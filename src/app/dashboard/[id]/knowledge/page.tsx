'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string;
  hitCount: number;
  createdAt: string;
  imageUrl?: string;
}

export default function KnowledgePage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [adding, setAdding] = useState(false);
  const [charName, setCharName] = useState('');
  const [clearing, setClearing] = useState<string | null>(null); // null=idle, 'all'|category name

  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'parsing' | 'done' | 'error'>('idle');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/knowledge?characterId=${id}&limit=100`)
      .then(r => r.json())
      .then(d => { setItems(d.knowledge || []); setLoading(false); });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const add = async () => {
    if (!content.trim()) return;
    setAdding(true);
    await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: id, title, content, category }),
    });
    setTitle(''); setContent(''); setAdding(false);
    load();
  };

  const del = async (itemId: string) => {
    await fetch(`/api/knowledge?id=${itemId}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  // 批量刪除：傳入 'all' 或 category 名稱
  const clearByCategory = async (target: 'all' | string) => {
    const targets = target === 'all' ? items : items.filter(i => i.category === target);
    if (targets.length === 0) return;
    const label = target === 'all' ? '全部知識' : `category「${target}」的 ${targets.length} 條`;
    if (!confirm(`確定清除${label}？此操作不可復原。`)) return;

    setClearing(target);
    for (const item of targets) {
      await fetch(`/api/knowledge?id=${item.id}`, { method: 'DELETE' });
    }
    setClearing(null);
    load();
  };

  const uploadFile = async (file: File) => {
    setUploadStatus('uploading');
    setUploadMsg('正在取得上傳憑證...');
    try {
      const urlRes = await fetch('/api/knowledge-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', characterId: id }),
      });
      const urlData = await urlRes.json();
      if (!urlData.uploadUrl) throw new Error(urlData.error || '取得上傳 URL 失敗');

      setUploadMsg(`上傳中... (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      const putRes = await fetch(urlData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`上傳到 Storage 失敗 (HTTP ${putRes.status})`);

      setUploadStatus('parsing');
      setUploadMsg('解析文件，拆分成知識條目...');
      const parseRes = await fetch('/api/knowledge-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: urlData.storagePath, characterId: id, filename: file.name, category: 'document' }),
      });
      const parseData = await parseRes.json();
      if (!parseData.success) throw new Error(parseData.error || '解析失敗');

      setUploadStatus('done');
      const textPart = parseData.text ? `文字 ${parseData.text.chunks} 條` : `${parseData.saved} 條`;
      const imgPart = parseData.images?.chunks > 0 ? `、圖片 ${parseData.images.chunks} 條` : '';
      setUploadMsg(`✅ ${file.name} 解析完成，新增 ${textPart}${imgPart}`);
      load();
    } catch (e: unknown) {
      setUploadStatus('error');
      setUploadMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const isUploading = uploadStatus === 'uploading' || uploadStatus === 'parsing';

  // 統計各 category 數量
  const categoryCount = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const inputStyle = {
    width: '100%', border: '1px solid #e0e0e0', borderRadius: 6,
    padding: '8px 10px', marginBottom: 8, fontSize: 14,
    boxSizing: 'border-box' as const,
  };

  const catColor: Record<string, string> = {
    document: '#e8f0fe',
    image: '#fce8ff',
    general: '#f0f0f0',
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> ›{' '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 知識庫
      </div>
      <CharNav id={id} active="/knowledge" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>

        {/* 左側 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 上傳文件 */}
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>📄 上傳文件</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>支援 .docx、.pdf、.md、.txt，文字與圖片分開建檔</p>
            <input ref={fileInputRef} type="file" accept=".docx,.pdf,.md,.txt" onChange={handleFileChange} style={{ display: 'none' }} />
            <button
              onClick={() => { setUploadStatus('idle'); setUploadMsg(''); fileInputRef.current?.click(); }}
              disabled={isUploading}
              style={{
                width: '100%', background: isUploading ? '#f5f5f5' : '#f8f9ff',
                border: `2px dashed ${isUploading ? '#ddd' : '#c0c8ff'}`,
                borderRadius: 8, padding: '14px 10px',
                cursor: isUploading ? 'default' : 'pointer',
                fontSize: 14, color: isUploading ? '#999' : '#5560cc', fontWeight: 600,
              }}
            >
              {isUploading ? '⏳ ' + uploadMsg : '＋ 選擇文件'}
            </button>
            {uploadStatus === 'done' && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#e8f5e9', borderRadius: 8, fontSize: 13, color: '#2e7d32' }}>{uploadMsg}</div>
            )}
            {uploadStatus === 'error' && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#ffebee', borderRadius: 8, fontSize: 13, color: '#c00' }}>{uploadMsg}</div>
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

          {/* 清除工具 */}
          {items.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #ffd0d0', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#c00' }}>🗑️ 清除知識</h3>

              {/* 依 category 清除 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {Object.entries(categoryCount).map(([cat, count]) => (
                  <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>
                      <span style={{ background: catColor[cat] || '#f0f0f0', padding: '2px 8px', borderRadius: 4, fontSize: 12, marginRight: 6 }}>{cat}</span>
                      {count} 條
                    </span>
                    <button
                      onClick={() => clearByCategory(cat)}
                      disabled={clearing !== null}
                      style={{ background: 'none', border: '1px solid #ffaaaa', color: '#c00', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
                    >
                      {clearing === cat ? '清除中...' : '清除'}
                    </button>
                  </div>
                ))}
              </div>

              {/* 全部清除 */}
              <button
                onClick={() => clearByCategory('all')}
                disabled={clearing !== null}
                style={{ width: '100%', background: clearing === 'all' ? '#ccc' : '#c00', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 0', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                {clearing === 'all' ? '清除中...' : `全部清除（${items.length} 條）`}
              </button>
            </div>
          )}
        </div>

        {/* 右側：列表 */}
        <div>
          <h3 style={{ margin: '0 0 16px', color: '#1a1a2e' }}>共 {items.length} 條知識</h3>
          {loading ? (
            <div style={{ color: '#999' }}>載入中...</div>
          ) : items.length === 0 ? (
            <div style={{ color: '#bbb', textAlign: 'center', padding: 40, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
              還沒有知識，從左側新增或上傳文件
            </div>
          ) : items.map(item => (
            <div key={item.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {item.title && <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{item.title}</span>}
                  <span style={{ background: catColor[item.category] || '#f0f0f0', color: '#555', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
                    {item.category}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#999' }}>查詢 {item.hitCount} 次</span>
                  <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', color: '#c00', cursor: 'pointer', fontSize: 13 }}>刪</button>
                </div>
              </div>

              {/* 圖片預覽 */}
              {item.imageUrl && (
                <div style={{ marginBottom: 8 }}>
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 6, objectFit: 'contain', background: '#f5f5f5' }}
                  />
                </div>
              )}

              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                {item.content.slice(0, 200)}{item.content.length > 200 ? '...' : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
