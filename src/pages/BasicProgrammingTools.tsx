import { Code2, GitBranch, FlaskConical, FolderKanban, Network, MessagesSquare, ExternalLink, Copy, Check } from 'lucide-react';
import { useState } from 'react';

type Tool = { name: string; description: string; url: string; status?: string };
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
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(''), 1800); }
    catch { setCopied(''); }
  }
  return <section className="mx-auto max-w-7xl space-y-8 px-5 py-8 text-slate-100 sm:px-10" aria-labelledby="programming-tools-title">
    <header className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">RyanAI / Developer workspace</p>
      <h1 id="programming-tools-title" className="mt-2 text-3xl font-bold text-white">Basic Programming Tools</h1>
      <p className="mt-3 text-sm leading-6 text-slate-400">A practical toolbox for coding, source control, API testing, project planning and technical collaboration. External tools open in their own services; RyanAI does not claim to execute commands on this device.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <a href="#/studio" className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15"><Code2 className="h-4 w-4" /> Open RyanAI Studio</a>
        <a href="#/settings?section=plugin-integrations" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5">Manage integrations</a>
      </div>
    </header>
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
