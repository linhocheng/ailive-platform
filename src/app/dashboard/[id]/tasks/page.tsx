'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Task { id: string; type: string; run_hour: number; run_minute: number; days: string[]; enabled: boolean; description: string; last_run?: string; }

const TYPE_LABELS: Record<string, string> = { learn: '🎓 主動學習', reflect: '🌙 每日省思', post: '📝 生成草稿', engage: '💬 互動' };
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default function TasksPage() {
  const { id } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [charName, setCharName] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('learn');

  const load = () => {
    setLoading(true);
    fetch(`/api/tasks?characterId=${id}`).then(r => r.json()).then(d => { setTasks(d.tasks || []); setLoading(false); });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const toggleEnabled = async (task: Task) => {
    await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, enabled: !task.enabled }) });
    load();
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) });
    setSaving(false);
    setEditing(null);
    load();
  };

  const addTask = async () => {
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: id, type: newType, run_hour: 9, run_minute: 0, days: ['mon', 'wed', 'fri'], enabled: true }) });
    load();
  };

  const del = async (taskId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
    load();
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 排程
      </div>
      <CharNav id={id} active="/tasks" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <select value={newType} onChange={e => setNewType(e.target.value)} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 14 }}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={addTask} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}>+ 新增任務</button>
      </div>

      {loading ? <div style={{ color: '#999' }}>載入中...</div> : tasks.map(task => (
        <div key={task.id} style={{ background: '#fff', border: `2px solid ${task.enabled ? '#e8f5e9' : '#eeeeee'}`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
          {editing?.id === task.id ? (
            // 編輯模式
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#666' }}>小時（台北）</label>
                  <input type="number" min={0} max={23} value={editing.run_hour} onChange={e => setEditing({ ...editing, run_hour: +e.target.value })}
                    style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#666' }}>分鐘</label>
                  <input type="number" min={0} max={59} value={editing.run_minute} onChange={e => setEditing({ ...editing, run_minute: +e.target.value })}
                    style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#666' }}>說明</label>
                  <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                    style={{ width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>執行日</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DAY_KEYS.map((dk, i) => (
                    <button key={dk} onClick={() => {
                      const days = editing.days.includes(dk) ? editing.days.filter(d => d !== dk) : [...editing.days, dk];
                      setEditing({ ...editing, days });
                    }} style={{ padding: '4px 8px', border: '1px solid #e0e0e0', borderRadius: 4, background: editing.days.includes(dk) ? '#1a1a2e' : '#fff', color: editing.days.includes(dk) ? '#fff' : '#666', cursor: 'pointer', fontSize: 13 }}>
                      {DAY_LABELS[i]}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save} disabled={saving} style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }}>儲存</button>
                <button onClick={() => setEditing(null)} style={{ background: '#f8f9fa', color: '#666', border: '1px solid #e0e0e0', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }}>取消</button>
              </div>
            </div>
          ) : (
            // 顯示模式
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 600 }}>{TYPE_LABELS[task.type] || task.type}</span>
                <span style={{ color: '#666', fontSize: 13, marginLeft: 12 }}>每天 {task.run_hour.toString().padStart(2, '0')}:{task.run_minute.toString().padStart(2, '0')} 台北</span>
                <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>週{task.days.map(d => DAY_LABELS[DAY_KEYS.indexOf(d)]).join('')}</span>
                {task.last_run && <span style={{ color: '#bbb', fontSize: 11, marginLeft: 8 }}>上次 {new Date(task.last_run).toLocaleString('zh-TW')}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => toggleEnabled(task)} style={{ background: task.enabled ? '#e8f5e9' : '#eeeeee', color: task.enabled ? '#2e7d32' : '#999', border: 'none', borderRadius: 20, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                  {task.enabled ? '啟用中' : '已停用'}
                </button>
                <button onClick={() => setEditing(task)} style={{ background: 'none', border: '1px solid #e0e0e0', color: '#666', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>編輯</button>
                <button onClick={() => del(task.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
