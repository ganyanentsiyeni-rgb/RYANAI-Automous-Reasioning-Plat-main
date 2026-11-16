import { useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Heart, ShieldCheck, Sparkles } from 'lucide-react';

const featureOptions = [
  'AI Assistant and autonomous agents',
  'Three-brain reasoning and model selection',
  'Operator Console and Cockpit',
  'Audiobook Studio and voice tools',
  'Quant Lab and paper trading',
  'Agentic Communications (email, voice, SMS and WhatsApp)',
  'Memory Vault and personal knowledge',
  'Coding and developer tools',
  'Research and productivity workflows',
];

const useCaseOptions = [
  'Work and business productivity',
  'Learning, research and education',
  'Software development',
  'Content creation and media',
  'Personal organisation',
  'Data analysis and decision support',
  'Customer support and communications',
  'Exploring AI and experimentation',
];

const inputClass = 'mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10';
const labelClass = 'block text-sm font-medium text-slate-200';

export default function CommunitySurveyPage() {
  const [answers, setAnswers] = useState({
    role: '',
    aiExperience: '',
    discovery: '',
    currentUse: '',
    features: [] as string[],
    useCases: [] as string[],
    usefulness: '',
    topPriority: '',
    biggestBarrier: '',
    trustPriority: '',
    accessPreference: '',
    betaInterest: '',
    feedback: '',
  });
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [betaName, setBetaName] = useState('');
  const [betaEmail, setBetaEmail] = useState('');
  const [betaConsent, setBetaConsent] = useState(false);
  const [betaStatus, setBetaStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [betaError, setBetaError] = useState('');
  const [notificationStatus, setNotificationStatus] = useState<'accepted' | 'not_configured' | 'failed' | 'unknown'>('unknown');

  const update = (key: string, value: string | boolean | string[]) => setAnswers((current) => ({ ...current, [key]: value }));
  const toggle = (key: 'features' | 'useCases', value: string) => {
    const current = answers[key];
    update(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setError('');
    try {
      const response = await fetch('/api/community-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'We could not submit your feedback. Please try again.');
      setNotificationStatus(
        result.notificationStatus === 'accepted' ||
        result.notificationStatus === 'failed' ||
        result.notificationStatus === 'not_configured'
          ? result.notificationStatus
          : 'unknown',
      );
      setStatus('success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (submissionError) {
      setStatus('error');
      setError(submissionError instanceof Error ? submissionError.message : 'Submission failed.');
    }
  }

  async function submitBetaInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBetaStatus('sending');
    setBetaError('');
    try {
      const response = await fetch('/api/community-beta-interest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: betaName, email: betaEmail, consent: betaConsent }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'We could not save your Beta interest. Please try again.');
      setBetaStatus('success');
    } catch (submissionError) {
      setBetaStatus('error');
      setBetaError(submissionError instanceof Error ? submissionError.message : 'Registration failed.');
    }
  }

  if (status === 'success') {
    return (
      <section className="mx-auto min-h-full max-w-2xl px-4 py-12">
        <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[0.06] p-8 text-center sm:p-10">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">Anonymous feedback received</p>
          <h1 className="mt-3 text-3xl font-bold text-white">Thank you for shaping RyanAI.</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">Your survey answers were saved separately without your name, email address or RyanAI account identity.</p>
          <p role="status" className="mt-4 text-sm leading-6 text-slate-400">
            {notificationStatus === 'accepted'
              ? 'The email provider accepted the owner notification; final mailbox delivery is not confirmed.'
              : notificationStatus === 'failed'
                ? 'Your response was saved, but the owner notification failed.'
                : notificationStatus === 'not_configured'
                  ? 'Your response was saved, but owner email notification is not configured.'
                  : 'Owner notification status is unavailable.'}
          </p>
          <a href="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950">Explore RyanAI <ArrowRight className="h-4 w-4" /></a>
        </div>
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Optional · Separate registration</p>
          <h2 className="mt-2 text-xl font-bold text-white">Interested in RyanAI Beta testing?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">This separate form stores contact details independently from your anonymous survey answers. Registration does not guarantee Beta access.</p>
          {betaStatus === 'success' ? <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-200">Your Beta interest has been recorded separately. Thank you!</p> : (
            <form onSubmit={submitBetaInterest} className="mt-5 space-y-4">
              <label className={labelClass}>Name <span className="font-normal text-slate-500">(optional)</span><input className={inputClass} maxLength={100} value={betaName} onChange={(e) => setBetaName(e.target.value)} placeholder="Your name" /></label>
              <label className={labelClass}>Email address<input className={inputClass} type="email" maxLength={254} required value={betaEmail} onChange={(e) => setBetaEmail(e.target.value)} placeholder="you@example.com" /></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.04] p-4 text-sm leading-6 text-slate-200"><input type="checkbox" className="mt-1 accent-cyan-300" checked={betaConsent} onChange={(e) => setBetaConsent(e.target.checked)} required />I agree that RyanAI may contact me about Beta testing. I understand this is optional and I can withdraw my interest.</label>
              {betaStatus === 'error' && <p role="alert" className="text-sm text-rose-200">{betaError}</p>}
              <button type="submit" disabled={betaStatus === 'sending'} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200/20 bg-cyan-200/10 px-5 py-3 text-sm font-semibold text-cyan-100 disabled:opacity-60">{betaStatus === 'sending' ? 'Saving…' : 'Register Beta interest'} <ArrowRight className="h-4 w-4" /></button>
            </form>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-full bg-[#0b1020] px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="overflow-hidden rounded-3xl border border-cyan-200/15 bg-gradient-to-br from-[#132a45] via-[#101b32] to-[#101322] p-6 shadow-2xl shadow-black/20 sm:p-10">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><Sparkles className="h-4 w-4" /> RyanAI Community Initiative</div>
          <h1 className="mt-5 text-3xl font-black leading-tight text-white sm:text-5xl">Help shape the future of RyanAI.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">Tell us what matters to you. Your answers will guide the features we prioritise, the experience we improve and the community we build together.</p>
          <div className="mt-7 flex flex-wrap gap-3 text-xs text-slate-300">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">3–5 minutes</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Anonymous by default</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">No account required</span>
          </div>
        </header>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">01 / About you</p>
            <h2 className="mt-2 text-xl font-bold text-white">A little context</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className={labelClass}>Which best describes you?
                <select className={inputClass} value={answers.role} onChange={(e) => update('role', e.target.value)} required>
                  <option value="">Choose one</option><option>Student or educator</option><option>Business owner or entrepreneur</option><option>Developer or technical professional</option><option>Creative professional</option><option>Researcher or analyst</option><option>Working professional</option><option>AI enthusiast</option><option>Other</option>
                </select>
              </label>
              <label className={labelClass}>How would you describe your AI experience?
                <select className={inputClass} value={answers.aiExperience} onChange={(e) => update('aiExperience', e.target.value)} required>
                  <option value="">Choose one</option><option>Just getting started</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>Expert / building AI systems</option>
                </select>
              </label>
              <label className={labelClass}>How did you hear about RyanAI?
                <select className={inputClass} value={answers.discovery} onChange={(e) => update('discovery', e.target.value)} required>
                  <option value="">Choose one</option><option>Facebook</option><option>LinkedIn</option><option>Reddit</option><option>WhatsApp</option><option>Hacker News</option><option>Friend or colleague</option><option>Online search</option><option>Other</option>
                </select>
              </label>
              <label className={labelClass}>Have you tried RyanAI?
                <select className={inputClass} value={answers.currentUse} onChange={(e) => update('currentUse', e.target.value)} required>
                  <option value="">Choose one</option><option>Yes, regularly</option><option>Yes, a few times</option><option>Not yet, but interested</option><option>Just discovering it</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">02 / Product discovery</p>
            <h2 className="mt-2 text-xl font-bold text-white">What should RyanAI focus on?</h2>
            <p className="mt-2 text-sm text-slate-400">Select all features that interest you most.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {featureOptions.map((item) => <label key={item} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-200 hover:border-cyan-200/30"><input type="checkbox" checked={answers.features.includes(item)} onChange={() => toggle('features', item)} className="mt-0.5 accent-cyan-300" />{item}</label>)}
            </div>
            <p className="mt-6 text-sm font-medium text-slate-200">What would you use an AI platform for? <span className="text-slate-500">(Choose all that apply)</span></p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {useCaseOptions.map((item) => <label key={item} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-200 hover:border-cyan-200/30"><input type="checkbox" checked={answers.useCases.includes(item)} onChange={() => toggle('useCases', item)} className="mt-0.5 accent-cyan-300" />{item}</label>)}
            </div>
            <label className={labelClass + ' mt-6'}>How useful does an integrated AI platform sound to you?
              <select className={inputClass} value={answers.usefulness} onChange={(e) => update('usefulness', e.target.value)} required><option value="">Choose one</option><option>Extremely useful</option><option>Very useful</option><option>Somewhat useful</option><option>Not sure yet</option><option>Not useful for me</option></select>
            </label>
            <label className={labelClass + ' mt-5'}>If we could improve or build just one thing next, what should it be?
              <textarea className={inputClass} rows={3} maxLength={1200} value={answers.topPriority} onChange={(e) => update('topPriority', e.target.value)} placeholder="Tell us the feature or problem that matters most to you…" required />
            </label>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">03 / Experience and trust</p>
            <h2 className="mt-2 text-xl font-bold text-white">What makes a product worth using?</h2>
            <div className="mt-5 space-y-5">
              <label className={labelClass}>What is the biggest barrier that might stop you using RyanAI?
                <select className={inputClass} value={answers.biggestBarrier} onChange={(e) => update('biggestBarrier', e.target.value)} required><option value="">Choose one</option><option>Unclear features or how to get started</option><option>Reliability or performance</option><option>Privacy and data security</option><option>Cost or affordability</option><option>Mobile usability or accessibility</option><option>I do not have a current barrier</option><option>Other</option></select>
              </label>
              <label className={labelClass}>Which trust priority matters most?
                <select className={inputClass} value={answers.trustPriority} onChange={(e) => update('trustPriority', e.target.value)} required><option value="">Choose one</option><option>Clear privacy and data controls</option><option>Secure accounts and permissions</option><option>Transparent AI answers and limitations</option><option>Human approval for important actions</option><option>Reliable and consistent performance</option><option>All of the above</option></select>
              </label>
              <label className={labelClass}>What access model would you prefer?
                <select className={inputClass} value={answers.accessPreference} onChange={(e) => update('accessPreference', e.target.value)} required><option value="">Choose one</option><option>Free core features with optional upgrades</option><option>Affordable monthly subscription</option><option>Pay only for what I use</option><option>Free community / open-source edition</option><option>Not sure</option></select>
              </label>
              <label className={labelClass}>Would you be interested in testing upcoming RyanAI features?
                <select className={inputClass} value={answers.betaInterest} onChange={(e) => update('betaInterest', e.target.value)} required><option value="">Choose one</option><option>Yes, I would love to help</option><option>Maybe, send me more information</option><option>Not at this time</option></select>
              </label>
              <label className={labelClass}>Anything else we should know?
                <textarea className={inputClass} rows={4} maxLength={2000} value={answers.feedback} onChange={(e) => update('feedback', e.target.value)} placeholder="Ideas, frustrations, use cases, partnerships or anything else…" />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">04 / Anonymous submission</p>
            <h2 className="mt-2 text-xl font-bold text-white">Your feedback stays separate</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">This survey does not ask for your name, email address or RyanAI account identity. If you want to volunteer for Beta testing, a separate optional registration form will appear after you submit.</p>
          </section>

          {status === 'error' && <p role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-200">{error}</p>}
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-7">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><div><h2 className="font-semibold text-white">Your privacy matters</h2><p className="mt-1 text-xs leading-6 text-slate-400">Survey answers are stored without account identity or contact fields. Beta contact details are stored separately only after explicit consent. Please do not include passwords, credentials, financial details or sensitive personal information. A private notification may be sent to the RyanAI survey owner after your answers are saved. No messages are sent to survey respondents.</p></div></div>
            <button type="submit" disabled={status === 'sending'} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">{status === 'sending' ? 'Submitting your feedback…' : 'Submit my feedback'} <ArrowRight className="h-4 w-4" /></button>
            <p className="mt-3 text-center text-xs text-slate-500">Thank you for helping us build a more useful RyanAI. <Heart className="inline h-3 w-3 text-rose-300" /></p>
          </div>
        </form>
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7" aria-labelledby="survey-faq-title">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Need to know more?</p>
          <h2 id="survey-faq-title" className="mt-2 text-xl font-bold text-white">Frequently asked questions</h2>
          <div className="mt-4 divide-y divide-white/10">
            {[
              ['What is the RyanAI Community Survey?', 'It is a short product-discovery questionnaire that helps us understand what people need from AI tools and which RyanAI capabilities we should prioritise.'],
              ['Who can participate?', 'Anyone can participate, whether you already use RyanAI or are discovering it for the first time. A RyanAI account is not required.'],
              ['Is the survey anonymous?', 'Survey answers are stored without your name, email address or RyanAI account identity. Please do not include identifying details in free-text answers.'],
              ['Do I have to answer every question?', 'Questions marked as required must be completed. The written feedback field is optional.'],
              ['How will RyanAI use my answers?', 'Feedback helps the team understand community needs, improve the product experience and prioritise future development.'],
              ['How can I volunteer for Beta testing?', 'After submitting the survey, you may complete a separate optional Beta registration form. Contact details are stored separately from survey answers.'],
              ['Does Beta registration guarantee access?', 'No. Beta places may be limited. Registering records your interest but does not guarantee selection or immediate access.'],
              ['Will submitting the survey send me messages?', 'A private notification is sent to the RyanAI survey owner after the response is saved when email delivery is configured. The survey does not send messages to respondents, and provider acceptance does not confirm final mailbox delivery.'],
              ['Can I include confidential information?', 'No. Please do not submit passwords, credentials, financial account details, confidential business information or sensitive personal information.'],
              ['How long does it take?', 'Most people can complete the survey in approximately 3–5 minutes.'],
            ].map(([question, answer]) => <details key={question} className="group py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-100"><span>{question}</span><span aria-hidden="true" className="text-cyan-200 transition group-open:rotate-45">+</span></summary><p className="mt-3 pr-6 text-sm leading-6 text-slate-400">{answer}</p></details>)}
          </div>
        </section>
        <footer className="py-8 text-center text-xs text-slate-600">RyanAI · Community Feedback & Product Discovery · 2026</footer>
      </div>
    </div>
  );
}
