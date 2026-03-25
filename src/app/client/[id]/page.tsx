'use client';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import ChatPageInner from '@/app/chat/[id]/page';
import { useParams } from 'next/navigation';

interface Character {
  id: string; name: string; mission: string; type: string;
  enhancedSoul: string; clientPassword?: string;
  visualIdentity?: { characterSheet?: string };
}
interface Post {
  id: string; content: string; imageUrl?: string; topic: string;
  status: string; createdAt: string; scheduledAt?: string;
}
interface Task {
  id: string; type: string; description: string; enabled: boolean;
  run_hour: number; run_minute: number; days: string[]; last_run?: string;
}
interface Message {
  role: 'user' | 'assistant'; content: string; timestamp: string; imageUrl?: string;
}

const DAYS_LABEL: Record<string, string> = { mon:'一',tue:'二',wed:'三',thu:'四',fri:'五',sat:'六',sun:'日' };
const ALL_DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  draft:     { bg:'#fff3e0', color:'#e65100', label:'草稿' },
  scheduled: { bg:'#e8f5e9', color:'#2e7d32', label:'已排程' },
  published: { bg:'#e3f2fd', color:'#1565c0', label:'已發佈' },
  rejected:  { bg:'#fce4ec', color:'#c62828', label:'已拒絕' },
};

function PasswordGate({ charName, avatar, onUnlock }: { charName:string; avatar?:string; onUnlock:()=>void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!pw.trim()) return;
    setChecking(true); setError('');
    const ok = await (window as any).__checkPassword(pw.trim());
    if (ok) { onUnlock(); }
    else { setError('密碼錯誤，請再試一次'); setChecking(false); setPw(''); inputRef.current?.focus(); }
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8f9fa' }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'40px 32px', boxShadow:'0 4px 24px rgba(0,0,0,0.08)', width:320, textAlign:'center' }}>
        {avatar && <img src={avatar} alt="" style={{ width:72, height:72, borderRadius:'50%', objectFit:'cover', marginBottom:16, border:'3px solid #e0e0e0' }} />}
        <div style={{ fontSize:22, fontWeight:700, marginBottom:4, color:'#1a1a2e' }}>{charName||'...'}</div>
        <div style={{ fontSize:13, color:'#999', marginBottom:24 }}>請輸入存取密碼</div>
        <input ref={inputRef} type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="密碼"
          style={{ width:'100%', padding:'10px 14px', border:'1px solid #e0e0e0', borderRadius:8, fontSize:15, outline:'none', boxSizing:'border-box', marginBottom:10 }} />
        {error && <div style={{ color:'#c62828', fontSize:13, marginBottom:10 }}>{error}</div>}
        <button onClick={submit} disabled={checking||!pw.trim()}
          style={{ width:'100%', background:'#1a1a2e', color:'#fff', border:'none', borderRadius:8, padding:'11px 0', fontSize:15, fontWeight:600, cursor:'pointer', opacity:checking?0.6:1 }}>
          {checking?'驗證中...':'進入'}
        </button>
      </div>
    </div>
  );
}



