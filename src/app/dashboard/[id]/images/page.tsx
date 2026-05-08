'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

function DebugRow({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          fontSize: mono ? 11 : 13,
          color: accent || '#333',
          background: '#fafaf8',
          border: '1px solid #efeeea',
          borderRadius: 6,
          padding: '8px 10px',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}

interface ImageItem {
  url: string;
  conversationId: string;
  timestamp: string;
  jobId?: string;
  source?: string;
  specialistName?: string;
  workLog?: string;
  brief?: string;
  geminiPrompt?: string;
  imagePromptPrefix?: string;
  refsUsed?: string[];
}

export default function ImagesPage() {
  const { id } = useParams<{ id: string }>();
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageItem | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/images?characterId=${id}`).then(r => r.json()).then(d => {
      setImages(d.images || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => { setCharName(d.character?.name || ''); });
  }, [id]);

  const del = async (img: ImageItem) => {
    if (!confirm('確定徹底刪除這張圖？\n將同時清除：對話紀錄 + 作品檔案 + 雲端實體圖。\n不可回復。')) return;
    setDeleting(img.url);
    const params = new URLSearchParams({
      url: img.url,
      conversationId: img.conversationId || '',
    });
    if (img.jobId) params.set('jobId', img.jobId);
    const res = await fetch(`/api/images?${params.toString()}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`刪除失敗：${j.error || res.status}`);
    }
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
        <span style={{ fontSize: 12, color: '#bbb' }}>從對話中生成；刪除會三源清（對話/作品/實體）</span>
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
              <div onClick={() => setPreview(img)} style={{ aspectRatio: '3/4', overflow: 'hidden' }}>
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

      {/* 燈箱預覽（含除錯面板） */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'stretch', zIndex: 1000, cursor: 'zoom-out' }}
        >
          {/* 左：圖 */}
          <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minWidth: 0 }}>
            <img src={preview.url} alt="預覽" style={{ maxHeight: '90vh', maxWidth: '100%', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} />
          </div>

          {/* 右：除錯面板 */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 380, flexShrink: 0, background: '#fff', overflowY: 'auto', cursor: 'default', padding: '24px 20px', fontSize: 13, lineHeight: 1.6, color: '#333' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <strong style={{ color: '#1a1a2e', fontSize: 15 }}>真相鏈</strong>
              <span style={{ fontSize: 11, color: '#999' }}>{formatDate(preview.timestamp)}</span>
            </div>

            {preview.specialistName && (
              <DebugRow label="作者" value={preview.specialistName} />
            )}
            {preview.brief && (
              <DebugRow label="原 Brief" value={preview.brief} mono />
            )}
            {preview.imagePromptPrefix && (
              <DebugRow label="Prefix（瞬靈魂）" value={preview.imagePromptPrefix} mono accent="#c08" />
            )}
            {preview.geminiPrompt && (
              <DebugRow label="送進 Gemini 的 Prompt" value={preview.geminiPrompt} mono accent="#06c" />
            )}
            {preview.refsUsed && preview.refsUsed.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>參考圖（{preview.refsUsed.length}）</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {preview.refsUsed.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer" title={u}>
                      <img src={u} alt={`ref ${i + 1}`} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid #e0e0e0' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {preview.workLog && (
              <DebugRow label="工作日誌" value={preview.workLog} />
            )}
            {preview.jobId && (
              <DebugRow label="Job ID" value={preview.jobId} mono />
            )}
            <div style={{ marginTop: 16 }}>
              <a href={preview.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#06c' }}>原圖 ↗</a>
            </div>
          </div>

          {/* 關閉鈕 */}
          <button
            onClick={() => setPreview(null)}
            style={{ position: 'fixed', top: 20, right: 24, background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', zIndex: 1001 }}
          >✕</button>
        </div>
      )}
    </div>
  );
}
