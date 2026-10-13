import { Link } from 'react-router-dom';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { formatDate, outcomeLabel, type CallRecord } from '../lib/api';
import { callDuration, DurationLabel, EmptyState, outcomeTone, StatusPill } from './Common';

export function CallTable({ calls, compact = false }: { calls: CallRecord[]; compact?: boolean }) {
  if (!calls.length) return <EmptyState title="No calls recorded yet" description="When you finish a simulated call, its outcome and transcript will appear here." />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>CALLER</th><th>STARTED</th><th>STATUS / OUTCOME</th><th>DURATION</th>{!compact && <th>CONVERSATION</th>}<th aria-label="Open call details" /></tr></thead><tbody>
    {calls.map((call) => { const status = call.status ?? (call.ended_at ? 'completed' : 'in_progress'); const messageCount = call.transcript?.length ?? (call.turns?.length ?? 0) * 2; return <tr key={call.id}><td><div className="caller-cell"><span className="caller-avatar"><UserRound size={16} /></span><span><strong>{call.caller_name || 'Unknown caller'}</strong><small>Call #{String(call.id).slice(-6)}{call.caller_phone ? ` · ${call.caller_phone}` : ''}</small></span></div></td><td><span className="date-cell">{formatDate(call.started_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span><small className="time-cell">{new Date(call.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td><td><StatusPill tone={status === 'in_progress' ? 'warn' : outcomeTone(call.outcome)}>{status.replace('_', ' ')}</StatusPill>{call.outcome && <small className="time-cell">{outcomeLabel(call.outcome)}</small>}</td><td><DurationLabel seconds={callDuration(call.started_at, call.ended_at)} /></td>{!compact && <td><span className="turn-count">{messageCount} {messageCount === 1 ? 'message' : 'messages'}</span></td>}<td><Link className="row-open" to={`/calls/${call.id}`} aria-label={`Open call with ${call.caller_name}`}><ArrowUpRight size={16} /></Link></td></tr>; })}
  </tbody></table></div>;
}
