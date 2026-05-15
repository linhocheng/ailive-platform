'use client';

import { useState, useRef, useCallback } from 'react';

export default function DesignXPage() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'idle' | 'keywords' | 'images' | 'generating' | 'done'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const handleGenerate = async () => {
    if (!file && !text.trim()) return;
    setLoading(true);
    setError('');
    setHtml('');
    setStep('keywords');

    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      else formData.append('text', text);

      setStep('images');
      const res = await fetch('/api/design-x/generate', { method: 'POST', body: formData });
      setStep('generating');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失敗');
      setHtml(data.html);
      setStep('done');
    } catch (e) {
      setError(String(e));
      setStep('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `designx-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stepLabel: Record<string, string> = {
    keywords: '分析內容關鍵字...',
    images: '搜尋高質感圖片...',
    generating: 'Claude 設計中，請稍候...',
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Design<span className="text-amber-400">X</span>
          </h1>
          <p className="text-zinc-400 text-lg">上傳文件，Claude 自動設計高質感簡報</p>
        </div>

        {html ? (
          /* Result view */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">簡報已生成</span>
              <div className="flex gap-3">
                <button
                  onClick={() => { setHtml(''); setStep('idle'); setFile(null); setText(''); }}
                  className="px-4 py-2 text-sm border border-zinc-700 rounded-lg hover:border-zinc-500 transition-colors"
                >
                  重新設計
                </button>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 text-sm bg-amber-400 text-black font-semibold rounded-lg hover:bg-amber-300 transition-colors"
                >
                  下載 HTML
                </button>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ height: '70vh' }}>
              <iframe
                srcDoc={html}
                className="w-full h-full"
                title="Preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        ) : (
          /* Upload view */
          <div className="space-y-6">
            {/* Drop zone */}
            <div
              className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
                ${dragging ? 'border-amber-400 bg-amber-400/5' : 'border-zinc-700 hover:border-zinc-500'}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.txt,.md"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
              />
              {file ? (
                <div className="space-y-2">
                  <div className="text-3xl">📄</div>
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-zinc-500 text-sm">{(file.size / 1024).toFixed(1)} KB</p>
                  <button
                    onClick={e => { e.stopPropagation(); setFile(null); }}
                    className="text-zinc-500 text-xs hover:text-zinc-300 underline"
                  >
                    移除
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-4xl opacity-40">↑</div>
                  <p className="text-zinc-300">拖曳或點擊上傳</p>
                  <p className="text-zinc-600 text-sm">.docx · .txt · .md</p>
                </div>
              )}
            </div>

            {/* Divider */}
            {!file && (
              <>
                <div className="flex items-center gap-4">
                  <div className="flex-1 border-t border-zinc-800" />
                  <span className="text-zinc-600 text-sm">或直接貼文字</span>
                  <div className="flex-1 border-t border-zinc-800" />
                </div>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="貼上你的內容..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-600 transition-colors"
                  rows={6}
                />
              </>
            )}

            {/* Error */}
            {error && (
              <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={loading || (!file && !text.trim())}
              className="w-full py-4 bg-amber-400 text-black font-bold text-lg rounded-xl
                hover:bg-amber-300 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  {stepLabel[step] || '處理中...'}
                </span>
              ) : '生成簡報'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
