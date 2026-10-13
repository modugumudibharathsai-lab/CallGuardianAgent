import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Check, Clock3, RefreshCw, Search, X } from 'lucide-react';
import { api, jsonBody, type Appointment } from '../lib/api';
import { useToast } from '../lib/toast';
import { EmptyState, ErrorState, PageLoading } from '../components/Common';
import './appointments.css';

type CalendarView = 'day' | 'week' | 'month';
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayKey = () => dateKey(new Date());
const localDateTime = (value: string) => {
  const date = new Date(value); const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
};

export function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [kind, setKind] = useState('General'); const [when, setWhen] = useState('');
  const [availability, setAvailability] = useState<string>(''); const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [view, setView] = useState<CalendarView>('week');
  const [anchorDate, setAnchorDate] = useState(todayKey);
  const notify = useToast();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setAppointments((await api<{ appointments: Appointment[] }>('/appointments')).appointments); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Appointments could not load.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    if (!when) { setAvailability('Choose a date and time first.'); return; }
    try {
      const params = new URLSearchParams({ start_at: new Date(when).toISOString(), duration_minutes: '30', timezone: zone() });
      const result = await api<{ available: boolean; alternatives: { start_at: string }[]; calendar: string }>(`/appointments/availability?${params}`);
      setAvailability(result.available ? 'This 30-minute slot is available in the internal calendar.' : `Unavailable.${result.alternatives.length ? ` Checked alternatives: ${result.alternatives.map((slot) => new Date(slot.start_at).toLocaleString()).join(' · ')}` : ' No nearby alternative was available.'}`);
    } catch (reason) { setAvailability(reason instanceof Error ? reason.message : 'Availability could not be checked.'); }
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!when) return;
    setSaving(true);
    try {
      await api<Appointment>('/appointments', jsonBody({ start_at: new Date(when).toISOString(), timezone: zone(), contact_name: name.trim(), contact_phone: phone.trim() || null, appointment_type: kind, idempotency_key: crypto.randomUUID() }));
      notify('Appointment confirmed in the internal calendar.', 'success'); setName(''); setPhone(''); setKind('General'); setWhen(''); setAvailability(''); await load();
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Appointment could not be saved.', 'error'); }
    finally { setSaving(false); }
  };
  const calendarWindow = useMemo(() => {
    const anchor = new Date(`${anchorDate}T12:00:00`);
    let start: Date; let end: Date; let gridStart: Date; let count: number;
    if (view === 'day') { start = new Date(anchor); start.setHours(0, 0, 0, 0); end = new Date(start); end.setDate(end.getDate() + 1); gridStart = start; count = 1; }
    else if (view === 'week') { start = new Date(anchor); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); end = new Date(start); end.setDate(end.getDate() + 7); gridStart = start; count = 7; }
    else { start = new Date(anchor.getFullYear(), anchor.getMonth(), 1); end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1); gridStart = new Date(start); gridStart.setDate(gridStart.getDate() - gridStart.getDay()); count = 42; }
    const days = Array.from({ length: count }, (_, index) => { const day = new Date(gridStart); day.setDate(day.getDate() + index); return day; });
    const title = view === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'day' ? anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(end.getTime() - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    return { start, end, days, title, anchor };
  }, [anchorDate, view]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return appointments.filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (q && !`${item.contact_name} ${item.contact_phone ?? ''} ${item.appointment_type} ${item.booking_reference}`.toLowerCase().includes(q)) return false;
      const date = new Date(item.start_at);
      return date >= calendarWindow.start && date < calendarWindow.end;
    });
  }, [appointments, calendarWindow, query, status]);
  const upcoming = filtered.filter((item) => new Date(item.start_at).getTime() >= Date.now());
  const past = filtered.filter((item) => new Date(item.start_at).getTime() < Date.now());
  const shiftWindow = (amount: number) => {
    const date = new Date(`${anchorDate}T12:00:00`);
    if (view === 'day') date.setDate(date.getDate() + amount);
    else if (view === 'week') date.setDate(date.getDate() + amount * 7);
    else { date.setDate(1); date.setMonth(date.getMonth() + amount); }
    setAnchorDate(dateKey(date));
  };
  const cancel = async (item: Appointment) => {
    if (!window.confirm(`Cancel the appointment for ${item.contact_name}?`)) return;
    try { await api(`/appointments/${item.id}/cancel`, { method: 'POST' }); notify('Appointment cancelled.', 'success'); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Appointment could not be cancelled.', 'error'); }
  };
  const reschedule = async (item: Appointment) => {
    const value = window.prompt('Enter the new date and time (for example 2026-10-20T15:00):', localDateTime(item.start_at));
    if (!value) return;
    const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) { notify('Enter a valid date and time.', 'error'); return; }
    try { await api(`/appointments/${item.id}/reschedule`, jsonBody({ start_at: parsed.toISOString(), timezone: zone() })); notify('Appointment rescheduled.', 'success'); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : 'Appointment could not be rescheduled.', 'error'); }
  };
  if (loading && !appointments.length) return <PageLoading label="Loading your appointments…" />;
  if (error && !appointments.length) return <ErrorState message={error} onRetry={() => void load()} />;
  return <div className="page-stack">
    <div className="local-page-intro"><div><span className="eyebrow">INTERNAL CALENDAR · {zone()}</span><h2>Appointments, checked against saved bookings.</h2><p>Availability is checked against this account’s internal SQLite calendar. External calendars are not connected.</p></div><button className="button button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div>
    {error && <div className="inline-alert">{error}</div>}
    <div className="contacts-layout">
      <section className="panel contact-form-panel"><div className="section-heading"><div><span className="eyebrow">NEW APPOINTMENT</span><h3>Check and book a slot</h3><p>30 minutes · weekdays, 9 AM–5 PM in your local timezone</p></div><CalendarDays size={20} className="form-heading-icon" /></div>
        <form className="stacked-form" onSubmit={create}>
          <label className="form-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
          <label className="form-field"><span>Phone <small>Optional</small></span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></label>
          <label className="form-field"><span>Appointment type</span><input value={kind} onChange={(e) => setKind(e.target.value)} maxLength={100} required /></label>
          <label className="form-field"><span>Date and time</span><input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setAvailability(''); }} required /></label>
          <button className="button button-secondary" type="button" onClick={() => void check()}><Search size={15} /> Check availability</button>
          {availability && <div className="local-data-note" role="status">{availability}</div>}
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : <><Check size={15} /> Confirm appointment</>}</button>
        </form>
      </section>
      <section className="panel contacts-list-panel"><div className="section-heading"><div><span className="eyebrow">SCHEDULE</span><h3>{appointments.length} saved {appointments.length === 1 ? 'appointment' : 'appointments'}</h3><p>Confirmed entries reserve a slot in this internal calendar.</p></div></div>
        <div className="filter-toolbar"><label className="search-field"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or reference" aria-label="Search appointments" /></label><select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter appointment status"><option value="all">All statuses</option>{['confirmed','pending','cancelled','completed','failed'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="calendar-toolbar"><div className="segmented-control" aria-label="Calendar range">{(['day','week','month'] as CalendarView[]).map((item) => <button key={item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className="calendar-navigation"><button className="button button-secondary button-sm" onClick={() => shiftWindow(-1)} aria-label="Previous calendar period">‹</button><strong>{calendarWindow.title}</strong><button className="button button-secondary button-sm" onClick={() => shiftWindow(1)} aria-label="Next calendar period">›</button><input type="date" aria-label="Calendar date" value={anchorDate} onChange={(event) => event.target.value && setAnchorDate(event.target.value)} /></div></div>
        <div className={`appointments-calendar calendar-view-${view}`} aria-label={`${view} calendar`}>
          {calendarWindow.days.map((day) => {
            const dayAppointments = filtered.filter((item) => dateKey(new Date(item.start_at)) === dateKey(day));
            const inMonth = day.getMonth() === calendarWindow.anchor.getMonth();
            return <div className={`calendar-day${inMonth ? '' : ' calendar-day-muted'}`} key={dateKey(day)}><span className="calendar-day-label">{view === 'month' ? day.getDate() : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>{dayAppointments.slice(0, view === 'month' ? 2 : 5).map((item) => <span className={`calendar-event event-${item.status}`} key={item.id} title={`${item.contact_name} · ${new Date(item.start_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`}>{view !== 'month' && `${new Date(item.start_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })} · `}{item.contact_name}</span>)}{dayAppointments.length > (view === 'month' ? 2 : 5) && <small className="calendar-more">+{dayAppointments.length - (view === 'month' ? 2 : 5)} more</small>}</div>;
          })}
        </div>
        {!filtered.length ? <EmptyState title="No appointments in this view" description="Book an appointment or adjust the calendar date and filters." /> : <>
          {upcoming.length > 0 && <><span className="eyebrow">UPCOMING</span><div className="contact-list">{upcoming.map((item) => <AppointmentRow key={item.id} item={item} reschedule={reschedule} cancel={cancel} />)}</div></>}
          {past.length > 0 && <><span className="eyebrow">PAST</span><div className="contact-list">{past.map((item) => <AppointmentRow key={item.id} item={item} reschedule={reschedule} cancel={cancel} />)}</div></>}
        </>}
      </section>
    </div>
    <div className="data-boundary"><span className="boundary-mark" />This is an internal account calendar. It does not check external calendars or book real-world services.</div>
  </div>;
}

function AppointmentRow({ item, reschedule, cancel }: { item: Appointment; reschedule: (item: Appointment) => Promise<void>; cancel: (item: Appointment) => Promise<void> }) {
  return <article className="contact-item"><span className="contact-initial"><CalendarDays size={16} /></span><span className="contact-info"><strong>{item.contact_name} · {item.appointment_type}</strong><small><Clock3 size={12} /> {new Date(item.start_at).toLocaleString()} · {item.status} · {item.booking_reference}</small>{item.contact_phone && <small>{item.contact_phone}</small>}{item.call_id && <Link to={`/calls/${item.call_id}`}>Open related call transcript</Link>}</span>{item.status === 'confirmed' && new Date(item.start_at).getTime() >= Date.now() && <span className="toolbar-actions"><button className="icon-button" onClick={() => void reschedule(item)} title="Reschedule" aria-label="Reschedule appointment"><RefreshCw size={15} /></button><button className="icon-button" onClick={() => void cancel(item)} title="Cancel" aria-label="Cancel appointment"><X size={15} /></button></span>}</article>;
}
