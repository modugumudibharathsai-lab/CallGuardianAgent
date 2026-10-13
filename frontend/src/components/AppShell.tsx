import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, AudioLines, BarChart3, Bell, CalendarDays, ChevronDown, Headphones, LayoutDashboard,
  LogOut, Menu, PhoneCall, Settings2, ShieldCheck, Users, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';

const navigation = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/calls', label: 'Call history', icon: PhoneCall },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/assistant', label: 'AI assistant', icon: AudioLines },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
];
const titles: Record<string, [string, string]> = {
  '/dashboard': ['Overview', 'Your call workspace at a glance'],
  '/calls': ['Call history', 'Review your recent screened calls'],
  '/appointments': ['Appointments', 'Availability from your internal calendar'],
  '/assistant': ['AI assistant', 'A text-first call simulation, powered by your configured Gemini model'],
  '/contacts': ['Contacts', 'Manage this browser’s local contact list'],
  '/analytics': ['Analytics', 'Metrics calculated from your saved call records'],
  '/settings': ['Settings', 'Account and local playback preferences'],
};

function Brand() {
  return <Link className="brand-lockup" to="/dashboard" aria-label="CallGuardianAI overview">
    <span className="brand-mark"><ShieldCheck size={21} strokeWidth={2.1} /></span>
    <span className="brand-type">CallGuardian<span>AI</span><small>PRIVATE CALL WORKSPACE</small></span>
  </Link>;
}

function Sidebar({ onNavigate, userName }: { onNavigate: () => void; userName: string }) {
  return <>
    <div className="sidebar-brand"><Brand /><button className="icon-button sidebar-dismiss" onClick={onNavigate} aria-label="Close navigation"><X size={18} /></button></div>
    <div className="workspace-label">WORKSPACE</div>
    <nav className="side-nav" aria-label="Main navigation">
      {navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
        <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Call history' && <span className="nav-count">Live</span>}
      </NavLink>)}
    </nav>
    <div className="sidebar-spacer" />
    <div className="privacy-card">
      <div className="privacy-icon"><ShieldCheck size={17} /></div>
      <div><strong>Your data stays yours</strong><p>Records are private to your account.</p></div>
    </div>
    <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => `nav-link settings-link${isActive ? ' active' : ''}`}><Settings2 size={18} /><span>Settings</span></NavLink>
    <div className="sidebar-user"><span className="avatar avatar-small">{userName.slice(0, 2).toUpperCase()}</span><span className="user-meta"><strong>{userName}</strong><small>Personal workspace</small></span><span className="online-dot" aria-label="Signed in" /></div>
  </>;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const title = titles[location.pathname] ?? (location.pathname.startsWith('/calls/') ? ['Call details', 'Transcript and call outcome'] : ['CallGuardianAI', 'Private call workspace']);
  const handleLogout = async () => {
    try { await logout(); navigate('/login'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Sign out failed.', 'error'); }
  };
  return <div className="app-frame">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
      <Sidebar onNavigate={() => setMobileOpen(false)} userName={user?.username ?? 'Account'} />
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="page-context"><span className="eyebrow">CALLGUARDIAN / WORKSPACE</span><div className="page-heading-row"><h1>{title[0]}</h1><span className="context-badge"><Activity size={13} /> PERSONAL</span></div><p>{title[1]}</p></div>
        <div className="topbar-actions"><span className="secure-status"><span className="online-dot" /> Secure session</span><button className="icon-button notification-button" aria-label="Notifications are not configured" title="No notifications"><Bell size={18} /><i /></button><div className="topbar-profile"><span className="avatar avatar-small">{(user?.username ?? 'AC').slice(0, 2).toUpperCase()}</span><ChevronDown size={14} /></div><button className="icon-button logout-button" onClick={handleLogout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button></div>
      </header>
      <motion.div key={location.pathname} className="page-content" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .16, ease: 'easeOut' }}>
        <Outlet />
      </motion.div>
      <footer className="app-footer"><span><Headphones size={14} /> Designed for private call screening</span><span>CallGuardianAI <span className="footer-dot">·</span> Simulated calls only</span></footer>
    </main>
  </div>;
}
