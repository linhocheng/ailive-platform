'use client';
import './feed.css';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface Character {
  id: string;
  name: string;
  mission: string;
  clientPassword?: string;
  visualIdentity?: { characterSheet?: string };
}

interface Post {
  id: string;
  content: string;
  imageUrl?: string;
  topic?: string;
  status: string;
  publishedAt?: string;
  createdAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function parseContent(raw: string): string[] {
  // Extract image markdown and return clean paragraphs
  const cleaned = raw
    .replace(/!\[.*?\]\(.*?\)/g, '')   // strip inline image markdown
    .replace(/\[.*?\]\(.*?\)/g, (m) => m.replace(/\[|\]/g, '').split('](')[0]) // flatten links
    .trim();
  return cleaned
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 0);
}

function extractImageFromContent(content: string): string | null {
  const m = content.match(/!\[.*?\]\((.*?)\)/);
  return m ? m[1] : null;
}

function ImagePlaceholder({ hero }: { hero?: boolean }) {
  return (
    <div className={hero ? 'feed-card-hero-img-placeholder' : 'feed-card-img-placeholder'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
  );
}

function PostContent({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="feed-card-text">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function HeroCard({ post }: { post: Post }) {
  const imgSrc = post.imageUrl || extractImageFromContent(post.content);
  const paragraphs = parseContent(post.content);
  const date = formatDate(post.publishedAt || post.createdAt);

  return (
    <article className="feed-card-hero">
      {imgSrc
        ? <img className="feed-card-hero-img" src={imgSrc} alt="" loading="lazy" />
        : <ImagePlaceholder hero />
      }
      <div className="feed-card-hero-body">
        <div className="feed-card-meta">
          <span className="feed-card-date">{date}</span>
          {post.topic && (
            <>
              <span className="feed-card-dot" />
              <span className="feed-card-tag">{post.topic}</span>
            </>
          )}
        </div>
        <PostContent paragraphs={paragraphs} />
      </div>
    </article>
  );
}

function RegularCard({ post }: { post: Post }) {
  const imgSrc = post.imageUrl || extractImageFromContent(post.content);
  const paragraphs = parseContent(post.content);
  const date = formatDate(post.publishedAt || post.createdAt);

  return (
    <article className="feed-card">
      {imgSrc
        ? <img className="feed-card-img" src={imgSrc} alt="" loading="lazy" />
        : <ImagePlaceholder />
      }
      <div className="feed-card-body">
        <div className="feed-card-meta">
          <span className="feed-card-date">{date}</span>
          {post.topic && (
            <>
              <span className="feed-card-dot" />
              <span className="feed-card-tag">{post.topic}</span>
            </>
          )}
        </div>
        <PostContent paragraphs={paragraphs} />
      </div>
    </article>
  );
}

function PasswordGate({
  char,
  onUnlock,
}: {
  char: Character;
  onUnlock: () => void;
}) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const avatarSrc = char.visualIdentity?.characterSheet;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const stored = char.clientPassword;
    if (!stored || pw === stored) {
      sessionStorage.setItem(`feed_unlocked_${char.id}`, '1');
      onUnlock();
    } else {
      setError('密碼錯誤，請再試一次');
      setPw('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="feed-root">
      <div className="feed-gate">
        <div className="feed-gate-card">
          {avatarSrc
            ? <img className="feed-gate-avatar" src={avatarSrc} alt={char.name} />
            : <div className="feed-gate-avatar-letter">{char.name[0]}</div>
          }
          <div className="feed-gate-name">{char.name}</div>
          {char.mission && <div className="feed-gate-mission">{char.mission}</div>}

          <div className="feed-gate-label">存取密碼</div>
          <input
            ref={inputRef}
            className="feed-gate-input"
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="••••••"
          />
          <div className="feed-gate-error">{error}</div>
          <button className="feed-gate-btn" disabled={!pw.trim()} onClick={submit}>
            進入
          </button>
          <div className="feed-gate-foot">由 AILIVE 提供支援 · {char.name} 的文章</div>
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Character | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load character
  useEffect(() => {
    if (!id) return;
    fetch(`/api/characters/${id}`)
      .then(r => r.json())
      .then(data => {
        const c = data.character || data;
        setChar(c);
        // Check session unlock
        const stored = sessionStorage.getItem(`feed_unlocked_${id}`);
        const needsPw = !!c.clientPassword;
        if (!needsPw || stored === '1') setUnlocked(true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Load published posts once unlocked
  useEffect(() => {
    if (!id || !unlocked) return;
    fetch(`/api/posts?characterId=${id}&limit=50`)
      .then(r => r.json())
      .then(data => {
        const visible = (data.posts || []).filter((p: Post) => p.status !== 'rejected');
        setPosts(visible);
      });
  }, [id, unlocked]);

  if (loading) {
    return (
      <div className="feed-root">
        <div className="feed-loading">載入中…</div>
      </div>
    );
  }

  if (!char) {
    return (
      <div className="feed-root">
        <div className="feed-loading">找不到角色</div>
      </div>
    );
  }

  if (!unlocked) {
    return <PasswordGate char={char} onUnlock={() => setUnlocked(true)} />;
  }

  const avatarSrc = char.visualIdentity?.characterSheet;

  return (
    <div className="feed-root">
      <div className="feed-frame">

        {/* Header */}
        <header className="feed-header">
          {avatarSrc
            ? <img className="feed-header-avatar" src={avatarSrc} alt={char.name} />
            : <div className="feed-header-avatar-letter">{char.name[0]}</div>
          }
          <div className="feed-header-info">
            <div className="feed-header-name">{char.name}</div>
            {char.mission && <div className="feed-header-mission">{char.mission}</div>}
          </div>
        </header>

        {/* Posts */}
        {posts.length === 0 ? (
          <div className="feed-empty">
            還沒有發佈的文章。
          </div>
        ) : (
          <div className="feed-list">
            {posts.map((post, i) => (
              <div key={post.id}>
                {i === 0
                  ? <HeroCard post={post} />
                  : <RegularCard post={post} />
                }
                {i < posts.length - 1 && (
                  <div className="feed-divider">
                    <div className="feed-divider-line" />
                    <div className="feed-divider-dot" />
                    <div className="feed-divider-line" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <footer className="feed-footer">
          由 AILIVE 提供支援
        </footer>
      </div>
    </div>
  );
}
