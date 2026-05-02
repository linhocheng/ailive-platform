/**
 * Anthropic via bridge — 把 Anthropic SDK call 轉發到 zhu-bridge（claude CLI Max OAuth）
 *
 * 目的：把 batch routes 從 per-token API key billing 切到 Claude Max 月費。
 * 用法：原本 `new Anthropic({ apiKey })` 換成 `getAnthropicClient(apiKey)`。
 *
 * Bridge 回應 shape 已經 mimic Anthropic Messages API。
 * Bridge 失敗時會 fallback 到原本的 SDK（同 request 內救回，user 無感）。
 */
import Anthropic from '@anthropic-ai/sdk';

const BRIDGE_TIMEOUT_MS = 90_000;

export class AnthropicBridge {
  public messages: {
    create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };

  constructor(bridgeUrl: string, secret: string, apiKey?: string) {
    const url = bridgeUrl.replace(/\/$/, '');
    this.messages = {
      create: async (args) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
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
        } catch (bridgeErr) {
          if (apiKey) {
            console.warn('[anthropic-via-bridge] fallback to SDK:', bridgeErr instanceof Error ? bridgeErr.message : bridgeErr);
            const sdk = new Anthropic({ apiKey });
            return sdk.messages.create(args);
          }
          throw bridgeErr;
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
 * - BRIDGE_ENABLED=true  ← master switch
 * - BRIDGE_URL           ← e.g. https://bridge.soul-polaroid.work
 * - BRIDGE_SECRET        ← Bearer token
 *
 * 任何一項缺失 → 回退原本 SDK（不破壞既有部署）
 */
export function getAnthropicClient(apiKey: string): Anthropic | AnthropicBridge {
  const enabled = process.env.BRIDGE_ENABLED === 'true';
  const url = process.env.BRIDGE_URL;
  const secret = process.env.BRIDGE_SECRET;
  if (enabled && url && secret) {
    return new AnthropicBridge(url, secret, apiKey);
  }
  return new Anthropic({ apiKey });
}
