'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface VisualIdentity { characterSheet: string; imagePromptPrefix: string; styleGuide: string; negativePrompt: string; }

export default function IdentityPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Record<string, unknown> | null>(null);
  const [vi, setVi] = useState<VisualIdentity>({ characterSheet: '', imagePromptPrefix: '', styleGuide: '', negativePrompt: 'different face, inconsistent features' });
  const [mission, setMission] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      const c = d.character;
      setChar(c);
      setMission(c?.mission || '');
      setVi(c?.visualIdentity || { characterSheet: '', imagePromptPrefix: '', styleGuide: '', negativePrompt: 'different face, inconsistent features' });
    });
  }, [id]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/characters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission, visualIdentity: vi }) });
    setSaving(false);
    setMsg('✅ 已儲存');
    setTimeout(() => setMsg(''), 2000);
  };

  if (!char) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{char.name as string}</a> › 身份設定
      </div>
      <CharNav id={id} active="/identity" />
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 20px' }}>身份與視覺設定</h3>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>使命宣言（第七咒律）</label>
          <input value={mission} onChange={e => setMission(e.target.value)}
            style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>角色參考照 URL（characterSheet）</label>
          <input value={vi.characterSheet} onChange={e => setVi({ ...vi, characterSheet: e.target.value })}
            style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' }}
            placeholder="Firebase Storage URL（正面清晰照）" />
          {vi.characterSheet && <img src={vi.characterSheet} alt="ref" style={{ marginTop: 8, maxWidth: 160, borderRadius: 8, border: '1px solid #e0e0e0' }} />}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>
            imagePromptPrefix <span style={{ color: '#c00' }}>（必須英文）</span>
          </label>
          <input value={vi.imagePromptPrefix} onChange={e => setVi({ ...vi, imagePromptPrefix: e.target.value })}
            style={{ width: '100%', border: `1px solid ${/[\u4e00-\u9fff]/.test(vi.imagePromptPrefix) ? '#c00' : '#e0e0e0'}`, borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' }}
            placeholder="e.g. A young woman with short brown hair, round glasses," />
          {/[\u4e00-\u9fff]/.test(vi.imagePromptPrefix) && <div style={{ color: '#c00', fontSize: 12, marginTop: 4 }}>⚠️ 含有中文，生圖時會跑臉。請改成英文描述。</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>風格</label>
            <select value={vi.styleGuide} onChange={e => setVi({ ...vi, styleGuide: e.target.value })}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '10px 12px', fontSize: 14 }}>
              <option value="">選擇風格</option>
              <option value="anime">Anime</option>
              <option value="realistic">Realistic</option>
              <option value="illustration">Illustration</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 6 }}>negativePrompt</label>
            <input value={vi.negativePrompt} onChange={e => setVi({ ...vi, negativePrompt: e.target.value })}
              style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={save} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontSize: 14 }}>
            {saving ? '儲存中...' : '儲存'}
          </button>
          {msg && <span style={{ fontSize: 13, color: '#2e7d32' }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