function PostsTab({ charId }: { charId: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('draft');
  const [acting, setActing] = useState<string|null>(null);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/posts?characterId=${charId}&limit=50`).then(r=>r.json()).then(d=>{ setPosts(d.posts||[]); setLoading(false); });
  }, [charId]);
  useEffect(() => { load(); }, [load]);

  const saveContent = async (postId: string) => {
    setSaving(true);
    await fetch('/api/posts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:postId, content:editValue }) });
    setSaving(false); setEditingId(null); load();
  };
  const approve = async (postId: string) => {
    setActing(postId);
    await fetch('/api/posts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:postId, status:'scheduled' }) });
    setActing(null); load();
  };
  const reject = async (postId: string) => {
    setActing(postId);
    await fetch('/api/posts', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:postId, status:'rejected' }) });
    setActing(null); load();
  };

  const filtered = filter==='all' ? posts : posts.filter(p=>p.status===filter);
  const draftCount = posts.filter(p=>p.status==='draft').length;

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {(['draft','scheduled','published','rejected','all'] as const).map(s => (
          <button key={s} onClick={()=>setFilter(s)}
            style={{ padding:'5px 12px', border:'1px solid #e0e0e0', borderRadius:20, background:filter===s?'#1a1a2e':'#fff', color:filter===s?'#fff':'#666', cursor:'pointer', fontSize:12, position:'relative' }}>
            {s==='all'?'全部':STATUS_COLORS[s]?.label||s}
            {s==='draft'&&draftCount>0&&<span style={{ marginLeft:4, background:'#ff5722', color:'#fff', borderRadius:20, padding:'0 5px', fontSize:10 }}>{draftCount}</span>}
          </button>
        ))}
        {filter==='draft'&&<span style={{ fontSize:11, color:'#bbb' }}>✏️ 點擊內文可編輯</span>}
      </div>
      {loading ? <div style={{ color:'#999' }}>載入中...</div>
        : filtered.length===0 ? <div style={{ color:'#bbb', textAlign:'center', padding:40, border:'2px dashed #e0e0e0', borderRadius:12 }}>目前沒有貼文</div>
        : filtered.map(post => {
          const sc = STATUS_COLORS[post.status]||{ bg:'#f8f9fa', color:'#666', label:post.status };
          const isDraft = post.status==='draft';
          return (
            <div key={post.id} style={{ background:'#fff', border:'1px solid #e0e0e0', borderRadius:12, padding:18, marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ background:sc.bg, color:sc.color, padding:'3px 10px', borderRadius:20, fontSize:12, fontWeight:600 }}>{sc.label}</span>
                  {post.topic&&<span style={{ color:'#999', fontSize:12 }}>#{post.topic}</span>}
                </div>
                <span style={{ fontSize:11, color:'#bbb' }}>{new Date(post.createdAt).toLocaleString('zh-TW')}</span>
              </div>
              {isDraft&&editingId===post.id ? (
                <div style={{ marginBottom:10 }}>
                  <textarea value={editValue} onChange={e=>setEditValue(e.target.value)} rows={Math.max(3,editValue.split('\n').length+1)}
                    style={{ width:'100%', fontSize:14, lineHeight:1.8, background:'#f0f7ff', border:'2px solid #1976d2', borderRadius:8, padding:12, outline:'none', resize:'vertical', boxSizing:'border-box', fontFamily:'inherit' }} />
                  <div style={{ display:'flex', gap:8, marginTop:6 }}>
                    <button onClick={()=>saveContent(post.id)} disabled={saving}
                      style={{ background:'#1976d2', color:'#fff', border:'none', borderRadius:6, padding:'6px 16px', fontSize:13, cursor:'pointer' }}>
                      {saving?'儲存中...':'儲存'}
                    </button>
                    <button onClick={()=>setEditingId(null)} style={{ background:'none', border:'1px solid #e0e0e0', color:'#999', borderRadius:6, padding:'6px 14px', fontSize:13, cursor:'pointer' }}>取消</button>
                  </div>
                </div>
              ) : (
                <div onClick={()=>{ if(isDraft){ setEditingId(post.id); setEditValue(post.content); } }}
                  style={{ fontSize:14, color:'#333', lineHeight:1.8, whiteSpace:'pre-wrap', background:'#f8f9fa', borderRadius:8, padding:12, marginBottom:10, cursor:isDraft?'text':'default', border:'2px solid transparent', transition:'border 0.15s' }}
                  onMouseEnter={e=>{ if(isDraft) e.currentTarget.style.border='2px solid #bbdefb'; }}
                  onMouseLeave={e=>{ e.currentTarget.style.border='2px solid transparent'; }}>
                  {post.content}
                </div>
              )}
              {post.imageUrl&&<img src={post.imageUrl} alt="" style={{ maxWidth:180, borderRadius:8, marginBottom:10, border:'1px solid #e0e0e0', display:'block' }} />}
              {isDraft&&(
                <div style={{ display:'flex', gap:8, marginTop:4 }}>
                  <button onClick={()=>approve(post.id)} disabled={!!acting}
                    style={{ background:'#2e7d32', color:'#fff', border:'none', borderRadius:6, padding:'7px 18px', cursor:'pointer', fontSize:13, fontWeight:600 }}>✓ 核准</button>
                  <button onClick={()=>reject(post.id)} disabled={!!acting}
                    style={{ background:'#c62828', color:'#fff', border:'none', borderRadius:6, padding:'7px 18px', cursor:'pointer', fontSize:13 }}>✗ 拒絕</button>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function TasksTab({ charId }: { charId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string|null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/tasks?characterId=${charId}`).then(r=>r.json()).then(d=>{ setTasks(d.tasks||[]); setLoading(false); });
  }, [charId]);
  useEffect(() => { load(); }, [load]);

  const patch = async (taskId: string, updates: Partial<Task>) => {
    setSaving(taskId);
    await fetch('/api/tasks', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id:taskId, ...updates }) });
    setSaving(null); load();
  };

  const TYPE_LABEL: Record<string,string> = { post:'📝 發文', reflect:'🌙 反思', learn:'📚 學習', engage:'💬 互動' };

  if (loading) return <div style={{ color:'#999' }}>載入中...</div>;
  if (tasks.length===0) return <div style={{ color:'#bbb', textAlign:'center', padding:40, border:'2px dashed #e0e0e0', borderRadius:12 }}>目前沒有排程任務</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {tasks.map(task => (
        <div key={task.id} style={{ background:'#fff', border:`1px solid ${task.enabled?'#e0e0e0':'#f5f5f5'}`, borderRadius:12, padding:18, opacity:task.enabled?1:0.6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <div>
              <span style={{ fontWeight:600, fontSize:15, color:'#1a1a2e' }}>{TYPE_LABEL[task.type]||task.type}</span>
              {task.description&&<div style={{ fontSize:12, color:'#999', marginTop:2 }}>{task.description}</div>}
            </div>
            <div onClick={()=>patch(task.id,{ enabled:!task.enabled })}
              style={{ width:44, height:24, borderRadius:12, background:task.enabled?'#1a1a2e':'#ddd', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
              <div style={{ position:'absolute', top:3, left:task.enabled?23:3, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'#999' }}>時間</span>
            <select value={task.run_hour} onChange={e=>patch(task.id,{ run_hour:Number(e.target.value) })}
              style={{ border:'1px solid #e0e0e0', borderRadius:6, padding:'4px 8px', fontSize:13, cursor:'pointer', outline:'none' }}>
              {Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}
            </select>
            <span style={{ color:'#999' }}>:</span>
            <select value={task.run_minute} onChange={e=>patch(task.id,{ run_minute:Number(e.target.value) })}
              style={{ border:'1px solid #e0e0e0', borderRadius:6, padding:'4px 8px', fontSize:13, cursor:'pointer', outline:'none' }}>
              {[0,15,30,45].map(m=><option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
            </select>
            {saving===task.id&&<span style={{ fontSize:11, color:'#1976d2' }}>儲存中...</span>}
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {ALL_DAYS.map(d => {
              const active = task.days.includes(d);
              return (
                <button key={d} onClick={()=>{ const next=active?task.days.filter(x=>x!==d):[...task.days,d]; if(next.length>0) patch(task.id,{ days:next }); }}
                  style={{ width:32, height:32, borderRadius:'50%', border:'1px solid #e0e0e0', background:active?'#1a1a2e':'#f8f9fa', color:active?'#fff':'#666', fontSize:12, fontWeight:active?600:400, cursor:'pointer' }}>
                  {DAYS_LABEL[d]}
                </button>
              );
            })}
          </div>
          {task.last_run&&<div style={{ fontSize:11, color:'#bbb', marginTop:10 }}>上次執行：{new Date(task.last_run).toLocaleString('zh-TW')}</div>}
        </div>
      ))}
    </div>
  );
}

export default function ClientPage() {
  const { id: charId } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character|null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<'chat'|'posts'|'tasks'>('posts');

  useEffect(() => {
    fetch(`/api/characters/${charId}`).then(r=>r.json()).then(d=>setChar(d.character||null));
    if (typeof window!=='undefined' && sessionStorage.getItem(`client_unlocked_${charId}`)==='1') setUnlocked(true);
  }, [charId]);

  useEffect(() => {
    if (!char) return;
    (window as any).__checkPassword = (pw: string) => {
      const stored = char.clientPassword;
      if (!stored) return true;
      const ok = pw===stored;
      if (ok) sessionStorage.setItem(`client_unlocked_${charId}`,'1');
      return ok;
    };
  }, [char, charId]);

  if (!char) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#bbb' }}>載入中...</div>;
  if (!unlocked) return <PasswordGate charName={char.name} avatar={char.visualIdentity?.characterSheet} onUnlock={()=>setUnlocked(true)} />;

  const TABS = [{ key:'posts', label:'📝 貼文' },{ key:'tasks', label:'🗓 排程' },{ key:'chat', label:'💬 聊天' }] as const;

  return (
    <>
    <div style={{ maxWidth:640, margin:'0 auto', padding:'0 16px 40px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'20px 0 16px', borderBottom:'1px solid #f0f0f0', marginBottom:20 }}>
        {char.visualIdentity?.characterSheet&&<img src={char.visualIdentity.characterSheet} alt="" style={{ width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid #e0e0e0' }} />}
        <div>
          <div style={{ fontWeight:700, fontSize:18, color:'#1a1a2e' }}>{char.name}</div>
          {char.mission&&<div style={{ fontSize:12, color:'#999', marginTop:1 }}>{char.mission.slice(0,50)}{char.mission.length>50?'...':''}</div>}
        </div>
      </div>
      <div style={{ display:'flex', gap:4, marginBottom:20, background:'#f8f9fa', borderRadius:10, padding:4 }}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{ flex:1, padding:'8px 0', border:'none', borderRadius:8, background:tab===t.key?'#fff':'transparent', color:tab===t.key?'#1a1a2e':'#999', fontWeight:tab===t.key?600:400, fontSize:13, cursor:'pointer', boxShadow:tab===t.key?'0 1px 4px rgba(0,0,0,0.08)':'none', transition:'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==='posts'&&<PostsTab charId={charId} />}
      {tab==='tasks'&&<TasksTab charId={charId} />}
    </div>
    {/* 聊天室全屏覆蓋（保留完整功能） */}
    {tab==='chat'&&(
      <div style={{ position:'fixed', inset:0, zIndex:100, background:'#0f0f13' }}>
        <Suspense>
          <ChatPageInner />
        </Suspense>
        <button onClick={()=>setTab('posts')}
          style={{ position:'fixed', top:14, right:16, zIndex:101, background:'rgba(0,0,0,0.5)', border:'1px solid #2a2a38', color:'#888', borderRadius:20, padding:'4px 12px', fontSize:12, cursor:'pointer' }}>
          ✕ 關閉
        </button>
      </div>
    )}
    </>
  );
}
