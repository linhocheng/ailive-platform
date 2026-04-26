'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface StrategyRec {
  jobId: string;
  status: string;
  brief: string;
  docUrl?: string;
  docTitle?: string;
  filename?: string;
  assigneeId?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export default function StrategiesPage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<StrategyRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');

  const load = () => {
    setLoading(true);
    fetch(`/api/strategies?characterId=${id}`).then(r => r.json()).then(d => {
      setItems(d.strategies || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => { setCharName(d.character?.name || ''); });
  }, [id]);

  const formatDate = (ts: string) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('zh-TW', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ts.slice(0, 16); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      pending:    { label: '奧寫作中…', bg: '#fff3cd', color: '#856404' },
      processing: { label: '處理中',     bg: '#fff3cd', color: '#856404' },
      done:       { label: '已完成',     bg: '#d4edda', color: '#155724' },
      completed:  { label: '已完成',     bg: '#d4edda', color: '#155724' },
      failed:     { label: '失敗',       bg: '#f8d7da', color: '#721c24' },
      error:      { label: '失敗',       bg: '#f8d7da', color: '#721c24' },
    };
    const s = map[status] || { label: status, bg: '#e9ecef', color: '#495057' };
    return (
      <span style={{
        background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 4,
        fontSize: 11, fontWeight: 500,
      }}>{s.label}</span>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a>
        {' › '}
        <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a>
        {' › 策略書'}
      </div>
      <CharNav id={id} active="/strategies" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#1a1a2e' }}>共 {items.length} 份策略書</h3>
        <span style={{ fontSize: 12, color: '#bbb' }}>
          委託奧寫的長文檔案（規劃書／提案／策略），完成後可下載 docx
          <button onClick={load} style={{ marginLeft: 12, fontSize: 12, padding: '2px 8px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>↻ 重新整理</button>
        </span>
      </div>

      {loading ? (
        <div style={{ color: '#999', padding: 40, textAlign: 'center' }}>載入中...</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 60, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          還沒有策略書檔案
          <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
            在對話中跟 {charName} 說「幫我寫一份 X 規劃書」就會委派奧處理
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', width: 120 }}>建立時間</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555' }}>標題 / Brief</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', width: 100 }}>狀態</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#555', width: 120 }}>動作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.jobId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px', color: '#666', verticalAlign: 'top' }}>{formatDate(item.createdAt)}</td>
                  <td style={{ padding: '12px', verticalAlign: 'top' }}>
                    {item.docTitle ? (
                      <div style={{ fontWeight: 500, color: '#1a1a2e', marginBottom: 4 }}>{item.docTitle}</div>
                    ) : null}
                    <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                      {item.brief.slice(0, 120)}{item.brief.length > 120 ? '…' : ''}
                    </div>
                    {item.error ? (
                      <div style={{ color: '#c00', fontSize: 11, marginTop: 6 }}>錯誤：{item.error}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '12px', verticalAlign: 'top' }}>{statusBadge(item.status)}</td>
                  <td style={{ padding: '12px', verticalAlign: 'top' }}>
                    {item.docUrl ? (
                      <a
                        href={item.docUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12, color: '#fff', background: '#1a1a2e',
                          padding: '6px 12px', borderRadius: 4, textDecoration: 'none',
                          display: 'inline-block',
                        }}
                      >下載 docx</a>
                    ) : (
                      <span style={{ fontSize: 11, color: '#bbb' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
