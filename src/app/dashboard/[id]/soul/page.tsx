'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

export default function SoulPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Record<string, unknown> | null>(null);
  const [rawSoul, setRawSoul] = useState('');
  const [soulCore, setSoulCore] = useState('');
  const [systemSoul, setSystemSoul] = useState('');
  const [skipForge, setSkipForge] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [forging, setForging] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => {
      const c = d.character;
      setChar(c);
      setRawSoul(c?.rawSoul || '');
      setSoulCore(c?.soul_core || '');
      setSystemSoul(c?.system_soul || '');
    });
  }, [id]);

  const save = async (field: string, value: string, label: string) => {
    setSaving(field);
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    setSaving(null);
    setMsg(`✅ ${label} 已儲存`);
    setTimeout(() => setMsg(''), 2000);
  };

  const forge = async () => {
    setForging(true);
    setMsg(skipForge ? '🔥 提煉 soul_core 中...' : '🔥 整理靈魂 + 提煉中...');
    const r = await fetch('/api/soul-enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: id, skipForge }),
    });
    const d = await r.json();
    if (d.success) {
      setSoulCore(d.soul_core);
      setMsg(`✅ 鑄魂完成（v${d.soulVersion}）${skipForge ? '　直接提煉' : '　整理後提煉'}`);
    } else {
      setMsg(`❌ ${d.error}`);
    }
    setForging(false);
    setTimeout(() => setMsg(''), 5000);
  };

  if (!char) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;

  const btn = (label: string, onClick: () => void, disabled: boolean, color = '#1a1a2e') => (
    <button onClick={onClick} disabled={disabled}
      style={{ background: disabled ? '#ccc' : color, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: disabled ? 'default' : 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );

  const textarea = (value: string, onChange: (v: string) => void, placeholder: string, minHeight = 220) => (
    <textarea value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', minHeight, border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, fontSize: 13, fontFamily: 'system-ui', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
      placeholder={placeholder} />
  );

  const card = (children: React.ReactNode) => (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
      {children}
    </div>
  );

  const rowHeader = (title: string, badge?: string, right?: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        {badge && <span style={{ background: '#e8eaf6', color: '#3949ab', padding: '2px 8px', borderRadius: 20, fontSize: 11 }}>{badge}</span>}
      </div>
      {right}
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a>
        {' › '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{char.name as string}</a>
        {' › 靈魂'}
      </div>
      <CharNav id={id} active="/soul" />

      {/* 訊息列 */}
      {msg && (
        <div style={{ marginBottom: 12, fontSize: 13, padding: '8px 14px', borderRadius: 8,
          background: msg.includes('❌') ? '#fdecea' : '#e8f5e9',
          color: msg.includes('❌') ? '#c62828' : '#2e7d32' }}>
          {msg}
        </div>
      )}

      {/* 第一排：rawSoul + 鑄魂控制 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 16 }}>
        {card(
          <>
            {rowHeader('原始人設', undefined,
              btn(saving === 'rawSoul' ? '儲存中...' : '儲存', () => save('rawSoul', rawSoul, '原始人設'), saving === 'rawSoul')
            )}
            {textarea(rawSoul, setRawSoul, '輸入角色的原始人設描述...', 260)}
          </>
        )}

        {card(
          <>
            {rowHeader('鑄魂設定')}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8,
                background: skipForge ? '#f3e5f5' : '#e8f5e9', border: `1px solid ${skipForge ? '#ce93d8' : '#a5d6a7'}` }}>
                <input type="checkbox" checked={skipForge} onChange={e => setSkipForge(e.target.checked)}
                  style={{ marginTop: 2, accentColor: skipForge ? '#9c27b0' : '#43a047' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: skipForge ? '#6a1b9a' : '#1b5e20' }}>
                    {skipForge ? '✦ 原稿夠好，直接提煉' : '⚡ 整理後提煉'}
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.5 }}>
                    {skipForge
                      ? '跳過整理，直接從 rawSoul 提煉 soul_core'
                      : '先用靈魂整理格式梳理 rawSoul，再提煉 soul_core'}
                  </div>
                </div>
              </label>
            </div>

            <button onClick={forge} disabled={forging || !rawSoul}
              style={{ width: '100%', background: forging ? '#ccc' : '#6c63ff', color: '#fff', border: 'none',
                borderRadius: 8, padding: '10px', cursor: forging ? 'default' : 'pointer', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              {forging ? '🔥 鑄魂中...' : '⚡ 觸發鑄魂爐'}
            </button>

            <div style={{ fontSize: 12, color: '#999', lineHeight: 1.6, background: '#f8f9fa', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#666' }}>鑄魂後產生</div>
              <div>→ soul_core（一字千義格式）</div>
              <div style={{ marginTop: 4, color: '#bbb' }}>版本 v{char.soulVersion as number || 0}</div>
            </div>
          </>
        )}
      </div>

      {/* 第二排：soul_core + system_soul */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {card(
          <>
            {rowHeader(
              'Soul Core',
              '常駐載入',
              btn(saving === 'soul_core' ? '儲存中...' : '儲存', () => save('soul_core', soulCore, 'Soul Core'), saving === 'soul_core', '#43a047')
            )}
            <div style={{ fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
              每次對話都會載入的精煉靈魂。鑄魂爐產生後可在此手動調整。
            </div>
            {textarea(soulCore, setSoulCore, '鑄魂後自動產生，或手動填入一字千義格式...', 280)}
          </>
        )}

        {card(
          <>
            {rowHeader(
              'System Soul',
              '最終啟動版',
              btn(saving === 'system_soul' ? '儲存中...' : '儲存', () => save('system_soul', systemSoul, 'System Soul'), saving === 'system_soul', '#e65100')
            )}
            <div style={{ fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 1.5 }}>
              系統啟動時注入的完整靈魂（含工具整合後的最終版）。<br />
              填入後優先於 Soul Core。可留空讓系統自動使用 Soul Core。
            </div>
            {textarea(systemSoul, setSystemSoul, '選填：貼入組合工具後的最終靈魂文件。此欄位優先於 Soul Core 注入系統...', 280)}
          </>
        )}
      </div>
    </div>
  );
}
