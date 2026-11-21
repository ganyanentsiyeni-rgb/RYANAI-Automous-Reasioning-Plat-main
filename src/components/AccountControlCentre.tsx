import { useEffect, useState } from 'react';
import {
  ChevronDown,
  CircleHelp,
  ClipboardList,
  LogOut,
  Plug,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';

interface AccountControlCentreProps {
  displayName: string;
  email: string;
  roleLabel: string;
  isOwner: boolean;
  isAdmin: boolean;
  signingOut: boolean;
  onSignOut: () => void;
  compact?: boolean;
}

const accountLinks = [
  { label: 'Profile & account preferences', description: 'Your name, language, voice and workspace defaults', href: '#/settings', icon: UserRound },
  { label: 'Personalization & AI preferences', description: 'Assistant behaviour, model and voice preferences', href: '#/settings', icon: Settings2 },
  { label: 'Security & sessions', description: 'Password, email verification and other signed-in devices', href: '#/settings?section=account-security-title', icon: ShieldCheck },
  { label: 'Connected integrations', description: 'GitHub authorization and available integrations', href: '#/settings?section=github-settings-title', icon: Plug },
  { label: 'Community Survey', description: 'Share feedback to improve RyanAI', href: '#/survey', icon: ClipboardList },
  { label: 'Help & support', description: 'Guidance and frequently asked questions', href: '#/help', icon: CircleHelp },
] as const;

export default function AccountControlCentre({
  displayName,
  email,
  roleLabel,
  isOwner,
  isAdmin,
  signingOut,
  onSignOut,
  compact = false,
}: AccountControlCentreProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const initials = (displayName || email || 'R').trim().slice(0, 1).toUpperCase();

  return (
    <div className={`relative ${compact ? 'shrink-0' : 'w-full'}`}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="ryanai-account-menu"
        aria-label={open ? 'Close account menu' : 'Open account and preferences menu'}
        onClick={() => setOpen(value => !value)}
        className={`flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-left transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${compact ? 'min-h-10 px-2.5 py-2' : 'w-full p-3'}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-sm font-bold text-cyan-100">{initials}</span>
        {!compact && <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-100">{displayName || 'RyanAI account'}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{roleLabel}</span></span>}
        {compact && <span className="hidden max-w-24 truncate text-xs font-medium text-slate-200 sm:block">Account</span>}
        {open ? <X className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close account menu overlay" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <section id="ryanai-account-menu" aria-label="Account and personal control centre" className={`absolute z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#0b111c] shadow-2xl shadow-black/50 ${compact ? 'right-0' : 'left-0'}`}>
            <div className="border-b border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-base font-bold text-cyan-100">{initials}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{displayName || 'RyanAI account'}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{email || 'Authenticated RyanAI account'}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">{roleLabel}</p>
                </div>
              </div>
            </div>
            <nav aria-label="Account controls" className="max-h-[min(65dvh,32rem)] overflow-y-auto p-2">
              {accountLinks.map(({ label, description, href, icon: Icon }) => (
                <a key={label} href={href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-xs font-semibold text-slate-100">{label}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{description}</span></span>
                </a>
              ))}
              {(isOwner || isAdmin) && <a href="#/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Admin Console</a>}
            </nav>
            <div className="border-t border-white/10 p-2">
              <button type="button" onClick={() => { setOpen(false); onSignOut(); }} disabled={signingOut} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50">
                <LogOut className="h-4 w-4" aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out of RyanAI'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
