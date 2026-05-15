/**
 * /api/specialist/strategy-html
 *
 * 策略書 HTML 設計版 follow-up worker。
 *
 * 流程：
 * 1. 驗證 x-worker-secret
 * 2. 從 platform_jobs 撈 mdContent + docTitle（Step 0 已落 DB）
 * 3. bridge call → HTML（system prompt 帶 PHILOSOPHY + reference HTML）
 * 4. 七題自查（hero/toc/end 必出、無 AI tell 字體 / 金色 / 紫漸層）
 * 5. Storage 上 public，寫回 jobs.htmlUrl + push system_event
 *
 * 觸發來源：strategy/route.ts 完成後 fire-and-forget（同 internal dispatch 套路）
 *
 * @author 築 · 2026-05-10 晚 · Strategy HTML Phase 1
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore, getFirebaseAdmin } from '@/lib/firebase-admin';
import { buildSystemPrompt, buildUserPrompt, type PhilosophyKey } from '@/lib/strategy-html/prompt';
import { qaHtml } from '@/lib/strategy-html/qa';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-worker-secret') || '';
  const expectedSecret = (process.env.WORKER_SECRET || '').replace(/^"|"$/g, '').trim();
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json() as {
    jobId: string;
    philosophy?: PhilosophyKey;
  };
  const { jobId } = body;
  const philosophy: PhilosophyKey = body.philosophy || 'eastern-blank';
  if (!jobId) return NextResponse.json({ error: 'jobId 必填' }, { status: 400 });

  const db = getFirestore();

  try {
    // 1. 撈 mdContent + 元資訊
    const jobRef = db.collection('platform_jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) throw new Error(`job ${jobId} 不存在`);
    const job = jobDoc.data()!;

    const mdContent = String(job.mdContent || '');
    if (!mdContent) throw new Error(`job ${jobId} 缺 mdContent（Step 0 還沒生效？）`);

    const docTitle = String(job.result?.docTitle || '策略規劃書');
    const assigneeId = String(job.assigneeId || '');
    const requesterConvId = String(job.requesterConvId || '');

    console.log(`[strategy-html] job=${jobId.slice(0, 8)} title="${docTitle}" mdChars=${mdContent.length} philosophy=${philosophy}`);

    // 2. bridge call → HTML
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/^"|"$/g, '');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
    const anthropic = getAnthropicClient(apiKey);

    const t0 = Date.now();
    const sysPrompt = buildSystemPrompt(philosophy);
    const userPrompt = buildUserPrompt(mdContent, docTitle);

    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: sysPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let html = (res.content[0] as { text: string }).text.trim();
    const stopReason = res.stop_reason;
    const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };

    // strip ```html fence if model snuck one in
    html = html.replace(/^```html\s*\n/i, '').replace(/\n```\s*$/i, '');

    console.log(`[strategy-html] generated ${html.length}B in ${elapsed}s | stop=${stopReason} | tok in=${usage.input} out=${usage.output}`);

    // 3. 七題自查
    const qa = qaHtml(html, philosophy);
    if (!qa.ok) {
      const tail = html.slice(-300).replace(/\s+/g, ' ');
      console.warn(`[strategy-html] QA FAILED: ${qa.reasons.join(', ')} | bytes=${html.length} stop=${stopReason} out=${usage.output} | tail="${tail}"`);
      // 失敗時把 stop / bytes / tail 寫進 Firestore 方便除錯
      try {
        await jobRef.update({
          htmlError: `QA failed: ${qa.reasons.join('; ')} | stop=${stopReason} bytes=${html.length} out=${usage.output}`,
          htmlDebugTail: tail,
          htmlGeneratedAt: new Date().toISOString(),
        });
      } catch {}
      throw new Error(`QA failed: ${qa.reasons.join('; ')} | stop=${stopReason} bytes=${html.length} out=${usage.output}`);
    }

    // 4. Storage 上傳 public
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeTitle = docTitle.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
    const filename = `${safeTitle || 'strategy'}-${date}.html`;
    const filePath = `platform-strategy-html/${assigneeId}/${jobId}-${filename}`;
    const file = bucket.file(filePath);
    await file.save(html, {
      metadata: {
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'public, max-age=300',
      },
    });
    await file.makePublic();
    const htmlUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    // 5. 寫回 jobs + 推 system_event（沿用 strategy 的 schema）
    await jobRef.update({
      htmlUrl,
      htmlPhilosophy: philosophy,
      htmlBytes: html.length,
      htmlGeneratedAt: new Date().toISOString(),
    });

    if (requesterConvId) {
      try {
        await db.collection('platform_conversations').doc(requesterConvId).update({
          messages: admin.firestore.FieldValue.arrayUnion({
            role: 'system_event',
            eventType: 'strategy_html_delivered',
            jobId,
            output: { type: 'html', htmlUrl, title: docTitle, philosophy },
            timestamp: new Date().toISOString(),
          }),
          messageCount: admin.firestore.FieldValue.increment(1),
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[strategy-html] system_event push failed:', e);
      }
    }

    console.log(`[strategy-html] done | url=${htmlUrl.slice(-60)}`);

    return NextResponse.json({
      ok: true,
      htmlUrl,
      bytes: html.length,
      philosophy,
      qa: qa.metrics,
      stopReason,
      usage,
      elapsed: Number(elapsed),
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[strategy-html] error: ${msg}`);
    // 失敗時不動 jobs.status（jobs.status 已被 strategy route 標 done），只塞 htmlError
    try {
      await db.collection('platform_jobs').doc(jobId).update({
        htmlError: msg,
        htmlGeneratedAt: new Date().toISOString(),
      });
    } catch {}
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
