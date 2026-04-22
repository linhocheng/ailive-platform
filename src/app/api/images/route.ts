/**
 * /api/images — 對話生圖檔案夾
 *
 * GET ?characterId=xxx → 撈所有對話中的 assistant imageUrl
 * DELETE ?url=xxx&conversationId=xxx → 從對話中移除該圖的 imageUrl
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

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

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const url = req.nextUrl.searchParams.get('url');
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!url || !conversationId) return NextResponse.json({ error: 'url, conversationId 必填' }, { status: 400 });

    const convRef = db.collection('platform_conversations').doc(conversationId);
    const convDoc = await convRef.get();
    if (!convDoc.exists) return NextResponse.json({ error: '對話不存在' }, { status: 404 });

    const messages = (convDoc.data()!.messages || []) as Array<Record<string, unknown>>;
    const targetUrl = url.replace(/\n/g, '').trim();
    const updated = messages.map(m => {
      // 1. 移除 assistant 自生圖
      if (m.role === 'assistant') {
        const mUrl = (m.imageUrl as string || '').replace(/\n/g, '').trim();
        if (mUrl === targetUrl) {
          const { imageUrl: _, ...rest } = m;
          void _;
          return rest;
        }
      }
      // 2. 移除 specialist 交件圖（清 output.imageUrl，保留 workLog 等其他欄位）
      if (m.role === 'system_event' && m.eventType === 'specialist_delivered') {
        const output = m.output as { imageUrl?: string } | undefined;
        const oUrl = (output?.imageUrl || '').replace(/\n/g, '').trim();
        if (oUrl === targetUrl) {
          // 保留 system_event 其他資訊，只把 output.imageUrl 清空
          const newOutput = output ? { ...output, imageUrl: undefined } : undefined;
          return { ...m, output: newOutput };
        }
      }
      return m;
    });

    await convRef.update({ messages: updated });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
