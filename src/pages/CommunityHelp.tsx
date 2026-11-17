import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Search, ShieldCheck, Sparkles } from 'lucide-react';

const faqGroups = [
 { title: 'Getting started', items: [
  ['What is RyanAI?', 'RyanAI is being developed as an AI operating platform that brings assistants, reasoning, specialised workspaces, knowledge and governed tool use into one experience. Capabilities available to you depend on the current release and service status.'],
  ['Who can use the Community Survey and Help Centre?', 'The Community Survey and this Help Centre are public. You do not need a RyanAI account to read the FAQs or submit product feedback.'],
  ['How long does the survey take?', 'Most people can complete it in about 3–5 minutes. Required questions help us compare feedback consistently; the longer written feedback field is optional.'],
 ]},
 { title: 'AI, models and reasoning', items: [
  ['How is RyanAI different from a basic chatbot?', 'The product direction combines conversational assistance with specialised workspaces, multiple reasoning providers, persistent project knowledge and controlled tools. Not every capability is necessarily enabled in every release.'],
  ['What does Three-Brain reasoning mean?', 'It describes RyanAI’s intended multi-model reasoning approach, where different model roles can contribute to a task. Model selection or model output does not grant permission to perform an action.'],
  ['Can an AI model make decisions or act on its own?', 'Models can propose or help prepare work. Consequential actions must pass applicable identity, ownership, policy, capability and approval checks. A model cannot authorize itself.'],
 ]},
 { title: 'Gen-X, Jarvis and safe execution', items: [
  ['What is Gen-X?', 'Gen-X is RyanAI’s governance and authorization authority. It evaluates whether a requested operation is permitted under the applicable policy. If a required authorization decision is missing or unavailable, execution should fail closed.'],
  ['What is Jarvis?', 'Jarvis is a bounded orchestration layer intended to coordinate approved work. It cannot bypass Gen-X, create its own authority or replace a required human approval.'],
  ['Does a successful tool call prove that a task is complete?', 'No. Execution success and independent verification are separate. RyanAI should retain evidence and verify the requested outcome rather than treating a successful API response as proof of completion.'],
  ['Will RyanAI send emails, WhatsApp messages, SMS or make calls?', 'Only when the relevant provider integration is available and the action is authorized. Live communication requires destination verification and explicit test or action approval; provider acceptance is not proof of final delivery.'],
 ]},
 { title: 'Workspaces and capabilities', items: [
  ['What is the Operator Console?', 'It is an operational workspace for supported RyanAI activities. Access and available actions depend on account permissions, enabled features and service readiness.'],
  ['What is Memory Vault?', 'Memory Vault is intended to manage useful personal and project knowledge with appropriate ownership and access controls. Do not place passwords, API keys or other secrets into ordinary notes or feedback.'],
  ['Can I use Quant Lab for live trading?', 'Quant Lab is intended for research, historical analysis and virtual paper-trading workflows. It is not authorization to connect a brokerage account or place live trades.'],
  ['Are Audiobook Studio and voice features always available?', 'Availability depends on the current release, supported providers, device permissions and service health. A workspace being visible does not guarantee every provider or device feature is operational.'],
 ]},
 { title: 'Privacy, feedback and community', items: [
  ['Is the Community Survey anonymous?', 'The survey is designed to store answers separately from your name, email address and RyanAI account identity. Avoid adding identifying or confidential details in free-text answers.'],
  ['How is Beta testing interest handled?', 'Beta registration is optional and separate from anonymous survey answers. Contact details are collected only when you provide them and explicitly agree to be contacted. Registration does not guarantee a place.'],
  ['What should I never submit?', 'Do not submit passwords, API keys, access tokens, financial account details, private customer data or sensitive personal information in the survey or Help Centre.'],
  ['How will RyanAI use my feedback?', 'Feedback is intended to inform product discovery, usability improvements and feature prioritisation. Survey responses do not grant permission to change your account, run tools, or deploy software.'],
  ['How can I suggest a feature or report a problem?', 'Use the Community Survey and describe the use case, expected result and the problem you encountered. Do not include secrets, private records or credentials.'],
  ['Does the Help Centre guarantee that a feature is live?', 'No. This page explains product concepts and intended safeguards. Actual availability should be confirmed in the relevant workspace and release notes.'],
 ]},
] as const;

export default function CommunityHelpPage() {
 const [query, setQuery] = useState('');
 const normalizedQuery = query.trim().toLowerCase();
 const filteredGroups = useMemo(() => faqGroups.map((group) => ({
  ...group,
  items: group.items.filter(([question, answer]) => !normalizedQuery || (question + ' ' + answer + ' ' + group.title).toLowerCase().includes(normalizedQuery)),
 })).filter((group) => group.items.length > 0), [normalizedQuery]);
 const resultCount = filteredGroups.reduce((total, group) => total + group.items.length, 0);
 return (
  <main className="min-h-full bg-[#0b1020] px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
   <div className="mx-auto max-w-4xl">
    <header className="overflow-hidden rounded-3xl border border-cyan-200/15 bg-gradient-to-br from-[#132a45] via-[#101b32] to-[#101322] p-6 shadow-2xl shadow-black/20 sm:p-10">
     <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><Sparkles className="h-4 w-4" aria-hidden="true" /> RyanAI Community</div>
     <h1 className="mt-5 text-3xl font-black leading-tight text-white sm:text-5xl">Community &amp; Help Centre</h1>
     <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">Find clear answers about RyanAI, its workspaces, responsible AI execution and the community initiative. These FAQs describe product direction and safeguards; availability varies by release.</p>
     <div className="mt-7 flex flex-wrap gap-3"><a href="#/survey" className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200">Share your feedback <ArrowRight className="h-4 w-4" /></a><span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300"><ShieldCheck className="h-4 w-4 text-cyan-200" /> Privacy-conscious by design</span></div>
    </header>
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7" aria-labelledby="faq-heading">
     <div className="flex items-center gap-2 text-cyan-200"><BookOpen className="h-5 w-5" aria-hidden="true" /><h2 id="faq-heading" className="text-xl font-bold text-white">Frequently asked questions</h2></div>
     <label htmlFor="faq-search" className="mt-5 block text-sm font-medium text-slate-200">Search the Help Centre</label>
     <div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" /><input id="faq-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search privacy, Gen-X, Quant Lab…" className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" /></div>
     <p className="mt-3 text-xs text-slate-500" role="status">{resultCount} {resultCount === 1 ? 'answer' : 'answers'} {normalizedQuery ? 'match your search.' : 'across five topics.'}</p>
     <div className="mt-5 space-y-6">{filteredGroups.map((group) => <section key={group.title} aria-label={group.title}><h3 className="border-b border-white/10 pb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">{group.title}</h3><div className="divide-y divide-white/10">{group.items.map(([question, answer]) => <details key={question} className="group py-4"><summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><span>{question}</span><span aria-hidden="true" className="text-lg leading-none text-cyan-200 transition group-open:rotate-45">+</span></summary><p className="mt-3 pr-6 text-sm leading-7 text-slate-400">{answer}</p></details>)}</div></section>)}</div>
     {resultCount === 0 && <p className="mt-6 rounded-xl border border-white/10 bg-slate-950/50 p-5 text-sm text-slate-400">No answers matched that search. Try another phrase or <a href="#/survey" className="font-semibold text-cyan-200 underline">send us your question</a>.</p>}
    </section>
    <footer className="py-8 text-center text-xs text-slate-600">RyanAI · Community &amp; Help Centre · 2026</footer>
   </div>
  </main>
 );
}
