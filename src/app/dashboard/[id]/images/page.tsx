'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface ImageItem {
  url: string;
  conversationId: string;
  timestamp: string;
}

export default function ImagesPage() {
  const { id } = useParams<{ id: string }>();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/images?characterId=${id}`).then(r => r.json()).then(d => {
      setImages(d.images || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const del = async (img: ImageItem) => {
    if (!confirm('確定刪除這張圖的記錄？（Firebase Storage 的圖片不會刪除）')) return;
    setDeleting(img.url);
    await fetch(`/api/images?url=${encodeURIComponent(img.url)}&conversationId=${img.conversationId}`, { method: 'DELETE' });
    setDeleting(null);
    load();
  };

  const formatDate = (ts: string) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return ts.slice(0, 16); }
  };

  return (
    <div>
      {/* 麵包屑 */}
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a>
        {' › '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a>
        {' › 生圖檔'}
      </div>
      <CharNav id={id} active="/images" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#1a1a2e' }}>共 {images.length} 張生成圖片</h3>
        <span style={{ fontSize: 12, color: '#bbb' }}>從對話中生成，永久存於 Firebase Storage</span>
      </div>

      {loading ? (
        <div style={{ color: '#999', padding: 40, textAlign: 'center' }}>載入中...</div>
      ) : images.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 60, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          還沒有對話生圖
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid #e0e0e0', background: '#f8f9fa', cursor: 'pointer' }}>
              {/* 圖片 */}
              <div onClick={() => setPreview(img.url)} style={{ aspectRatio: '3/4', overflow: 'hidden' }}>
                <img
                  src={img.url}
                  alt={`生圖 ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                />
              </div>

              {/* 底部 bar */}
              <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                <span style={{ fontSize: 11, color: '#bbb' }}>{formatDate(img.timestamp)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                    title="開啟原圖"
                    style={{ fontSize: 13, color: '#666', textDecoration: 'none', padding: '2px 4px', borderRadius: 4, border: '1px solid #e0e0e0' }}
                    onClick={e => e.stopPropagation()}
                  >↗</a>
                  <button
                    onClick={e => { e.stopPropagation(); del(img); }}
                    disabled={deleting === img.url}
                    title="從記錄中移除"
                    style={{ fontSize: 13, color: '#c00', background: 'none', border: '1px solid #e0e0e0', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                  >{deleting === img.url ? '...' : '✕'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 燈箱預覽 */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out' }}
        >
          <img src={preview} alt="預覽" style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} />
          <button
            onClick={() => setPreview(null)}
            style={{ position: 'fixed', top: 20, right: 24, background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer' }}
          >✕</button>
        </div>
      )}
    </div>
  );
}
