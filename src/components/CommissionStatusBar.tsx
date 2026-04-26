/**
 * CommissionStatusBar
 *
 * 對話頁頂部的委託狀態條。任何角色有進行中的 platform_jobs 都會出現。
 *
 * 視覺：
 *   [🎨 拿鐵晨光 in morning...  ●●●○○   12s   瞬]
 *   每列對應一個 job。
 *   五顆燈對應 5 階段（見 commission-stages.ts）。
 *   done 後整列淡出，failed 留著不自動消失。
 *
 * @author 築 · Phase 2 · 推論式 5 階段（A 方案）
 */
'use client';
import React, { useEffect, useState } from 'react';
import type { ActiveJob, LampState } from '@/lib/commission-stages';
import { deriveStages, jobLabel, jobElapsed, isJobSeenInMessages } from '@/lib/commission-stages';

export interface MiniMessage {
  role?: string;
  eventType?: string;
  jobId?: string;
}

interface Props {
  jobs: ActiveJob[];
  messages: MiniMessage[];
}

// ── 燈的視覺（圓點 dot）──
function Lamp({ state }: { state: LampState }) {
  const size = 8;
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    display: 'inline-block',
    transition: 'background 0.2s, box-shadow 0.2s, transform 0.2s',
  };
  if (state === 'empty') {
    return <span style={{
      ...base,
      background: 'transparent',
      border: '1px solid var(--border, #E4E2DC)',
    }} />;
  }
  if (state === 'done') {
    return <span style={{
      ...base,
      background: 'var(--text-primary, #1A1916)',
    }} />;
  }
  if (state === 'failed') {
    return <span style={{
      ...base,
      background: '#C0392B',
      boxShadow: '0 0 0 2px rgba(192,57,43,0.15)',
    }} />;
  }
  // active: 脈動
  return <span style={{
    ...base,
    background: 'var(--text-primary, #1A1916)',
    animation: 'zhu-lamp-pulse 1.2s ease-in-out infinite',
  }} />;
}

// ── 單列 job ──
function JobRow({
  job,
  seen,
  isFading,
  onDismiss,
}: {
  job: ActiveJob;
  seen: boolean;
  isFading: boolean;
  onDismiss?: () => void;
}) {
  // 讓 status bar 在 in_progress 時也能滾動更新「經過時間」
  const [, tick] = useState(0);
  useEffect(() => {
    if (job.status === 'done' || job.status === 'failed') return;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const { lamps, overall } = deriveStages(job, seen);
  const elapsed = jobElapsed(job);
  const label = jobLabel(job, 10);

  // 失敗時可點開看細節
  const [showErr, setShowErr] = useState(false);

  const isPainter = job.jobType === 'image' || job.assigneeId === 'shun-001';
  const emoji = isPainter ? '🎨' : '✍️';
  const ASSIGNEE_NAMES: Record<string, string> = {
    'shun-001': '瞬',
    'pEWC5m2MOddyGe9uw0u0': '奧',
  };
  const roleName = ASSIGNEE_NAMES[job.assigneeId] || job.assigneeId;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px',
        fontSize: 12,
        color: 'var(--text-secondary, #3F3D37)',
        borderTop: '1px solid var(--border, #E4E2DC)',
        background: overall === 'failed'
          ? 'rgba(192,57,43,0.04)'
          : 'var(--surface-2, #FAFAF8)',
        opacity: isFading ? 0 : 1,
        transition: 'opacity 0.6s ease',
      }}
    >
      <span style={{ minWidth: 20 }}>{emoji}</span>
      <span style={{
        flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--text-primary, #1A1916)',
      }}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        {lamps.map((s, i) => <Lamp key={i} state={s} />)}
      </span>
      <span style={{
        minWidth: 36, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-muted, #9C9A95)',
      }}>{elapsed}</span>
      <span style={{ minWidth: 20, color: 'var(--text-muted, #9C9A95)' }}>{roleName}</span>
      {overall === 'failed' && (
        <>
          <button
            onClick={() => setShowErr(v => !v)}
            style={{
              background: 'transparent', border: '1px solid var(--border, #E4E2DC)',
              borderRadius: 4, padding: '2px 8px', fontSize: 11,
              color: 'var(--text-muted, #9C9A95)', cursor: 'pointer',
            }}
          >{showErr ? '收起' : '看錯誤'}</button>
          <button
            onClick={onDismiss}
            title="從狀態條移除"
            style={{
              background: 'transparent', border: 'none',
              fontSize: 14, color: 'var(--text-muted, #9C9A95)',
              cursor: 'pointer', padding: '0 4px',
            }}
          >×</button>
        </>
      )}
      {showErr && overall === 'failed' && job.error && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          marginTop: 4, padding: '8px 14px',
          background: 'white', border: '1px solid var(--border)', borderRadius: 6,
          color: '#C0392B', fontSize: 11, lineHeight: 1.5,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          zIndex: 5,
        }}>{job.error}</div>
      )}
    </div>
  );
}

export default function CommissionStatusBar({ jobs, messages }: Props) {
  // 本地記錄「哪些 done 的 job 還在淡出倒數」
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // done → 5 秒後標記淡出；實際移除靠後端 activeJobs 不再回傳（>60s 後）
  useEffect(() => {
    jobs.forEach(j => {
      if (j.status === 'done' && !fadingIds.has(j.id)) {
        const t = setTimeout(() => {
          setFadingIds(prev => new Set(prev).add(j.id));
        }, 5_000);
        return () => clearTimeout(t);
      }
    });
  }, [jobs, fadingIds]);

  const visible = jobs.filter(j => !dismissed.has(j.id));
  if (visible.length === 0) return null;

  return (
    <div style={{
      borderBottom: '1px solid var(--border, #E4E2DC)',
      background: 'var(--surface-2, #FAFAF8)',
    }}>
      <style>{`
        @keyframes zhu-lamp-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.25); }
        }
      `}</style>
      {visible.map(j => (
        <JobRow
          key={j.id}
          job={j}
          seen={isJobSeenInMessages(j.id, messages)}
          isFading={fadingIds.has(j.id)}
          onDismiss={() => setDismissed(prev => new Set(prev).add(j.id))}
        />
      ))}
    </div>
  );
}
