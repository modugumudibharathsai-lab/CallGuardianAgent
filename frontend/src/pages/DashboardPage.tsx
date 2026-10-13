import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, AudioLines, BarChart3, CheckCircle2, Clock3, Download, PhoneCall, RefreshCw, ShieldAlert } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, API_BASE, type Analytics, type CallRecord } from '../lib/api';
import { useToast } from '../lib/toast';
import { CallTable } from '../components/CallTable';
import { EmptyState, ErrorState, MetricCard, PageLoading } from '../components/Common';

const ranges = [7, 30, 90] as const;

export function DashboardPage() {
  const [days, setDays] = useState<number>(7);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const notify = useToast();
  const navigate = useNavigate();
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [summary, recent] = await Promise.all([
        api<Analytics>(`/analytics/summary?days=${days}`),
        api<{ calls: CallRecord[] }>('/calls?limit=50'),
      ]);
      setAnalytics(summary); setCalls(recent.calls);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Dashboard could not load.'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 60_000); return () => window.clearInterval(timer); }, [load]);
  const exportCalls = async () => {
    try {
      const response = await fetch(`${API_BASE}/export/calls.csv`, { credentials: 'include' });
      if (!response.ok) throw new Error('Export could not be prepared.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'callguardian-calls.csv'; anchor.click(); URL.revokeObjectURL(url);
      notify('Your call export is ready.', 'success');
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Export failed.', 'error'); }
  };
  if (loading && !analytics) return <PageLoading label="Gathering your call activity…" />;
  if (error && !analytics) return <ErrorState message={error} onRetry={() => void load()} />;
  const total = analytics?.totals.calls ?? 0;
  const completed = analytics?.totals.completed ?? 0;
  const completion = total ? Math.round(completed / total * 100) : null;
  const chartData = (analytics?.calls_per_day ?? []).map((item) => ({ ...item, shortDate: new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  return <div className="page-stack">
    <div className="welcome-row"><div><span className="eyebrow">YOUR PERSONAL CALL DESK</span><h2>Good to have you back.</h2><p>Here’s what’s happening in your workspace.</p></div><div className="welcome-actions"><button className="button button-secondary" onClick={exportCalls} disabled={!total}><Download size={16} /> Export</button><button className="button button-primary" onClick={() => navigate('/assistant')}><AudioLines size={16} /> Start a simulation</button></div></div>
    {error && <div className="inline-alert"><ShieldAlert size={16} />{error}<button className="icon-button" onClick={() => void load()} aria-label="Retry"><RefreshCw size={14} /></button></div>}
    <div className="metric-grid">
      <MetricCard label="Total calls" value={analytics?.totals.calls ?? 0} hint="All saved records" icon={<PhoneCall size={18} />} />
      <MetricCard label="Completed" value={analytics?.totals.completed ?? 0} hint={completion === null ? 'No completed calls yet' : `${completion}% of recorded calls`} icon={<CheckCircle2 size={18} />} />
      <MetricCard label="No outcome saved" value={analytics?.totals.abandoned ?? 0} hint="Calls without a saved outcome" icon={<Activity size={18} />} />
      <MetricCard label="Avg. duration" value={analytics?.avg_call_duration_seconds == null ? '—' : `${Math.floor(analytics.avg_call_duration_seconds / 60)}m ${Math.round(analytics.avg_call_duration_seconds % 60)}s`} hint="Across ended calls" icon={<Clock3 size={18} />} />
    </div>
    <section className="dashboard-grid">
      <article className="panel chart-panel"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><h3>Call volume</h3><p>Saved call records per day</p></div><div className="segmented-control" aria-label="Chart date range">{ranges.map((range) => <button key={range} className={days === range ? 'selected' : ''} onClick={() => setDays(range)}>{range}d</button>)}</div></div>
        {total === 0 ? <EmptyState title="Your chart starts here" description="Screen a simulated call to see real activity in this chart." action={<button className="button button-secondary button-sm" onClick={() => navigate('/assistant')}>Open call simulation <ArrowRight size={14} /></button>} /> : <div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}><defs><linearGradient id="callFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c83ff" stopOpacity={0.25} /><stop offset="95%" stopColor="#7c83ff" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#242a3c" vertical={false} strokeDasharray="4 6" /><XAxis dataKey="shortDate" tick={{ fill: '#777f96', fontSize: 11 }} axisLine={false} tickLine={false} interval={days === 90 ? 13 : days === 30 ? 5 : 0} /><YAxis allowDecimals={false} tick={{ fill: '#777f96', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#151a2b', border: '1px solid #30364a', borderRadius: 10, color: '#eef0fb' }} labelStyle={{ color: '#aeb4c7' }} /><Area type="monotone" dataKey="calls" name="Calls" stroke="#8984ff" strokeWidth={2.5} fill="url(#callFill)" activeDot={{ r: 5, fill: '#a39eff', stroke: '#151a2b', strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div>}
      </article>
      <article className="panel outcome-panel"><div className="section-heading"><div><span className="eyebrow">OUTCOMES</span><h3>How calls ended</h3><p>Distribution from saved records</p></div><span className="chart-icon"><BarChart3 size={18} /></span></div>
        <div className="outcome-breakdown">{[
          ['AI handled', analytics?.outcomes['AI handled'] ?? 0, 'outcome-ai'],
          ['Transferred', analytics?.outcomes.Transferred ?? 0, 'outcome-transfer'],
          ['Declined', analytics?.outcomes.Declined ?? 0, 'outcome-decline'],
        ].map(([label, value, tone]) => <div key={label} className="outcome-row"><span className="outcome-swatch" data-tone={tone} /><span className="outcome-name">{label}</span><strong>{value}</strong><span className="outcome-percent">{total ? `${Math.round(Number(value) / total * 100)}%` : '—'}</span></div>)}</div>
        <div className="outcome-note"><ShieldAlert size={15} /><span>Call decisions are recommendations for simulated calls. No telephone call is placed.</span></div>
      </article>
    </section>
    <section className="panel recent-panel"><div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h3>Latest calls</h3><p>Most recent records saved to your account</p></div><Link className="text-link" to="/calls">View call history <ArrowRight size={15} /></Link></div>
      {calls.length ? <CallTable calls={calls.slice(0, 5)} compact /> : <EmptyState title="Nothing in your history yet" description="Your call history will fill in as you complete simulations." action={<button className="button button-primary button-sm" onClick={() => navigate('/assistant')}>Start a simulation <ArrowRight size={14} /></button>} />}
    </section>
    {loading && analytics && <div className="refresh-note"><RefreshCw size={13} className="spin" /> Refreshing data…</div>}
  </div>;
}
