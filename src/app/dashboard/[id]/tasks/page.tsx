'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Task {
  id: string; type: string; run_hour: number; run_minute: number;
  days: string[]; enabled: boolean; description: string;
  intent?: string; last_run?: string;
}

const TYPE_LABELS: Record<string, string> = {
  learn: '🎓 主動學習',
  reflect: '🌙 每日省思',
  post: '📝 生成草稿',
  explore: '🔍 探索學習',
  sleep: '💤 作夢沉殿',
  engage: '💬 互動',
};

const TYPE_INTENT_HINTS: Record<string, string> = {
  learn: '例如：每天主動了解一件跟我的世界觀相關的新事物，把洞察記下來',
  reflect: '例如：回看今天說了什麼、感受到什麼，把真實的部分記住',
  post: '例如：從我最近的感受出發，說一件只有今天的我能說的事',
  explore: '例如：搜尋今天讓我有感覺的議題（攝影、身體、都市），寫心得，可以畫一張圖',
  sleep: '例如：整理最近的洞察，問自己：我在成為更完整的自己嗎',
  engage: '例如：主動問候最近在聊天的人，從記憶裡找一個值得延續的話題',
};

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
    await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      characterId: id, type: newType,
      run_hour: 9, run_minute: 0,
      days: ['mon', 'wed', 'fri'],
      enabled: true,
      intent: TYPE_INTENT_HINTS[newType] || '',
      description: '',
    })});
    load();
  };

  const del = async (taskId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/tasks?id=${taskId}`, { method: 'DELETE' });
    load();
  };

  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box', fontFamily: 'system-ui' };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 排程
      </div>
      <CharNav id={id} active="/tasks" />

      {/* 說明卡片 */}
      <div style={{ background: '#f8f9ff', border: '1px solid #e0e8ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#555' }}>
        <strong>任務意義（intent）</strong> 是這個任務存在的原因，用一句話說清楚。<br />
        蓉兒執行時會先查自己的記憶和知識庫，再從這個意義出發，自己決定今天怎麼做。
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <select value={newType} onChange={e => setNewType(e.target.value)} style={{ border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 14 }}>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={addTask} style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}>+ 新增任務</button>
      </div>

      {loading ? <div style={{ color: '#999' }}>載入中...</div> : tasks.map(task => (
        <div key={task.id} style={{ background: '#fff', border: `2px solid ${task.enabled ? '#e8f5e9' : '#eeeeee'}`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
          {editing?.id === task.id ? (
            <div>
              {/* 時間設定 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 3 }}>小時（台北）</label>
                  <input type="number" min={0} max={23} value={editing.run_hour} onChange={e => setEditing({ ...editing, run_hour: +e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 3 }}>分鐘</label>
                  <input type="number" min={0} max={59} value={editing.run_minute} onChange={e => setEditing({ ...editing, run_minute: +e.target.value })} style={inputStyle} />
                </div>
              </div>

              {/* 任務意義（intent）— 核心欄位 */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#5560cc', display: 'block', marginBottom: 3, fontWeight: 600 }}>
                  ✦ 任務意義（蓉兒會根據這個 + 自己的記憶決定怎麼做）
                </label>
                <textarea
                  value={editing.intent || ''}
                  onChange={e => setEditing({ ...editing, intent: e.target.value })}
                  rows={3}
                  placeholder={TYPE_INTENT_HINTS[editing.type] || '這個任務存在的意義是什麼？'}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* 執行日 */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#999', display: 'block', marginBottom: 4 }}>執行日</label>
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
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{TYPE_LABELS[task.type] || task.type}</span>
                    <span style={{ color: '#666', fontSize: 12 }}>
                      每天 {task.run_hour.toString().padStart(2, '0')}:{task.run_minute.toString().padStart(2, '0')} 台北
                    </span>
                    <span style={{ color: '#999', fontSize: 11 }}>週{task.days.map(d => DAY_LABELS[DAY_KEYS.indexOf(d)]).join('')}</span>
                  </div>
                  {/* intent 顯示 */}
                  {task.intent && (
                    <div style={{ fontSize: 12, color: '#5560cc', background: '#f8f9ff', borderRadius: 6, padding: '6px 10px', marginBottom: 4, borderLeft: '3px solid #c0c8ff' }}>
                      {task.intent}
                    </div>
                  )}
                  {task.last_run && (
                    <div style={{ fontSize: 11, color: '#bbb' }}>
                      上次執行：{new Date(task.last_run).toLocaleString('zh-TW')}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 12 }}>
                  <button onClick={() => toggleEnabled(task)} style={{ background: task.enabled ? '#e8f5e9' : '#eeeeee', color: task.enabled ? '#2e7d32' : '#999', border: 'none', borderRadius: 20, padding: '4px 12px', cursor: 'pointer', fontSize: 11 }}>
                    {task.enabled ? '啟用中' : '已停用'}
                  </button>
                  <button onClick={() => setEditing(task)} style={{ background: 'none', border: '1px solid #e0e0e0', color: '#666', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>編輯</button>
                  <button onClick={() => del(task.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 12 }}>刪</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
