import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowLeft, Download, FileJson2, FileSpreadsheet, Search, SlidersHorizontal, Trash2, Volume2 } from 'lucide-react';
import { api, API_BASE, formatDate, type CallRecord } from '../lib/api';
import { useToast } from '../lib/toast';
import { CallTable } from '../components/CallTable';
import { callDuration, DurationLabel, EmptyState, ErrorState, outcomeTone, PageLoading, StatusPill } from '../components/Common';

type DateFilter = 'all' | '7' | '30' | '90';

async function downloadFile(path: string, filename: string) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(data?.detail || `Export failed (HTTP ${response.status}).`);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CallsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState<DateFilter>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const notify = useToast();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api<{ calls: CallRecord[] }>('/calls?limit=200'); setCalls(result.calls); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Call history could not load.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => {
    const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    const normalizedQuery = query.trim().toLowerCase();
    return calls.filter((call) => {
      const text = [call.caller_name, call.caller_phone, call.summary, String(call.id), ...(call.turns ?? []).flatMap((turn) => [turn.summary, turn.intent, turn.caller_message]), ...(call.transcript ?? []).map((message) => message.message)].join(' ').toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesStatus = status === 'all' || (['in_progress', 'completed', 'missed', 'failed'].includes(status)
        ? (call.status ?? (call.ended_at ? 'completed' : 'in_progress')) === status
        : status === 'No outcome' ? call.outcome === null : call.outcome === status);
      const matchesDate = !cutoff || new Date(call.started_at).getTime() >= cutoff;
      return matchesQuery && matchesStatus && matchesDate;
    }).sort((a, b) => sort === 'newest' ? b.started_at.localeCompare(a.started_at) : a.started_at.localeCompare(b.started_at));
  }, [calls, period, query, sort, status]);
  const pageSize = 12; const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query, status, period, sort]);
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const exportAs = async (kind: 'csv' | 'json' | 'turns') => {
    setExporting(true);
    try { await downloadFile(kind === 'json' ? '/export/calls.json' : kind === 'turns' ? '/export/turns.csv' : '/export/calls.csv', `callguardian-${kind}.${kind === 'json' ? 'json' : 'csv'}`); notify('Your export is ready.', 'success'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Export failed.', 'error'); }
    finally { setExporting(false); }
  };
  if (loading) return <PageLoading label="Loading call history…" />;
  if (error && !calls.length) return <ErrorState message={error} onRetry={() => void load()} />;
  return <div className="page-stack">
    <div className="list-toolbar"><div className="toolbar-summary"><strong>{calls.length}</strong> saved {calls.length === 1 ? 'call' : 'calls'}<span className="toolbar-divider" />Showing up to 200 most recent records</div><div className="toolbar-actions"><div className="export-menu"><details><summary className="button button-secondary"><Download size={16} /> Export</summary><div className="export-options"><button onClick={() => void exportAs('csv')} disabled={exporting}><FileSpreadsheet size={15} /> Calls CSV</button><button onClick={() => void exportAs('turns')} disabled={exporting}><FileSpreadsheet size={15} /> Turns CSV</button><button onClick={() => void exportAs('json')} disabled={exporting}><FileJson2 size={15} /> JSON archive</button></div></details></div></div></div>
    <section className="panel calls-list-panel">
      <div className="filter-toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search callers, summaries, or intent" aria-label="Search call records" />{query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label><label className="filter-select"><SlidersHorizontal size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by call status"><option value="all">All statuses and outcomes</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="missed">Missed</option><option value="failed">Failed</option><option>AI handled</option><option>Transferred</option><option>Declined</option><option>No outcome</option></select></label><label className="filter-select"><select value={period} onChange={(event) => setPeriod(event.target.value as DateFilter)} aria-label="Filter by date"><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><button className="icon-button sort-button" title={`Sort ${sort === 'newest' ? 'oldest' : 'newest'} first`} aria-label={`Sort ${sort === 'newest' ? 'oldest' : 'newest'} first`} onClick={() => setSort((value) => value === 'newest' ? 'oldest' : 'newest')}><ArrowDownWideNarrow size={17} /></button></div>
      {error && <div className="inline-alert">{error}</div>}
      {calls.length === 0 ? <EmptyState title="Your call history is empty" description="Complete a text-based call simulation and the saved record will show up here." /> : filtered.length === 0 ? <EmptyState title="No matching calls" description="Try a different search phrase or clear one of the filters." action={<button className="button button-secondary button-sm" onClick={() => { setQuery(''); setStatus('all'); setPeriod('all'); }}>Clear filters</button>} /> : <CallTable calls={shown} />}
      {filtered.length > pageSize && <div className="pagination"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div><button className="button button-secondary button-sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Previous</button><span className="page-number">{page} / {pageCount}</span><button className="button button-secondary button-sm" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Next</button></div></div>}
    </section>
    <div className="data-boundary"><span className="boundary-mark" /><span>Private records are filtered by your authenticated account on the server. Filters here apply to the 200 newest records returned by the API.</span></div>
  </div>;
}

export function CallDetailsPage() {
  const { callId } = useParams();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [speechOn, setSpeechOn] = useState(false);
  const notify = useToast();
  useEffect(() => {
    if (!callId || !/^\d+$/.test(callId)) { setError('This call record could not be found.'); setLoading(false); return; }
    api<CallRecord>(`/calls/${encodeURIComponent(callId)}`).then(setCall).catch((reason) => setError(reason instanceof Error ? reason.message : 'Call could not load.')).finally(() => setLoading(false));
  }, [callId]);
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);
  const listen = (text: string) => {
    if (!('speechSynthesis' in window)) { notify('Speech playback is not supported in this browser.', 'error'); return; }
    try {
      window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-IN';
      utterance.onstart = () => setSpeechOn(true); utterance.onend = () => setSpeechOn(false); utterance.onerror = () => { setSpeechOn(false); notify('Browser speech could not play.', 'error'); };
      window.speechSynthesis.speak(utterance);
    } catch { setSpeechOn(false); notify('Browser speech could not start.', 'error'); }
  };
  const remove = async () => {
    if (!call || !window.confirm('Permanently delete this call, its transcript, analysis, and linked appointments?')) return;
    try { await api(`/calls/${call.id}`, { method: 'DELETE' }); notify('Call and associated records deleted.', 'success'); navigate('/calls', { replace: true }); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Call could not be deleted.', 'error'); }
  };
  if (loading) return <PageLoading label="Loading call details…" />;
  if (error || !call) return <ErrorState message={error || 'Call not found.'} />;
  return <div className="page-stack">
    <Link to="/calls" className="back-link"><ArrowLeft size={16} /> Back to call history</Link>
    <section className="panel detail-hero"><div className="detail-caller"><span className="detail-avatar"><span /></span><div><span className="eyebrow">SAVED SIMULATED CALL</span><h2>{call.caller_name || 'Unknown caller'}</h2><p>Call reference #{call.id}{call.caller_phone ? ` · ${call.caller_phone}` : ''}</p></div></div><div className="detail-status"><StatusPill tone={call.status === 'in_progress' ? 'warn' : outcomeTone(call.outcome)}>{(call.status ?? (call.ended_at ? 'completed' : 'in_progress')).replace('_', ' ')}</StatusPill><span><span className="eyebrow">OUTCOME</span><strong>{call.outcome ?? 'Not recorded'}</strong></span><span><span className="eyebrow">DURATION</span><strong><DurationLabel seconds={callDuration(call.started_at, call.ended_at)} /></strong></span><button className="button button-secondary button-sm" onClick={() => void remove()}><Trash2 size={14} /> Delete record</button></div></section>
    {call.summary && <section className="panel detail-meta"><span>Call summary</span><strong>{call.summary}</strong></section>}
    <div className="detail-meta-grid"><div className="detail-meta panel"><span>Started · {call.timezone ?? 'local time'}</span><strong>{formatDate(call.started_at, { dateStyle: 'full', timeStyle: 'short', ...(call.timezone ? { timeZone: call.timezone } : {}) })}</strong></div><div className="detail-meta panel"><span>Ended</span><strong>{formatDate(call.ended_at, { dateStyle: 'full', timeStyle: 'short', ...(call.timezone ? { timeZone: call.timezone } : {}) })}</strong></div><div className="detail-meta panel"><span>Transcript messages</span><strong>{call.transcript?.length ?? (call.turns?.length ?? 0) * 2}</strong></div></div>
    <section className="panel transcript-panel"><div className="section-heading"><div><span className="eyebrow">TRANSCRIPT</span><h3>Conversation and analysis</h3><p>Messages and summaries saved for this account</p></div></div>
      {call.transcript?.length ? <div className="saved-transcript">{call.transcript.map((message) => <article className="saved-turn" key={message.sequence_no}><div className="saved-turn-header"><span className="turn-index">{String(message.sequence_no).padStart(2, '0')} · {message.speaker === 'caller' ? 'CALLER' : 'GUARDIAN ASSISTANT'}</span><span>{formatDate(message.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div><div className={`saved-turn-message${message.speaker === 'assistant' ? ' assistant-turn-message' : ''}`}><p>{message.message}</p>{message.speaker === 'assistant' && <button className="speech-button" onClick={() => listen(message.message)} title="Play with browser speech"><Volume2 size={14} />{speechOn ? 'Playing' : 'Listen'}</button>}</div></article>)}</div> : !call.turns?.length ? <EmptyState title="No transcript available" description="This call was saved without any assistant conversation turns." /> : <div className="saved-transcript">{call.turns.map((turn) => <article className="saved-turn" key={turn.turn_no}><div className="saved-turn-header"><span className="turn-index">TURN {String(turn.turn_no).padStart(2, '0')}</span><span>{formatDate(turn.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{turn.latency_ms != null && <span>{turn.latency_ms}ms AI</span>}</div><div className="saved-turn-message"><span>CALLER</span><p>{turn.caller_message}</p></div><div className="saved-turn-message assistant-turn-message"><span>GUARDIAN ASSISTANT</span><p>{turn.reply}</p><button className="speech-button" onClick={() => listen(turn.reply)} title="Play with browser speech"><Volume2 size={14} />{speechOn ? 'Playing' : 'Listen'}</button></div><div className="turn-analysis"><div><span>Intent</span><strong>{turn.intent}</strong></div><div><span>Risk</span><strong className={`risk-${turn.risk.toLowerCase()}`}>{turn.risk}</strong></div><div><span>Urgency</span><strong>{turn.urgency}</strong></div><div><span>Recommendation</span><strong>{turn.suggested_action}</strong></div>{turn.review_required && <div className="review-required">Review recommended</div>}</div></article>)}</div>}
    </section>
    <div className="data-boundary"><span className="boundary-mark" /> Recordings are not available. This app stores caller text and analysis, not audio.</div>
  </div>;
}
