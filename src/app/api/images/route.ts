/**
 * /api/images — 對話生圖檔案夾
 *
 * GET ?characterId=xxx → 撈所有對話中的 assistant imageUrl
 * DELETE ?url=xxx&conversationId=xxx&jobId=xxx → 徹底刪除一張圖（三源清）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    interface ImageRec {
      url: string;
      conversationId: string;
      timestamp: string;
      source: 'self' | string;         // 'self' = 角色自己生的; 'specialist:{id}' = 瞬等 specialist 交件
      specialistName?: string;
      workLog?: string;                // 瞬的工作日誌（只有 specialist 圖才有）
      jobId?: string;
      brief?: string;                  // specialist job 的 brief（補來源時有）
    }
    const images: ImageRec[] = [];
    const seenJobIds = new Set<string>();   // 去重：已見過的 jobId（primary key）
    const seenUrls = new Set<string>();      // 去重：已見過的 url（fallback，應付缺 jobId 的狀況）

    const cleanHttpUrl = (raw: string): string | null => {
      const u = (raw || '').replace(/\n/g, '').trim();
      return u.startsWith('http') ? u : null;
    };

    // ── 源 1：conversation messages（對話實況，含 self 生圖 + specialist 交件）──
    const convSnap = await db.collection('platform_conversations')
      .where('characterId', '==', characterId)
      .limit(100)
      .get();

    for (const doc of convSnap.docs) {
      const data = doc.data();
      const messages = (data.messages || []) as Array<Record<string, unknown>>;
      for (const m of messages) {
        const role = m.role as string;
        const timestamp = (m.timestamp as string) || '';

        // 1a. 角色自己生的圖（舊 generate_image tool 路徑）
        if (role === 'assistant') {
          const url = cleanHttpUrl(m.imageUrl as string);
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            images.push({ url, conversationId: doc.id, timestamp, source: 'self' });
          }
        }

        // 1b. specialist 交件（Phase 2 非同步委託 system_event）
        if (role === 'system_event' && m.eventType === 'specialist_delivered') {
          const output = m.output as { imageUrl?: string } | undefined;
          const url = output?.imageUrl ? cleanHttpUrl(output.imageUrl) : null;
          if (url && !seenUrls.has(url)) {
            const specialistId = (m.specialistId as string) || '';
            const jobId = (m.jobId as string) || '';
            seenUrls.add(url);
            if (jobId) seenJobIds.add(jobId);
            images.push({
              url,
              conversationId: doc.id,
              timestamp,
              source: specialistId ? `specialist:${specialistId}` : 'specialist',
              specialistName: (m.specialistName as string) || undefined,
              workLog: (m.workLog as string) || undefined,
              jobId: jobId || undefined,
            });
          }
        }
      }
    }

    // ── 源 2：platform_jobs（作品真相源，撈所有 done 的 specialist 交件）──
    // 為什麼需要：race 或壓縮可能把 messages 裡的 system_event 洗掉，但 jobs 記錄永遠在
    // 架構意義：Conversation 是對話記錄、Jobs 是作品檔案，各司其職
    try {
      const jobsSnap = await db.collection('platform_jobs')
        .where('requesterId', '==', characterId)
        .limit(500)
        .get();

      for (const jd of jobsSnap.docs) {
        const j = jd.data();
        if (j.status !== 'done') continue;
        const output = j.output as { imageUrl?: string; workLog?: string } | undefined;
        const url = output?.imageUrl ? cleanHttpUrl(output.imageUrl) : null;
        if (!url) continue;
        // 去重：若 job 對應的 system_event 已被源 1 帶進，跳過
        if (seenJobIds.has(jd.id) || seenUrls.has(url)) continue;

        const assigneeId = (j.assigneeId as string) || '';
        seenJobIds.add(jd.id);
        seenUrls.add(url);
        images.push({
          url,
          conversationId: (j.requesterConvId as string) || '',
          // 優先用 completedAt 當對話 timeline 時間；若沒有退 createdAt
          timestamp: (j.completedAt as string) || (j.createdAt as string) || '',
          source: assigneeId ? `specialist:${assigneeId}` : 'specialist',
          specialistName: assigneeId === 'shun-001' ? '瞬' : undefined,
          workLog: output?.workLog || undefined,
          jobId: jd.id,
          brief: (j.brief as { prompt?: string } | undefined)?.prompt || undefined,
        });
      }
    } catch (jobsErr) {
      // jobs 撈失敗不阻斷主流程（index 未建等例外）
      console.warn('[images] jobs fallback failed:', jobsErr);
    }

    // 按時間排序（最新在前）
    images.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return NextResponse.json({ images, total: images.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * DELETE — 徹底刪除一張圖（三源清）
 *   1. platform_conversations.messages：清 self imageUrl / 移除 specialist_delivered 整條 event（含 workLog）
 *   2. platform_jobs/{jobId}：整個 doc delete（含 workLog / brief / output）
 *   3. Firebase Storage 實體 PNG：依 URL 解析 path，白名單校驗後刪
 * 不可回復。Adam 手動觸發，低頻。
 */
