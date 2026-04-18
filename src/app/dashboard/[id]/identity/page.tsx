'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface RefImage {
  url: string;
  name: string;
  angle: string;
  framing: string;
  expression: string;
}

interface VisualIdentity {
  characterSheet: string;
  imagePromptPrefix: string;
  styleGuide: string;
  negativePrompt: string;
  fixedElements: string[];
  referenceImages: string[];
  refs: RefImage[];
}

// 從檔名解析角度/比例/表情（對齊 Emily hub 邏輯）
function parseRefMeta(filename: string): { angle: string; framing: string; expression: string } {
  const name = filename.replace(/\.[^.]+$/, '');
  const parts = name.split(/[_\-\s]/);

  const FRAMING: Record<string, string> = {
    '全身': 'full', '半身': 'half', '7分身': '7/10', '七分身': '7/10',
    '特寫': 'closeup', full: 'full', half: 'half', closeup: 'closeup',
  };
  const ANGLE: Record<string, string> = {
    '正面': 'front', '側臉': 'side', '側面': 'side', '側身': 'side',
    '側45度': '3/4', '45度': '3/4', '斜角': '3/4', '背面': 'back', '背影': 'back',
    front: 'front', side: 'side', back: 'back', profile: 'side', '3/4': '3/4',
  };
  const EXPRESSION: Record<string, string> = {
    '微笑': 'smile', '開心': 'happy', '笑': 'smile', '撒嬌': 'coquettish',
    '生氣': 'angry', '憤怒': 'angry', '穩定': 'calm', '冷靜': 'calm',
    smile: 'smile', happy: 'happy', angry: 'angry', calm: 'calm',
  };

  let framing = 'half', angle = 'front', expression = 'calm';
  for (const p of parts) {
    if (FRAMING[p]) framing = FRAMING[p];
    if (ANGLE[p]) angle = ANGLE[p];
    if (EXPRESSION[p]) expression = EXPRESSION[p];
  }
  return { angle, framing, expression };
}

