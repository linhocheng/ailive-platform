'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 1 | 2 | 3 | 4 | 5;

interface CharacterDraft {
  name: string;
  type: 'vtuber' | 'brand_editor';
  mission: string;
  rawSoul: string;
  enhancedSoul: string;
  soulVersion: number;
  imagePromptPrefix: string;
  styleGuide: string;
  negativePrompt: string;
  lineChannelToken: string;
  lineChannelSecret: string;
  tasks: Array<{ type: string; run_hour: number; run_minute: number; days: string[]; description: string }>;
}

const STEPS = [
  { num: 1, label: '基本資料' },
  { num: 2, label: '鑄魂' },
  { num: 3, label: '視覺身份' },
  { num: 4, label: 'LINE 設定' },
  { num: 5, label: '排程任務' },
];

const DEFAULT_TASKS = [
  { type: 'learn', run_hour: 9, run_minute: 0, days: ['mon', 'tue', 'wed', 'thu', 'fri'], description: '每日主動學習' },
  { type: 'reflect', run_hour: 21, run_minute: 0, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], description: '每日省思' },
  { type: 'post', run_hour: 12, run_minute: 0, days: ['tue', 'thu', 'sat'], description: '生成 IG 草稿' },
];

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const TYPE_LABELS: Record<string, string> = { learn: '🎓 主動學習', reflect: '🌙 每日省思', post: '📝 生成草稿' };

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<CharacterDraft>({
    name: '', type: 'vtuber', mission: '', rawSoul: '', enhancedSoul: '', soulVersion: 0,
    imagePromptPrefix: '', styleGuide: 'realistic', negativePrompt: 'different face, inconsistent features',
    lineChannelToken: '', lineChannelSecret: '',
    tasks: DEFAULT_TASKS.map(t => ({ ...t })),
  });
  const [forging, setForging] = useState(false);
  const [forgeMsg, setForgeMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState('');

  const forge = async () => {
    if (!draft.rawSoul.trim()) return;
    setForging(true);
    setForgeMsg('鑄魂中...');

    // 先建臨時角色
    const cr = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name || '新角色', type: draft.type, mission: draft.mission, rawSoul: draft.rawSoul }),
    });
    const cd = await cr.json();
    const tmpId = cd.id;

    // 鑄魂
    const sr = await fetch('/api/soul-enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: tmpId }),
    });
    const sd = await sr.json();

    if (sd.success) {
      setDraft(prev => ({ ...prev, enhancedSoul: sd.enhancedSoul, soulVersion: sd.soulVersion, _tmpId: tmpId } as CharacterDraft & { _tmpId: string }));
      setForgeMsg(`✅ 鑄魂完成（v${sd.soulVersion}）`);
    } else {
      setForgeMsg(`❌ ${sd.error}`);
      // 刪掉臨時角色（TODO）
    }
    setForging(false);
  };

  const finish = async () => {
    setCreating(true);
    const tmpId = (draft as CharacterDraft & { _tmpId?: string })._tmpId;

    if (tmpId) {
      // 更新已建的角色
      await fetch(`/api/characters/${tmpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, mission: draft.mission,
          lineChannelToken: draft.lineChannelToken,
          lineChannelSecret: draft.lineChannelSecret,
          status: 'active',
          visualIdentity: {
            characterSheet: '',
            imagePromptPrefix: draft.imagePromptPrefix,
            styleGuide: draft.styleGuide,
            negativePrompt: draft.negativePrompt,
            fixedElements: [],
          },
        }),
      });

      // 建立排程任務
      for (const task of draft.tasks) {
        await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: tmpId, ...task, enabled: true }),
        });
      }

      setCreatedId(tmpId);
    }
    setCreating(false);
  };

  // 步驟驗收條件
  const canProceed: Record<Step, boolean> = {
    1: !!draft.name.trim() && !!draft.mission.trim(),
    2: !!draft.enhancedSoul,
    3: true,
    4: true,
    5: true,
  };

  const inputStyle = { width: '100%', border: '1px solid #e0e0e0', borderRadius: 8, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block' as const, fontSize: 13, color: '#666', marginBottom: 6 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8f9fa' }}>
      <header style={{ background: '#1a1a2e', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/dashboard" style={{ color: '#e0e0ff', textDecoration: 'none', fontSize: 18, fontWeight: 700 }}>AILIVE</a>
        <span style={{ color: '#666' }}>›</span>
        <span style={{ color: '#e0e0ff', fontSize: 14 }}>建立新角色</span>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>

        {/* 完成畫面 */}
        {createdId ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 60, marginBottom: 16 }}>🎉</div>
            <h2 style={{ color: '#1a1a2e', marginBottom: 8 }}>{draft.name} 已上線！</h2>
            <p style={{ color: '#666', marginBottom: 32 }}>角色已建立，排程任務已設定，靈魂已注入。</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <a href={`/dashboard/${createdId}`} style={{ background: '#1a1a2e', color: '#fff', padding: '12px 28px', borderRadius: 8, textDecoration: 'none', fontSize: 15, fontWeight: 600 }}>
                進入後台管理
              </a>
              <a href="/dashboard" style={{ background: '#f0f0f0', color: '#333', padding: '12px 24px', borderRadius: 8, textDecoration: 'none', fontSize: 15 }}>
                回到首頁
              </a>
            </div>
          </div>
        ) : (
          <>
            {/* 步驟指示器 */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
              {STEPS.map((s, i) => (
                <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: step > s.num ? '#2e7d32' : step === s.num ? '#1a1a2e' : '#e0e0e0',
                      color: step >= s.num ? '#fff' : '#999', fontSize: 14, fontWeight: 700,
                    }}>
                      {step > s.num ? '✓' : s.num}
                    </div>
                    <div style={{ fontSize: 11, color: step === s.num ? '#1a1a2e' : '#999', marginTop: 4, whiteSpace: 'nowrap' }}>{s.label}</div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: step > s.num ? '#2e7d32' : '#e0e0e0', margin: '0 4px', marginBottom: 16 }} />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1：基本資料 */}
            {step === 1 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 32 }}>
                <h2 style={{ margin: '0 0 24px', color: '#1a1a2e' }}>基本資料</h2>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>角色名稱 *</label>
                  <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                    style={inputStyle} placeholder="例如：Emily、小美" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>角色類型</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[['vtuber', '🎭 虛擬網紅', '有個性、有粉絲關係的創作型角色'], ['brand_editor', '📢 品牌小編', '代表品牌聲音、服務客戶的功能型角色']].map(([val, label, desc]) => (
                      <div key={val} onClick={() => setDraft({ ...draft, type: val as 'vtuber' | 'brand_editor' })}
                        style={{ flex: 1, border: `2px solid ${draft.type === val ? '#1a1a2e' : '#e0e0e0'}`, borderRadius: 10, padding: 14, cursor: 'pointer', background: draft.type === val ? '#f0f0f8' : '#fff' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 12, color: '#666' }}>{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>使命宣言 * （這個角色存在是為了什麼）</label>
                  <input value={draft.mission} onChange={e => setDraft({ ...draft, mission: e.target.value })}
                    style={inputStyle} placeholder="例如：陪伴追求美好生活的人，一起探索美學與真實的自我" />
                </div>
              </div>
            )}

            {/* Step 2：鑄魂 */}
            {step === 2 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 32 }}>
                <h2 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>注入靈魂</h2>
                <p style={{ color: '#666', margin: '0 0 24px', fontSize: 14 }}>用自然語言描述角色的個性、說話方式和世界觀，鑄魂爐會將它鑄造成七咒律格式。</p>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>原始人設描述</label>
                  <textarea value={draft.rawSoul} onChange={e => setDraft({ ...draft, rawSoul: e.target.value })}
                    rows={8} style={{ ...inputStyle, resize: 'vertical' as const, fontFamily: 'system-ui' }}
                    placeholder={`例如：我叫 ${draft.name || '角色名'}，是一個充滿創意的存在。我熱愛美學和真實的連結。說話直接但溫暖，喜歡用輕鬆的方式分享生活觀察。我相信美不是完美，而是真實...`} />
                </div>
                <button onClick={forge} disabled={forging || !draft.rawSoul.trim()}
                  style={{ width: '100%', background: forging ? '#ccc' : '#6c63ff', color: '#fff', border: 'none', borderRadius: 8, padding: 12, cursor: 'pointer', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                  {forging ? '🔥 鑄魂中...' : '⚡ 觸發鑄魂爐'}
                </button>
                {forgeMsg && <div style={{ fontSize: 13, color: forgeMsg.includes('❌') ? '#c00' : '#2e7d32', marginBottom: 12 }}>{forgeMsg}</div>}
                {draft.enhancedSoul && (
                  <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 16, maxHeight: 260, overflowY: 'auto' }}>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>七咒律靈魂預覽</div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#333' }}>{draft.enhancedSoul.slice(0, 600)}...</div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3：視覺身份 */}
            {step === 3 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 32 }}>
                <h2 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>視覺身份</h2>
                <p style={{ color: '#666', margin: '0 0 24px', fontSize: 14 }}>設定角色的生圖描述，確保每次生成的圖片臉部一致。可以之後再設定。</p>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>
                    imagePromptPrefix <span style={{ color: '#c00' }}>（必須英文）</span>
                  </label>
                  <input value={draft.imagePromptPrefix} onChange={e => setDraft({ ...draft, imagePromptPrefix: e.target.value })}
                    style={{ ...inputStyle, borderColor: /[\u4e00-\u9fff]/.test(draft.imagePromptPrefix) ? '#c00' : '#e0e0e0' }}
                    placeholder="e.g. A young woman with short brown hair, warm eyes," />
                  {/[\u4e00-\u9fff]/.test(draft.imagePromptPrefix) && <div style={{ color: '#c00', fontSize: 12, marginTop: 4 }}>⚠️ 含中文會導致生圖跑臉，請改成英文</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>生圖風格</label>
                    <select value={draft.styleGuide} onChange={e => setDraft({ ...draft, styleGuide: e.target.value })}
                      style={{ ...inputStyle }}>
                      <option value="realistic">Realistic（寫實）</option>
                      <option value="anime">Anime（動畫）</option>
                      <option value="illustration">Illustration（插畫）</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>負向提示</label>
                    <input value={draft.negativePrompt} onChange={e => setDraft({ ...draft, negativePrompt: e.target.value })}
                      style={inputStyle} />
                  </div>
                </div>
              </div>
            )}

            {/* Step 4：LINE 設定 */}
            {step === 4 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 32 }}>
                <h2 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>LINE 設定 <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>（選填）</span></h2>
                <p style={{ color: '#666', margin: '0 0 24px', fontSize: 14 }}>設定後可透過 LINE 與角色對話。之後可在後台的「身份設定」修改。</p>
                <div style={{ background: '#e8f4fd', borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13, color: '#1565c0' }}>
                  <strong>LINE Webhook URL：</strong><br />
                  <code style={{ wordBreak: 'break-all' }}>https://ailive-platform.vercel.app/api/line-webhook/[角色ID]</code><br />
                  <span style={{ fontSize: 12, color: '#666', marginTop: 4, display: 'block' }}>角色建立後才能確認 ID，請先填入 Token/Secret，再去 LINE Developer Console 設定 Webhook。</span>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Channel Access Token</label>
                  <input value={draft.lineChannelToken} onChange={e => setDraft({ ...draft, lineChannelToken: e.target.value })}
                    style={inputStyle} placeholder="從 LINE Developer Console 取得" />
                </div>
                <div>
                  <label style={labelStyle}>Channel Secret</label>
                  <input value={draft.lineChannelSecret} onChange={e => setDraft({ ...draft, lineChannelSecret: e.target.value })}
                    style={inputStyle} placeholder="從 LINE Developer Console 取得" type="password" />
                </div>
              </div>
            )}

            {/* Step 5：排程任務 */}
            {step === 5 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 32 }}>
                <h2 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>排程任務</h2>
                <p style={{ color: '#666', margin: '0 0 24px', fontSize: 14 }}>設定角色的自主行為節奏。可以在後台的「排程設定」隨時修改。</p>
                {draft.tasks.map((task, i) => (
                  <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 600 }}>{TYPE_LABELS[task.type] || task.type}</span>
                      <span style={{ fontSize: 13, color: '#666' }}>台北 {task.run_hour.toString().padStart(2, '0')}:{task.run_minute.toString().padStart(2, '0')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                      {DAY_KEYS.map((dk, di) => (
                        <button key={dk} onClick={() => {
                          const updated = [...draft.tasks];
                          const days = updated[i].days.includes(dk) ? updated[i].days.filter(d => d !== dk) : [...updated[i].days, dk];
                          updated[i] = { ...updated[i], days };
                          setDraft({ ...draft, tasks: updated });
                        }} style={{ padding: '3px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: task.days.includes(dk) ? '#1a1a2e' : '#fff', color: task.days.includes(dk) ? '#fff' : '#666', cursor: 'pointer', fontSize: 12 }}>
                          {DAY_LABELS[di]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ background: '#e8f5e9', borderRadius: 10, padding: 14, fontSize: 13, color: '#2e7d32' }}>
                  ✓ 以上任務將在角色建立時自動啟用
                </div>
              </div>
            )}

            {/* 操作按鈕 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
              <button onClick={() => step > 1 && setStep((step - 1) as Step)}
                disabled={step === 1}
                style={{ background: '#f0f0f0', color: step === 1 ? '#bbb' : '#333', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: step === 1 ? 'default' : 'pointer', fontSize: 14 }}>
                ← 上一步
              </button>

              {step < 5 ? (
                <button onClick={() => canProceed[step] && setStep((step + 1) as Step)}
                  disabled={!canProceed[step]}
                  style={{ background: canProceed[step] ? '#1a1a2e' : '#ccc', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: canProceed[step] ? 'pointer' : 'default', fontSize: 14, fontWeight: 600 }}>
                  下一步 →
                </button>
              ) : (
                <button onClick={finish} disabled={creating}
                  style={{ background: creating ? '#ccc' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 32px', cursor: creating ? 'default' : 'pointer', fontSize: 15, fontWeight: 700 }}>
                  {creating ? '建立中...' : '🚀 完成，上線！'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