export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const url = req.nextUrl.searchParams.get('url');
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    const jobId = req.nextUrl.searchParams.get('jobId');
    if (!url) return NextResponse.json({ error: 'url 必填' }, { status: 400 });
    const targetUrl = url.replace(/\n/g, '').trim();

    const result: {
      conv: boolean;
      job: boolean;
      storage: boolean;
      convErr?: string;
      jobErr?: string;
      storageErr?: string;
    } = { conv: false, job: false, storage: false };

    // 1. 清 conversation.messages — 用 transaction 包住，避免和 dialogue / jobWorker race
    //    （4-22 lesson：messages 是多 writer collection，禁讀-改-寫；DELETE 又必須精確 slice，
    //     用 transaction 是唯一安全做法）
    if (conversationId) {
      try {
        const convRef = db.collection('platform_conversations').doc(conversationId);
        const convChanged = await db.runTransaction(async (tx) => {
          const snap = await tx.get(convRef);
          if (!snap.exists) return false;
          const messages = (snap.data()!.messages || []) as Array<Record<string, unknown>>;
          let changed = false;
          const updated: Array<Record<string, unknown>> = [];
          for (const m of messages) {
            if (m.role === 'assistant') {
              const mUrl = ((m.imageUrl as string) || '').replace(/\n/g, '').trim();
              if (mUrl === targetUrl) {
                changed = true;
                const { imageUrl: _omit, ...rest } = m;
                void _omit;
                updated.push(rest);
                continue;
              }
            }
            if (m.role === 'system_event' && m.eventType === 'specialist_delivered') {
              const output = m.output as { imageUrl?: string } | undefined;
              const oUrl = ((output?.imageUrl as string) || '').replace(/\n/g, '').trim();
              if (oUrl === targetUrl) {
                changed = true;
                continue;
              }
            }
            updated.push(m);
          }
          if (changed) tx.update(convRef, { messages: updated });
          return changed;
        });
        if (convChanged) result.conv = true;
      } catch (e) {
        result.convErr = e instanceof Error ? e.message : String(e);
        console.warn('[DELETE images] conv cleanup failed:', e);
      }
    }

    // 2. 刪 platform_jobs doc
    if (jobId) {
      try {
        await db.collection('platform_jobs').doc(jobId).delete();
        result.job = true;
      } catch (e) {
        result.jobErr = e instanceof Error ? e.message : String(e);
        console.warn('[DELETE images] job delete failed:', e);
      }
    }

    // 3. 刪 Firebase Storage 實體 PNG
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname !== 'storage.googleapis.com') {
        throw new Error(`unexpected host: ${parsed.hostname}`);
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 2) throw new Error(`unexpected path: ${parsed.pathname}`);
      const urlBucketName = segments[0];
      const filePath = segments.slice(1).join('/');

      const ALLOWED_PREFIXES = [
        'platform-images/',
        'platform-specialist-images/',
        'platform-character-portraits/',
      ];
      if (!ALLOWED_PREFIXES.some(p => filePath.startsWith(p))) {
        throw new Error(`path not in allowed prefixes: ${filePath}`);
      }

      const admin = (await import('@/lib/firebase-admin')).getFirebaseAdmin();
      const bucket = admin.storage().bucket();
      if (bucket.name !== urlBucketName) {
        throw new Error(`bucket mismatch: url=${urlBucketName}, expected=${bucket.name}`);
      }

      try {
        await bucket.file(filePath).delete();
        result.storage = true;
      } catch (delErr: unknown) {
        const code = (delErr as { code?: number }).code;
        if (code === 404) {
          result.storage = true;
        } else {
          throw delErr;
        }
      }
    } catch (e) {
      result.storageErr = e instanceof Error ? e.message : String(e);
      console.warn('[DELETE images] storage cleanup failed:', e);
    }

    const anyHit = result.conv || result.job || result.storage;
    return NextResponse.json(
      { success: anyHit, ...result },
      { status: anyHit ? 200 : 404 }
    );
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
