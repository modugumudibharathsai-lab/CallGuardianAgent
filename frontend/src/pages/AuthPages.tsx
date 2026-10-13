import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, AudioLines, Eye, EyeOff, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api, jsonBody } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

type Challenge = { id: string; question: string };
type PasswordPolicy = { min_length: number; require_uppercase: boolean; require_digit: boolean; require_special: boolean };

function AuthBrand() {
  return <Link to="/login" className="brand-lockup auth-brand"><span className="brand-mark"><ShieldCheck size={21} /></span><span className="brand-type">CallGuardian<span>AI</span><small>PRIVATE CALL WORKSPACE</small></span></Link>;
}

function AuthFrame({ children, mode }: { children: React.ReactNode; mode: 'login' | 'register' }) {
  return <div className="auth-page">
    <section className="auth-story">
      <AuthBrand />
      <div className="auth-story-copy"><span className="eyebrow auth-eyebrow"><Sparkles size={14} /> A calmer way to screen</span><h1>Let your calls<br />come to <em>you.</em></h1><p>A private workspace to review screened calls, understand what matters, and stay in control of every conversation.</p>
        <div className="auth-feature-list"><span><ShieldCheck size={16} /> Private by account</span><span><AudioLines size={16} /> Voice stays in your browser</span></div>
      </div>
      <div className="auth-story-footer"><span>CallGuardianAI <i>·</i> Simulated calls only</span><span>Built for a little more peace of mind.</span></div>
    </section>
    <section className="auth-panel"><div className="auth-panel-inner">
      <div className="auth-mobile-brand"><AuthBrand /></div>
      <div className="auth-form-heading"><span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</span><h2>{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h2><p>{mode === 'login' ? 'Your calls and settings are waiting for you.' : 'A few details, then your private workspace is ready.'}</p></div>
      {children}
      <p className="auth-switch">{mode === 'login' ? 'New to CallGuardianAI?' : 'Already have an account?'} <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Create an account' : 'Sign in'} <ArrowRight size={14} /></Link></p>
      <div className="auth-trust"><LockKeyhole size={14} /> Your session is protected with secure, account-scoped access.</div>
    </div></section>
  </div>;
}

function useCaptcha() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    setLoading(true); setError(''); setChallenge(null);
    try { setChallenge(await api<Challenge>('/captcha')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'CAPTCHA could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return { challenge, loading, error, refresh };
}

function CaptchaField({ challenge, loading, error, refresh, answer, setAnswer }: {
  challenge: Challenge | null; loading: boolean; error: string;
  refresh: () => Promise<void>; answer: string; setAnswer: (value: string) => void;
}) {
  return <div className="form-field">
    <label htmlFor="captcha-answer">Security check</label>
    <div className="captcha-control"><span className="captcha-question" aria-live="polite">{loading ? 'Loading…' : challenge?.question ?? 'Challenge unavailable'}</span><button className="icon-button captcha-refresh" type="button" onClick={() => { setAnswer(''); void refresh(); }} disabled={loading} aria-label="Refresh security challenge"><RefreshCw size={15} /></button></div>
    <input id="captcha-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} inputMode="numeric" pattern="-?[0-9]+" autoComplete="off" required aria-describedby="captcha-help" placeholder="Enter the result" />
    <span className="field-hint" id="captcha-help">{error || 'Enter the answer to the arithmetic question above.'}</span>
  </div>;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const notify = useToast();
  const { challenge, loading: captchaLoading, error: captchaError, refresh: refreshCaptcha } = useCaptcha();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [answer, setAnswer] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!challenge) { notify('Load the security check before signing in.', 'error'); return; }
    setBusy(true);
    try {
      await api('/auth/login', jsonBody({ credential: credential.trim(), password, captcha_id: challenge.id, captcha_ans: Number(answer) }));
      const signedInUser = await refresh();
      if (!signedInUser) throw new Error('The sign-in request succeeded, but this browser could not confirm the session. Check that cookies are enabled, then try again.');
      notify('You’re signed in.', 'success');
      navigate('/dashboard', { replace: true });
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Sign in failed.', 'error'); }
    finally { setBusy(false); setAnswer(''); void refreshCaptcha(); }
  };

  return <AuthFrame mode="login"><form className="auth-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="credential">Email or username</label><input id="credential" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="username" required placeholder="you@example.com" /></div>
    <div className="form-field"><div className="field-label-row"><label htmlFor="password">Password</label><span className="field-muted">Account password</span></div><div className="password-input"><input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button className="icon-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
    <CaptchaField challenge={challenge} loading={captchaLoading} error={captchaError} refresh={refreshCaptcha} answer={answer} setAnswer={setAnswer} />
    <button className="button button-primary auth-submit" type="submit" disabled={busy || captchaLoading || !challenge}>{busy ? <span className="button-spinner" /> : <LockKeyhole size={16} />}{busy ? 'Signing in…' : 'Sign in securely'}<ArrowRight size={16} /></button>
  </form></AuthFrame>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const notify = useToast();
  const { challenge, loading: captchaLoading, error: captchaError, refresh: refreshCaptcha } = useCaptcha();
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [values, setValues] = useState({ username: '', email: '', password: '', confirm: '', answer: '' });
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => { api<PasswordPolicy>('/auth/password-policy').then(setPolicy).catch((error) => notify(error.message, 'error')); }, [notify]);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const passwordValid = !!policy && values.password.length >= policy.min_length
    && (!policy.require_uppercase || /[A-Z]/.test(values.password))
    && (!policy.require_digit || /\d/.test(values.password))
    && (!policy.require_special || /[^A-Za-z0-9]/.test(values.password));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!challenge) { notify('Load the security check before creating an account.', 'error'); return; }
    if (!passwordValid) { notify('Password does not meet the account requirements.', 'error'); return; }
    if (values.password !== values.confirm) { notify('Passwords do not match.', 'error'); return; }
    setBusy(true);
    try {
      await api('/auth/register', jsonBody({ username: values.username.trim(), email: values.email.trim().toLowerCase(), password: values.password, confirm: values.confirm, captcha_id: challenge.id, captcha_ans: Number(values.answer) }));
      notify('Account created. Sign in to continue.', 'success');
      navigate('/login', { replace: true });
    } catch (reason) { notify(reason instanceof Error ? reason.message : 'Account creation failed.', 'error'); }
    finally { setBusy(false); set('answer', ''); void refreshCaptcha(); }
  };
  return <AuthFrame mode="register"><form className="auth-form register-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="username">Username</label><input id="username" value={values.username} onChange={(event) => set('username', event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" required placeholder="Choose a username" /></div>
    <div className="form-field"><label htmlFor="email">Email address</label><input id="email" type="email" value={values.email} onChange={(event) => set('email', event.target.value)} autoComplete="email" required placeholder="you@example.com" /></div>
    <div className="form-field"><label htmlFor="new-password">Password</label><div className="password-input"><input id="new-password" type={showPassword ? 'text' : 'password'} value={values.password} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" minLength={policy?.min_length ?? 8} maxLength={128} required /><button className="icon-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><span className={`field-hint${values.password && !passwordValid ? ' field-hint-error' : ''}`}>{policy ? `At least ${policy.min_length} characters${policy.require_uppercase ? ', one uppercase letter' : ''}${policy.require_digit ? ', one number' : ''}${policy.require_special ? ', one special character' : ''}.` : 'Loading password requirements…'}</span></div>
    <div className="form-field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" value={values.confirm} onChange={(event) => set('confirm', event.target.value)} autoComplete="new-password" maxLength={128} required /></div>
    <CaptchaField challenge={challenge} loading={captchaLoading} error={captchaError} refresh={refreshCaptcha} answer={values.answer} setAnswer={(value) => set('answer', value)} />
    <button className="button button-primary auth-submit" type="submit" disabled={busy || captchaLoading || !challenge || !policy}>{busy ? <span className="button-spinner" /> : <ShieldCheck size={16} />}{busy ? 'Creating account…' : 'Create secure account'}<ArrowRight size={16} /></button>
    <p className="legal-note">Your call history is scoped to your account. This app screens simulated calls; it does not connect to a phone network.</p>
  </form></AuthFrame>;
}
