import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, AudioLines, Check, CircleStop, Clock3, Headphones, LoaderCircle, MicOff, Phone, RotateCcw, Send, ShieldCheck, Volume2, X } from 'lucide-react';
import { api, jsonBody, type Analysis } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

type Message = { role: 'caller' | 'assistant'; content: string; analysis?: Analysis };
type Outcome = 'AI handled' | 'Transferred' | 'Declined';
type Contact = { id: string; name: string; phone: string; category: string };

function formatElapsed(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }

export function AssistantPage() {
  const { user } = useAuth();
  const [callerName, setCallerName] = useState('Unknown caller');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agentMode, setAgentMode] = useState(false);
  const [active, setActive] = useState(false);
  const [handled, setHandled] = useState(false);
  const [callId, setCallId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcomePrompt, setOutcomePrompt] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [elapsedSpeech, setElapsedSpeech] = useState(false);
  const [apiStatus, setApiStatus] = useState<'checking' | 'configured' | 'missing' | 'unavailable'>('checking');
  const messageEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingMessage = useRef<{ callId: number; text: string; id: string } | null>(null);
  const notify = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`cgai:${user.id}:contacts`) || '[]');
      setContacts(Array.isArray(stored) ? stored.filter((item): item is Contact => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.phone === 'string') : []);
      setAgentMode(localStorage.getItem(`cgai:${user.id}:agent-mode`) === 'true');
    } catch {
      setContacts([]);
      setAgentMode(false);
    }
  }, [user]);
  useEffect(() => { api<{ gemini_key_configured: boolean }>('/config-status').then((result) => setApiStatus(result.gemini_key_configured ? 'configured' : 'missing')).catch(() => setApiStatus('unavailable')); }, []);
  useEffect(() => { messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => {
    if (!active || !startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [active, startedAt]);
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  const start = async () => {
    const id = Date.now(); const time = Date.now();
    const contact = contacts.find((item) => item.id === selectedContactId);
    const label = contact?.name ?? (callerName.trim() || 'Unknown caller');
    try {
      await api('/calls/start', jsonBody({ client_call_id: id, caller_name: label, caller_phone: contact?.phone || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' }));
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Could not create the call record.', 'error'); return; }
    setCallerName(label);
    setCallId(id); setStartedAt(time); setElapsed(0); setMessages([]); setActive(true); setHandled(agentMode); setOutcomePrompt(false); setSavingOutcome(false); setDraft('');
    notify(agentMode ? 'Agent Mode is handling this simulated call. Type the caller’s words for a real Gemini analysis.' : 'Simulated call started. Choose how to handle it.', 'success');
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  const setAgentModePreference = (enabled: boolean) => {
    setAgentMode(enabled);
    if (user) {
      try { localStorage.setItem(`cgai:${user.id}:agent-mode`, String(enabled)); }
      catch { notify('Could not save Agent Mode in this browser.', 'error'); }
    }
  };

  const sendMessage = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!active || !handled || !callId || !text || busy || savingOutcome) return;
    if (text.length > 2000) { notify('Keep each caller message under 2,000 characters.', 'error'); return; }
    setBusy(true);
    try {
      const messageId = pendingMessage.current?.callId === callId && pendingMessage.current.text === text
        ? pendingMessage.current.id : crypto.randomUUID();
      pendingMessage.current = { callId, text, id: messageId };
      await api(`/calls/${callId}/transcript`, jsonBody({ speaker: 'caller', message: text, client_message_id: messageId }));
      const history = messages.map((item) => ({ role: item.role, content: item.content }));
      const currentContact = contacts.find((contact) => contact.id === selectedContactId);
      const result = await api<Analysis>('/chat', jsonBody({ message: text, history, client_call_id: callId, caller_name: callerName.trim() || 'Unknown caller', caller_phone: currentContact?.phone || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', client_message_id: messageId }));
      setMessages((current) => [...current, { role: 'caller', content: text }, { role: 'assistant', content: result.reply, analysis: result }]);
      pendingMessage.current = null;
      setDraft('');
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'The assistant could not respond.', 'error'); }
    finally { setBusy(false); inputRef.current?.focus(); }
  };

  const endCall = async (outcome: Outcome) => {
    if (!callId || savingOutcome || busy) return;
    setSavingOutcome(true);
    try {
      await api('/calls/complete', jsonBody({ client_call_id: callId, outcome, caller_name: callerName.trim() || 'Unknown caller' }));
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setActive(false); setHandled(false); setCallId(null); setStartedAt(null); setMessages([]); setOutcomePrompt(false);
      notify(`Simulation saved as “${outcome}”.`, 'success');
      navigate('/calls');
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Could not save this call outcome.', 'error'); }
    finally { setSavingOutcome(false); }
  };

  const retrySpeech = (text: string) => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { notify('Speech playback is not supported in this browser.', 'error'); return; }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-IN'; utterance.onstart = () => setElapsedSpeech(true); utterance.onend = () => setElapsedSpeech(false);
      utterance.onerror = () => { setElapsedSpeech(false); notify('Browser speech could not play. The response remains available as text.', 'error'); };
      window.speechSynthesis.speak(utterance);
    } catch {
      setElapsedSpeech(false);
      notify('Browser speech could not start. The response remains available as text.', 'error');
    }
  };

  return <div className="page-stack assistant-page">
    <div className="assistant-intro"><div><span className="eyebrow">TEXT-BASED CALL SIMULATION</span><h2>Practice a safer response.</h2><p>This creates a simulated record. It does not connect to a phone, microphone, or carrier.</p></div><div className={`model-status model-${apiStatus}`}><i />{apiStatus === 'checking' ? 'Checking backend' : apiStatus === 'missing' ? 'Gemini key not configured' : apiStatus === 'unavailable' ? 'Backend unavailable' : 'Gemini key configured'}</div></div>
    <div className="simulation-layout">
      <section className="panel simulation-panel">
        <div className="simulation-topline"><div className="simulation-title"><span className="simulation-mark"><AudioLines size={18} /></span><div><strong>Call simulation</strong><small>Gemini text response · browser speech optional</small></div></div><div className="simulation-top-actions">{active ? <span className="live-chip"><i /> {handled ? 'SESSION ACTIVE' : 'CALL WAITING'}</span> : <span className="idle-chip"><i /> READY</span>}</div></div>
        {!active ? <div className="simulation-start"><div className="start-illustration"><div className="start-ring start-ring-one" /><div className="start-ring start-ring-two" /><div className="start-center"><Headphones size={31} /></div><span className="start-dot start-dot-a" /><span className="start-dot start-dot-b" /><span className="start-dot start-dot-c" /></div><h3>Start a new simulation</h3><p>Choose a known contact or use an unknown caller, then handle, transfer, or decline the simulated call.</p><div className="form-field simulation-caller"><label htmlFor="caller-contact">Caller</label><select id="caller-contact" value={selectedContactId} onChange={(event) => { const id = event.target.value; setSelectedContactId(id); setCallerName(contacts.find((item) => item.id === id)?.name ?? 'Unknown caller'); }}><option value="">Unknown / unlisted caller</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}</option>)}</select></div>{!selectedContactId && <label className="form-field simulation-caller"><span>Caller label <small>Optional</small></span><input value={callerName === 'Unknown caller' ? '' : callerName} onChange={(event) => setCallerName(event.target.value)} maxLength={80} placeholder="Unknown caller" /></label>}<label className="agent-mode-toggle"><input type="checkbox" checked={agentMode} onChange={(event) => setAgentModePreference(event.target.checked)} /><span><strong>Agent Mode</strong><small>Automatically open the AI handling simulation when a call starts.</small></span></label><button className="button button-primary start-call-button" onClick={start}><Phone size={17} /> Start simulation</button><div className="simulation-disclaimer"><ShieldCheck size={15} /> Simulation only — no real phone call is started.</div></div> : <>
          <div className="call-session-bar"><span className="session-person"><span className="caller-avatar"><Phone size={15} /></span><span><strong>{callerName || 'Unknown caller'}</strong><small>{selectedContactId ? 'Known contact · simulated' : 'Unknown caller · simulated'}</small></span></span><span className="session-timer"><Clock3 size={15} />{formatElapsed(elapsed)}</span><button className="icon-button end-session-icon" onClick={() => setOutcomePrompt(true)} aria-label="End simulation"><X size={17} /></button></div>
          {!handled && <div className="incoming-controls"><p>Incoming simulated call. Choose an action to continue.</p><div><button className="button button-primary button-sm" onClick={() => { setHandled(true); notify('AI handling started. Caller messages will be analyzed by Gemini.', 'info'); }}><AudioLines size={14} /> Handle with AI</button><button className="button button-secondary button-sm" onClick={() => void endCall('Transferred')} disabled={busy || savingOutcome}><Phone size={14} /> Transfer</button><button className="button button-secondary button-sm decline-action" onClick={() => void endCall('Declined')} disabled={busy || savingOutcome}><X size={14} /> Decline</button></div></div>}
          <div className="transcript" aria-live="polite">
            {handled && !messages.length && !busy && <div className="transcript-empty"><div className="sound-wave"><i /><i /><i /><i /><i /></div><strong>AI handling is ready</strong><p>Type the caller’s actual words. Gemini will analyze each message; no sample response is substituted.</p></div>}
            {messages.map((message, index) => <div className={`message-row message-${message.role}`} key={`${index}-${message.role}`}><span className={`message-avatar ${message.role === 'assistant' ? 'assistant-avatar' : ''}`}>{message.role === 'assistant' ? <ShieldCheck size={16} /> : <Phone size={14} />}</span><div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Guardian assistant' : callerName || 'Caller'}</strong><span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="message-bubble">{message.content}</div>{message.analysis && <div className="analysis-mini"><span>{message.analysis.intent}</span><span className={`risk-${message.analysis.risk.toLowerCase()}`}>{message.analysis.risk} risk</span>{message.analysis.review_required && <span className="review-tag"><AlertTriangle size={12} /> Review</span>}<button className="speech-button" onClick={() => retrySpeech(message.content)} title="Play using browser speech"><Volume2 size={14} />{elapsedSpeech ? 'Playing' : 'Listen'}</button></div>}</div></div>)}
            {busy && <div className="message-row message-assistant"><span className="message-avatar assistant-avatar"><ShieldCheck size={16} /></span><div className="message-body"><div className="message-meta"><strong>Guardian assistant</strong></div><div className="message-bubble thinking"><LoaderCircle size={15} className="spin" /> Reviewing caller message…</div></div></div>}
            <div ref={messageEnd} />
          </div>
          <div className="composer-wrap"><form className="message-composer" onSubmit={sendMessage}><textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} maxLength={2000} rows={2} disabled={!handled || busy || savingOutcome} placeholder={handled ? 'Type what the caller says…' : 'Choose Handle with AI to begin…'} aria-label="Caller message" /><div className="composer-bottom"><span>{draft.length}/2,000 · Enter to send</span><button className="button button-primary button-sm" type="submit" disabled={!handled || busy || savingOutcome || !draft.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}Send</button></div></form></div>
          {outcomePrompt && <div className="outcome-confirm"><div className="outcome-confirm-heading"><div><strong>Save the simulation outcome</strong><small>Choose what happened in this simulated call.</small></div><button className="icon-button" onClick={() => setOutcomePrompt(false)} disabled={savingOutcome} aria-label="Keep simulation active"><X size={17} /></button></div><div className="outcome-buttons">{(['AI handled', 'Transferred', 'Declined'] as Outcome[]).map((outcome) => <button className="button button-secondary button-sm" key={outcome} onClick={() => void endCall(outcome)} disabled={savingOutcome || busy}>{savingOutcome ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{outcome}</button>)}</div></div>}
          {!outcomePrompt && <div className="session-footer"><span><MicOff size={15} /> No microphone is active</span><button className="text-link danger-link" onClick={() => setOutcomePrompt(true)} disabled={savingOutcome || busy}><CircleStop size={15} /> End & save call</button></div>}
        </>}
      </section>
      <aside className="panel assistant-side-panel"><span className="eyebrow">SESSION NOTES</span><h3>What this assistant can do</h3><ul className="capability-list"><li><span className="capability-icon"><ShieldCheck size={16} /></span><span><strong>Review text</strong><small>Classify the caller’s message and suggest a response.</small></span></li><li><span className="capability-icon"><AlertTriangle size={16} /></span><span><strong>Flag risk</strong><small>Highlight requests for credentials or likely scam patterns.</small></span></li><li><span className="capability-icon"><Volume2 size={16} /></span><span><strong>Read aloud</strong><small>Optional playback uses the browser’s installed voice.</small></span></li></ul><div className="capability-boundary"><ShieldCheck size={16} /><p>There is no live audio, call recording, transcription, or carrier integration in this version.</p></div><div className="assistant-config-line"><span>Model</span><strong>Managed by backend configuration</strong></div>{apiStatus === 'missing' && <div className="setup-notice"><AlertTriangle size={15} /> Set GEMINI_API_KEY on the backend to enable AI responses.</div>}{apiStatus === 'configured' && <div className="setup-notice"><RotateCcw size={14} /> The key is present; provider access is confirmed only after a successful response.</div>}
      </aside>
    </div>
  </div>;
}
