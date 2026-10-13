import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Clock3, MessageSquareText, RefreshCw, ShieldAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Analytics } from '../lib/api';
import { EmptyState, ErrorState, MetricCard, PageLoading } from '../components/Common';

const COLORS = ['#81d7bb', '#f3c879', '#f18d9a'];

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await api<Analytics>(`/analytics/summary?days=${days}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Analytics could not load.'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <PageLoading label="Calculating account analytics…" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  const outcomes = ['AI handled', 'Transferred', 'Declined']
    .map((name, index) => ({ name, value: data?.outcomes[name] ?? 0, color: COLORS[index] }))
    .filter((item) => item.value > 0);
  const volume = (data?.calls_per_day ?? []).map((item) => ({
    ...item,
    label: new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));
  const analyzed = data?.totals.calls_with_analysis ?? 0;

  return <div className="page-stack">
    <div className="analytics-toolbar">
      <div><span className="eyebrow">ACCOUNT-SCOPED METRICS</span><h2>Know what’s coming through.</h2><p>Computed from the call records stored for your account.</p></div>
      <label className="filter-select range-select"><span>Date range</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
    </div>
    {error && <div className="inline-alert"><ShieldAlert size={16} />{error}<button className="icon-button" onClick={() => void load()} aria-label="Retry"><RefreshCw size={14} /></button></div>}
    <div className="metric-grid analytics-metrics">
      <MetricCard label="Calls analyzed" value={data?.totals.calls ?? 0} hint="All saved records" icon={<BarChart3 size={18} />} />
      <MetricCard label="Assistant turns" value={data?.totals.turns ?? 0} hint="Messages analyzed" icon={<MessageSquareText size={18} />} />
      <MetricCard label="Calls needing review" value={analyzed ? Math.round((data?.review_required_rate ?? 0) * analyzed) : '0'} hint="Based on assistant flags" icon={<ShieldAlert size={18} />} />
      <MetricCard label="Avg. AI response" value={data?.avg_gemini_latency_ms == null ? '—' : `${data.avg_gemini_latency_ms} ms`} hint="Gemini turns with timing data" icon={<Clock3 size={18} />} />
    </div>
    {data?.empty ? <section className="panel analytics-empty"><EmptyState title="Analytics will appear after your first saved call" description="No records are counted as activity until a call simulation is saved to your account." /></section> : <div className="analytics-chart-grid">
      <section className="panel analytics-chart-panel">
        <div className="section-heading"><div><span className="eyebrow">CALL VOLUME</span><h3>Daily saved calls</h3><p>Last {days} days</p></div></div>
        <div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={volume} margin={{ top: 12, right: 12, bottom: 0, left: -17 }}><CartesianGrid stroke="#242a3c" vertical={false} strokeDasharray="4 6" /><XAxis dataKey="label" tick={{ fill: '#777f96', fontSize: 11 }} axisLine={false} tickLine={false} interval={days === 90 ? 13 : days === 30 ? 5 : 0} /><YAxis allowDecimals={false} tick={{ fill: '#777f96', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#151a2b', border: '1px solid #30364a', borderRadius: 10, color: '#eef0fb' }} /><Bar dataKey="calls" name="Calls" fill="#8884ff" radius={[5, 5, 0, 0]} maxBarSize={25} /></BarChart></ResponsiveContainer></div>
      </section>
      <section className="panel analytics-chart-panel outcome-chart-panel">
        <div className="section-heading"><div><span className="eyebrow">SAVED OUTCOMES</span><h3>Call outcomes</h3><p>Actual recorded decisions</p></div></div>
        {!outcomes.length ? <EmptyState title="No outcomes to compare" description="Saved outcomes will be summarized here." /> : <>
          <div className="pie-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={64} outerRadius={88} paddingAngle={4} stroke="none">{outcomes.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip contentStyle={{ background: '#151a2b', border: '1px solid #30364a', borderRadius: 10, color: '#eef0fb' }} /></PieChart></ResponsiveContainer><div className="pie-center"><strong>{data?.totals.completed ?? 0}</strong><span>completed</span></div></div>
          <div className="pie-legend">{outcomes.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<strong>{item.value}</strong></span>)}</div>
        </>}
      </section>
    </div>}
    <div className="data-boundary"><span className="boundary-mark" /> Summary totals include all of your stored calls; the daily chart and selected range cover the last {days} days.</div>
  </div>;
}
