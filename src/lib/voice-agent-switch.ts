/**
 * ailive-realtime-agent 開關制（需求喚醒＋閒置自關）
 *
 * 背景：LiveKit agent 是出站連 LiveKit 註冊 worker，Cloud Run 不會因來電自己醒——
 * min-instances=0 = 聾。常駐又是磚頭費（~$60/月）。開關制：
 *   - 開：/api/livekit/wake（進撥號頁自動打）→ minInstances 0→1
 *   - 關：/api/livekit/agent-sleep（cron 每 20 分）→ 無活躍通話且閒置 30 分 → 1→0
 *
 * 走 Cloud Run Admin REST v2 + 手簽 JWT（不用 @google-cloud SDK：Turbopack 會炸，
 * 見 cloud-tasks.ts 同款做法）。SA = voice-switch@ailive-realtime-2026（run.developer
 * + actAs runtime SA），key 在 env VOICE_SWITCH_SA_KEY_JSON。
 *
 * 鑑別信號（不能只看設定面）：
 *   - 活著 = Firestore system_status/voice_agent.agentBootAt > lastSleepAt
 *     （agent main.py 開機蓋章；容器沒起來這個章不可能出現）
 *   - 每次 PATCH 都生新 revision（含一顆 ≤15 分鐘的計費驗證實例），所以所有寫入
 *     操作都先讀現值、值已相同就不動（冪等防抖）。
 */
import { createSign } from 'crypto';
import { RoomServiceClient } from 'livekit-server-sdk';
import { getFirestore } from '@/lib/firebase-admin';

const PROJECT = 'ailive-realtime-2026';
const REGION = 'asia-east1';
const SERVICE = 'ailive-realtime-agent';
const SERVICE_URL = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}`;
const ROOM_PREFIX = 'realtime-'; // token route 的房名格式；LiveKit project 與江彬共用，只認自家房

interface SaKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

let _key: SaKey | null = null;
function getKey(): SaKey {
  if (_key) return _key;
  const keyJson = (process.env.VOICE_SWITCH_SA_KEY_JSON || '').replace(/^"|"$/g, '');
  if (!keyJson) throw new Error('VOICE_SWITCH_SA_KEY_JSON missing');
  _key = JSON.parse(keyJson) as SaKey;
  return _key;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

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
    throw new Error(`OAuth token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  _token = { value: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

interface CloudRunService {
  template?: { scaling?: { minInstanceCount?: number } };
  latestReadyRevision?: string;
  [k: string]: unknown;
}

async function getService(): Promise<CloudRunService> {
  const token = await getAccessToken();
  const res = await fetch(SERVICE_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET service failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<CloudRunService>;
}

function minInstancesOf(svc: CloudRunService): number {
  return svc.template?.scaling?.minInstanceCount ?? 0;
}

/** GET→改→PATCH 整包回寫。值相同時呼叫端要自己擋（每次 PATCH 都生新 revision）。 */
async function setMinInstances(svc: CloudRunService, n: 0 | 1): Promise<void> {
  const token = await getAccessToken();
  svc.template = svc.template || {};
  svc.template.scaling = { ...(svc.template.scaling || {}), minInstanceCount: n };
  const res = await fetch(SERVICE_URL, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(svc),
  });
  if (!res.ok) throw new Error(`PATCH service failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
}

function statusRef() {
  return getFirestore().collection('system_status').doc('voice_agent');
}

interface TsLike { toDate?: () => Date }
function asDate(v: unknown): Date | null {
  const d = (v as TsLike)?.toDate?.();
  return d instanceof Date ? d : null;
}

/** agentBootAt 在上次熄燈之後 = 有實例活著（main.py 開機蓋的章） */
function isAlive(d: Record<string, unknown>): boolean {
  const boot = asDate(d.agentBootAt);
  if (!boot) return false;
  const sleep = asDate(d.lastSleepAt);
  return !sleep || boot > sleep;
}

export interface VoiceAgentState {
  state: 'ready' | 'waking';
  minInstances: number;
}

/** 撥號頁進場：需要就開機，並蓋活動章（給 sleep cron 判斷閒置用） */
export async function wakeVoiceAgent(): Promise<VoiceAgentState> {
  const svc = await getService();
  const ref = statusRef();
  const snap = await ref.get();
  const d = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const now = new Date();

  if (minInstancesOf(svc) >= 1) {
    await ref.set({ lastActivityAt: now }, { merge: true });
    return { state: isAlive(d) ? 'ready' : 'waking', minInstances: minInstancesOf(svc) };
  }

  await setMinInstances(svc, 1);
  await ref.set({ lastWakeAt: now, lastActivityAt: now }, { merge: true });
  return { state: 'waking', minInstances: 1 };
}

/** 前端輪詢用：只讀不寫 */
export async function voiceAgentStatus(): Promise<VoiceAgentState> {
  const svc = await getService();
  const snap = await statusRef().get();
  const d = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const min = minInstancesOf(svc);
  return { state: min >= 1 && isAlive(d) ? 'ready' : 'waking', minInstances: min };
}

async function listActiveRealtimeRooms(): Promise<number> {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) throw new Error('LIVEKIT_* env missing');
  const httpUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const rooms = await client.listRooms();
  return rooms.filter(r => r.name.startsWith(ROOM_PREFIX) && r.numParticipants > 0).length;
}

export interface SleepResult {
  action: 'already-off' | 'active-call' | 'recently-active' | 'slept';
  activeRooms?: number;
  lastActivityAt?: string;
}

/** cron：無活躍通話且閒置超過 idleMinutes 才熄燈 */
export async function sleepVoiceAgentIfIdle(idleMinutes = 30): Promise<SleepResult> {
  const svc = await getService();
  if (minInstancesOf(svc) === 0) return { action: 'already-off' };

  const ref = statusRef();
  const activeRooms = await listActiveRealtimeRooms();
  if (activeRooms > 0) {
    // 通話中：續活動章，讓掛斷後還有完整的閒置緩衝
    await ref.set({ lastActivityAt: new Date() }, { merge: true });
    return { action: 'active-call', activeRooms };
  }

  const snap = await ref.get();
  const d = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const last = [asDate(d.lastActivityAt), asDate(d.lastWakeAt)]
    .filter((x): x is Date => !!x)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (last && Date.now() - last.getTime() < idleMinutes * 60_000) {
    return { action: 'recently-active', lastActivityAt: last.toISOString() };
  }

  await setMinInstances(svc, 0);
  await ref.set({ lastSleepAt: new Date() }, { merge: true });
  return { action: 'slept', lastActivityAt: last?.toISOString() };
}
