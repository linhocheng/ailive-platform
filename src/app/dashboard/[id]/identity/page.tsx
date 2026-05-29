'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';
import { useIsMobile } from '@/hooks/useIsMobile';

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

// ── Style tokens ──
const CARD: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '20px 24px' };
const SECTION_LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 8 };
const FIELD_LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const INPUT: React.CSSProperties = { width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13, boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text-primary)', outline: 'none' };
const BTN_PRIMARY: React.CSSProperties = { background: 'var(--text-primary)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '9px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const BTN_COPY: React.CSSProperties = { background: 'var(--bg-alt)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' };

// ── Slider ──
function Slider({ label, hint, value, min, max, step, onChange, onReset }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onReset: () => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
          {label}
          {hint && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400, marginLeft: 8 }}>{hint}</span>}
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 600, background: 'var(--bg-alt)', padding: '2px 8px', borderRadius: 'var(--r-sm)' }}>
            {value.toFixed(step < 1 ? 2 : 0)}
          </span>
          <button onClick={onReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: '0 2px' }}>reset</button>
        </div>
      </div>
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--text-primary)', cursor: 'pointer' }} />
    </div>
  );
}

export default function IdentityPage() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
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

  // ── TTS 細節參數（分 provider 存）──
  interface ElevenLabsSettings { speed?: number; stability?: number; similarity_boost?: number; style?: number }
  interface MinimaxSettings { speed?: number; pitch?: number; emotion?: string; vol?: number }
  const [elSettings, setElSettings] = useState<ElevenLabsSettings>({});
  const [mmSettings, setMmSettings] = useState<MinimaxSettings>({});

  const [auditionText, setAuditionText] = useState('');  // 試聽句子
  const [auditioning, setAuditioning] = useState(false);
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
      const ts = (c?.ttsSettings || {}) as { elevenlabs?: ElevenLabsSettings; minimax?: MinimaxSettings };
      setElSettings(ts.elevenlabs || {});
      setMmSettings(ts.minimax || {});
      // 預設試聽句
      setAuditionText(`嗨我是${c?.name || '角色'}，這是我的聲音。`);
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
          setMsg('✅ 上傳成功，辨識角度中…');

          // 看圖判角度（vision 是 angle 的唯一真相源；檔名解析只是即時預設）
          try {
            const dRes = await fetch('/api/image/detect-angle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ characterId: id, url: d.url }),
            });
            const dJson = await dRes.json();
            if (dJson.success && dJson.detected) {
              const merged = newStructured.map(r => r.url === d.url
                ? { ...r, angle: dJson.detected.angle, framing: dJson.detected.framing, expression: dJson.detected.expression }
                : r);
              setVi({ ...newVi, refs: merged });
              setMsg(`✅ 上傳成功（角度：${dJson.detected.angle}）`);
            } else {
              setMsg('✅ 上傳成功');
            }
          } catch {
            setMsg('✅ 上傳成功');
          }
          setTimeout(() => setMsg(''), 2500);
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
        ttsSettings: {
          ...(Object.keys(elSettings).length ? { elevenlabs: elSettings } : {}),
          ...(Object.keys(mmSettings).length ? { minimax: mmSettings } : {}),
        },
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
      {/* Breadcrumb */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
        <a href="/dashboard" style={{ color: 'var(--text-muted)' }}>所有角色</a>
        <span>›</span>
        <a href={`/dashboard/${id}`} style={{ color: 'var(--text-muted)' }}>{charName}</a>
        <span>›</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>身份設定</span>
      </div>
      <CharNav id={id} active="/identity" />

      {/* ── Section 1: 視覺 & 身份 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, alignItems: 'start' }}>

        {/* 左：參考照片 */}
        <div style={{ ...CARD }}>
          <span style={SECTION_LABEL}>參考照片</span>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.6 }}>
            上傳各角度照片，生圖時維持臉孔一致性。點擊圖片設為主要參考。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            {vi.referenceImages.map((url, i) => {
              const isPrimary = url === vi.characterSheet;
              const structuredRef = vi.refs.find(r => r.url === url);
              const angle = structuredRef?.angle || null;
              return (
                <div key={i} style={{ position: 'relative', cursor: 'pointer', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}
                  onMouseEnter={e => { const b = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (b) b.style.opacity = '1'; }}
                  onMouseLeave={e => { const b = e.currentTarget.querySelector<HTMLElement>('.del-btn'); if (b) b.style.opacity = '0'; }}
                >
                  <div onClick={() => setPrimary(url)}>
                    <img src={url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block', border: isPrimary ? '2px solid var(--text-primary)' : '2px solid transparent' }} />
                    {isPrimary && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--text-primary)', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', padding: '3px 6px', textAlign: 'center' }}>PRIMARY</div>
                    )}
                    {angle && !isPrimary && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 9, fontWeight: 600, padding: '3px 6px', textAlign: 'center', textTransform: 'uppercase' }}>{angle}</div>
                    )}
                  </div>
                  <button className="del-btn" onClick={e => { e.stopPropagation(); deleteRef(url); }}
                    style={{ opacity: 0, transition: 'opacity 0.15s', position: 'absolute', top: 4, right: 4, width: 22, height: 22, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>×</button>
                </div>
              );
            })}
            <div onClick={() => !uploading && fileRef.current?.click()}
              style={{ aspectRatio: '1/1', border: '1.5px dashed var(--border)', borderRadius: 'var(--r-sm)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', gap: 4, background: uploading ? 'var(--bg-alt)' : 'transparent' }}>
              <span style={{ fontSize: 20, color: 'var(--text-muted)' }}>{uploading ? '⋯' : '+'}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', fontWeight: 600 }}>{uploading ? 'UPLOADING' : 'UPLOAD'}</span>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
          {vi.characterSheet
            ? <p style={{ fontSize: 12, color: 'var(--green)', margin: 0 }}>✓ 主要參考圖已設定</p>
            : <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>尚未上傳。上傳第一張後自動設為主要參考。</p>
          }
        </div>

        {/* 右：文字設定 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 使命 */}
          <div style={{ ...CARD }}>
            <span style={SECTION_LABEL}>使命</span>
            <input value={mission} onChange={e => setMission(e.target.value)} style={{ ...INPUT }} placeholder="這個角色存在是為了什麼" />
          </div>

          {/* 固定特徵 */}
          <div style={{ ...CARD }}>
            <span style={SECTION_LABEL}>固定特徵</span>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>每次生圖自動注入 prompt 的外觀描述。</p>
            {vi.fixedElements.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {vi.fixedElements.map((el, i) => (
                  <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 10px' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{el}</span>
                    <button onClick={() => removeElement(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newElement} onChange={e => setNewElement(e.target.value)} onKeyDown={e => e.key === 'Enter' && addElement()}
                style={{ ...INPUT, flex: 1 }} placeholder="新增特徵（如：short brown hair）" />
              <button onClick={addElement} style={{ ...BTN_PRIMARY, padding: '9px 16px' }}>+</button>
            </div>
          </div>

          {/* Image Prompt */}
          <div style={{ ...CARD }}>
            <span style={SECTION_LABEL}>Image Prompt</span>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>生圖時的基底描述，必須用英文。</p>
            <input value={vi.imagePromptPrefix} onChange={e => setVi({ ...vi, imagePromptPrefix: e.target.value })}
              style={{ ...INPUT, borderColor: hasChinese ? 'var(--red)' : 'var(--border)', marginBottom: hasChinese ? 4 : 12 }}
              placeholder="e.g. A young woman with short brown hair, warm eyes," />
            {hasChinese && <p style={{ color: 'var(--red)', fontSize: 12, margin: '0 0 12px' }}>含中文會導致生圖跑臉，請改為英文描述</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={FIELD_LABEL}>風格</label>
                <select value={vi.styleGuide} onChange={e => setVi({ ...vi, styleGuide: e.target.value })} style={{ ...INPUT }}>
                  <option value="realistic">Realistic</option>
                  <option value="anime">Anime</option>
                  <option value="illustration">Illustration</option>
                </select>
              </div>
              <div>
                <label style={FIELD_LABEL}>Negative Prompt</label>
                <input value={vi.negativePrompt} onChange={e => setVi({ ...vi, negativePrompt: e.target.value })} style={{ ...INPUT }} />
              </div>
            </div>
          </div>

          {/* 聲音設定 */}
          <div style={{ ...CARD }}>
            <span style={SECTION_LABEL}>聲音設定</span>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>選擇 TTS 供應商並填入對應的 Voice ID。</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={FIELD_LABEL}>TTS Provider</label>
                <select value={ttsProvider} onChange={e => setTtsProvider(e.target.value as '' | 'elevenlabs' | 'minimax')} style={{ ...INPUT }}>
                  <option value="">跟隨系統預設</option>
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="minimax">MiniMax</option>
                </select>
              </div>
              <div>
                <label style={FIELD_LABEL}>ElevenLabs Voice ID</label>
                <input value={voiceId} onChange={e => setVoiceId(e.target.value)} style={{ ...INPUT, fontFamily: 'monospace' }} placeholder="56hCnQE2rYMllQDw3m1o" />
              </div>
              <div>
                <label style={FIELD_LABEL}>MiniMax Voice ID</label>
                <input value={voiceIdMinimax} onChange={e => setVoiceIdMinimax(e.target.value)} style={{ ...INPUT, fontFamily: 'monospace' }} placeholder="moss_audio_xxx" />
              </div>
            </div>

            {(ttsProvider === 'elevenlabs' || ttsProvider === 'minimax') && (
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-soft)' }}>
                <span style={{ ...SECTION_LABEL, marginBottom: 14 }}>聲音微調 — {ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'MiniMax'}</span>
                {ttsProvider === 'elevenlabs' && (
                  <>
                    <Slider label="Stability 穩定度" hint="值越高越穩 (預設 0.85)" value={elSettings.stability ?? 0.85} min={0} max={1} step={0.01} onChange={v => setElSettings({ ...elSettings, stability: v })} onReset={() => { const { stability: _, ...rest } = elSettings; void _; setElSettings(rest); }} />
                    <Slider label="Similarity Boost" hint="越高越貼近原聲 (預設 0.75)" value={elSettings.similarity_boost ?? 0.75} min={0} max={1} step={0.01} onChange={v => setElSettings({ ...elSettings, similarity_boost: v })} onReset={() => { const { similarity_boost: _, ...rest } = elSettings; void _; setElSettings(rest); }} />
                    <Slider label="Style 風格" hint="0=中性 / 1=戲劇化 (預設 0.0)" value={elSettings.style ?? 0.0} min={0} max={1} step={0.01} onChange={v => setElSettings({ ...elSettings, style: v })} onReset={() => { const { style: _, ...rest } = elSettings; void _; setElSettings(rest); }} />
                    <Slider label="Speed 語速" hint="0.7~1.2 (預設 1.0)" value={elSettings.speed ?? 1.0} min={0.7} max={1.2} step={0.05} onChange={v => setElSettings({ ...elSettings, speed: v })} onReset={() => { const { speed: _, ...rest } = elSettings; void _; setElSettings(rest); }} />
                  </>
                )}
                {ttsProvider === 'minimax' && (
                  <>
                    <Slider label="Speed 語速" hint="1.0=正常 (0.5~2.0)" value={mmSettings.speed ?? 1.0} min={0.5} max={2.0} step={0.05} onChange={v => setMmSettings({ ...mmSettings, speed: v })} onReset={() => { const { speed: _, ...rest } = mmSettings; void _; setMmSettings(rest); }} />
                    <Slider label="Pitch 音高" hint="0=正常 (-12 ~ +12)" value={mmSettings.pitch ?? 0} min={-12} max={12} step={1} onChange={v => setMmSettings({ ...mmSettings, pitch: v })} onReset={() => { const { pitch: _, ...rest } = mmSettings; void _; setMmSettings(rest); }} />
                    <Slider label="Volume 音量" hint="1.0=正常 (0.1~3.0)" value={mmSettings.vol ?? 1.0} min={0.1} max={3.0} step={0.1} onChange={v => setMmSettings({ ...mmSettings, vol: v })} onReset={() => { const { vol: _, ...rest } = mmSettings; void _; setMmSettings(rest); }} />
                    <div>
                      <label style={FIELD_LABEL}>Emotion 情緒 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(預設 neutral)</span></label>
                      <select value={mmSettings.emotion ?? 'neutral'} onChange={e => { const v = e.target.value; if (v === 'neutral') { const { emotion: _, ...rest } = mmSettings; void _; setMmSettings(rest); } else setMmSettings({ ...mmSettings, emotion: v }); }} style={{ ...INPUT }}>
                        <option value="neutral">neutral（中性）</option>
                        <option value="happy">happy（開心）</option>
                        <option value="sad">sad（哀傷）</option>
                        <option value="angry">angry（憤怒）</option>
                        <option value="fearful">fearful（恐懼）</option>
                        <option value="surprised">surprised（驚訝）</option>
                        <option value="disgusted">disgusted（厭惡）</option>
                      </select>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border-soft)' }}>
                  <label style={FIELD_LABEL}>試聽句子</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={auditionText} onChange={e => setAuditionText(e.target.value)} style={{ ...INPUT, flex: 1 }} placeholder="嗨我是..." />
                    <button disabled={auditioning || !auditionText.trim()}
                      onClick={async () => {
                        const currentVoiceId = ttsProvider === 'elevenlabs' ? voiceId.trim() : voiceIdMinimax.trim();
                        if (!currentVoiceId) { alert(`請先填 ${ttsProvider} 的 voice ID`); return; }
                        setAuditioning(true);
                        try {
                          const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: auditionText, voiceId: currentVoiceId, ttsProvider, settings: ttsProvider === 'elevenlabs' ? elSettings : mmSettings }) });
                          if (!res.ok) { const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })); alert('試聽失敗：' + (err.error || 'unknown')); return; }
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const audio = new Audio(url);
                          audio.onended = () => URL.revokeObjectURL(url);
                          await audio.play();
                        } catch (e) { alert('試聽錯誤：' + (e instanceof Error ? e.message : String(e))); }
                        finally { setAuditioning(false); }
                      }}
                      style={{ ...BTN_PRIMARY, opacity: (auditioning || !auditionText.trim()) ? 0.5 : 1, cursor: auditioning ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                      {auditioning ? '合成中…' : '▶ 試聽'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={save} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? '儲存中...' : '儲存設定'}
            </button>
            {msg && <span style={{ fontSize: 13, color: msg.includes('❌') ? 'var(--red)' : 'var(--green)' }}>{msg}</span>}
          </div>
        </div>
      </div>

      {/* ── Section 2: 通路設定 ── */}
      <div style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>通路設定</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>設定 LINE 和 Instagram 的 API 串接。</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>

          {/* LINE */}
          <div style={{ ...CARD }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: '#06C755', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>💬</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>LINE</div>
                <div style={{ fontSize: 11, color: channels.lineChannelToken && channels.lineChannelSecret ? 'var(--green)' : 'var(--text-muted)', marginTop: 1 }}>
                  {channels.lineChannelToken && channels.lineChannelSecret ? '● 已啟用' : '○ 未設定'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={FIELD_LABEL}>Channel Access Token</label>
                <input value={channels.lineChannelToken} onChange={e => setChannels(p => ({ ...p, lineChannelToken: e.target.value }))} placeholder="貼上 LINE Channel Access Token" style={{ ...INPUT }} />
              </div>
              <div>
                <label style={FIELD_LABEL}>Channel Secret</label>
                <input value={channels.lineChannelSecret} onChange={e => setChannels(p => ({ ...p, lineChannelSecret: e.target.value }))} placeholder="貼上 LINE Channel Secret" style={{ ...INPUT }} />
              </div>
              <div style={{ background: 'var(--bg-alt)', borderRadius: 'var(--r-sm)', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>Webhook URL</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all', flex: 1, lineHeight: 1.5 }}>{`https://ailive-platform.vercel.app/api/line-webhook/${id}`}</code>
                  <button onClick={() => navigator.clipboard.writeText(`https://ailive-platform.vercel.app/api/line-webhook/${id}`)} style={{ ...BTN_COPY }}>複製</button>
                </div>
              </div>
              <div style={{ background: 'var(--bg-alt)', borderRadius: 'var(--r-sm)', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>共用對話連結</div>
                <input type="text" value={lineUserId} onChange={e => setLineUserId(e.target.value)} placeholder="填入 LINE 用戶 ID（Uxxxxxxxx）" style={{ ...INPUT, fontSize: 12, marginBottom: lineUserId.trim() ? 8 : 0 }} />
                {lineUserId.trim() && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <code style={{ fontSize: 10, color: 'var(--accent)', wordBreak: 'break-all', flex: 1, lineHeight: 1.5 }}>{`https://ailive-platform.vercel.app/chat/${id}?cid=line_${id}_${lineUserId.trim()}`}</code>
                    <button onClick={() => navigator.clipboard.writeText(`https://ailive-platform.vercel.app/chat/${id}?cid=line_${id}_${lineUserId.trim()}`)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', padding: '4px 10px', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>複製</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* IG */}
          <div style={{ ...CARD }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', background: 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📸</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Instagram</div>
                <div style={{ fontSize: 11, color: channels.igAccessToken && channels.igUserId ? 'var(--green)' : 'var(--text-muted)', marginTop: 1 }}>
                  {channels.igAccessToken && channels.igUserId ? '● 已啟用' : '○ 未設定'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={FIELD_LABEL}>Access Token</label>
                <input value={channels.igAccessToken} onChange={e => setChannels(p => ({ ...p, igAccessToken: e.target.value }))} placeholder="貼上 Instagram Access Token" style={{ ...INPUT }} />
              </div>
              <div>
                <label style={FIELD_LABEL}>Instagram User ID</label>
                <input value={channels.igUserId} onChange={e => setChannels(p => ({ ...p, igUserId: e.target.value }))} placeholder="貼上 IG Business User ID" style={{ ...INPUT }} />
              </div>
              <div style={{ background: 'var(--bg-alt)', borderRadius: 'var(--r-sm)', padding: '12px 14px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>需要 Instagram Graph API 的 Business 帳號 Access Token 與 User ID。Token 過期需重新產生。</p>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button onClick={saveChannels} disabled={channelSaving} style={{ ...BTN_PRIMARY, opacity: channelSaving ? 0.6 : 1, cursor: channelSaving ? 'default' : 'pointer' }}>
            {channelSaving ? '儲存中...' : '儲存通路設定'}
          </button>
          {channelMsg && <span style={{ fontSize: 13, color: 'var(--green)' }}>{channelMsg}</span>}
        </div>
      </div>

      {/* ── Section 3: 客戶端入口 ── */}
      <div style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>客戶端入口</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>將連結傳給客戶，可存取貼文審核、排程設定與角色對話。</p>
        </div>
        <div style={{ ...CARD, maxWidth: 560 }}>
          <ClientPasswordSection charId={id} />
        </div>
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
