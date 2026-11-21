import { Cake, CalendarDays, Sparkles } from 'lucide-react';
import NeuralIcon from '@/components/brand/NeuralIcon';
import { getRyanAIAnniversaryInfo, RYANAI_BIRTH_DATE, RYANAI_IDENTITY_NAME, RYANAI_TIME_ZONE } from '@/shared/ryanVoiceIdentity';

type Props = { now?: Date };

/** Owner-facing annual milestone for RyanAI's founding and identity celebration. */
export default function RyanAIAnniversaryCard({ now = new Date() }: Props) {
  const anniversary = getRyanAIAnniversaryInfo(now);
  const nextDate = new Date(`${anniversary.nextAnniversary}T12:00:00+02:00`);
  const formattedNextDate = new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: RYANAI_TIME_ZONE,
  }).format(nextDate);
  const foundingDate = new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: RYANAI_TIME_ZONE,
  }).format(new Date(`${RYANAI_BIRTH_DATE}T12:00:00+02:00`));

  return (
    <article
      aria-labelledby="ryanai-anniversary-title"
      className="relative mt-6 overflow-hidden rounded-2xl border border-cyan-300/25 bg-gradient-to-br from-[#102638] via-slate-900 to-[#17132c] p-5 shadow-lg shadow-cyan-950/20 sm:p-6"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
            <NeuralIcon icon={Sparkles} active size="brand" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Annual identity milestone</p>
            <h2 id="ryanai-anniversary-title" className="mt-1 text-lg font-bold text-white">RyanAI birthday & anniversary</h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/5 px-3 py-1.5 text-xs font-medium text-violet-100">
          <Cake className="h-3.5 w-3.5" /> Every 24 May
        </span>
      </div>

      <div className="relative mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="text-sm font-semibold text-slate-100">{RYANAI_IDENTITY_NAME}</p>
          <p className="mt-1 text-xs text-slate-400">Founded {foundingDate} · Johannesburg time</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-cyan-100">
            <CalendarDays className="h-4 w-4 text-cyan-300" />
            <span>Next celebration: <strong>{formattedNextDate}</strong></span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 sm:min-w-36">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Years completed</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-cyan-200">{anniversary.years}</p>
          <p className="text-xs text-slate-400">{anniversary.years === 1 ? 'year' : 'years'} of RyanAI</p>
        </div>
      </div>
    </article>
  );
}
