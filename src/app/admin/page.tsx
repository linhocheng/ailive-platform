'use client';
import { useEffect, useState, useCallback } from 'react';

const LS_KEY = 'lm_admin_key';

// ── Types ──────────────────────────────────────────────
interface SchedulerChannel {
  enabled: boolean;
  postsPerDay: number;
}
interface SchedulerConfig {
  ig: SchedulerChannel;
  articles: SchedulerChannel;
  updatedAt?: string;
}
interface IgPost {
  id: string;
  content: string;
  imageUrl?: string;
  topic?: string;
  status: string;
  createdAt?: string;
  publishedAt?: string;
  igPostId?: string;
}
interface Article {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string;
  status: string;
  createdAt?: string | { _seconds: number };
}

type Tab = 'ig' | 'articles';

// ── Helpers ────────────────────────────────────────────
function adminHeaders(key: string) {
  return { 'Content-Type': 'application/json', 'x-admin-key': key };
}

function fmtDate(val?: string | { _seconds: number } | null) {
  if (!val) return '—';
  const d = typeof val === 'object' && '_seconds' in val
    ? new Date(val._seconds * 1000)
    : new Date(val as string);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function intervalLabel(ppd: number) {
  const mins = Math.round(1440 / ppd);
  if (mins >= 60) return `每 ${Math.round(mins / 60)} 小時一篇`;
  return `每 ${mins} 分鐘一篇`;
}

// ── Sub-components ─────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; fg: string; bg: string }> = {
    published:      { label: '已發布', fg: '#15803D', bg: '#F0FDF4' },
    draft:          { label: '草稿',   fg: '#6B7280', bg: '#F3F4F6' },
    failed:         { label: '失敗',   fg: '#B91C1C', bg: '#FEF2F2' },
    scheduled:      { label: '排程中', fg: '#B45309', bg: '#FFFBEB' },
    pending_review: { label: '待審',   fg: '#B45309', bg: '#FFFBEB' },
    approved:       { label: '已核',   fg: '#1D4ED8', bg: '#EFF4FF' },
    rejected:       { label: '拒絕',   fg: '#B91C1C', bg: '#FEF2F2' },
    dead:           { label: '已廢',   fg: '#9C9A95', bg: '#F5F4F1' },
  };
  const c = cfg[status] ?? { label: status, fg: '#6B7280', bg: '#F3F4F6' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      color: c.fg, background: c.bg,
      padding: '2px 8px', borderRadius: 20,
      border: `1px solid ${c.fg}22`,
    }}>{c.label}</span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: on ? 'var(--accent)' : 'var(--border)',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: on ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function CounterInput({ value, onChange, min = 1, max = 24 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  const btn = (delta: number) => ({
    width: 28, height: 28, borderRadius: 6,
    border: '1px solid var(--border)', background: 'var(--bg)',
    cursor: 'pointer', fontSize: 16, fontWeight: 500,
    color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button style={btn(-1)} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, minWidth: 28, textAlign: 'center' }}>
        {value}
      </span>
      <button style={btn(1)} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

function SchedulerCard({
  title, subtitle, channel, saving, onSave,
}: {
  title: string;
  subtitle: string;
  channel: SchedulerChannel;
  saving: boolean;
  onSave: (next: SchedulerChannel) => void;
}) {
  const safe = channel ?? { enabled: false, postsPerDay: 2 };
  const [local, setLocal] = useState<SchedulerChannel>(safe);
  useEffect(() => { if (channel) setLocal(channel); }, [channel]);
  const dirty = local.enabled !== safe.enabled || local.postsPerDay !== safe.postsPerDay;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg, 12px)', padding: 24,
      display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: local.enabled ? 'var(--green)' : 'var(--text-muted)', fontWeight: 500 }}>
            {local.enabled ? '開啟' : '關閉'}
          </span>
          <Toggle on={local.enabled} onChange={v => setLocal(p => ({ ...p, enabled: v }))} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>每天發幾篇</div>
          <CounterInput value={local.postsPerDay} onChange={v => setLocal(p => ({ ...p, postsPerDay: v }))} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>發布頻率</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, marginTop: 2 }}>
            {intervalLabel(local.postsPerDay)}
          </div>
        </div>
      </div>

      {dirty && (
        <button
          onClick={() => onSave(local)}
          disabled={saving}
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 16px', cursor: saving ? 'not-allowed' : 'pointer',
            fontWeight: 600, fontSize: 13, opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? '儲存中...' : '儲存設定'}
        </button>
      )}
    </div>
  );
}

