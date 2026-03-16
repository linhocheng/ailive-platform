'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

export default function SoulPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Record<string, unknown> | null>(null);
  const [rawSoul, setRawSoul] = useState('');
  const [enhancedSoul, setEnhancedSoul] = useState('');
  const [saving, setSaving] = useState(false);
  const [forging, setForging] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      const c = d.character;
      setChar(c);
      setRawSoul(c?.rawSoul || '');
      setEnhancedSoul(c?.enhancedSoul || '');
    });
  }, [id]);

  const saveRaw = async () => {
    setSaving(true);
    await fetch(`/api/characters/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawSoul }) });
    setSaving(false);
    setMsg('原始靈魂已儲存');
    setTimeout(() => setMsg(''), 2000);
  };

  const forge = async () => {
    setForging(true);
    setMsg('鑄魂中...');
    const r = await fetch('/api/soul-enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: id }) });
    const d = await r.json();
    if (d.success) {
      setEnhancedSoul(d.enhancedSoul);
      setMsg(`✅ 鑄魂完成（v${d.soulVersion}）`);
    } else {
      setMsg(`❌ ${d.error}`);
    }
    setForging(false);
    setTimeout(() => setMsg(''), 4000);
  };

  if (!char) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{char.name as string}</a> › 靈魂
      </div>
      <CharNav id={id} active="/soul" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 左：rawSoul */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>原始人設</h3>
            <button onClick={saveRaw} disabled={saving} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
          <textarea value={rawSoul} onChange={e => setRawSoul(e.target.value)}
            style={{ width: '100%', minHeight: 300, border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'system-ui', resize: 'vertical', boxSizing: 'border-box' }}
            placeholder="輸入角色的原始人設描述..." />
          <button onClick={forge} disabled={forging || !rawSoul}
            style={{ marginTop: 12, width: '100%', background: forging ? '#ccc' : '#6c63ff', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            {forging ? '🔥 鑄魂中...' : '⚡ 觸發鑄魂爐'}
          </button>
          {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg.includes('❌') ? '#c00' : '#2e7d32' }}>{msg}</div>}
        </div>
        {/* 右：enhancedSoul */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>七咒律靈魂</h3>
            <span style={{ background: '#e8eaf6', color: '#3949ab', padding: '2px 8px', borderRadius: 20, fontSize: 12 }}>v{char.soulVersion as number}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: '#333', maxHeight: 500, overflowY: 'auto', background: '#f8f9fa', borderRadius: 8, padding: 12 }}>
            {enhancedSoul || <span style={{ color: '#bbb' }}>尚未鑄魂。請先填入原始人設，然後觸發鑄魂爐。</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
