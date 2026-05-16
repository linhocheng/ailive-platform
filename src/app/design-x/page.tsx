'use client';
import './page.css';
import { useState, useRef, useCallback } from 'react';

type Stage = 'idle' | 'reading' | 'keywords' | 'designing' | 'done';

const STAGES: { id: Stage; label: string; sub: string }[] = [
  { id: 'reading',   label: '解析內容結構', sub: '讀取文件，辨識層次與主題' },
  { id: 'keywords',  label: '規劃投影片架構', sub: '決定張數與版型組合' },
  { id: 'designing', label: 'Claude 設計中', sub: '生成排版、字型對比與視覺節奏' },
];

function stageState(id: Stage, current: Stage): 'pending' | 'active' | 'done' {
  const order: Stage[] = ['reading', 'keywords', 'designing', 'done'];
  const ci = order.indexOf(current);
  const si = order.indexOf(id);
  if (ci > si) return 'done';
  if (ci === si) return 'active';
  return 'pending';
}

export default function DesignXPage() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  const handleGenerate = async () => {
    if (!file && !text.trim()) return;
    setError('');
    setHtml('');
    setStage('reading');

    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      else formData.append('text', text);

      const res = await fetch('/api/design-x/generate', { method: 'POST', body: formData });
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'progress') {
              setStage(data.stage as Stage);
            } else if (eventType === 'done') {
              setHtml(data.html);
              setStage('done');
            } else if (eventType === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }
    } catch (e) {
      setError(String(e));
      setStage('idle');
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

  const isLoading = stage !== 'idle' && stage !== 'done';

  if (html) {
    return (
      <div className="root">
        <div className="container">
          <div className="resultHeader">
            <span className="resultLabel">簡報已生成</span>
            <div className="resultActions">
              <button
                className="btnSecondary"
                onClick={() => { setHtml(''); setStage('idle'); setFile(null); setText(''); }}
              >
                重新設計
              </button>
              <button className="btnPrimary" onClick={handleDownload}>
                下載 HTML
              </button>
            </div>
          </div>
          <iframe
            className="previewFrame"
            srcDoc={html}
            title="Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="root">
        <div className="container">
          <div className="progressWrap">
            <div className="progressTitle">生成中</div>
            <div className="stages">
              {STAGES.map((s) => {
                const state = stageState(s.id, stage);
                return (
                  <div key={s.id} className="stage">
                    <div className={`stageDot ${state}`} />
                    <div className="stageContent">
                      <div className={`stageLabel ${state}`}>{s.label}</div>
                      {state === 'active' && (
                        <div className="stageSub">{s.sub}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="root">
      <div className="container">
        <div className="header">
          <div className="wordmark">Design<span>X</span></div>
          <div className="tagline">貼上文字，生成高質感 HTML 簡報</div>
        </div>

        {file ? (
          <div className="fileInfo">
            <span className="fileName">{file.name}</span>
            <span className="fileSize">{(file.size / 1024).toFixed(1)} KB</span>
            <button className="fileRemove" onClick={() => setFile(null)}>×</button>
          </div>
        ) : (
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }}
            />
            <div className="dropzoneArrow">↑</div>
            <div className="dropzoneLabel">拖曳或點擊上傳</div>
            <div className="dropzoneHint">.docx · .txt · .md</div>
          </div>
        )}

        {!file && (
          <>
            <div className="divider">
              <div className="dividerLine" />
              <span className="dividerText">或直接貼文字</span>
              <div className="dividerLine" />
            </div>
            <textarea
              className="textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="把你的內容貼在這裡..."
              rows={8}
            />
          </>
        )}

        {error && <div className="error">{error}</div>}

        <button
          className="btnGenerate"
          onClick={handleGenerate}
          disabled={!file && !text.trim()}
        >
          生成簡報
        </button>
      </div>
    </div>
  );
}
