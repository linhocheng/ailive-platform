/**
 * 語義向量工具（Vertex AI text-embedding-004）
 * 把文字變成向量，讓記憶可以用意思搜尋，不是碰關鍵字。
 *
 * 靈魂工程學：覺察要有料。Vector Search 讓料找得到。
 */
import { GoogleAuth } from 'google-auth-library';

const EMBEDDING_MODEL = 'text-embedding-004';
const DIMENSION = 256;

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (authClient) return authClient;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa = JSON.parse(saJson);
    authClient = new GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  } else {
    authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return authClient;
}

function getProjectId(): string {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    return JSON.parse(saJson).project_id;
  }
  return process.env.FIREBASE_PROJECT_ID || '';
}

/**
 * 把一段文字變成語義向量
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const auth = getAuth();
  const tokenResult = await auth.getAccessToken();
  const accessToken = typeof tokenResult === 'string' ? tokenResult : (tokenResult as any)?.token || '';
  const projectId = getProjectId();

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${EMBEDDING_MODEL}:predict`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ content: text }],
      parameters: { outputDimensionality: DIMENSION },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding 失敗 (${response.status}): ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const values = data.predictions?.[0]?.embeddings?.values;

  if (!values || !Array.isArray(values)) {
    throw new Error('Embedding 回傳格式異常');
  }

  return values;
}

/**
 * 把任意文件的關鍵資訊合併成一個可向量化的字串
 * 自動偵測欄位名稱，支援 memories、xinfa、任何有文字內容的文件
 */
export function docToText(data: Record<string, unknown>): string {
  const parts = [];
  // memories
  if (data.feeling) parts.push(String(data.feeling));
  if (data.want_to_keep) parts.push(String(data.want_to_keep));
  if (data.moment && typeof data.moment === 'string') parts.push(data.moment);
  // xinfa
  if (data.title) parts.push(String(data.title));
  if (data.content) parts.push(String(data.content));
  if (data.principle) parts.push(String(data.principle));
  // general
  if (data.observation) parts.push(String(data.observation));
  if (data.summary) parts.push(String(data.summary));
  if (data.caption) parts.push(String(data.caption));
  return parts.join(' ').slice(0, 2000);
}

// backward compat
export const memoryToText = docToText;

export const EMBEDDING_DIMENSION = DIMENSION;
