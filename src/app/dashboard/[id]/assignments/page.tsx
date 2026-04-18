'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Assignment { id: string; event: string; strategistId: string; updatedAt: string; }
interface Character { id: string; name: string; tier: string; }

const EVENT_LABELS: Record<string, string> = {
  post_review:   '📝 發文審核（角色存草稿時觸發）',
  growth_guide:  '🌱 成長引導（角色寫入新記憶時觸發）',
};

export default function AssignmentsPage() {
  const { id } = useParams<{ id: string }>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [strategists, setStrategists] = useState<Character[]>([]);
  const [managedChars, setManagedChars] = useState<Character[]>([]);
  const [charName, setCharName] = useState('');
  const [charTier, setCharTier] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  const load = async () => {
    setLoading(true);
    const [charRes, assignRes, allCharsRes] = await Promise.all([
      fetch(`/api/characters/${id}`).then(r => r.json()),
      fetch(`/api/assignments?strategistId=${id}`).then(r => r.json()),
      fetch('/api/characters').then(r => r.json()),
    ]);

    const char = charRes.character || {};
    setCharName(char.name || '');
    setCharTier(char.tier || '');

    const allChars: Character[] = allCharsRes.characters || [];
    setStrategists(allChars.filter((c: Character) => c.tier === 'strategist'));

    // 謀師視角：看我管的角色
    const myAssignments: Assignment[] = assignRes.assignments || [];
    setAssignments(myAssignments);

    // 找所有被我管的角色
    const managedIds = new Set(myAssignments.map(a => a.id.split('_')[0]));
    setManagedChars(allChars.filter((c: Character) => managedIds.has(c.id) && c.tier !== 'strategist'));
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const getAssignment = (charId: string, event: string) =>
    assignments.find(a => a.id === `${charId}_${event}`);

  const assign = async (charId: string, event: string, strategistId: string) => {
    setSaving(`${charId}_${event}`);
    if (strategistId === '') {
      await fetch('/api/assignments', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, event }) });
    } else {
      await fetch('/api/assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: charId, event, strategistId }) });
    }
    setSaving('');
    load();
  };

  // 所有角色（非謀師）
  const [allChars, setAllChars] = useState<Character[]>([]);
  useEffect(() => {
    fetch('/api/characters').then(r => r.json()).then(d => {
      setAllChars((d.characters || []).filter((c: Character) => c.tier !== 'strategist'));
    });
  }, []);

  if (loading) return <div style={{ padding: 40, color: '#999' }}>載入中...</div>;

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> ›{' '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 管轄設定
      </div>
      <CharNav id={id} active="/assignments" tier={charTier} />

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#1a1a2e' }}>管轄設定</h3>
        <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
          設定每個角色在哪些事件上由哪位謀師負責。沒有配對的事件不會觸發謀師。
        </p>
      </div>

      {/* 角色 × 事件 配對表 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', color: '#666', fontWeight: 600 }}>角色</th>
              {Object.entries(EVENT_LABELS).map(([evt, label]) => (
                <th key={evt} style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #e0e0e0', color: '#666', fontWeight: 600, minWidth: 200 }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allChars.map(char => (
              <tr key={char.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, color: '#1a1a2e' }}>{char.name}</td>
                {Object.keys(EVENT_LABELS).map(evt => {
                  const assignment = getAssignment(char.id, evt);
                  const currentStratId = assignment?.strategistId || '';
                  const key = `${char.id}_${evt}`;
                  return (
                    <td key={evt} style={{ padding: '8px 14px' }}>
                      <select
                        value={currentStratId}
                        disabled={saving === key}
                        onChange={e => assign(char.id, evt, e.target.value)}
                        style={{
                          border: `1px solid ${currentStratId ? '#4caf50' : '#e0e0e0'}`,
                          borderRadius: 6, padding: '5px 8px', fontSize: 12,
                          background: currentStratId ? '#f1f8f1' : '#fff',
                          color: currentStratId ? '#2e7d32' : '#999',
                          cursor: 'pointer', width: '100%',
                        }}
                      >
                        <option value="">— 無管理者 —</option>
                        {strategists.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {allChars.length === 0 && (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          目前沒有角色
        </div>
      )}
    </div>
  );
}