export default function IdentityPage() {
  const { id } = useParams<{ id: string }>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [char, setChar] = useState<Record<string, unknown> | null>(null);
  const [vi, setVi] = useState<VisualIdentity>({
    characterSheet: '', imagePromptPrefix: '', styleGuide: 'realistic',
    negativePrompt: 'different face, inconsistent features',
    fixedElements: [], referenceImages: [], refs: [],
  });
  const [mission, setMission] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [voiceIdMinimax, setVoiceIdMinimax] = useState('');
  const [ttsProvider, setTtsProvider] = useState<'' | 'elevenlabs' | 'minimax'>('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [newElement, setNewElement] = useState('');
  const [channels, setChannels] = useState({
    lineChannelToken: '',
    lineChannelSecret: '',
    igAccessToken: '',
    igUserId: '',
  });
  const [channelSaving, setChannelSaving] = useState(false);
  const [lineUserId, setLineUserId] = useState('');
  const [channelMsg, setChannelMsg] = useState('');

  const load = () => {
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      const c = d.character;
      setChar(c);
      setMission(c?.mission || '');
      setVoiceId(c?.voiceId || '');
      setVoiceIdMinimax(c?.voiceIdMinimax || '');
      const prov = (c?.ttsProvider || '').toLowerCase();
      setTtsProvider(prov === 'minimax' ? 'minimax' : prov === 'elevenlabs' ? 'elevenlabs' : '');
      setChannels({
        lineChannelToken: c?.lineChannelToken || '',
        lineChannelSecret: c?.lineChannelSecret || '',
        igAccessToken: c?.igAccessToken || '',
        igUserId: c?.igUserId || '',
      });
      const v = c?.visualIdentity as VisualIdentity | undefined;
      setVi({
        characterSheet: v?.characterSheet || '',
        imagePromptPrefix: v?.imagePromptPrefix || '',
        styleGuide: v?.styleGuide || 'realistic',
        negativePrompt: v?.negativePrompt || 'different face, inconsistent features',
        fixedElements: v?.fixedElements || [],
        referenceImages: v?.referenceImages || [],
        refs: v?.refs || [],
      });
    });
  };

  useEffect(() => { load(); }, [id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    e.target.value = '';
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        const ext = file.name.split('.').pop() || 'jpg';
        const meta = parseRefMeta(file.name);
        const filename = `${meta.angle}-${Date.now()}.${ext}`;

        const res = await fetch('/api/image/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, contentType: file.type, characterId: id, filename }),
        });
        const d = await res.json();

        if (d.url) {
          const newRefs = [...vi.referenceImages, d.url];
          const newStructured: RefImage[] = [...vi.refs, {
            url: d.url,
            name: file.name.replace(/\.[^.]+$/, ''),
            angle: meta.angle,
            framing: meta.framing,
            expression: meta.expression,
          }];
          const newCharacterSheet = vi.characterSheet || d.url;

          const newVi = { ...vi, referenceImages: newRefs, refs: newStructured, characterSheet: newCharacterSheet };
          setVi(newVi);

          // 立即寫入
          await fetch(`/api/characters/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visualIdentity: newVi }),
          });
          setMsg('✅ 上傳成功');
          setTimeout(() => setMsg(''), 2000);
        } else {
          setMsg(`❌ ${d.error}`);
        }
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setMsg(`❌ ${String(err)}`);
      setUploading(false);
    }
  };

  const deleteRef = async (url: string) => {
    const newRefs = vi.referenceImages.filter(r => r !== url);
    const newStructured = vi.refs.filter(r => r.url !== url);
    const newPrimary = vi.characterSheet === url ? (newRefs[0] || '') : vi.characterSheet;
    const newVi = { ...vi, referenceImages: newRefs, refs: newStructured, characterSheet: newPrimary };
    setVi(newVi);
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visualIdentity: newVi }),
    });
  };

  const setPrimary = async (url: string) => {
    const newVi = { ...vi, characterSheet: url };
    setVi(newVi);
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visualIdentity: newVi }),
    });
    setMsg('✅ 主要參考圖已更新');
    setTimeout(() => setMsg(''), 2000);
  };

  const addElement = () => {
    if (!newElement.trim()) return;
    setVi({ ...vi, fixedElements: [...vi.fixedElements, newElement.trim()] });
    setNewElement('');
  };

  const removeElement = (i: number) => {
    setVi({ ...vi, fixedElements: vi.fixedElements.filter((_, idx) => idx !== i) });
  };

  const saveChannels = async () => {
    setChannelSaving(true);
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(channels),
    });
    setChannelSaving(false);
    setChannelMsg('✅ 已儲存');
    setTimeout(() => setChannelMsg(''), 2000);
  };

  const save = async () => {
    setSaving(true);
    const autoPrefix = vi.fixedElements.length > 0
      ? vi.fixedElements.join(', ') + ','
      : vi.imagePromptPrefix;
    const finalVi = { ...vi, imagePromptPrefix: vi.imagePromptPrefix || autoPrefix };
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mission,
        visualIdentity: finalVi,
        voiceId: voiceId.trim() || null,
        voiceIdMinimax: voiceIdMinimax.trim() || null,
        ttsProvider: ttsProvider || null,
      }),
    });
    setVi(finalVi);
    setSaving(false);
    setMsg('✅ 已儲存');
    setTimeout(() => setMsg(''), 2000);
  };

  if (!char) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  const charName = char.name as string;
  const hasChinese = /[\u4e00-\u9fff]/.test(vi.imagePromptPrefix);

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> ›{' '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 身份設定
      </div>
      <CharNav id={id} active="/identity" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* 左欄：REFERENCE PHOTOS */}
        <div style={{ background: '#fff', border: '1px solid #e7e5e4', padding: 28 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.2em', color: '#a8a29e', fontWeight: 700, margin: '0 0 6px' }}>REFERENCE PHOTOS</p>
          <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 20px', lineHeight: 1.7 }}>
            上傳各角度的照片，生圖時會以此維持臉孔一致性。點擊任一張設為主要參考。
          </p>

          {/* 圖片 grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {vi.referenceImages.map((url, i) => {
              const isPrimary = url === vi.characterSheet;
              const structuredRef = vi.refs.find(r => r.url === url);
              const angle = structuredRef?.angle || null;
              return (
                <div key={i} style={{ position: 'relative', cursor: 'pointer' }}
                  onMouseEnter={e => { const b = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (b) b.style.opacity = '1'; }}
                  onMouseLeave={e => { const b = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (b) b.style.opacity = '0'; }}
                >
                  <div onClick={() => setPrimary(url)}>
                    <img src={url} alt="" style={{
                      width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block',
                      border: isPrimary ? '3px solid #292524' : '3px solid transparent',
                    }} />
                    {/* PRIMARY badge */}
                    {isPrimary && (
                      <div style={{ position: 'absolute', bottom: 4, left: 4, background: '#292524', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 6px' }}>
                        PRIMARY
                      </div>
                    )}
                    {/* 角度 label */}
                    {angle && !isPrimary && (
                      <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 6px', textTransform: 'uppercase' }}>
                        {angle}
                      </div>
                    )}
                  </div>
                  {/* 刪除按鈕 */}
                  <button className="del-btn" onClick={e => { e.stopPropagation(); deleteRef(url); }}
                    style={{ opacity: 0, transition: 'opacity 0.15s', position: 'absolute', top: 4, right: 4, width: 22, height: 22, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ×
                  </button>
                </div>
              );
            })}

            {/* 上傳按鈕格 */}
            <div onClick={() => !uploading && fileRef.current?.click()}
              style={{ aspectRatio: '1/1', border: '2px dashed #e7e5e4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', gap: 4, background: uploading ? '#f9f9f7' : 'transparent' }}>
              <span style={{ fontSize: 22, color: '#a8a29e' }}>{uploading ? '⋯' : '+'}</span>
              <span style={{ fontSize: 9, color: '#a8a29e', letterSpacing: '0.1em' }}>{uploading ? 'UPLOADING' : 'UPLOAD'}</span>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />

          {vi.characterSheet ? (
            <p style={{ fontSize: 11, color: '#10b981', letterSpacing: '0.05em', margin: 0 }}>✓ 主要參考圖已設定，生圖時會維持臉孔一致性</p>
          ) : (
            <p style={{ fontSize: 11, color: '#a8a29e', margin: 0 }}>尚未上傳。上傳第一張後自動設為 PRIMARY。</p>
          )}
        </div>

        {/* 右欄：FIXED ELEMENTS + 其他設定 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 使命 */}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', padding: 20 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.2em', color: '#a8a29e', fontWeight: 700, margin: '0 0 10px' }}>MISSION</p>
            <input value={mission} onChange={e => setMission(e.target.value)}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '9px 11px', fontSize: 14, boxSizing: 'border-box' }}
              placeholder="這個角色存在是為了什麼" />
          </div>

          {/* VOICE (TTS PROVIDER + VOICE IDS) */}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', padding: 20 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.2em', color: '#a8a29e', fontWeight: 700, margin: '0 0 6px' }}>VOICE</p>
            <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 14px', lineHeight: 1.6 }}>選 TTS 家，填對應的 voice ID。未選則跟隨系統預設（env）。</p>

            <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6 }}>TTS Provider</label>
            <select value={ttsProvider} onChange={e => setTtsProvider(e.target.value as '' | 'elevenlabs' | 'minimax')}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '9px 11px', fontSize: 13, boxSizing: 'border-box', marginBottom: 14 }}>
              <option value="">跟隨系統預設</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="minimax">MiniMax</option>
            </select>

            <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6 }}>ElevenLabs Voice ID</label>
            <input value={voiceId} onChange={e => setVoiceId(e.target.value)}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '9px 11px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: 14 }}
              placeholder="56hCnQE2rYMllQDw3m1o（預設女聲）" />

            <label style={{ display: 'block', fontSize: 11, color: '#555', marginBottom: 6 }}>MiniMax Voice ID</label>
            <input value={voiceIdMinimax} onChange={e => setVoiceIdMinimax(e.target.value)}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '9px 11px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace' }}
              placeholder="moss_audio_xxx" />
          </div>

          {/* FIXED ELEMENTS */}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', padding: 20 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.2em', color: '#a8a29e', fontWeight: 700, margin: '0 0 6px' }}>FIXED ELEMENTS</p>
            <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 14px', lineHeight: 1.6 }}>每次生圖都會保留的外觀特徵，自動注入 prompt。</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {vi.fixedElements.map((el, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f5f5f4', padding: '5px 10px' }}>
                  <span style={{ fontSize: 12, color: '#444' }}>{el}</span>
                  <button onClick={() => removeElement(i)} style={{ background: 'none', border: 'none', color: '#a8a29e', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newElement} onChange={e => setNewElement(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addElement()}
                style={{ flex: 1, border: '1px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
                placeholder="新增特徵（如：short brown hair）" />
              <button onClick={addElement} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>+</button>
            </div>
          </div>

          {/* imagePromptPrefix */}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', padding: 20 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.2em', color: '#a8a29e', fontWeight: 700, margin: '0 0 6px' }}>IMAGE PROMPT PREFIX <span style={{ color: '#c00' }}>（必須英文）</span></p>
            <input value={vi.imagePromptPrefix} onChange={e => setVi({ ...vi, imagePromptPrefix: e.target.value })}
              style={{ width: '100%', border: `1px solid ${hasChinese ? '#c00' : '#e0e0e0'}`, borderRadius: 6, padding: '9px 11px', fontSize: 13, boxSizing: 'border-box' }}
              placeholder="e.g. A young woman with short brown hair, warm eyes," />
            {hasChinese && <p style={{ color: '#c00', fontSize: 11, margin: '4px 0 0' }}>⚠️ 含中文會導致生圖跑臉，請改成英文描述</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#a8a29e', marginBottom: 4 }}>風格</label>
                <select value={vi.styleGuide} onChange={e => setVi({ ...vi, styleGuide: e.target.value })}
                  style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13 }}>
                  <option value="realistic">Realistic</option>
                  <option value="anime">Anime</option>
                  <option value="illustration">Illustration</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#a8a29e', marginBottom: 4 }}>Negative Prompt</label>
                <input value={vi.negativePrompt} onChange={e => setVi({ ...vi, negativePrompt: e.target.value })}
                  style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>
          </div>

          {/* 儲存 */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={save} disabled={saving}
              style={{ background: saving ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 28px', cursor: saving ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}>
              {saving ? '儲存中...' : '儲存'}
            </button>
            {msg && <span style={{ fontSize: 13, color: msg.includes('❌') ? '#c00' : '#2e7d32' }}>{msg}</span>}
          </div>
        </div>

        {/* ===== 通路設定 ===== */}
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* LINE */}
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>💬</span>
              <h3 style={{ margin: 0, fontSize: 15 }}>LINE 通路</h3>
              <span style={{
                marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: channels.lineChannelToken && channels.lineChannelSecret ? '#e8f5e9' : '#f5f5f5',
                color: channels.lineChannelToken && channels.lineChannelSecret ? '#2e7d32' : '#999',
              }}>
                {channels.lineChannelToken && channels.lineChannelSecret ? '● 已啟用' : '○ 未設定'}
              </span>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Channel Access Token</div>
              <input
                value={channels.lineChannelToken}
                onChange={e => setChannels(p => ({ ...p, lineChannelToken: e.target.value }))}
                placeholder="貼上 LINE Channel Access Token"
                style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Channel Secret</div>
              <input
                value={channels.lineChannelSecret}
                onChange={e => setChannels(p => ({ ...p, lineChannelSecret: e.target.value }))}
                placeholder="貼上 LINE Channel Secret"
                style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const }}
              />
            </div>

            <div style={{ background: '#f8f9ff', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Webhook URL（貼進 LINE Developer Console）</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 11, color: '#444', wordBreak: 'break-all' as const, flex: 1 }}>
                  {`https://ailive-platform.vercel.app/api/line-webhook/${id}`}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(`https://ailive-platform.vercel.app/api/line-webhook/${id}`); }}
                  style={{ background: '#eee', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' as const }}
                >複製</button>
              </div>
            </div>

            {/* LINE 共用對話連結 */}
            <div style={{ background: '#f0f7ff', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>共用對話連結（網頁 + LINE 同一段記憶）</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  value={lineUserId}
                  onChange={e => setLineUserId(e.target.value)}
                  placeholder="填入 LINE 用戶 ID（Uxxxxxxxx）"
                  style={{ flex: 1, border: '1px solid #c5d8f0', borderRadius: 6, padding: '6px 10px', fontSize: 12, boxSizing: 'border-box' as const }}
                />
              </div>
              {lineUserId.trim() && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontSize: 10, color: '#1a6fb5', wordBreak: 'break-all' as const, flex: 1, background: '#e3f0ff', borderRadius: 4, padding: '4px 6px' }}>
                    {`https://ailive-platform.vercel.app/chat/${id}?cid=line_${id}_${lineUserId.trim()}`}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(`https://ailive-platform.vercel.app/chat/${id}?cid=line_${id}_${lineUserId.trim()}`)}
                    style={{ background: '#1a6fb5', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' as const }}
                  >複製</button>
                </div>
              )}
              {!lineUserId.trim() && (
                <div style={{ fontSize: 11, color: '#999' }}>填入 LINE 用戶 ID 後自動產生連結</div>
              )}
            </div>
          </div>

          {/* IG */}
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>📸</span>
              <h3 style={{ margin: 0, fontSize: 15 }}>Instagram 通路</h3>
              <span style={{
                marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: channels.igAccessToken && channels.igUserId ? '#fce8ff' : '#f5f5f5',
                color: channels.igAccessToken && channels.igUserId ? '#7b1fa2' : '#999',
              }}>
                {channels.igAccessToken && channels.igUserId ? '● 已啟用' : '○ 未設定'}
              </span>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Access Token</div>
              <input
                value={channels.igAccessToken}
                onChange={e => setChannels(p => ({ ...p, igAccessToken: e.target.value }))}
                placeholder="貼上 Instagram Access Token"
                style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Instagram User ID</div>
              <input
                value={channels.igUserId}
                onChange={e => setChannels(p => ({ ...p, igUserId: e.target.value }))}
                placeholder="貼上 IG Business User ID"
                style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const }}
              />
            </div>

            <div style={{ background: '#f8f9ff', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#666' }}>需要 Instagram Graph API 的 Business 帳號 Access Token 與 User ID。Token 過期需重新產生。</div>
            </div>
          </div>

        </div>

        {/* 通路儲存 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <button onClick={saveChannels} disabled={channelSaving}
            style={{ background: channelSaving ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 28px', cursor: channelSaving ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}>
            {channelSaving ? '儲存中...' : '儲存通路設定'}
          </button>
          {channelMsg && <span style={{ fontSize: 13, color: '#2e7d32' }}>{channelMsg}</span>}
        </div>

      </div>

      {/* ── 客戶端入口 ── */}
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <h3 style={{ margin: 0, fontSize: 15 }}>客戶端入口</h3>
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.6 }}>
          將以下連結傳給客戶，客戶可以存取：貼文審核、排程設定、與角色聊天。<br />
          不會顯示後台其他功能。
        </div>

        {/* 客戶端密碼 */}
        <ClientPasswordSection charId={id} />
      </div>

    </div>
  );
}

function ClientPasswordSection({ charId }: { charId: string }) {
  const [pw, setPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const clientUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/client/${charId}`
    : `/client/${charId}`;

  useEffect(() => {
    fetch(`/api/characters/${charId}`).then(r => r.json()).then(d => {
      setPw(d.character?.clientPassword || '');
    });
  }, [charId]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/characters/${charId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientPassword: pw }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const copy = () => {
    navigator.clipboard.writeText(clientUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>客戶端連結</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={clientUrl}
            style={{ flex: 1, border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#555', background: '#f8f9fa', boxSizing: 'border-box' as const }} />
          <button onClick={copy}
            style={{ background: copied ? '#2e7d32' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' as const }}>
            {copied ? '✓ 已複製' : '複製'}
          </button>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>存取密碼 <span style={{ color: '#bbb' }}>(留空則不設密碼)</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" value={pw} onChange={e => setPw(e.target.value)} placeholder="設定客戶端密碼"
            style={{ flex: 1, border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' as const }} />
          <button onClick={save} disabled={saving}
            style={{ background: saving ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: saving ? 'default' : 'pointer', fontSize: 13, whiteSpace: 'nowrap' as const }}>
            {saving ? '儲存中...' : saved ? '✓ 已儲存' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}
