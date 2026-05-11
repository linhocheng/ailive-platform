'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

const LS_KEY = 'lm_admin_key';

// ── Types ──────────────────────────────────────────────
interface Character {
  id: string;
  name: string;
  en: string;
  title: string;
  tier: 'ceo' | 'editor' | 'superego' | 'exec' | 'creator';
  temperature: number;
  order: number;
  positioning: string;
  status: 'active' | 'inactive' | 'standby';
  soul_content?: string;
  updatedAt?: string;
}

// ── Helpers ────────────────────────────────────────────
const TIER_CFG = {
  creator:  { label: '創作者', fg: '#BE185D', bg: '#FDF2F8', border: '#FBCFE8' },
  ceo:      { label: 'CEO',    fg: '#1D4ED8', bg: '#EFF4FF', border: '#BFDBFE' },
  editor:   { label: '總編',   fg: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
  superego: { label: '超我',   fg: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  exec:     { label: '執行',   fg: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' },
};

const STATUS_CFG = {
  active:   { label: '運行中', dot: '#22C55E' },
  inactive: { label: '停用',   dot: '#9CA3AF' },
  standby:  { label: '待命',   dot: '#F59E0B' },
};

function tempColor(t: number) {
  if (t <= 4)  return '#3B82F6';
  if (t <= 14) return '#6366F1';
  if (t <= 18) return '#8B5CF6';
  if (t <= 22) return '#EC4899';
  return '#EF4444';
}

function adminHeaders(key: string) {
  return { 'Content-Type': 'application/json', 'x-admin-key': key };
}

// ── Key Gate ───────────────────────────────────────────
function KeyGate({ onUnlock }: { onUnlock: (k: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 320 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 20 }}>Live Media 後台</div>
        <input type="password" placeholder="Admin Key" value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && val && onUnlock(val)}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, fontFamily: 'var(--font-body)', background: 'var(--bg)', boxSizing: 'border-box', marginBottom: 12 }} autoFocus />
        <button onClick={() => val && onUnlock(val)}
          style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          進入
        </button>
      </div>
    </div>
  );
}

// ── Character Row ──────────────────────────────────────
function CharRow({ char, selected, onClick }: { char: Character; selected: boolean; onClick: () => void }) {
  const tc = TIER_CFG[char.tier];
  const sc = STATUS_CFG[char.status] ?? STATUS_CFG.active;
  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: '28px 52px 80px 1fr 52px 28px',
      alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer',
      background: selected ? 'var(--accent-light)' : 'transparent',
      borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
      borderBottom: '1px solid var(--border-soft)',
      transition: 'background 0.1s',
    }}>
      {/* order */}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {String(char.order).padStart(2, '0')}
      </span>
      {/* name */}
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', lineHeight: 1 }}>
          {char.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{char.en}</div>
      </div>
      {/* title */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{char.title}</div>
      {/* positioning */}
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {char.positioning || '—'}
      </div>
      {/* tier + temp */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: tc.fg, background: tc.bg, border: `1px solid ${tc.border}`, padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap' }}>
          {tc.label}
        </span>
        {char.temperature > 0 && (
          <span style={{ fontSize: 10, color: tempColor(char.temperature), fontWeight: 600 }}>{char.temperature}°C</span>
        )}
      </div>
      {/* status dot */}
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: sc.dot, flexShrink: 0, marginLeft: 'auto' }} title={sc.label} />
    </div>
  );
}

