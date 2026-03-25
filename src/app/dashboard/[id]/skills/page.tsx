'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Skill {
  id: string;
  name: string;
  trigger: string;
  procedure: string;
  enabled: boolean;
  createdBy: string;
  hitCount: number;
  createdAt: string;
}

export default function SkillsPage() {
  const { id } = useParams<{ id: string }>();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Skill>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', trigger: '', procedure: '' });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/skills?characterId=${id}`);
    const d = await r.json();
    setSkills(d.skills || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const toggle = async (skill: Skill) => {
    setSaving(skill.id);
    await fetch('/api/skills', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: skill.id, enabled: !skill.enabled }),
    });
    await load();
    setSaving(null);
  };

  const startEdit = (skill: Skill) => {
    setEditing(skill.id);
    setEditDraft({ name: skill.name, trigger: skill.trigger, procedure: skill.procedure });
  };

  const saveEdit = async (skillId: string) => {
    setSaving(skillId);
    await fetch('/api/skills', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: skillId, ...editDraft }),
    });
    setEditing(null);
    await load();
    setSaving(null);
  };

  const deleteSkill = async (skillId: string) => {
    if (!confirm('確定刪除這個技巧？')) return;
    setDeleting(skillId);
    await fetch(`/api/skills?id=${skillId}`, { method: 'DELETE' });
    await load();
    setDeleting(null);
  };

  const createSkill = async () => {
    if (!newSkill.name || !newSkill.trigger || !newSkill.procedure) return;
    setCreating(true);
    await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: id, ...newSkill, createdBy: 'admin' }),
    });
    setNewSkill({ name: '', trigger: '', procedure: '' });
    setShowCreate(false);
    await load();
    setCreating(false);
  };

  const inputStyle = { width: '100%', fontSize: 13, padding: '8px 10px', border: '1.5px solid #ddd', borderRadius: 6, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const };
  const taStyle = { ...inputStyle, resize: 'vertical' as const };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <CharNav id={id} active="/skills" />
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>⚡ 定型技巧</h1>
            <p style={{ fontSize: 13, color: '#666', margin: '4px 0 0' }}>
              對話中說「把這個技巧記下來」就會自動建立。每次對話都會帶著這些技巧。
            </p>
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            + 手動新增
          </button>
        </div>

        {/* 手動新增表單 */}
        {showCreate && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 20, border: '2px solid #1a1a2e' }}>
            <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>新增技巧</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>技巧名稱</div>
                <input style={inputStyle} placeholder="例：選購顧問流程" value={newSkill.name}
                  onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>觸發條件（什麼情況下用？）</div>
                <input style={inputStyle} placeholder="例：有人詢問如何選購產品時" value={newSkill.trigger}
                  onChange={e => setNewSkill({ ...newSkill, trigger: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>流程步驟（具體怎麼做？）</div>
                <textarea style={taStyle} rows={4} placeholder="例：1. 先問目標&#10;2. 問預算&#10;3. 根據條件推薦" value={newSkill.procedure}
                  onChange={e => setNewSkill({ ...newSkill, procedure: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreate(false)}
                  style={{ background: '#f5f5f5', color: '#333', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>取消</button>
                <button onClick={createSkill} disabled={creating || !newSkill.name || !newSkill.trigger || !newSkill.procedure}
                  style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', opacity: creating ? 0.6 : 1 }}>
                  {creating ? '建立中...' : '建立技巧'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 技巧列表 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>載入中...</div>
        ) : skills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#999', background: '#fff', borderRadius: 12 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>還沒有技巧</div>
            <div style={{ fontSize: 13 }}>對話中說「把這個技巧記下來」，或點上方「手動新增」</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {skills.map(skill => (
              <div key={skill.id} style={{ background: '#fff', borderRadius: 12, padding: 18, border: `1.5px solid ${skill.enabled ? '#e0e0e0' : '#f0f0f0'}`, opacity: skill.enabled ? 1 : 0.6 }}>
                {editing === skill.id ? (
                  // 編輯模式
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input style={inputStyle} value={editDraft.name || ''} onChange={e => setEditDraft({ ...editDraft, name: e.target.value })} placeholder="技巧名稱" />
                    <input style={inputStyle} value={editDraft.trigger || ''} onChange={e => setEditDraft({ ...editDraft, trigger: e.target.value })} placeholder="觸發條件" />
                    <textarea style={taStyle} rows={4} value={editDraft.procedure || ''} onChange={e => setEditDraft({ ...editDraft, procedure: e.target.value })} placeholder="流程步驟" />
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditing(null)} style={{ background: '#f5f5f5', color: '#333', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>取消</button>
                      <button onClick={() => saveEdit(skill.id)} disabled={saving === skill.id}
                        style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>
                        {saving === skill.id ? '儲存中...' : '儲存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  // 閱讀模式
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{skill.name}</span>
                        <span style={{ fontSize: 11, background: skill.createdBy === 'user' ? '#e8f5e9' : '#e3f2fd', color: skill.createdBy === 'user' ? '#2e7d32' : '#1565c0', padding: '2px 7px', borderRadius: 10 }}>
                          {skill.createdBy === 'user' ? '對話建立' : '手動建立'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {/* 開關 */}
                        <button onClick={() => toggle(skill)} disabled={saving === skill.id}
                          style={{ background: skill.enabled ? '#e8f5e9' : '#f5f5f5', color: skill.enabled ? '#2e7d32' : '#999', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          {saving === skill.id ? '...' : skill.enabled ? '✓ 啟用' : '停用'}
                        </button>
                        <button onClick={() => startEdit(skill)}
                          style={{ background: '#f5f5f5', color: '#555', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>編輯</button>
                        <button onClick={() => deleteSkill(skill.id)} disabled={deleting === skill.id}
                          style={{ background: '#fff0f0', color: '#c62828', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>
                          {deleting === skill.id ? '...' : '刪除'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
                      🎯 觸發：<span style={{ color: '#555' }}>{skill.trigger}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#444', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f9f9f9', borderRadius: 6, padding: '8px 10px' }}>
                      {skill.procedure}
                    </div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 8 }}>
                      {new Date(skill.createdAt).toLocaleDateString('zh-TW')} 建立
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
