'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Insight {
  id: string;
  title: string;
  content: string;
  source: string;
  tier: string;
  hitCount: number;
  eventDate: string;
  createdAt: string;
  userId?: string;
  memoryType?: string;
}

interface UserObservations {
  personality?: string | null;
  preferences?: string[];
  inferredInterests?: string[];
  notes?: string | null;
  updatedAt?: string;
}

const TIER_COLORS: Record<string, string> = { core: '#fff3e0', fresh: '#f8f9fa', archive: '#eeeeee' };
const TIER_LABELS: Record<string, string> = { core: '核心', fresh: '新鮮', archive: '封存' };
const SOURCE_LABELS: Record<string, string> = {
  conversation: '對話', manual: '手動', self_learning: '自學', reflect: '省思',
  sleep_time: '夢境', auto_extract: '自動提煉', resource_awareness: '資源認知',
  sleep_self_awareness: '睡眠自知', scheduler_reflect: '排程省思',
};

// 判斷這條記憶是否會被注入 prompt
const IDENTITY_SOURCES = new Set([
  'sleep_time', 'self_awareness', 'sleep_self_awareness', 'reflect',
  'scheduler_reflect', 'scheduler_sleep', 'post_reflection', 'pre_publish_reflection',
  'conversation', 'awakening', 'resource_awareness',
]);
function willInject(item: Insight): boolean {
  if (item.tier === 'archive') return false;
  if (item.memoryType === 'identity') return true;
  if (item.memoryType === 'knowledge') return false;
  return IDENTITY_SOURCES.has(item.source);
}

