const configuredApiBase = import.meta.env.VITE_API_URL?.trim();
// In development the browser talks to Vite on its own origin; Vite proxies API
// requests to the backend. This avoids stale browser-side localhost ports.
export const API_BASE = (import.meta.env.DEV ? '' : configuredApiBase || '').replace(/\/$/, '');

export interface User {
  id: number;
  username: string;
  email: string;
}

export interface Turn {
  turn_no: number;
  created_at: string;
  caller_message: string;
  reply: string;
  summary: string;
  intent: string;
  urgency: 'Low' | 'Medium' | 'High';
  risk: 'Low' | 'Medium' | 'High';
  review_required: boolean;
  suggested_action: 'accept' | 'decline' | 'transfer';
  source: string;
  latency_ms: number | null;
}

export interface CallRecord {
  id: number;
  caller_name: string;
  started_at: string;
  ended_at: string | null;
  outcome: 'AI handled' | 'Transferred' | 'Declined' | null;
  status?: 'in_progress' | 'completed' | 'missed' | 'failed';
  turns: Turn[];
  caller_phone?: string | null;
  timezone?: string;
  summary?: string | null;
  transcript?: { sequence_no: number; speaker: 'caller' | 'assistant'; message: string; created_at: string }[];
}

export interface Appointment {
  id: number;
  booking_reference: string;
  user_id: number;
  call_id: number | null;
  contact_name: string;
  contact_phone: string | null;
  appointment_type: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'failed';
}

export interface Analytics {
  empty: boolean;
  generated_at: string;
  totals: { calls: number; completed: number; abandoned: number; turns: number; calls_with_analysis: number };
  outcomes: Record<string, number>;
  calls_per_day: { date: string; calls: number }[];
  call_risk: Record<string, number>;
  call_urgency: Record<string, number>;
  avg_gemini_latency_ms: number | null;
  avg_call_duration_seconds: number | null;
  review_required_rate: number | null;
  top_intents: { intent: string; turns: number }[];
}

export interface Analysis {
  reply: string;
  summary: string;
  intent: string;
  urgency: 'Low' | 'Medium' | 'High';
  risk: 'Low' | 'Medium' | 'High';
  review_required: boolean;
  suggested_action: 'accept' | 'decline' | 'transfer';
  sensitive_info_requested: boolean;
}

function csrfToken() {
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('cgai_csrf='));
  return match ? decodeURIComponent(match.slice('cgai_csrf='.length)) : '';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const csrf = csrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new Error('Cannot reach the CallGuardianAI API. Check that the backend is running.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: string | { msg?: string }[] } | null;
    const detail = Array.isArray(data?.detail)
      ? data.detail.map((entry) => entry.msg).filter(Boolean).join(' ')
      : data?.detail;
    if (response.status === 401) window.dispatchEvent(new CustomEvent('cgai:unauthorized'));
    throw new Error(typeof detail === 'string'
      ? detail
      : response.status >= 500
        ? 'Cannot reach the CallGuardianAI API. Check that the backend is running, then retry.'
        : `Request failed (HTTP ${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const jsonBody = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) });

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const dateParts: (keyof Intl.DateTimeFormatOptions)[] = ['weekday', 'era', 'year', 'month', 'day'];
  const timeParts: (keyof Intl.DateTimeFormatOptions)[] = ['hour', 'minute', 'second', 'fractionalSecondDigits', 'dayPeriod', 'timeZoneName'];
  const hasComponentStyle = [...dateParts, ...timeParts].some((part) => options[part] !== undefined);
  return new Intl.DateTimeFormat(undefined, { ...(hasComponentStyle ? {} : { dateStyle: 'medium' as const }), ...options }).format(date);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function outcomeLabel(outcome: CallRecord['outcome']) {
  return outcome ?? 'No outcome';
}