function IgPostCard({ post }: { post: IgPost }) {
  const preview = post.content?.slice(0, 80) + (post.content?.length > 80 ? '...' : '');
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {post.imageUrl ? (
        <div style={{ aspectRatio: '4/5', overflow: 'hidden', background: 'var(--bg-alt)' }}>
          <img src={post.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : (
        <div style={{ aspectRatio: '4/5', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>無圖片</span>
        </div>
      )}
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {post.topic && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {post.topic}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{preview}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <StatusBadge status={post.status} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(post.publishedAt ?? post.createdAt)}</span>
        </div>
        {post.igPostId && (
          <a
            href={`https://www.instagram.com/p/${post.igPostId}/`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', marginTop: 2 }}
          >
            IG 查看
          </a>
        )}
      </div>
    </div>
  );
}

function ArticleRow({ article }: { article: Article }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 90px 130px',
      alignItems: 'center', gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid var(--border-soft)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
          {article.title}
        </div>
        {article.sourceUrl && (
          <a href={article.sourceUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
            來源
          </a>
        )}
      </div>
      <div><StatusBadge status={article.status} /></div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        {fmtDate(article.createdAt as string)}
      </div>
    </div>
  );
}

// ── Key Gate ───────────────────────────────────────────
function KeyGate({ onUnlock }: { onUnlock: (k: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, width: 320 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 20, color: 'var(--text-primary)' }}>
          Live Media 後台
        </div>
        <input
          type="password"
          placeholder="Admin Key"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && val && onUnlock(val)}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)', fontSize: 14,
            fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
            background: 'var(--bg)', boxSizing: 'border-box', marginBottom: 12,
          }}
          autoFocus
        />
        <button
          onClick={() => val && onUnlock(val)}
          style={{
            width: '100%', background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 8, padding: '10px', cursor: 'pointer',
            fontWeight: 600, fontSize: 14,
          }}
        >
          進入
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────
export default function AdminPage() {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [igPosts, setIgPosts] = useState<IgPost[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [tab, setTab] = useState<Tab>('ig');
  const [saving, setSaving] = useState<'ig' | 'articles' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [igFilter, setIgFilter] = useState('');
  const [articleFilter, setArticleFilter] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) setAdminKey(stored);
  }, []);

  const unlock = (key: string) => {
    localStorage.setItem(LS_KEY, key);
    setAdminKey(key);
  };

  const fetchConfig = useCallback(async (key: string) => {
    const res = await fetch('/api/admin/scheduler-config', { headers: adminHeaders(key) });
    if (res.ok) setConfig(await res.json());
    else { setError('無法載入排程設定（key 錯誤？）'); setAdminKey(null); localStorage.removeItem(LS_KEY); }
  }, []);

  const fetchIgPosts = useCallback(async (key: string, status = '') => {
    const url = status ? `/api/admin/ig-posts?status=${status}` : '/api/admin/ig-posts';
    const res = await fetch(url, { headers: adminHeaders(key) });
    if (res.ok) { const data = await res.json(); setIgPosts(data.posts ?? []); }
  }, []);

  const fetchArticles = useCallback(async (key: string, status = '') => {
    const url = status ? `/api/admin/articles?status=${status}` : '/api/admin/articles';
    const res = await fetch(url, { headers: adminHeaders(key) });
    if (res.ok) { const data = await res.json(); setArticles(data.articles ?? []); }
  }, []);

  useEffect(() => {
    if (!adminKey) return;
    (async () => {
      setLoading(true);
      await Promise.all([fetchConfig(adminKey), fetchIgPosts(adminKey), fetchArticles(adminKey)]);
      setLoading(false);
    })();
  }, [adminKey, fetchConfig, fetchIgPosts, fetchArticles]);

  const saveChannel = async (channel: 'ig' | 'articles', next: SchedulerChannel) => {
    if (!adminKey) return;
    setSaving(channel);
    try {
      const body: Partial<SchedulerConfig> = { [channel]: next };
      const res = await fetch('/api/admin/scheduler-config', {
        method: 'PATCH',
        headers: adminHeaders(adminKey),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setConfig(updated);
      }
    } finally {
      setSaving(null);
    }
  };

  if (!adminKey) return <KeyGate onUnlock={unlock} />;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)' }}>載入中...</span>
      </div>
    );
  }

  const STATUS_FILTERS_IG = ['', 'published', 'draft', 'failed'];
  const STATUS_FILTERS_ARTICLES = ['', 'pending_review', 'approved', 'published', 'rejected'];
  const STATUS_LABELS: Record<string, string> = {
    '': '全部', published: '已發布', draft: '草稿', failed: '失敗',
    pending_review: '待審', approved: '已核', rejected: '拒絕',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '0 32px',
        height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Live Media 後台
        </span>
        {error && <span style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 32px 64px' }}>

        {/* Scheduler Controls */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 16 }}>
            自動化排程
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {config && (
              <>
                <SchedulerCard
                  title="IG 圖文自動發文"
                  subtitle="鏡（lucymo0306）每隔固定時間發一篇"
                  channel={config.ig}
                  saving={saving === 'ig'}
                  onSave={next => saveChannel('ig', next)}
                />
                <SchedulerCard
                  title="文章自動發文"
                  subtitle="Live Media 文章排程發布"
                  channel={config.articles}
                  saving={saving === 'articles'}
                  onSave={next => saveChannel('articles', next)}
                />
              </>
            )}
          </div>
          {config?.updatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              上次更新：{fmtDate(config.updatedAt)}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {(['ig', 'articles'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '10px 20px', border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 14,
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1, transition: 'color 0.15s',
              }}>
                {t === 'ig' ? `IG 貼文（${igPosts.length}）` : `文章（${articles.length}）`}
              </button>
            ))}
          </div>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {(tab === 'ig' ? STATUS_FILTERS_IG : STATUS_FILTERS_ARTICLES).map(s => {
            const active = tab === 'ig' ? igFilter === s : articleFilter === s;
            return (
              <button key={s} onClick={() => {
                if (tab === 'ig') { setIgFilter(s); fetchIgPosts(adminKey, s); }
                else { setArticleFilter(s); fetchArticles(adminKey, s); }
              }} style={{
                padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)',
                background: active ? 'var(--accent)' : 'var(--surface)',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontSize: 12, cursor: 'pointer', fontWeight: active ? 600 : 400,
              }}>
                {STATUS_LABELS[s] || s}
              </button>
            );
          })}
          <button onClick={() => {
            if (tab === 'ig') fetchIgPosts(adminKey!, igFilter);
            else fetchArticles(adminKey!, articleFilter);
          }} style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: 20,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          }}>
            重新整理
          </button>
        </div>

        {/* Content */}
        {tab === 'ig' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {igPosts.length === 0
              ? <div style={{ gridColumn: '1/-1', color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center', fontSize: 13 }}>沒有貼文</div>
              : igPosts.map(p => <IgPostCard key={p.id} post={p} />)
            }
          </div>
        )}

        {tab === 'articles' && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 130px', padding: '10px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>標題</span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>狀態</span>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>時間</span>
            </div>
            {articles.length === 0
              ? <div style={{ color: 'var(--text-muted)', padding: '40px 16px', textAlign: 'center', fontSize: 13 }}>沒有文章</div>
              : articles.map(a => <ArticleRow key={a.id} article={a} />)
            }
          </div>
        )}
      </div>
    </div>
  );
}
