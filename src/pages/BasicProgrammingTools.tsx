import { useCallback, useEffect, useState } from 'react';
import { Code2, GitBranch, FlaskConical, FolderKanban, Network, MessagesSquare, ExternalLink, Copy, Check, RefreshCw, Plus, Search } from 'lucide-react';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

type Tool = { name: string; description: string; url: string };
type WorkspaceTab = 'projects' | 'research';
type StudioProject = {
  id: string; title: string; objective: string; projectType: string; status: string; createdAt: string;
  tasks: Array<{ id: string; title: string; taskType: string; status: string; approvalStatus?: string; assignedWorkerId?: string | null }>;
};
const groups: Array<{ title: string; description: string; icon: typeof Code2; tools: Tool[] }> = [
  { title: 'Code editors & IDEs', description: 'Choose an editor for quick changes, full projects or browser-based development.', icon: Code2, tools: [
    { name: 'Visual Studio Code', description: 'Extensible editor, debugging and integrated terminal.', url: 'https://code.visualstudio.com/' },
    { name: 'VS Code for the Web', description: 'Open a repository in a browser editor using GitHub.', url: 'https://vscode.dev/' },
    { name: 'JetBrains IDEs', description: 'IntelliJ IDEA, PyCharm and other full-featured IDEs.', url: 'https://www.jetbrains.com/ides/' },
    { name: 'Sublime Text', description: 'Fast, lightweight text editor.', url: 'https://www.sublimetext.com/' },
    { name: 'Vim', description: 'Keyboard-driven terminal editor.', url: 'https://www.vim.org/' },
    { name: 'Replit', description: 'Browser-based coding and collaboration environment.', url: 'https://replit.com/' },
  ]},
  { title: 'Version control & collaboration', description: 'Track changes, review code and collaborate on repositories.', icon: GitBranch, tools: [
    { name: 'Git', description: 'Local source control and project history.', url: 'https://git-scm.com/' },
    { name: 'GitHub', description: 'Repositories, pull requests, issues and CI workflows.', url: 'https://github.com/' },
    { name: 'GitLab', description: 'Source hosting and integrated DevOps workflows.', url: 'https://gitlab.com/' },
    { name: 'Bitbucket', description: 'Git repository hosting and code review.', url: 'https://bitbucket.org/' },
  ]},
  { title: 'Testing, APIs & environments', description: 'Inspect requests, validate services and understand runtime behaviour.', icon: FlaskConical, tools: [
    { name: 'Postman', description: 'Build and send HTTP requests and API tests.', url: 'https://www.postman.com/' },
    { name: 'Docker', description: 'Package applications and dependencies into containers.', url: 'https://www.docker.com/' },
    { name: 'Browser DevTools', description: 'Inspect layouts, JavaScript, storage and network traffic.', url: 'https://developer.chrome.com/docs/devtools/' },
    { name: 'Command line reference', description: 'Guides for shell commands, package managers and Git.', url: 'https://www.gnu.org/software/bash/manual/' },
  ]},
  { title: 'Project & planning tools', description: 'Organise issues, tasks, milestones and project documentation.', icon: FolderKanban, tools: [
    { name: 'Trello', description: 'Kanban boards and lightweight task tracking.', url: 'https://trello.com/' },
    { name: 'Jira', description: 'Issue tracking, backlogs and sprint planning.', url: 'https://www.atlassian.com/software/jira' },
    { name: 'Obsidian', description: 'Markdown notes and linked project documentation.', url: 'https://obsidian.md/' },
  ]},
  { title: 'Architecture & diagrams', description: 'Sketch flows, system boundaries and technical designs.', icon: Network, tools: [
    { name: 'draw.io', description: 'Flowcharts, architecture diagrams and technical sketches.', url: 'https://app.diagrams.net/' },
    { name: 'Miro', description: 'Collaborative visual whiteboards.', url: 'https://miro.com/' },
  ]},
  { title: 'Developer communication', description: 'Coordinate project updates and team discussions.', icon: MessagesSquare, tools: [
    { name: 'Slack', description: 'Team channels and engineering updates.', url: 'https://slack.com/' },
    { name: 'Discord', description: 'Community and project communication.', url: 'https://discord.com/' },
  ]},
];
const snippets = [
  { label: 'Git status', command: 'git status --short --branch' },
  { label: 'Create feature branch', command: 'git switch -c feat/your-change' },
  { label: 'Install Node dependencies', command: 'npm ci' },
  { label: 'Run project tests', command: 'npm test' },
  { label: 'Build project', command: 'npm run build' },
  { label: 'Check Docker containers', command: 'docker compose ps' },
];

