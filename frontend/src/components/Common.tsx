import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Clock3, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

export function PageLoading({ label = 'Loading your workspace…' }: { label?: string }) {
  return <div className="state-card loading-state"><LoaderCircle className="spin" size={21} /><span>{label}</span></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-card error-state"><span className="state-icon error-icon"><AlertTriangle size={19} /></span><div><strong>We couldn’t load this view</strong><p>{message}</p></div>{onRetry && <button className="button button-secondary button-sm" onClick={onRetry}><RefreshCw size={15} /> Try again</button>}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><ShieldCheck size={23} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function MetricCard({ label, value, hint, icon, trend }: { label: string; value: string | number; hint: string; icon: ReactNode; trend?: 'up' | 'down' }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-hint">{trend && <span className={`trend ${trend}`} aria-label={trend === 'up' ? 'increased' : 'decreased'}>{trend === 'up' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</span>}{hint}</div></article>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`status-pill status-${tone}`}><i />{children}</span>;
}

export function DurationLabel({ seconds }: { seconds: number | null }) {
  if (seconds == null) return <span className="muted-cell">—</span>;
  const value = Math.max(0, Math.round(seconds));
  return <span className="duration-label"><Clock3 size={14} />{Math.floor(value / 60)}:{String(value % 60).padStart(2, '0')}</span>;
}

export function callDuration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return null;
  const duration = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function outcomeTone(outcome: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (outcome === 'AI handled') return 'good';
  if (outcome === 'Transferred') return 'warn';
  if (outcome === 'Declined') return 'bad';
  return 'neutral';
}
