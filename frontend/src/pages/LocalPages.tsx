import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { api } from '../lib/api';
import { Check, Mic, Plus, Trash2, UserPlus, Volume2, X } from 'lucide-react';
import { EmptyState } from '../components/Common';

type Contact = { id: string; name: string; phone: string; category: string };
type LocalPreferences = { voiceURI: string; sampleRate: number };

function readContacts(userId: number): Contact[] {
  try { const parsed = JSON.parse(localStorage.getItem(`cgai:${userId}:contacts`) || '[]'); return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.phone === 'string') : []; }
  catch { return []; }
}

export function ContactsPage() {
  const { user } = useAuth();
  const notify = useToast();
  const [contacts, setContacts] = useState<Contact[]>(() => user ? readContacts(user.id) : []);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [category, setCategory] = useState('Personal');
  useEffect(() => { if (user) setContacts(readContacts(user.id)); }, [user]);
  const persist = (next: Contact[]) => { setContacts(next); if (user) { try { localStorage.setItem(`cgai:${user.id}:contacts`, JSON.stringify(next)); } catch { notify('Browser storage is unavailable; this contact was not saved.', 'error'); } } };
  const add = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!name.trim()) return; const next = [{ id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), category }, ...contacts]; persist(next); setName(''); setPhone(''); notify('Contact saved in this browser.', 'success'); };
  return <div className="page-stack">
    <div className="local-page-intro"><div><span className="eyebrow">LOCAL CONTACTS</span><h2>People you recognize.</h2><p>This list stays in this browser and does not affect the AI screening rules.</p></div><span className="local-only-badge">Browser only</span></div>
    <div className="contacts-layout"><section className="panel contact-form-panel"><div className="section-heading"><div><span className="eyebrow">NEW CONTACT</span><h3>Add someone</h3><p>Keep a quick reference for your own use.</p></div><UserPlus size={20} className="form-heading-icon" /></div><form className="stacked-form" onSubmit={add}><label className="form-field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="e.g. Priya Shah" /></label><label className="form-field"><span>Phone number <small>Optional</small></span><input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="tel" placeholder="e.g. +1 555 010 2480" /></label><label className="form-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Personal</option><option>Work</option><option>Healthcare</option><option>Other</option></select></label><button className="button button-primary" type="submit"><Plus size={16} /> Save contact</button></form><div className="local-data-note">Contact data is stored in this browser’s local storage. It is not uploaded to the API.</div></section>
      <section className="panel contacts-list-panel"><div className="section-heading"><div><span className="eyebrow">YOUR LIST</span><h3>{contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}</h3><p>Private to this browser profile</p></div></div>{contacts.length ? <div className="contact-list">{contacts.map((contact) => <div className="contact-item" key={contact.id}><span className="contact-initial">{contact.name.slice(0, 1).toUpperCase()}</span><span className="contact-info"><strong>{contact.name}</strong><small>{contact.phone || 'No phone number'} <i>·</i> {contact.category}</small></span><button className="icon-button contact-delete" onClick={() => { if (window.confirm(`Remove ${contact.name} from this browser?`)) { persist(contacts.filter((item) => item.id !== contact.id)); notify('Contact removed.', 'success'); } }} aria-label={`Remove ${contact.name}`}><Trash2 size={16} /></button></div>)}</div> : <EmptyState title="No contacts added yet" description="Add a name if you want a personal reference list here." />}</section></div>
  </div>;
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [preferences, setPreferences] = useState<LocalPreferences>({ voiceURI: '', sampleRate: 1 });
  const [status, setStatus] = useState<'loading' | 'configured' | 'missing' | 'unavailable'>('loading');
  useEffect(() => {
    if (user) { try { const saved = JSON.parse(localStorage.getItem(`cgai:${user.id}:preferences`) || 'null'); if (saved && typeof saved === 'object') setPreferences((current) => ({ ...current, ...saved })); } catch { /* malformed local preferences are ignored */ } }
    if (!('speechSynthesis' in window)) return;
    const sync = () => setVoices(window.speechSynthesis.getVoices()); sync(); window.speechSynthesis.addEventListener('voiceschanged', sync);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', sync);
  }, [user]);
  useEffect(() => { api<{ gemini_key_configured: boolean }>('/config-status').then((result) => setStatus(result.gemini_key_configured ? 'configured' : 'missing')).catch(() => setStatus('unavailable')); }, []);
  const englishVoices = useMemo(() => voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang)), [voices]);
  const update = (patch: Partial<LocalPreferences>) => {
    const next = { ...preferences, ...patch }; setPreferences(next);
    if (user) { try { localStorage.setItem(`cgai:${user.id}:preferences`, JSON.stringify(next)); notify('Playback preference saved in this browser.', 'success'); } catch { notify('Could not save this browser preference.', 'error'); } }
  };
  const previewVoice = () => {
    if (!('speechSynthesis' in window)) { notify('Browser speech is not supported.', 'error'); return; }
    try {
      window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance('Hello. This is a preview of your browser voice.');
      const voice = voices.find((item) => item.voiceURI === preferences.voiceURI); if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      utterance.rate = preferences.sampleRate; utterance.onerror = () => notify('The selected browser voice could not play.', 'error'); window.speechSynthesis.speak(utterance);
    } catch { notify('The selected browser voice could not start.', 'error'); }
  };
  const signOut = async () => { if (!window.confirm('Sign out of CallGuardianAI?')) return; try { await logout(); navigate('/login', { replace: true }); } catch (error) { notify(error instanceof Error ? error.message : 'Sign out failed.', 'error'); } };
  return <div className="page-stack">
    <div className="local-page-intro"><div><span className="eyebrow">WORKSPACE SETTINGS</span><h2>Your account, your preferences.</h2><p>Account security is managed by the backend. Voice options below live in this browser.</p></div></div>
    <section className="panel settings-section"><div className="section-heading"><div><span className="eyebrow">ACCOUNT</span><h3>Account details</h3><p>Signed-in identity for this private workspace</p></div></div><div className="account-detail-grid"><div><span>Username</span><strong>{user?.username}</strong></div><div><span>Email</span><strong>{user?.email}</strong></div><div><span>Member since</span><strong>Account active</strong></div></div><button className="button button-secondary settings-signout" onClick={() => void signOut()}><X size={15} /> Sign out</button></section>
    <section className="panel settings-section"><div className="section-heading"><div><span className="eyebrow">VOICE PLAYBACK</span><h3>Browser voice</h3><p>Optional text-to-speech for AI replies. Audio is generated by your browser, not saved.</p></div><span className="voice-icon"><Volume2 size={18} /></span></div>{'speechSynthesis' in window ? <div className="voice-settings"><label className="form-field"><span>Voice</span><select value={preferences.voiceURI} onChange={(event) => update({ voiceURI: event.target.value })}><option value="">Browser default voice</option>{englishVoices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}</select></label><label className="form-field rate-field"><span>Speech rate <strong>{preferences.sampleRate.toFixed(1)}×</strong></span><input type="range" min="0.7" max="1.3" step="0.1" value={preferences.sampleRate} onChange={(event) => update({ sampleRate: Number(event.target.value) })} /></label><button className="button button-secondary" onClick={previewVoice}><Volume2 size={16} /> Preview voice</button></div> : <div className="inline-alert"><Mic size={16} /> This browser does not support speech synthesis. Text responses still work.</div>}<div className="local-data-note">Saved locally on this browser. Preferences do not change Gemini’s analysis or language settings.</div></section>
    <section className="panel settings-section"><div className="section-heading"><div><span className="eyebrow">AI PROVIDER</span><h3>Gemini connection</h3><p>Credentials remain on the backend and cannot be changed from this page.</p></div><span className={`model-status model-${status}`}>{status === 'loading' ? 'Checking' : status === 'configured' ? 'Key present' : status === 'missing' ? 'Not configured' : 'Backend unavailable'}</span></div><div className="ai-managed-note"><Check size={16} /><span>Model and assistant instructions are managed through server configuration. This app does not send secrets to the browser.</span></div></section>
  </div>;
}
