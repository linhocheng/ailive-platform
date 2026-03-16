/**
 * Instagram Graph API — 貼文發佈
 *
 * 流程：建立 container → 發佈 container
 * 參考：https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/
 *
 * Token 類型對應 API base：
 * - Instagram Login token → graph.instagram.com（你的 token 用 me 可取得 id）
 * - Facebook Login / Page token → graph.facebook.com
 */
const GRAPH_BASE = 'https://graph.instagram.com/v21.0';

/** 輪詢 container 狀態，最久 30 秒，每 2 秒查一次。回傳 FINISHED 或最終狀態。 */
async function waitForContainerReady(
  containerId: string,
  tokenParam: string,
  maxWaitMs = 30000,
  intervalMs = 2000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code&${tokenParam}`,
    );
    const data = await res.json();
    const status = data.status_code ?? data.status ?? 'UNKNOWN';
    if (status === 'FINISHED') return status;
    if (status === 'ERROR' || status === 'EXPIRED') return status;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return 'TIMEOUT';
}

export type PublishResult =
  | { success: true; ig_post_id: string }
  | { success: false; error: string };

/**
 * 發佈單張圖片到 Instagram
 * @param igUserId - IG 使用者 ID（Business/Creator 帳號）
 * @param accessToken - 有效 access token（需 instagram_content_publish 權限）
 * @param imageUrl - 圖片公開 URL（IG 會直接 fetch，必須 HTTPS、可存取）
 * @param caption - 貼文 caption
 */
export async function publishPhoto(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
): Promise<PublishResult> {
  const tokenParam = `access_token=${encodeURIComponent(accessToken)}`;

  // Step 1: 建立 media container
  const createUrl = `${GRAPH_BASE}/${igUserId}/media?${tokenParam}`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption,
      media_type: 'IMAGE',
    }),
  });

  const createData = await createRes.json();
  if (createData.error) {
    return {
      success: false,
      error: createData.error.message || JSON.stringify(createData.error),
    };
  }

  const containerId = createData.id;
  if (!containerId) {
    return { success: false, error: 'IG API 未回傳 container id' };
  }

  // 等待 container 處理完成（圖片需時間 fetch，否則 media_publish 會回 Media ID is not available）
  const status = await waitForContainerReady(containerId, tokenParam);
  if (status !== 'FINISHED') {
    return { success: false, error: `Container 未就緒 (status: ${status})，請稍後重試` };
  }

  // Step 2: 發佈 container
  const publishUrl = `${GRAPH_BASE}/${igUserId}/media_publish?${tokenParam}`;
  const publishRes = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId }),
  });

  const publishData = await publishRes.json();
  if (publishData.error) {
    return {
      success: false,
      error: publishData.error.message || JSON.stringify(publishData.error),
    };
  }

  const igPostId = publishData.id;
  if (!igPostId) {
    return { success: false, error: 'IG API 未回傳貼文 id' };
  }

  return { success: true, ig_post_id: igPostId };
}