export default function BasicProgrammingToolsPage() {
  const [copied, setCopied] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>('projects');
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch('/api/engineering/studio/native/projects');
      const payload = await response.json() as { projects?: StudioProject[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Project containers could not be loaded.');
      setProjects(payload.projects ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project containers could not be loaded.');
    } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load authenticated, owner-scoped project containers on mount
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  const visibleProjects = projects.filter(project => {
    const typeMatches = tab === 'research' ? project.projectType === 'research' : project.projectType !== 'research';
    const query = search.trim().toLowerCase();
    return typeMatches && (!query || (project.title + ' ' + project.objective + ' ' + project.id).toLowerCase().includes(query));
  });
  async function createContainer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || objective.trim().length < 5 || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const projectType = tab === 'research' ? 'research' : 'engineering';
      const response = await authenticatedFetch('/api/engineering/studio/native/projects', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), objective: objective.trim(), projectType,
          initialTasks: [{
            title: tab === 'research' ? 'Create research plan and evidence map' : 'Create project execution plan',
            objective: tab === 'research'
              ? 'Develop a sourced research plan, identify evidence requirements, assess uncertainty and define reviewable findings. Do not execute external side effects.'
              : 'Decompose this coding project into reviewable implementation tasks, dependencies and acceptance evidence. Do not execute external side effects.',
            taskType: 'studio.plan', priority: 10, requiredCapabilities: ['planning'],
          }],
        }),
      });
      const payload = await response.json() as { project?: { id: string }; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Container could not be created.');
      setNotice((tab === 'research' ? 'Research' : 'Project') + ' container ' + (payload.project?.id ?? 'created') + ' was saved to RyanAI Studio. Its planning task is queued for governed processing.');
      setTitle(''); setObjective('');
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Container could not be created.');
    } finally { setSaving(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(''), 1800); }
    catch { setCopied(''); }
  }
  return <section className="mx-auto max-w-7xl space-y-8 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="programming-tools-title">
    <header className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Developer workspace</p>
      <h1 id="programming-tools-title" className="mt-2 text-3xl font-bold text-white">Basic Programming Tools</h1>
      <p className="mt-3 text-sm leading-6 text-slate-400">A practical toolbox for coding, research, source control, API testing and technical collaboration. Projects and Research use RyanAI Studio's authenticated, persisted project containers; execution remains subject to the platform's approval controls.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <a href="#/studio" className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15"><Code2 className="h-4 w-4" /> Open RyanAI Studio</a>
        <a href="#/settings?section=plugin-integrations" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5">Manage integrations</a>
      </div>
    </header>

    <section aria-label="Project containers" className="rounded-2xl border border-cyan-300/15 bg-slate-900/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Project containers</h2><p className="mt-1 text-xs text-slate-400">Separate workspaces for active, pending and completed work. Records are persisted through the authenticated Studio API.</p></div>
        <button type="button" onClick={() => void loadProjects()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Project and research containers">
        <button type="button" role="tab" aria-selected={tab === 'projects'} onClick={() => { setTab('projects'); setSearch(''); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'projects' ? 'bg-cyan-300/15 text-cyan-100 ring-1 ring-cyan-300/30' : 'border border-white/10 text-slate-400'}`}><FolderKanban className="mr-2 inline h-4 w-4" />Projects</button>
        <button type="button" role="tab" aria-selected={tab === 'research'} onClick={() => { setTab('research'); setSearch(''); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'research' ? 'bg-violet-300/15 text-violet-100 ring-1 ring-violet-300/30' : 'border border-white/10 text-slate-400'}`}><FlaskConical className="mr-2 inline h-4 w-4" />Research</button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form onSubmit={createContainer} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <h3 className="font-semibold text-white">Create {tab === 'research' ? 'research' : 'coding project'} container</h3>
          <label className="mt-3 block text-xs text-slate-400">Container name<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder={tab === 'research' ? 'e.g. PostgreSQL worker lifecycle research' : 'e.g. RyanAI mobile workspace'} className="mt-1 w-full rounded-lg border border-white/10 bg-[#070a10] px-3 py-2.5 text-sm text-white" /></label>
          <label className="mt-3 block text-xs text-slate-400">Objective and context<textarea required minLength={5} maxLength={12000} value={objective} onChange={event => setObjective(event.target.value)} placeholder={tab === 'research' ? 'What needs to be investigated, compared or evidenced?' : 'What needs to be designed, implemented or fixed?'} className="mt-1 min-h-28 w-full rounded-lg border border-white/10 bg-[#070a10] p-3 text-sm text-white" /></label>
          <button type="submit" disabled={saving || !title.trim() || objective.trim().length < 5} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-2.5 text-sm font-semibold text-emerald-100 disabled:opacity-50"><Plus className="h-4 w-4" />{saving ? 'Saving…' : 'Create container'}</button>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Creation stores a project record and queues a planning task. It does not automatically run code, publish research, approve actions or deploy changes.</p>
        </form>
        <div className="min-w-0 rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-white">{tab === 'research' ? 'Research library' : 'Coding projects'}</h3><span className="text-xs text-slate-500">{visibleProjects.length} shown · {projects.length} total</span></div>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-[#070a10] px-3"><Search className="h-4 w-4 text-slate-500" /><input aria-label="Search project containers" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search containers…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white outline-none" /></label>
          {error && <p role="alert" className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/5 p-3 text-xs text-rose-200">{error}</p>}
          {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-3 text-xs text-emerald-200">{notice}</p>}
          <div className="mt-3 space-y-2">
            {visibleProjects.map(project => <article key={project.id} className="rounded-lg border border-white/10 bg-[#080b12] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-100">{project.title}</h4><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-cyan-200">{project.status}</span></div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{project.objective}</p>
              <p className="mt-2 text-[10px] text-slate-500">{project.projectType} · {project.tasks.length} task(s) · {new Date(project.createdAt).toLocaleDateString()}</p>
              {project.tasks.map(task => <div key={task.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-xs"><span className="text-slate-300">{task.title}</span><span className="text-slate-500">{task.status}{task.approvalStatus ? ' · approval ' + task.approvalStatus : ''}</span></div>)}
              <p className="mt-2 break-all font-mono text-[9px] text-slate-600">{project.id}</p>
            </article>)}
            {!loading && visibleProjects.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-5 text-center text-xs text-slate-500">No {tab === 'research' ? 'research' : 'coding'} containers found. Create one to start a tracked project.</p>}
            {loading && <p className="p-4 text-center text-xs text-slate-500">Loading persisted containers…</p>}
          </div>
        </div>
      </div>
    </section>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map(group => <article key={group.title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
        <div className="flex items-center gap-3"><span className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2 text-cyan-200"><group.icon className="h-5 w-5" /></span><h2 className="font-semibold text-white">{group.title}</h2></div>
        <p className="mt-3 text-xs leading-5 text-slate-400">{group.description}</p>
        <ul className="mt-4 space-y-3">{group.tools.map(tool => <li key={tool.name} className="border-t border-white/5 pt-3 first:border-0 first:pt-0">
          <a href={tool.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-100 hover:text-white">{tool.name}<ExternalLink className="h-3 w-3" /></a>
          <p className="mt-1 text-xs leading-5 text-slate-500">{tool.description}</p>
        </li>)}</ul>
      </article>)}
    </div>
    <article className="rounded-2xl border border-violet-300/15 bg-slate-900/60 p-5">
      <h2 className="font-semibold text-white">Command & code snippets</h2>
      <p className="mt-1 text-xs text-slate-400">Copy reference commands for use in your chosen development environment. Commands are not run by RyanAI.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {snippets.map(item => <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
          <div className="min-w-0"><p className="text-xs font-medium text-slate-300">{item.label}</p><code className="mt-1 block break-all text-xs text-violet-200">{item.command}</code></div>
          <button type="button" onClick={() => void copy(item.command)} aria-label={'Copy ' + item.label} className="shrink-0 rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5">{copied === item.command ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
        </div>)}
      </div>
    </article>
  </section>;
}