// ── Soul Editor Panel ──────────────────────────────────
function SoulPanel({ char, adminKey, onSaved }: { char: Character; adminKey: string; onSaved: (updated: Character) => void }) {
  const [content, setContent] = useState(char.soul_content ?? '');
  const [positioning, setPositioning] = useState(char.positioning);
  const [status, setStatus] = useState<Character['status']>(char.status);
  const [temperature, setTemperature] = useState(char.temperature);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!char.soul_content);
  const dirty = content !== (char.soul_content ?? '') || positioning !== char.positioning || status !== char.status || temperature !== char.temperature;

  useEffect(() => {
    setContent(char.soul_content ?? '');
    setPositioning(char.positioning);
    setStatus(char.status);
    setTemperature(char.temperature);
    if (!char.soul_content) {
      setLoading(true);
      fetch(`/api/admin/live-media-characters/${char.id}`, { headers: adminHeaders(adminKey) })
        .then(r => r.json())
        .then(d => { setContent(d.character?.soul_content ?? ''); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [char.id, char.soul_content, char.positioning, char.status, char.temperature, adminKey]);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/admin/live-media-characters', {
      method: 'PATCH',
      headers: adminHeaders(adminKey),
      body: JSON.stringify({ id: char.id, soul_content: content, positioning, status, temperature }),
    });
    if (res.ok) {
      const data = await res.json();
      onSaved(data.character as Character);
    }
    setSaving(false);
  };

  const tc = TIER_CFG[char.tier];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Panel Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--text-primary)' }}>{char.name}</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{char.en}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: tc.fg, background: tc.bg, border: `1px solid ${tc.border}`, padding: '2px 8px', borderRadius: 10 }}>{tc.label}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 4 }}>{char.title}</span>
        </div>

        {/* Editable meta row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>定位句</div>
            <input value={positioning} onChange={e => setPositioning(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--font-body)', background: 'var(--bg)', boxSizing: 'border-box', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>溫度</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" value={temperature} min={0} max={40}
                onChange={e => setTemperature(Number(e.target.value))}
                style={{ width: 52, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: tempColor(temperature), background: 'var(--bg)', textAlign: 'center' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>°C</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>狀態</div>
            <select value={status} onChange={e => setStatus(e.target.value as Character['status'])}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--font-body)', background: 'var(--bg)', color: 'var(--text-primary)' }}>
              <option value="active">運行中</option>
              <option value="standby">待命</option>
              <option value="inactive">停用</option>
            </select>
          </div>
        </div>
      </div>

      {/* Soul Content Editor */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 20px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
          靈魂核心檔案
        </div>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中...</div>
        ) : (
          <textarea value={content} onChange={e => setContent(e.target.value)}
            style={{
              flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 8,
              padding: '12px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
              color: 'var(--text-primary)', background: 'var(--bg)',
              outline: 'none',
            }} />
        )}
      </div>

      {/* Save Bar */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: dirty ? 'var(--amber)' : 'var(--text-muted)' }}>
          {dirty ? '有未儲存的變更' : char.updatedAt ? `上次儲存：${new Date(char.updatedAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={save} disabled={!dirty || saving}
          style={{ background: dirty ? 'var(--accent)' : 'var(--border)', color: dirty ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: dirty ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, transition: 'all 0.15s' }}>
          {saving ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────
export default function LiveMediaAdminPage() {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<Character | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    const k = localStorage.getItem(LS_KEY);
    if (k) setAdminKey(k);
  }, []);

  const unlock = (k: string) => { localStorage.setItem(LS_KEY, k); setAdminKey(k); };

  const fetchAll = useCallback(async (key: string) => {
    setLoading(true);
    const res = await fetch('/api/admin/live-media-characters', { headers: adminHeaders(key) });
    if (res.ok) { const d = await res.json(); setCharacters(d.characters ?? []); }
    setLoading(false);
  }, []);

  useEffect(() => { if (adminKey) fetchAll(adminKey); }, [adminKey, fetchAll]);

  const onSaved = (updated: Character) => {
    setCharacters(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    setSelected(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
  };

  const selectChar = async (char: Character) => {
    if (!adminKey) return;
    setSelected(char);
    if (!char.soul_content) {
      const res = await fetch(`/api/admin/live-media-characters/${char.id}`, { headers: adminHeaders(adminKey) });
      if (res.ok) {
        const d = await res.json();
        const full = { ...char, ...d.character };
        setCharacters(prev => prev.map(c => c.id === char.id ? full : c));
        setSelected(full);
      }
    }
  };

  if (!adminKey) return <KeyGate onUnlock={unlock} />;

  const TIERS = ['all', 'creator', 'ceo', 'editor', 'superego', 'exec'];
  const TIER_LABELS: Record<string, string> = { all: '全部', creator: '創作者', ceo: 'CEO', editor: '總編', superego: '超我', exec: '執行' };

  const filtered = filter === 'all' ? characters : characters.filter(c => c.tier === filter);
  const statusCounts = {
    active: characters.filter(c => c.status === 'active').length,
    standby: characters.filter(c => c.status === 'standby').length,
    inactive: characters.filter(c => c.status === 'inactive').length,
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', fontFamily: 'var(--font-body)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ height: 52, borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 20, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Live Media 角色管理
        </span>
        <div style={{ display: 'flex', gap: 12, marginLeft: 8 }}>
          {[
            { color: '#22C55E', label: `${statusCounts.active} 運行` },
            { color: '#F59E0B', label: `${statusCounts.standby} 待命` },
            { color: '#9CA3AF', label: `${statusCounts.inactive} 停用` },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>
        <a href="/admin" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>排程後台</a>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: selected ? '380px 1fr' : '1fr', overflow: 'hidden' }}>
        {/* Left: Character List */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)' }}>
          {/* Filter bar */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 6, flexShrink: 0 }}>
            {TIERS.map(t => (
              <button key={t} onClick={() => setFilter(t)} style={{
                padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)',
                background: filter === t ? 'var(--accent)' : 'transparent',
                color: filter === t ? '#fff' : 'var(--text-secondary)',
                fontSize: 11, cursor: 'pointer', fontWeight: filter === t ? 600 : 400,
              }}>{TIER_LABELS[t]}</button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>{filtered.length} 個角色</span>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading
              ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>載入中...</div>
              : filtered.map(c => (
                <CharRow key={c.id} char={c} selected={selected?.id === c.id} onClick={() => selectChar(c)} />
              ))
            }
          </div>
        </div>

        {/* Right: Soul Editor */}
        {selected && adminKey && (
          <SoulPanel key={selected.id} char={selected} adminKey={adminKey} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}
