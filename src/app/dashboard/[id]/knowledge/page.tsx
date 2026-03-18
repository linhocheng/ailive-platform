'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface KnowledgeItem { id: string; title: string; content: string; category: string; hitCount: number; createdAt: string; }

export default function KnowledgePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [adding, setAdding] = useState(false);
  const [charName, setCharName] = useState('');

  // 上傳文件狀態
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ saved: number; failed: number; filename: string } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/knowledge?characterId=${id}`).then(r => r.json()).then(d => { setItems(d.knowledge || []); setLoading(false); });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const add = async () => {
    if (!content.trim()) return;
    setAdding(true);
    await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: id, title, content, category }) });
    setTitle(''); setContent(''); setAdding(false);
    load();
  };

  const del = async (itemId: string) => {
    if (!confirm('確定刪除？')) return;
    await fetch(`/api/knowledge?id=${itemId}`, { method: 'DELETE' });
    load();
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('characterId', id);
    formData.append('category', 'document');

    try {
      const res = await fetch('/api/knowledge-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        setUploadResult({ saved: data.saved, failed: data.failed, filename: data.filename });
        load();
      } else {
        setUploadError(data.error || '上傳失敗');
      }
    } catch {
      setUploadError('網路錯誤，請再試一次');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const inputStyle = { width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 14, boxSizing: 'border-box' as const };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 知識庫
      </div>
      <CharNav id={id} active="/knowledge" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
        {/* 左側：新增 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 上傳文件 */}
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>📄 上傳文件</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>支援 .docx 和 .pdf，圖片會自動轉成文字描述</p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                width: '100%', background: uploading ? '#f0f0f0' : '#f8f9ff',
                border: '2px dashed #c0c8ff', borderRadius: 8, padding: '14px 10px',
                cursor: uploading ? 'default' : 'pointer', fontSize: 14, color: '#5560cc',
                fontWeight: 600,
              }}
            >
              {uploading ? '⏳ 解析中，請稍候...' : '＋ 選擇 .docx 或 .pdf'}
            </button>

            {uploadResult && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#e8f5e9', borderRadius: 8, fontSize: 13 }}>
                ✅ <strong>{uploadResult.filename}</strong> 解析完成<br />
                新增 {uploadResult.saved} 條知識{uploadResult.failed > 0 ? `，${uploadResult.failed} 條失敗` : ''}
              </div>
            )}
            {uploadError && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#ffebee', borderRadius: 8, fontSize: 13, color: '#c00' }}>
                ❌ {uploadError}
              </div>
            )}
          </div>

          {/* 手動新增 */}
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>✏️ 手動新增</h3>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="標題（選填）" style={inputStyle} />
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="分類（如：品牌/產品/常見問題）" style={inputStyle} />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="知識內容..." rows={6}
              style={{ ...inputStyle, resize: 'vertical' as const }} />
            <button onClick={add} disabled={adding || !content.trim()}
              style={{ width: '100%', background: adding ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: 10, cursor: 'pointer', fontSize: 14 }}>
              {adding ? '新增中...' : '+ 新增'}
            </button>
          </div>
        </div>

        {/* 右側：列表 */}
        <div>
          <h3 style={{ margin: '0 0 16px', color: '#1a1a2e' }}>共 {items.length} 條知識</h3>
          {loading ? <div style={{ color: '#999' }}>載入中...</div> : items.length === 0 ? (
            <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>還沒有知識，從左側新增或上傳文件</div>
          ) : items.map(item => (
            <div key={item.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  {item.title && <span style={{ fontWeight: 600, color: '#1a1a2e', marginRight: 8 }}>{item.title}</span>}
                  <span style={{ background: '#f0f0f0', color: '#666', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{item.category}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#999' }}>查詢 {item.hitCount} 次</span>
                  <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{item.content.slice(0, 200)}{item.content.length > 200 ? '...' : ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
