import { ArrowLeft, Disc3, ListMusic, ShieldCheck, Smartphone } from 'lucide-react';
import MusicPlayer from '@/components/dashboard/MusicPlayer';
import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '@/lib/settingsPreferences';

interface Props { settings?: MusicSettings; }

export default function MusicWorkspace({ settings = DEFAULT_MUSIC_SETTINGS }: Props) {
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="music-workspace-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a href="#/dashboard" className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-cyan-200"><ArrowLeft className="h-3.5 w-3.5" /> Commander Dashboard</a>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Media</p>
          <h1 id="music-workspace-title" className="mt-2 flex items-center gap-3 text-3xl font-bold text-white"><Disc3 className="h-8 w-8 text-violet-300" /> RyanAI Music</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Your personal music workspace for importing audio, building playlists and handing tracks to VLC on Android.</p>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><Disc3 className="h-5 w-5 text-violet-300" /><h2 className="mt-3 text-sm font-semibold text-white">Your library</h2><p className="mt-1 text-xs leading-5 text-slate-400">Keep uploaded audio in this browser profile and return to it later.</p></article>
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><ListMusic className="h-5 w-5 text-violet-300" /><h2 className="mt-3 text-sm font-semibold text-white">Saved playlists</h2><p className="mt-1 text-xs leading-5 text-slate-400">Create, select, reorder and save named playlists.</p></article>
        <article className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><Smartphone className="h-5 w-5 text-violet-300" /><h2 className="mt-3 text-sm font-semibold text-white">VLC handoff</h2><p className="mt-1 text-xs leading-5 text-slate-400">Share a selected track to Android and choose VLC when the system offers it.</p></article>
      </div>
      <MusicPlayer settings={settings} />
      <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-slate-900/50 p-4 text-xs leading-5 text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /> Music files and playlists are currently stored locally in this browser profile. They are not cloud-backed or synchronized between devices. External VLC playback cannot be remotely controlled or observed by RyanAI.</p>
    </section>
  );
}
