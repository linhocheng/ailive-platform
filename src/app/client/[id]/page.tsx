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
  status: string; createdAt: string; igPostId?: string;
}
interface Task {
  id: string; type: string; description: string; intent?: string; enabled: boolean;
  run_hour: number; run_minute: number; days: string[]; last_run?: string;
}
interface KnowledgeItem {
  id: string; title: string; content: string; category: string;
  hitCount: number; createdAt: string; imageUrl?: string;
}

// ── SVG 線條圖示 ──
const Ic = {
  Mic:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  Chat:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  File:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  Calendar: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Book:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  Upload:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>,
  Edit:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Trash:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  Check:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  X:        () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Close:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Lock:     () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Image:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Hash:     () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>,
};

const S = {
  card:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20 } as React.CSSProperties,
  btn:   (active=true) => ({ display:'flex', alignItems:'center', gap:5, padding:'7px 14px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', background: active ? 'var(--text-primary)' : 'transparent', color: active ? '#fff' : 'var(--text-secondary)', fontSize:13, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }) as React.CSSProperties,
  input: { width:'100%', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', padding:'8px 11px', fontSize:13, outline:'none', background:'var(--surface)', color:'var(--text-primary)', boxSizing:'border-box' } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600, letterSpacing:'0.08em', color:'var(--text-muted)', marginBottom:5, display:'block' } as React.CSSProperties,
};

const DAYS_LABEL: Record<string,string> = { mon:'一',tue:'二',wed:'三',thu:'四',fri:'五',sat:'六',sun:'日' };
const ALL_DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const STATUS: Record<string,{bg:string;color:string;label:string}> = {
  draft:     { bg:'var(--amber-bg)',     color:'var(--amber)',  label:'草稿' },
  scheduled: { bg:'var(--green-bg)',     color:'var(--green)',  label:'已排程' },
  published: { bg:'var(--accent-light)', color:'var(--accent)', label:'已發佈' },
  rejected:  { bg:'var(--red-bg)',       color:'var(--red)',    label:'已拒絕' },
};
const TYPE_LABEL: Record<string,string> = {
  post:'生成草稿', reflect:'每日省思', learn:'主動學習',
  explore:'探索學習', sleep:'作夢沉澱', engage:'互動',
};

