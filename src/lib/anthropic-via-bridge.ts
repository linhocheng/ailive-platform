/**
 * Anthropic via bridge — 把 Anthropic SDK call 轉發到 zhu-bridge（claude CLI Max OAuth）
 *
 * 目的：把 batch routes 從 per-token API key billing 切到 Claude Max 月費。
 * 用法：原本 `new Anthropic({ apiKey })` 換成 `getAnthropicClient(apiKey)`。
 *
 * Bridge 回應 shape 已經 mimic Anthropic Messages API。
 * Bridge 失敗一律 throw，**不 fallback SDK**（避免雙燒：bridge VM 繼續跑 + API key 也燒）。
 * 失敗時 caller 自己決定要不要重試 — 前台會看到 500，這是設計選擇。
 *
 * Timeout 預設 280s：對齊 300s lambda（留 20s 收尾）。
 * Short-lambda caller（120/60s）必傳 bridgeTimeoutMs（= maxDuration - 10s）。
 */
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_BRIDGE_TIMEOUT_MS = 280_000;

export class AnthropicBridge {
  public messages: {
    create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };

  constructor(bridgeUrl: string, secret: string, bridgeTimeoutMs?: number) {
    const url = bridgeUrl.replace(/\/$/, '');
    const timeoutMs = bridgeTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
    this.messages = {
      create: async (args) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const r = await fetch(`${url}/v1/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${secret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: args.model,
              max_tokens: args.max_tokens,
              system: args.system,
              messages: args.messages,
            }),
            signal: ctrl.signal,
          });
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`bridge ${r.status}: ${body.slice(0, 200)}`);
          }
          return (await r.json()) as Anthropic.Message;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }
}

/**
 * 依環境變數決定回 bridge client 還是原本 SDK。
 *
 * 環境變數：
 * - BRIDGE_ENABLED=true  ← master switch（false 時直接走 SDK 燒 API key）
 * - BRIDGE_URL           ← e.g. https://bridge.soul-polaroid.work
 * - BRIDGE_SECRET        ← Bearer token
 *
 * 任何一項缺失 → 回退原本 SDK（這是顯式 config 切換，不是失敗時的隱式救援）
 */
export function getAnthropicClient(
  apiKey: string,
  opts?: { bridgeTimeoutMs?: number },
): Anthropic | AnthropicBridge {
  const enabled = process.env.BRIDGE_ENABLED === 'true';
  const url = process.env.BRIDGE_URL;
  const secret = process.env.BRIDGE_SECRET;
  if (enabled && url && secret) {
    return new AnthropicBridge(url, secret, opts?.bridgeTimeoutMs);
  }
  return new Anthropic({ apiKey });
}
