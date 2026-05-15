/**
 * Cloud Tasks enqueuer — strategy-worker + strategy-html-worker
 *
 * Vercel-side fire-and-forget：寫 platform_jobs pending 後立刻 enqueue → 不卡 dialogue 回應。
 * 兩條 worker 都在 Cloud Run，繞開 Vercel 300s lambda 上限。
 *
 * 實作：完全 fetch + Node crypto，**不** import @google-cloud/tasks SDK
 *   原因：SDK 內部有 dynamic require，Turbopack bundle 時會炸
 *         "Cannot find module as expression is too dynamic"，
 *         即便 await import() 也救不回來（Vercel 多次驗證）。
 *   做法：手簽 RS256 JWT → 換 access_token → POST Cloud Tasks REST v2 API。
 *
 * 依賴：
 * - env STRATEGY_ENQUEUER_KEY_JSON（service account key for strategy-enqueuer@zhu-cloud-2026）
 * - 該 SA 已 grant：cloudtasks.enqueuer (兩條 queue)、serviceAccountTokenCreator (self)、run.invoker (兩條 service)
 *
 * 失敗策略：throw — 由 caller 決定是否寫 Firestore *_EnqueueError，不擋主流程。
 */
import { createSign } from 'node:crypto';

const PROJECT = 'zhu-cloud-2026';
const LOCATION = 'asia-east1';
const ENQUEUER_SA = 'strategy-enqueuer@zhu-cloud-2026.iam.gserviceaccount.com';

// strategy-worker（兩段 LLM + docx）
const STRATEGY_QUEUE = 'strategy-tasks';
const STRATEGY_WORKER_URL = 'https://strategy-worker-754631848156.asia-east1.run.app/';
const STRATEGY_WORKER_AUDIENCE = 'https://strategy-worker-754631848156.asia-east1.run.app';

// strategy-html-worker（接 strategy 完成後出 HTML）
const HTML_QUEUE = 'strategy-html';
const HTML_WORKER_URL = 'https://strategy-html-worker-754631848156.asia-east1.run.app/';
const HTML_WORKER_AUDIENCE = 'https://strategy-html-worker-754631848156.asia-east1.run.app';

interface SaKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

let _key: SaKey | null = null;
function getKey(): SaKey {
  if (_key) return _key;
  const keyJson = (process.env.STRATEGY_ENQUEUER_KEY_JSON || '').replace(/^"|"$/g, '');
  if (!keyJson) throw new Error('STRATEGY_ENQUEUER_KEY_JSON missing');
  _key = JSON.parse(keyJson) as SaKey;
  return _key;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// In-memory access_token cache（50 min TTL，Google 預設 1h）
let _token: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.expiresAt - 60 > now) return _token.value;

  const key = getKey();
  const header = { alg: 'RS256', typ: 'JWT', kid: key.private_key_id };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(key.private_key);
  const assertion = `${signingInput}.${b64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth token exchange failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  _token = { value: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

async function createTask(queueName: string, workerUrl: string, audience: string, payload: object): Promise<string> {
  const token = await getAccessToken();
  const parent = `projects/${PROJECT}/locations/${LOCATION}/queues/${queueName}`;
  const url = `https://cloudtasks.googleapis.com/v2/${parent}/tasks`;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: workerUrl,
          headers: { 'Content-Type': 'application/json' },
          body,
          oidcToken: {
            serviceAccountEmail: ENQUEUER_SA,
            audience,
          },
        },
        dispatchDeadline: '1800s',
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Cloud Tasks createTask failed: ${res.status} ${txt.slice(0, 400)}`);
  }
  const json = await res.json() as { name?: string };
  return json.name || '<unknown>';
}

export async function enqueueStrategy(jobId: string): Promise<string> {
  const taskName = await createTask(STRATEGY_QUEUE, STRATEGY_WORKER_URL, STRATEGY_WORKER_AUDIENCE, { jobId });
  console.log(`[cloud-tasks] enqueued strategy job=${jobId.slice(0, 8)} task=${taskName.split('/').pop()}`);
  return taskName;
}

export async function enqueueStrategyHtml(jobId: string, philosophy: 'eastern-blank' | 'swiss-grid' | 'dark-premium' = 'swiss-grid'): Promise<string> {
  const taskName = await createTask(HTML_QUEUE, HTML_WORKER_URL, HTML_WORKER_AUDIENCE, { jobId, philosophy });
  console.log(`[cloud-tasks] enqueued strategy-html job=${jobId.slice(0, 8)} task=${taskName.split('/').pop()}`);
  return taskName;
}

// research-worker（索 + web_search → 回 platform_research_jobs）
// TODO STEP 3: 部署後更新這三個常數（queue 需在 GCP 建立，URL 從 Cloud Run deploy 取得）
const RESEARCH_QUEUE = 'research-tasks';
const RESEARCH_WORKER_URL = 'https://research-worker-754631848156.asia-east1.run.app/';
const RESEARCH_WORKER_AUDIENCE = 'https://research-worker-754631848156.asia-east1.run.app';

export async function enqueueResearch(jobId: string): Promise<string> {
  const taskName = await createTask(RESEARCH_QUEUE, RESEARCH_WORKER_URL, RESEARCH_WORKER_AUDIENCE, { jobId });
  console.log(`[cloud-tasks] enqueued research job=${jobId.slice(0, 8)} task=${taskName.split('/').pop()}`);
  return taskName;
}