export default function MemoryPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'char' | 'user'>('char');
  const [items, setItems] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [filter, setFilter] = useState('all');

  // 用戶記憶
  const [availableUsers, setAvailableUsers] = useState<{ userId: string; updatedAt?: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userItems, setUserItems] = useState<Insight[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [obs, setObs] = useState<UserObservations>({});
  const [obsLoading, setObsLoading] = useState(false);
  const [obsSaving, setObsSaving] = useState(false);
  const [obsEditing, setObsEditing] = useState(false);
  const [obsDraft, setObsDraft] = useState<UserObservations>({});

  // 新增記憶
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState({ title: '', content: '', tier: 'fresh' });
  const [addSaving, setAddSaving] = useState(false);

  // 編輯記憶
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: '', content: '' });
  const [editSaving, setEditSaving] = useState(false);

  const loadChar = () => {
    setLoading(true);
    fetch(`/api/insights?characterId=${id}&limit=100`).then(r => r.json()).then(d => {
      setItems((d.insights || []).filter((i: Insight) => !i.userId));
      setLoading(false);
    });
  };

  const loadUser = (uid: string) => {
    if (!uid) return;
    setUserLoading(true);
    fetch(`/api/insights?characterId=${id}&userId=${encodeURIComponent(uid)}&limit=100`)
      .then(r => r.json()).then(d => {
        setUserItems(d.insights || []);
        setUserLoading(false);
      });
  };

  const loadObs = (uid: string) => {
    if (!uid) return;
    setObsLoading(true);
    fetch(`/api/user-observations?characterId=${id}&userId=${encodeURIComponent(uid)}`)
      .then(r => r.json()).then(d => {
        const o = d.observations || {};
        setObs(o);
        setObsDraft(o);
        setObsLoading(false);
      });
  };

  useEffect(() => {
    loadChar();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => { setCharName(d.character?.name || ''); });
  }, [id]);

  // tab 切到 user 時，拉可用的 userId 清單
  useEffect(() => {
    if (tab !== 'user') return;
    fetch(`/api/user-observations?characterId=${id}&listUsers=1`)
      .then(r => r.json())
      .then(d => {
        const users: { userId: string; updatedAt?: string }[] = d.users || [];
        setAvailableUsers(users);
        // 預選：localStorage 有且在清單裡就選它，否則選第一個
        const localUid = typeof window !== 'undefined' ? (localStorage.getItem('ailive_realtime_anon_uid') || '') : '';
        const match = users.find(u => u.userId === localUid);
        const defaultUid = match ? localUid : (users[0]?.userId || '');
        if (defaultUid && !selectedUserId) {
          setSelectedUserId(defaultUid);
        }
      });
  }, [tab, id]);

  // selectedUserId 變了就載資料
  useEffect(() => {
    if (tab === 'user' && selectedUserId) {
      loadUser(selectedUserId);
      loadObs(selectedUserId);
      setObsEditing(false);
    }
  }, [selectedUserId, tab]);

  const del = async (insightId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/insights?id=${insightId}`, { method: 'DELETE' });
    tab === 'char' ? loadChar() : loadUser(selectedUserId);
  };

  const promote = async (insightId: string, tier: string) => {
    await fetch('/api/insights', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: insightId, tier }) });
    tab === 'char' ? loadChar() : loadUser(selectedUserId);
  };

  const startEdit = (item: Insight) => {
    setEditingId(item.id);
    setEditDraft({ title: item.title, content: item.content });
  };

  const saveEdit = async (insightId: string) => {
    setEditSaving(true);
    await fetch('/api/insights', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: insightId, title: editDraft.title, content: editDraft.content }),
    });
    setEditingId(null);
    setEditSaving(false);
    tab === 'char' ? loadChar() : loadUser(selectedUserId);
  };

  const saveObs = async () => {
    setObsSaving(true);
    const prefsRaw = typeof obsDraft.preferences === 'string'
      ? (obsDraft.preferences as unknown as string).split(/[,、\n]/).map(s => s.trim()).filter(Boolean)
      : obsDraft.preferences || [];
    const interestsRaw = typeof obsDraft.inferredInterests === 'string'
      ? (obsDraft.inferredInterests as unknown as string).split(/[,、\n]/).map(s => s.trim()).filter(Boolean)
      : obsDraft.inferredInterests || [];
    await fetch('/api/user-observations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: id,
        userId: selectedUserId,
        personality: obsDraft.personality,
        preferences: prefsRaw,
        inferredInterests: interestsRaw,
        notes: obsDraft.notes,
      }),
    });
    setObsSaving(false);
    setObsEditing(false);
    loadObs(selectedUserId);
  };

  const addInsight = async (forUserId?: string) => {
    if (!addDraft.content.trim()) return;
    setAddSaving(true);
    const body: Record<string, unknown> = {
      characterId: id,
      title: addDraft.title,
      content: addDraft.content,
      tier: addDraft.tier,
      source: 'manual',
    };
    if (forUserId) body.userId = forUserId;
    await fetch('/api/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setAddDraft({ title: '', content: '', tier: 'fresh' });
    setShowAddForm(false);
    setAddSaving(false);
    forUserId ? loadUser(forUserId) : loadChar();
  };

  const AddForm = ({ forUserId }: { forUserId?: string }) => (
    <div style={{ background: '#f0f4ff', border: '1px solid #c5cae9', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          placeholder="標題（選填）"
          value={addDraft.title}
          onChange={e => setAddDraft(d => ({ ...d, title: e.target.value }))}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '6px 10px', fontSize: 13, boxSizing: 'border-box' }}
        />
        <textarea
          placeholder="記憶內容（必填）"
          value={addDraft.content}
          onChange={e => setAddDraft(d => ({ ...d, content: e.target.value }))}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '6px 10px', fontSize: 13, minHeight: 80, boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={addDraft.tier}
            onChange={e => setAddDraft(d => ({ ...d, tier: e.target.value }))}
            style={{ border: '1px solid #ccc', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
          >
            <option value="fresh">新鮮</option>
            <option value="core">核心</option>
          </select>
          <button onClick={() => addInsight(forUserId)} disabled={addSaving || !addDraft.content.trim()}
            style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>
            {addSaving ? '儲存中...' : '儲存'}
          </button>
          <button onClick={() => { setShowAddForm(false); setAddDraft({ title: '', content: '', tier: 'fresh' }); }}
            style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>取消</button>
        </div>
      </div>
    </div>
  );

  const filtered = filter === 'all' ? items : items.filter(i => i.tier === filter);

  const InsightCard = ({ item, showInject }: { item: Insight; showInject?: boolean }) => {
    const isEditing = editingId === item.id;
    return (
      <div style={{ background: TIER_COLORS[item.tier] || '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {isEditing
              ? <input value={editDraft.title} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                  style={{ fontWeight: 600, border: '1px solid #ccc', borderRadius: 4, padding: '2px 6px', fontSize: 14, width: 200 }} />
              : <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{item.title || '(無標題)'}</span>
            }
            <span style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#666', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{SOURCE_LABELS[item.source] || item.source}</span>
            {item.tier === 'core' && <span style={{ background: '#ff9800', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>核心</span>}
            {showInject && <span style={{ background: willInject(item) ? '#e8f5e9' : '#f5f5f5', color: willInject(item) ? '#2e7d32' : '#999', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{willInject(item) ? '注入中' : '不注入'}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#999' }}>命中 {item.hitCount}</span>
            <span style={{ fontSize: 11, color: '#bbb' }}>{item.eventDate}</span>
            {isEditing ? (
              <>
                <button onClick={() => saveEdit(item.id)} disabled={editSaving}
                  style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
                  {editSaving ? '儲存中...' : '儲存'}
                </button>
                <button onClick={() => setEditingId(null)}
                  style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>取消</button>
              </>
            ) : (
              <>
                <button onClick={() => startEdit(item)}
                  style={{ background: 'none', border: '1px solid #bbb', color: '#666', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}>編輯</button>
                {item.tier !== 'core' && <button onClick={() => promote(item.id, 'core')}
                  style={{ background: 'none', border: '1px solid #ff9800', color: '#ff9800', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}>升核心</button>}
                {item.tier !== 'archive' && <button onClick={() => promote(item.id, 'archive')}
                  style={{ background: 'none', border: '1px solid #bbb', color: '#999', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}>封存</button>}
                <button onClick={() => del(item.id)}
                  style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
              </>
            )}
          </div>
        </div>
        {isEditing
          ? <textarea value={editDraft.content} onChange={e => setEditDraft(d => ({ ...d, content: e.target.value }))}
              style={{ width: '100%', minHeight: 80, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 13, lineHeight: 1.6, boxSizing: 'border-box' }} />
          : <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{item.content}</div>
        }
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> ›{' '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 記憶
      </div>
      <CharNav id={id} active="/memory" />

      {/* 主 tab */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #e0e0e0' }}>
        {([['char', '角色記憶'], ['user', '對你的認識']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '8px 20px', border: 'none', borderBottom: tab === key ? '2px solid #1a1a2e' : '2px solid transparent', marginBottom: -2, background: 'none', cursor: 'pointer', fontWeight: tab === key ? 600 : 400, color: tab === key ? '#1a1a2e' : '#999', fontSize: 14 }}>
            {label}
          </button>
        ))}
      </div>

      {/* 角色記憶 tab */}
      {tab === 'char' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>共 {items.length} 條</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['all', 'core', 'fresh', 'archive'] as const).map(t => (
                <button key={t} onClick={() => setFilter(t)}
                  style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 20, background: filter === t ? '#1a1a2e' : '#fff', color: filter === t ? '#fff' : '#666', cursor: 'pointer', fontSize: 12 }}>
                  {t === 'all' ? '全部' : TIER_LABELS[t]}
                </button>
              ))}
              <button onClick={() => setShowAddForm(v => !v)}
                style={{ padding: '5px 14px', border: '1px solid #3f51b5', borderRadius: 20, background: showAddForm ? '#3f51b5' : '#fff', color: showAddForm ? '#fff' : '#3f51b5', cursor: 'pointer', fontSize: 12 }}>
                + 新增
              </button>
            </div>
          </div>
          {showAddForm && <AddForm />}
          {loading ? <div style={{ color: '#999' }}>載入中...</div> : filtered.length === 0
            ? <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>沒有記憶</div>
            : filtered.map(item => <InsightCard key={item.id} item={item} />)
          }
        </>
      )}

      {/* 對你的認識 tab */}
      {tab === 'user' && (
        <>
          {availableUsers.length === 0 ? (
            <div style={{ color: '#999', padding: 32, textAlign: 'center', border: '2px dashed #e0e0e0', borderRadius: 12 }}>
              這個角色還沒有任何用戶記憶。對話幾次後會自動累積。
            </div>
          ) : (
            <>
              {/* 用戶選擇器 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px', background: '#f8f9fa', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>查看用戶：</span>
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                  style={{ flex: 1, border: '1px solid #ddd', borderRadius: 4, padding: '4px 8px', fontSize: 12, background: '#fff', color: '#333' }}>
                  {availableUsers.map(u => (
                    <option key={u.userId} value={u.userId}>
                      {u.userId}{u.updatedAt ? `  （最後更新 ${u.updatedAt.slice(0, 10)}）` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* 觀察區塊 */}
              <div style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 10, padding: 20, marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: '#1a1a2e' }}>
                    {charName ? `${charName}對你的觀察` : '角色對你的觀察'}
                  </h4>
                  {!obsEditing && (
                    <button onClick={() => { setObsEditing(true); setObsDraft(obs); }}
                      style={{ background: 'none', border: '1px solid #bbb', color: '#666', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>
                      編輯
                    </button>
                  )}
                </div>
                {obsLoading ? <div style={{ color: '#999', fontSize: 13 }}>載入中...</div> : obsEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <label style={{ fontSize: 12, color: '#666' }}>個性印象
                      <textarea value={obsDraft.personality || ''} onChange={e => setObsDraft(d => ({ ...d, personality: e.target.value }))}
                        placeholder="例如：直接、有創業思維、對 AI 充滿熱情"
                        style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 60, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 13, boxSizing: 'border-box' }} />
                    </label>
                    <label style={{ fontSize: 12, color: '#666' }}>偏好（逗號分隔）
                      <input value={(obsDraft.preferences || []).join('、')} onChange={e => setObsDraft(d => ({ ...d, preferences: e.target.value.split(/[,、]/).map(s => s.trim()).filter(Boolean) }))}
                        placeholder="例如：深度對話、短回覆、中文"
                        style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 13, boxSizing: 'border-box' }} />
                    </label>
                    <label style={{ fontSize: 12, color: '#666' }}>推測興趣（逗號分隔）
                      <input value={(obsDraft.inferredInterests || []).join('、')} onChange={e => setObsDraft(d => ({ ...d, inferredInterests: e.target.value.split(/[,、]/).map(s => s.trim()).filter(Boolean) }))}
                        placeholder="例如：AI、創業、人文"
                        style={{ display: 'block', width: '100%', marginTop: 4, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 13, boxSizing: 'border-box' }} />
                    </label>
                    <label style={{ fontSize: 12, color: '#666' }}>備註
                      <textarea value={obsDraft.notes || ''} onChange={e => setObsDraft(d => ({ ...d, notes: e.target.value }))}
                        placeholder="其他觀察..."
                        style={{ display: 'block', width: '100%', marginTop: 4, minHeight: 60, border: '1px solid #ccc', borderRadius: 4, padding: 8, fontSize: 13, boxSizing: 'border-box' }} />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={saveObs} disabled={obsSaving}
                        style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>
                        {obsSaving ? '儲存中...' : '儲存'}
                      </button>
                      <button onClick={() => setObsEditing(false)}
                        style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#444', lineHeight: 1.8 }}>
                    {!obs.personality && !(obs.preferences?.length) && !(obs.inferredInterests?.length) && !obs.notes
                      ? <span style={{ color: '#bbb' }}>還沒有觀察記錄。對話幾次後會自動累積，也可以手動編輯補充。</span>
                      : <>
                          {obs.personality && <div><strong>個性：</strong>{obs.personality}</div>}
                          {obs.preferences?.length ? <div><strong>偏好：</strong>{obs.preferences.join('、')}</div> : null}
                          {obs.inferredInterests?.length ? <div><strong>興趣：</strong>{obs.inferredInterests.join('、')}</div> : null}
                          {obs.notes && <div><strong>備註：</strong>{obs.notes}</div>}
                          {obs.updatedAt && <div style={{ fontSize: 11, color: '#bbb', marginTop: 8 }}>最後更新：{obs.updatedAt.slice(0, 10)}</div>}
                        </>
                    }
                  </div>
                )}
              </div>

              {/* 用戶記憶列表 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14, color: '#1a1a2e' }}>對你的記憶 {userLoading ? '' : `（${userItems.length} 條）`}</h4>
                <button onClick={() => setShowAddForm(v => !v)}
                  style={{ padding: '4px 12px', border: '1px solid #3f51b5', borderRadius: 20, background: showAddForm ? '#3f51b5' : '#fff', color: showAddForm ? '#fff' : '#3f51b5', cursor: 'pointer', fontSize: 12 }}>
                  + 新增
                </button>
              </div>
              {showAddForm && <AddForm forUserId={selectedUserId} />}
              {userLoading ? <div style={{ color: '#999', fontSize: 13 }}>載入中...</div>
                : userItems.length === 0
                  ? <div style={{ color: '#bbb', textAlign: 'center', padding: 32, border: '2px dashed #e0e0e0', borderRadius: 12, fontSize: 13 }}>
                      還沒有對你的記憶。對話後會自動提煉。
                    </div>
                  : userItems.map(item => <InsightCard key={item.id} item={item} showInject />)
              }
            </>
          )}
        </>
      )}
    </div>
  );
}
