'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CharNav } from '../page';

interface Insight { source: string; tier: string; hitCount: number; eventDate: string; createdAt: string; }

export default function GrowthPage() {
  const { id } = useParams<{ id: string }>();
  const [char, setChar] = useState<Record<string, unknown> | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/characters/${id}`).then(r => r.json()),
      fetch(`/api/insights?characterId=${id}&limit=200`).then(r => r.json()),
    ]).then(([cd, id2]) => {
      setChar(cd.character);
      setInsights(id2.insights || []);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>載入中...</div>;
  if (!char) return <div style={{ color: '#c00' }}>角色不存在</div>;

  const metrics = (char.growthMetrics as Record<string, number>) || {};
  const bySource = insights.reduce((acc: Record<string, number>, ins) => { acc[ins.source] = (acc[ins.source] || 0) + 1; return acc; }, {});
  const byTier = insights.reduce((acc: Record<string, number>, ins) => { acc[ins.tier] = (acc[ins.tier] || 0) + 1; return acc; }, {});
  const maxHit = Math.max(...insights.map(i => i.hitCount), 1);
  const topInsights = [...insights].sort((a, b) => b.hitCount - a.hitCount).slice(0, 5);

  const SOURCE_LABELS: Record<string, string> = { conversation: '對話', manual: '手動', self_learning: '自學', reflect: '省思', sleep_time: '夢境', auto_extract: '自動提煉' };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#999' }}>
        <a href="/dashboard" style={{ color: '#999', textDecoration: 'none' }}>所有角色</a> › <a href={`/dashboard/${id}`} style={{ color: '#999', textDecoration: 'none' }}>{char.name as string}</a> › 成長追蹤
      </div>
      <CharNav id={id} active="/growth" />

      {/* 核心指標 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: '靈魂版本', value: `v${char.soulVersion}`, icon: '⚡', color: '#e8eaf6' },
          { label: '總對話', value: metrics.totalConversations ?? 0, icon: '💬', color: '#e3f2fd' },
          { label: '記憶條數', value: insights.length, icon: '🧠', color: '#e8f5e9' },
          { label: '發文數', value: metrics.totalPosts ?? 0, icon: '📝', color: '#fff3e0' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ background: color, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28 }}>{icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', margin: '4px 0' }}>{value}</div>
            <div style={{ fontSize: 13, color: '#666' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 記憶來源分布 */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px' }}>記憶來源</h3>
          {Object.entries(bySource).map(([src, count]) => (
            <div key={src} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: '#444' }}>{SOURCE_LABELS[src] || src}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{count}</span>
              </div>
              <div style={{ background: '#f0f0f0', borderRadius: 4, height: 6 }}>
                <div style={{ background: '#6c63ff', width: `${(count / insights.length) * 100}%`, height: '100%', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>

        {/* 記憶層級分布 */}
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px' }}>記憶層級</h3>
          {[['core', '核心', '#ff9800'], ['fresh', '新鮮', '#4caf50'], ['archived', '封存', '#9e9e9e']].map(([tier, label, color]) => {
            const count = byTier[tier] || 0;
            return (
              <div key={tier} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: '#444' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{count}</span>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: 4, height: 6 }}>
                  <div style={{ background: color, width: insights.length ? `${(count / insights.length) * 100}%` : '0%', height: '100%', borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 最常被查詢的記憶 */}
      {topInsights.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 20, marginTop: 20 }}>
          <h3 style={{ margin: '0 0 16px' }}>最常被查詢的記憶</h3>
          {topInsights.map((ins, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{ width: 24, height: 24, background: '#1a1a2e', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(ins as unknown as Record<string, string>).title || '（無標題）'}</div>
                <div style={{ background: '#f0f0f0', borderRadius: 4, height: 4, marginTop: 4 }}>
                  <div style={{ background: '#6c63ff', width: `${(ins.hitCount / maxHit) * 100}%`, height: '100%', borderRadius: 4 }} />
                </div>
              </div>
              <span style={{ fontSize: 13, color: '#666', flexShrink: 0 }}>查詢 {ins.hitCount} 次</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