// ══════════════════════════════════════
// PasswordGate
// ══════════════════════════════════════
function PasswordGate({ charName, avatar, onUnlock }: { charName:string; avatar?:string; onUnlock:()=>void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(()=>{ inputRef.current?.focus(); },[]);

  const submit = async () => {
    if (!pw.trim()) return;
    setChecking(true); setError('');
    const ok = await (window as any).__checkPassword(pw.trim());
    if (ok) { onUnlock(); }
    else { setError('密碼錯誤，請再試一次'); setChecking(false); setPw(''); inputRef.current?.focus(); }
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', fontFamily:'var(--font-body)' }}>
      <div style={{ ...S.card, width:320, textAlign:'center', boxShadow:'var(--shadow-lg)' }}>
        {avatar
          ? <img src={avatar} alt="" style={{ width:64, height:64, borderRadius:'50%', objectFit:'cover', margin:'0 auto 16px', display:'block', border:'1px solid var(--border)' }} />
          : <div style={{ width:64, height:64, borderRadius:'50%', background:'var(--bg-alt)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', color:'var(--text-muted)' }}><Ic.Lock /></div>
        }
        <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, marginBottom:4, color:'var(--text-primary)', letterSpacing:'-0.02em' }}>{charName||'…'}</div>
        <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:24 }}>請輸入存取密碼</div>
        <input ref={inputRef} type="password" value={pw}
          onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
          placeholder="密碼" style={{ ...S.input, marginBottom:10, textAlign:'center', letterSpacing:'0.2em' }}
          onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')}
          onBlur={e=>(e.target.style.borderColor='var(--border)')}
        />
        {error && <div style={{ color:'var(--red)', fontSize:13, marginBottom:10 }}>{error}</div>}
        <button onClick={submit} disabled={checking||!pw.trim()}
          style={{ ...S.btn(true), width:'100%', justifyContent:'center', opacity:checking?0.6:1 }}>
          {checking?'驗證中…':'進入'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════
// PostsTab — 完整同步後台
// ══════════════════════════════════════
function PostsTab({ charId }: { charId:string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('draft');
  const [acting, setActing] = useState<string|null>(null);
  // 文案編輯
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editContent, setEditContent] = useState('');
  // topic 編輯
  const [editTopicId, setEditTopicId] = useState<string|null>(null);
  const [editTopic, setEditTopic] = useState('');
  // imageUrl 編輯
  const [editImgId, setEditImgId] = useState<string|null>(null);
  const [editImg, setEditImg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(()=>{
    setLoading(true);
    fetch(`/api/posts?characterId=${charId}&limit=50`).then(r=>r.json()).then(d=>{setPosts(d.posts||[]);setLoading(false);});
  },[charId]);
  useEffect(()=>{load();},[load]);

  const patch = async (id:string, fields:Record<string,unknown>) => {
    await fetch('/api/posts',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,...fields})});
    load();
  };

  const saveContent = async (id:string) => { setSaving(true); await patch(id,{content:editContent}); setSaving(false); setEditingId(null); };
  const saveTopic   = async (id:string) => { setSaving(true); await patch(id,{topic:editTopic});   setSaving(false); setEditTopicId(null); };
  const saveImg     = async (id:string) => { setSaving(true); await patch(id,{imageUrl:editImg});  setSaving(false); setEditImgId(null); };
  const approve     = async (id:string) => { setActing(id); await patch(id,{status:'scheduled'}); setActing(null); };
  const reject      = async (id:string) => { setActing(id); await patch(id,{status:'rejected'});  setActing(null); };
  const del         = async (id:string) => {
    if (!confirm('確定刪除這篇草稿？')) return;
    setActing(id);
    await fetch('/api/posts',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    setActing(null); load();
  };

  const filtered = filter==='all' ? posts : posts.filter(p=>p.status===filter);
  const draftCount = posts.filter(p=>p.status==='draft').length;

  return (
    <div>
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {(['draft','scheduled','published','rejected','all'] as const).map(s=>(
          <button key={s} onClick={()=>setFilter(s)} style={{
            padding:'4px 12px',border:'1px solid var(--border)',borderRadius:20,fontSize:12,
            background:filter===s?'var(--text-primary)':'transparent',
            color:filter===s?'#fff':'var(--text-muted)',cursor:'pointer',fontWeight:filter===s?600:400,
            display:'flex',alignItems:'center',gap:4,
          }}>
            {s==='all'?'全部':STATUS[s]?.label||s}
            {s==='draft'&&draftCount>0&&<span style={{background:'var(--red)',color:'#fff',borderRadius:20,padding:'0 5px',fontSize:10,fontWeight:700}}>{draftCount}</span>}
          </button>
        ))}
      </div>

      {loading ? <div style={{color:'var(--text-muted)',fontSize:13}}>載入中…</div>
        : filtered.length===0 ? <div style={{color:'var(--text-muted)',textAlign:'center',padding:40,border:'1.5px dashed var(--border)',borderRadius:'var(--r-lg)',fontSize:13}}>目前沒有貼文</div>
        : filtered.map(post=>{
          const sc = STATUS[post.status]||{bg:'var(--bg)',color:'var(--text-muted)',label:post.status};
          const isDraft = post.status==='draft';
          return (
            <div key={post.id} style={{...S.card,marginBottom:10}}>
              {/* Header row */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{background:sc.bg,color:sc.color,padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600}}>{sc.label}</span>
                  {post.igPostId && <span style={{background:'var(--accent-light)',color:'var(--accent)',padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>IG 已發佈</span>}
                  {/* Topic 編輯 */}
                  {editTopicId===post.id ? (
                    <div style={{display:'flex',gap:4,alignItems:'center'}}>
                      <input value={editTopic} onChange={e=>setEditTopic(e.target.value)}
                        style={{...S.input,width:120,padding:'3px 8px',fontSize:12}}
                        onFocus={e=>(e.target.style.borderColor='var(--accent)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
                      <button onClick={()=>saveTopic(post.id)} disabled={saving} style={{...S.btn(true),padding:'3px 8px',fontSize:11}}><Ic.Check/></button>
                      <button onClick={()=>setEditTopicId(null)} style={{...S.btn(false),padding:'3px 8px',fontSize:11}}><Ic.X/></button>
                    </div>
                  ) : (
                    <button onClick={()=>{setEditTopicId(post.id);setEditTopic(post.topic||'');}}
                      style={{display:'flex',alignItems:'center',gap:3,background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:12,padding:0}}>
                      <Ic.Hash/>{post.topic||'加 topic'}
                    </button>
                  )}
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:11,color:'var(--text-muted)'}}>{new Date(post.createdAt).toLocaleDateString('zh-TW')}</span>
                  <button onClick={()=>del(post.id)} disabled={!!acting}
                    style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',display:'flex',alignItems:'center',padding:0,transition:'color 0.15s'}}
                    onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                    onMouseLeave={e=>(e.currentTarget.style.color='var(--text-muted)')}>
                    <Ic.Trash/>
                  </button>
                </div>
              </div>

              {/* 文案編輯 */}
              {isDraft&&editingId===post.id ? (
                <div style={{marginBottom:10}}>
                  <textarea value={editContent} onChange={e=>setEditContent(e.target.value)}
                    rows={Math.max(3,editContent.split('\n').length+1)}
                    style={{...S.input,resize:'vertical',lineHeight:1.7,marginBottom:8,borderColor:'var(--accent)'}}/>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>saveContent(post.id)} disabled={saving} style={S.btn(true)}>{saving?'儲存中…':'儲存'}</button>
                    <button onClick={()=>setEditingId(null)} style={S.btn(false)}>取消</button>
                  </div>
                </div>
              ) : (
                <div onClick={()=>{if(isDraft){setEditingId(post.id);setEditContent(post.content);}}}
                  style={{fontSize:13,color:'var(--text-primary)',lineHeight:1.8,whiteSpace:'pre-wrap',
                    background:'var(--bg)',borderRadius:'var(--r-sm)',padding:12,marginBottom:10,
                    cursor:isDraft?'text':'default',border:'1px solid transparent',transition:'border 0.15s'}}
                  onMouseEnter={e=>{if(isDraft)e.currentTarget.style.borderColor='var(--accent-light)';}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='transparent';}}>
                  {post.content}
                </div>
              )}

              {/* 圖片 + imageUrl 編輯 */}
              <div style={{marginBottom:10}}>
                {post.imageUrl && !editImgId &&
                  <img src={post.imageUrl} alt="" style={{maxWidth:160,borderRadius:'var(--r-sm)',marginBottom:6,border:'1px solid var(--border)',display:'block'}}/>
                }
                {editImgId===post.id ? (
                  <div style={{display:'flex',gap:4,alignItems:'center'}}>
                    <input value={editImg} onChange={e=>setEditImg(e.target.value)}
                      placeholder="貼上圖片 URL" style={{...S.input,fontSize:12}}
                      onFocus={e=>(e.target.style.borderColor='var(--accent)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
                    <button onClick={()=>saveImg(post.id)} disabled={saving} style={{...S.btn(true),padding:'6px 10px',flexShrink:0}}><Ic.Check/></button>
                    <button onClick={()=>setEditImgId(null)} style={{...S.btn(false),padding:'6px 10px',flexShrink:0}}><Ic.X/></button>
                  </div>
                ) : (
                  isDraft && <button onClick={()=>{setEditImgId(post.id);setEditImg(post.imageUrl||'');}}
                    style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'1px solid var(--border)',borderRadius:'var(--r-sm)',color:'var(--text-muted)',cursor:'pointer',fontSize:11,padding:'4px 8px'}}>
                    <Ic.Image/>{post.imageUrl?'換圖片':'加圖片'}
                  </button>
                )}
              </div>

              {/* 操作按鈕 */}
              {isDraft&&(
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  <button onClick={()=>approve(post.id)} disabled={!!acting} style={{...S.btn(true),background:'var(--green)',borderColor:'var(--green)'}}>
                    <Ic.Check/>核准
                  </button>
                  <button onClick={()=>reject(post.id)} disabled={!!acting} style={{...S.btn(true),background:'var(--red)',borderColor:'var(--red)'}}>
                    <Ic.X/>拒絕
                  </button>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ══════════════════════════════════════
// TasksTab — 完整同步後台
// ══════════════════════════════════════
function TasksTab({ charId }: { charId:string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [editing, setEditing] = useState<Task|null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState('post');
  const [newDesc, setNewDesc] = useState('');
  const [newIntent, setNewIntent] = useState('');
  const [newHour, setNewHour] = useState(9);
  const [newMin, setNewMin] = useState(0);
  const [newDays, setNewDays] = useState(['mon','tue','wed','thu','fri']);
  const [adding, setAdding] = useState(false);

  const load = useCallback(()=>{
    setLoading(true);
    fetch(`/api/tasks?characterId=${charId}`).then(r=>r.json()).then(d=>{setTasks(d.tasks||[]);setLoading(false);});
  },[charId]);
  useEffect(()=>{load();},[load]);

  const patch = async (taskId:string, updates:Partial<Task>) => {
    await fetch('/api/tasks',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:taskId,...updates})});
    load();
  };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    await fetch('/api/tasks',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(editing)});
    setSaving(false); setEditing(null); load();
  };
  const del = async (taskId:string) => {
    if (!confirm('確定刪除這個排程任務？')) return;
    setDeleting(taskId);
    await fetch(`/api/tasks?id=${taskId}`,{method:'DELETE'});
    setDeleting(null); load();
  };
  const addTask = async () => {
    if (newDays.length===0) return;
    setAdding(true);
    await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      characterId:charId, type:newType, description:newDesc, intent:newIntent,
      run_hour:newHour, run_minute:newMin, days:newDays, enabled:true,
    })});
    setAdding(false); setShowAdd(false);
    setNewType('post'); setNewDesc(''); setNewIntent(''); setNewHour(9); setNewMin(0); setNewDays(['mon','tue','wed','thu','fri']);
    load();
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button onClick={()=>setShowAdd(v=>!v)} style={S.btn(!showAdd)}>
          {showAdd ? <><Ic.X/>取消</> : <>+ 新增任務</>}
        </button>
      </div>

      {showAdd&&(
        <div style={{...S.card,marginBottom:16,borderColor:'var(--accent-light)'}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:14}}>新增排程任務</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={S.label}>類型</label>
              <select value={newType} onChange={e=>setNewType(e.target.value)} style={S.input}>
                {Object.entries(TYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>時間</label>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <select value={newHour} onChange={e=>setNewHour(Number(e.target.value))} style={{...S.input,flex:1}}>
                  {Array.from({length:24},(_,i)=><option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}
                </select>
                <span style={{color:'var(--text-muted)',fontWeight:600}}>:</span>
                <select value={newMin} onChange={e=>setNewMin(Number(e.target.value))} style={{...S.input,flex:1}}>
                  {[0,15,30,45].map(m=><option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={S.label}>描述（選填）</label>
            <input value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="任務說明" style={S.input}
              onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
          </div>
          <div style={{marginBottom:10}}>
            <label style={S.label}>任務意義（intent）</label>
            <textarea value={newIntent} onChange={e=>setNewIntent(e.target.value)} rows={3}
              placeholder="這個任務存在的意義是什麼？" style={{...S.input,resize:'vertical'}}
              onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={S.label}>執行日</label>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {ALL_DAYS.map(d=>{
                const active=newDays.includes(d);
                return <button key={d} onClick={()=>setNewDays(prev=>active?prev.filter(x=>x!==d):[...prev,d])}
                  style={{width:30,height:30,borderRadius:'50%',border:'1px solid var(--border)',fontSize:12,fontWeight:active?600:400,cursor:'pointer',transition:'all 0.15s',
                    background:active?'var(--text-primary)':'transparent',color:active?'#fff':'var(--text-muted)'}}>
                  {DAYS_LABEL[d]}
                </button>;
              })}
            </div>
          </div>
          <button onClick={addTask} disabled={adding||newDays.length===0}
            style={{...S.btn(true),opacity:adding||newDays.length===0?0.5:1}}>
            {adding?'新增中…':'新增'}
          </button>
        </div>
      )}

      {loading ? <div style={{color:'var(--text-muted)',fontSize:13}}>載入中…</div>
        : tasks.length===0 ? <div style={{color:'var(--text-muted)',textAlign:'center',padding:40,border:'1.5px dashed var(--border)',borderRadius:'var(--r-lg)',fontSize:13}}>目前沒有排程任務</div>
        : <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {tasks.map(task=>(
            <div key={task.id} style={{...S.card,border:`1px solid ${task.enabled?'var(--green-bg)':'var(--border)'}`,opacity:task.enabled?1:0.65}}>
              {editing?.id===task.id ? (
                <div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                    <div>
                      <label style={S.label}>小時</label>
                      <input type="number" min={0} max={23} value={editing.run_hour}
                        onChange={e=>setEditing({...editing,run_hour:+e.target.value})} style={S.input}/>
                    </div>
                    <div>
                      <label style={S.label}>分鐘</label>
                      <input type="number" min={0} max={59} value={editing.run_minute}
                        onChange={e=>setEditing({...editing,run_minute:+e.target.value})} style={S.input}/>
                    </div>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={S.label}>描述</label>
                    <textarea value={editing.description||''} onChange={e=>setEditing({...editing,description:e.target.value})}
                      rows={2} style={{...S.input,resize:'vertical'}}/>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label style={S.label}>任務意義（intent）</label>
                    <textarea value={editing.intent||''} onChange={e=>setEditing({...editing,intent:e.target.value})}
                      rows={4} style={{...S.input,resize:'vertical'}} placeholder="這個任務存在的意義是什麼？"/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <label style={S.label}>執行日</label>
                    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                      {ALL_DAYS.map(d=>{
                        const active=editing.days.includes(d);
                        return <button key={d} onClick={()=>{const days=active?editing.days.filter(x=>x!==d):[...editing.days,d];if(days.length>0)setEditing({...editing,days});}}
                          style={{width:30,height:30,borderRadius:'50%',border:'1px solid var(--border)',fontSize:12,fontWeight:active?600:400,cursor:'pointer',transition:'all 0.15s',
                            background:active?'var(--text-primary)':'transparent',color:active?'#fff':'var(--text-muted)'}}>
                          {DAYS_LABEL[d]}
                        </button>;
                      })}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={save} disabled={saving} style={{...S.btn(true),background:'var(--green)',borderColor:'var(--green)'}}>{saving?'儲存中…':'儲存'}</button>
                    <button onClick={()=>setEditing(null)} style={S.btn(false)}>取消</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                        <span style={{fontWeight:600,fontSize:14,color:'var(--text-primary)'}}>{TYPE_LABEL[task.type]||task.type}</span>
                        <span style={{fontSize:12,color:'var(--text-secondary)'}}>{String(task.run_hour).padStart(2,'0')}:{String(task.run_minute).padStart(2,'0')}</span>
                        <span style={{fontSize:11,color:'var(--text-muted)'}}>週{task.days.map(d=>DAYS_LABEL[d]||'').join('')}</span>
                      </div>
                      {task.description&&<div style={{fontSize:12,color:'var(--text-secondary)',marginBottom:4}}>{task.description}</div>}
                      {task.intent&&<div style={{fontSize:12,color:'var(--text-secondary)',background:'var(--bg)',borderRadius:'var(--r-sm)',padding:'6px 10px',marginBottom:4,borderLeft:'2px solid var(--border)'}}>{task.intent.slice(0,140)}{task.intent.length>140?'…':''}</div>}
                      {task.last_run&&<div style={{fontSize:11,color:'var(--text-muted)'}}>上次執行：{new Date(task.last_run).toLocaleString('zh-TW')}</div>}
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center',marginLeft:12,flexShrink:0}}>
                      <button onClick={()=>patch(task.id,{enabled:!task.enabled})}
                        style={{padding:'3px 10px',border:'1px solid var(--border)',borderRadius:20,fontSize:11,fontWeight:500,cursor:'pointer',
                          background:task.enabled?'var(--green-bg)':'var(--bg)',color:task.enabled?'var(--green)':'var(--text-muted)'}}>
                        {task.enabled?'啟用中':'已停用'}
                      </button>
                      <button onClick={()=>setEditing(task)} style={{...S.btn(false),padding:'3px 10px',fontSize:11}}>
                        <Ic.Edit/>編輯
                      </button>
                      <button onClick={()=>del(task.id)} disabled={deleting===task.id}
                        style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',display:'flex',alignItems:'center',padding:0,transition:'color 0.15s'}}
                        onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')}
                        onMouseLeave={e=>(e.currentTarget.style.color='var(--text-muted)')}>
                        <Ic.Trash/>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      }
    </div>
  );
}

// ══════════════════════════════════════
// KnowledgeTab — 全功能
// ══════════════════════════════════════
function KnowledgeTab({ charId }: { charId:string }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<string|null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle'|'uploading'|'parsing'|'done'|'error'>('idle');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(()=>{
    setLoading(true);
    fetch(`/api/knowledge?characterId=${charId}&limit=100`).then(r=>r.json()).then(d=>{setItems(d.knowledge||[]);setLoading(false);});
  },[charId]);
  useEffect(()=>{load();},[load]);

  const add = async () => {
    if (!content.trim()) return;
    setAdding(true);
    await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId:charId,title,content,category})});
    setTitle(''); setContent(''); setAdding(false); load();
  };
  const del = async (id:string) => {
    await fetch(`/api/knowledge?id=${id}`,{method:'DELETE'});
    setItems(prev=>prev.filter(i=>i.id!==id));
  };
  const clearByCategory = async (target:'all'|string) => {
    const targets = target==='all' ? items : items.filter(i=>i.category===target);
    if (targets.length===0) return;
    if (!confirm(`確定清除？此操作不可復原。`)) return;
    setClearing(target);
    for (const item of targets) await fetch(`/api/knowledge?id=${item.id}`,{method:'DELETE'});
    setClearing(null); load();
  };
  const uploadFile = async (file:File) => {
    setUploadStatus('uploading'); setUploadMsg('取得上傳憑證中…');
    try {
      const urlRes = await fetch('/api/knowledge-upload-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,contentType:file.type||'application/octet-stream',characterId:charId})});
      const urlData = await urlRes.json();
      if (!urlData.uploadUrl) throw new Error(urlData.error||'取得 URL 失敗');
      setUploadMsg(`上傳中… (${(file.size/1024/1024).toFixed(1)} MB)`);
      const putRes = await fetch(urlData.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
      if (!putRes.ok) throw new Error(`上傳失敗 (HTTP ${putRes.status})`);
      setUploadStatus('parsing'); setUploadMsg('解析文件，拆分知識條目中…');
      const parseRes = await fetch('/api/knowledge-parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storagePath:urlData.storagePath,characterId:charId,filename:file.name,category:'document'})});
      const parseData = await parseRes.json();
      if (!parseData.success) throw new Error(parseData.error||'解析失敗');
      setUploadStatus('done');
      const textPart = parseData.text ? `文字 ${parseData.text.chunks} 條` : `${parseData.saved} 條`;
      const imgPart = parseData.images?.chunks>0 ? `、圖片 ${parseData.images.chunks} 條` : '';
      setUploadMsg(`${file.name} 解析完成，新增 ${textPart}${imgPart}`);
      load();
    } catch(e:unknown) {
      setUploadStatus('error'); setUploadMsg(e instanceof Error ? e.message : String(e));
    } finally { if (fileInputRef.current) fileInputRef.current.value=''; }
  };

  const isUploading = uploadStatus==='uploading'||uploadStatus==='parsing';
  const categoryCount = items.reduce<Record<string,number>>((acc,item)=>{acc[item.category]=(acc[item.category]||0)+1;return acc;},{});

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1.8fr',gap:16}}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:4,display:'flex',alignItems:'center',gap:6}}><Ic.Upload/>上傳文件</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>支援 .docx .pdf .md .txt</div>
          <input ref={fileInputRef} type="file" accept=".docx,.pdf,.md,.txt" onChange={e=>{const f=e.target.files?.[0];if(f)uploadFile(f);}} style={{display:'none'}}/>
          <button onClick={()=>{setUploadStatus('idle');setUploadMsg('');fileInputRef.current?.click();}} disabled={isUploading}
            style={{width:'100%',background:isUploading?'var(--bg)':'var(--accent-light)',border:`1.5px dashed ${isUploading?'var(--border)':'var(--accent)'}`,borderRadius:'var(--r-sm)',padding:'14px 10px',cursor:isUploading?'default':'pointer',fontSize:13,color:isUploading?'var(--text-muted)':'var(--accent)',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
            {isUploading ? uploadMsg : <><Ic.Upload/>選擇文件</>}
          </button>
          {uploadStatus==='done'&&<div style={{marginTop:8,padding:'8px 10px',background:'var(--green-bg)',borderRadius:'var(--r-sm)',fontSize:12,color:'var(--green)'}}>{uploadMsg}</div>}
          {uploadStatus==='error'&&<div style={{marginTop:8,padding:'8px 10px',background:'var(--red-bg)',borderRadius:'var(--r-sm)',fontSize:12,color:'var(--red)'}}>{uploadMsg}</div>}
        </div>
        <div style={S.card}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:12,display:'flex',alignItems:'center',gap:6}}><Ic.Edit/>手動新增</div>
          <label style={S.label}>標題（選填）</label>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="標題" style={{...S.input,marginBottom:8}}
            onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
          <label style={S.label}>分類</label>
          <input value={category} onChange={e=>setCategory(e.target.value)} placeholder="品牌/產品/常見問題" style={{...S.input,marginBottom:8}}
            onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
          <label style={S.label}>內容</label>
          <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="知識內容…" rows={5}
            style={{...S.input,resize:'vertical',lineHeight:1.6,marginBottom:10}}
            onFocus={e=>(e.target.style.borderColor='var(--text-secondary)')} onBlur={e=>(e.target.style.borderColor='var(--border)')}/>
          <button onClick={add} disabled={adding||!content.trim()} style={{...S.btn(true),width:'100%',justifyContent:'center',opacity:adding||!content.trim()?0.5:1}}>
            {adding?'新增中…':'新增'}
          </button>
        </div>
        {items.length>0&&(
          <div style={{...S.card,borderColor:'var(--red-bg)'}}>
            <div style={{fontSize:13,fontWeight:600,color:'var(--red)',marginBottom:12,display:'flex',alignItems:'center',gap:5}}><Ic.Trash/>清除知識</div>
            <div style={{display:'flex',flexDirection:'column',gap:7,marginBottom:10}}>
              {Object.entries(categoryCount).map(([cat,count])=>(
                <div key={cat} style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:'var(--text-secondary)'}}><span style={{background:'var(--bg-alt)',padding:'1px 7px',borderRadius:4,marginRight:5,fontSize:11}}>{cat}</span>{count} 條</span>
                  <button onClick={()=>clearByCategory(cat)} disabled={clearing!==null}
                    style={{...S.btn(false),padding:'3px 10px',fontSize:11,color:'var(--red)',borderColor:'var(--red-bg)'}}>
                    {clearing===cat?'清除中…':'清除'}
                  </button>
                </div>
              ))}
            </div>
            <button onClick={()=>clearByCategory('all')} disabled={clearing!==null}
              style={{...S.btn(true),width:'100%',justifyContent:'center',background:'var(--red)',borderColor:'var(--red)',opacity:clearing==='all'?0.6:1}}>
              {clearing==='all'?'清除中…':`全部清除（${items.length} 條）`}
            </button>
          </div>
        )}
      </div>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:12}}>共 {items.length} 條知識</div>
        {loading ? <div style={{color:'var(--text-muted)',fontSize:13}}>載入中…</div>
          : items.length===0 ? <div style={{color:'var(--text-muted)',textAlign:'center',padding:40,border:'1.5px dashed var(--border)',borderRadius:'var(--r-lg)',fontSize:13}}>還沒有知識，從左側新增或上傳文件</div>
          : items.map(item=>(
            <div key={item.id} style={{...S.card,marginBottom:8,padding:14}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  {item.title&&<span style={{fontWeight:600,fontSize:13,color:'var(--text-primary)'}}>{item.title}</span>}
                  <span style={{background:'var(--bg-alt)',color:'var(--text-muted)',padding:'1px 6px',borderRadius:4,fontSize:10}}>{item.category}</span>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
                  <span style={{fontSize:10,color:'var(--text-muted)'}}>查詢 {item.hitCount} 次</span>
                  <button onClick={()=>del(item.id)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',display:'flex',alignItems:'center',padding:0,transition:'color 0.15s'}}
                    onMouseEnter={e=>(e.currentTarget.style.color='var(--red)')} onMouseLeave={e=>(e.currentTarget.style.color='var(--text-muted)')}>
                    <Ic.Trash/>
                  </button>
                </div>
              </div>
              {item.imageUrl&&<img src={item.imageUrl} alt={item.title} style={{maxWidth:'100%',maxHeight:120,borderRadius:'var(--r-sm)',objectFit:'contain',background:'var(--bg)',marginBottom:6,border:'1px solid var(--border)',display:'block'}}/>}
              <div style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6}}>{item.content.slice(0,180)}{item.content.length>180?'…':''}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════
// Main
// ══════════════════════════════════════
export default function ClientPage() {
  const { id: charId } = useParams<{ id:string }>();
  const [char, setChar] = useState<Character|null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<'posts'|'tasks'|'knowledge'|'chat'>('posts');

  useEffect(()=>{
    fetch(`/api/characters/${charId}`).then(r=>r.json()).then(d=>setChar(d.character||null));
    if (typeof window!=='undefined'&&sessionStorage.getItem(`client_unlocked_${charId}`)==='1') setUnlocked(true);
  },[charId]);

  useEffect(()=>{
    if (!char) return;
    (window as any).__checkPassword = (pw:string) => {
      const stored = char.clientPassword;
      if (!stored) return true;
      const ok = pw===stored;
      if (ok) sessionStorage.setItem(`client_unlocked_${charId}`,'1');
      return ok;
    };
  },[char,charId]);

  if (!char) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',color:'var(--text-muted)',fontFamily:'var(--font-body)'}}>載入中…</div>
  );
  if (!unlocked) return <PasswordGate charName={char.name} avatar={char.visualIdentity?.characterSheet} onUnlock={()=>setUnlocked(true)}/>;

  const TABS = [
    {key:'posts',     label:'貼文',  icon:<Ic.File/>},
    {key:'tasks',     label:'排程',  icon:<Ic.Calendar/>},
    {key:'knowledge', label:'知識庫', icon:<Ic.Book/>},
    {key:'chat',      label:'聊天',  icon:<Ic.Chat/>},
  ] as const;

  const TabBar = ({fixed=false}:{fixed?:boolean}) => (
    <div style={{display:'flex',gap:2,background:'var(--bg)',borderRadius:fixed?0:'var(--r-md)',padding:fixed?'8px 16px':3,
      ...(fixed?{borderTop:'1px solid var(--border)'}:{})}}>
      {TABS.map(t=>(
        <button key={t.key} onClick={()=>setTab(t.key)} style={{
          flex:1,padding:'7px 0',border:'none',borderRadius:'var(--r-sm)',
          background:tab===t.key?'var(--surface)':'transparent',
          color:tab===t.key?'var(--text-primary)':'var(--text-muted)',
          fontWeight:tab===t.key?600:400,fontSize:fixed?12:13,cursor:'pointer',
          boxShadow:tab===t.key&&!fixed?'var(--shadow-sm)':'none',
          transition:'all 0.15s',display:'flex',alignItems:'center',justifyContent:'center',gap:4,
          fontFamily:'var(--font-body)',
        }}>{t.icon}{t.label}</button>
      ))}
    </div>
  );

  return (
    <>
    <div style={{maxWidth:760,margin:'0 auto',padding:'0 16px 48px',fontFamily:'var(--font-body)'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 0 16px',borderBottom:'1px solid var(--border)',marginBottom:20}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {char.visualIdentity?.characterSheet
            ? <img src={char.visualIdentity.characterSheet} alt="" style={{width:40,height:40,borderRadius:'50%',objectFit:'cover',border:'1px solid var(--border)'}}/>
            : <div style={{width:40,height:40,borderRadius:'50%',background:'var(--bg-alt)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:16,fontFamily:'var(--font-display)',fontWeight:700}}>{char.name[0]}</div>
          }
          <div>
            <div style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:17,color:'var(--text-primary)',letterSpacing:'-0.02em'}}>{char.name}</div>
            {char.mission&&<div style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>{char.mission.slice(0,48)}{char.mission.length>48?'…':''}</div>}
          </div>
        </div>
        <a href={`/voice/${charId}`}
          style={{...S.btn(true),textDecoration:'none',display:'flex',alignItems:'center'}}
          onMouseEnter={e=>(e.currentTarget.style.opacity='0.85')}
          onMouseLeave={e=>(e.currentTarget.style.opacity='1')}>
          <Ic.Mic/>語音
        </a>
      </div>

      <div style={{marginBottom:20}}><TabBar/></div>

      {tab==='posts'     && <PostsTab charId={charId}/>}
      {tab==='tasks'     && <TasksTab charId={charId}/>}
      {tab==='knowledge' && <KnowledgeTab charId={charId}/>}
    </div>

    {tab==='chat'&&(
      <div style={{position:'fixed',inset:0,zIndex:100,background:'#fff'}}>
        <style>{`
          .client-chat-wrap header a:first-child { display: none !important; }
          .client-chat-wrap header > div > div:nth-child(2) { display: none !important; }
        `}</style>
        <div className="client-chat-wrap" style={{height:'calc(100dvh - 56px)'}}>
          <Suspense><ChatPageInner/></Suspense>
        </div>
        <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:101}}>
          <TabBar fixed={true}/>
        </div>
      </div>
    )}
    </>
  );
}
