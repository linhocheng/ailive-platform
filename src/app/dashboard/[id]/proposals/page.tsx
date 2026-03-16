'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Proposal { id: string; proposedChange: string; reason: string; status: string; createdAt: string; }

export default function ProposalsPage() {
  const { id } = useParams<{ id: string }>();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [charName, setCharName] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/soul-proposals?characterId=${id}`).then(r => r.json()).then(d => { setProposals(d.proposals || []); setLoading(false); });
  };

  useEffect(() => {
    load();
    fetch(`/api/characters/${id}`).then(r => r.json()).then(d => setCharName(d.character?.name || ''));
  }, [id]);

  const review = async (proposalId: string, status: string) => {
    setActing(proposalId);
    await fetch('/api/soul-proposals', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: proposalId, status }) });
    setActing(null);
    load();
  };

  const pending = proposals.filter(p => p.status === 'pending');

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{charName}</a> › 靈魂提案
      </div>
      <CharNav id={id} active="/proposals" />

      {pending.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffcc02', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: '#856404' }}>
          💡 有 {pending.length} 個待審核的靈魂提案
        </div>
      )}

      {loading ? <div style={{ color: '#999' }}>載入中...</div> : proposals.length === 0 ? (
        <div style={{ color: '#bbb', textAlign: 'center', padding: 60, border: '2px dashed #e0e0e0', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💡</div>
          還沒有靈魂提案。當記憶累積到閾值，角色會自動提出靈魂修改建議。
        </div>
      ) : proposals.map(p => {
        const statusColor = p.status === 'pending' ? '#fff8e1' : p.status === 'approved' ? '#e8f5e9' : '#fce4ec';
        const statusLabel = p.status === 'pending' ? '待審核' : p.status === 'approved' ? '已核准' : '已拒絕';
        return (
          <div key={p.id} style={{ background: statusColor, border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#1a1a2e' }}>靈魂進化提案</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#999' }}>{new Date(p.createdAt).toLocaleString('zh-TW')}</span>
                <span style={{ fontSize: 12, background: '#fff', padding: '2px 8px', borderRadius: 20, color: '#666', border: '1px solid #e0e0e0' }}>{statusLabel}</span>
              </div>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>建議修改</div>
              <div style={{ fontSize: 14, color: '#333', lineHeight: 1.7 }}>{p.proposedChange}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 12, marginBottom: p.status === 'pending' ? 12 : 0 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>提案原因</div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>{p.reason}</div>
            </div>
            {p.status === 'pending' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => review(p.id, 'approved')} disabled={acting === p.id}
                  style={{ background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ✓ 核准採用
                </button>
                <button onClick={() => review(p.id, 'rejected')} disabled={acting === p.id}
                  style={{ background: 'none', border: '1px solid #c62828', color: '#c62828', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
                  ✗ 拒絕
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
