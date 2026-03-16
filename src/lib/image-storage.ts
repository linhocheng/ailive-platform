/**
 * 圖片持久化工具
 * MiniMax 生成的圖片 URL 會過期。
 * 下載後上傳到 Firebase Storage，回傳永久 URL。
 *
 * 邊界原則：這是程式碼的事，不是 Claude 的事。
 * 參考：靈魂拍立得 image-storage 模式
 */
import { getFirebaseAdmin } from './firebase-admin';

const TAG = '[ImageStorage]';

export async function persistImage(
  tempUrl: string,
  path: string,
): Promise<string> {
  try {
    const admin = getFirebaseAdmin();
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;

    if (!bucketName || bucketName === 'undefined') {
      console.warn(`${TAG} Storage bucket 未設定，回傳原始 URL`);
      return tempUrl;
    }

    console.log(`${TAG} 使用 bucket: ${bucketName}`);

    const response = await fetch(tempUrl);
    if (!response.ok) {
      console.warn(`${TAG} 下載圖片失敗 (HTTP ${response.status})，回傳原始 URL`);
      return tempUrl;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    console.log(`${TAG} 圖片下載完成 (${(buffer.length / 1024).toFixed(0)} KB)`);

    const file = bucket.file(path);
    await file.save(buffer, {
      metadata: { contentType },
    });
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${path}`;
    console.log(`${TAG} ✅ 持久化完成: ${path}`);
    return publicUrl;
  } catch (err: any) {
    console.error(`${TAG} ❌ 持久化失敗: ${err.message}`);
    return tempUrl;
  }
}

export function generateImagePath(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 10);
  return `${prefix}/${date}/${id}.jpg`;
}
