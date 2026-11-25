import { Object.freeze } from 'node:util';

export type PASkillRisk = 'low' | 'medium';
export type PASkillSourceType = 'project' | 'vendor-pattern' | 'installed-skill';

export interface PASourcedSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sourceType: PASkillSourceType;
  readonly sourceRef: string;
  readonly capabilities: readonly string[];
  readonly mode: 'read-only' | 'propose';
  readonly risk: PASkillRisk;
  readonly enabled: boolean;
}

/**
 * PA Agent skill expansion is deliberately capability-first. Vendor emails are
 * treated as design signals, not as authorization to connect external services.
 * These skills can produce research/inspection proposals and evidence without
 * changing provider configuration, secrets, databases, or deployments.
 */
export const PA_SOURCED_SKILLS: readonly PASourcedSkill[] = Object.freeze([
  {
    id: 'pa-research',
    name: 'PA Research & Source Verification',
    description: 'Research time-sensitive external facts, extract relevant evidence, and preserve source provenance before proposing an action.',
    sourceType: 'vendor-pattern',
    sourceRef: 'Tavily emails: live search, extract/crawl and scheduled intelligence monitoring (Nov 2026)',
    capabilities: ['research.search', 'research.extract', 'evidence.record'],
    mode: 'read-only',
    risk: 'low',
    enabled: true,
  },
  {
    id: 'pa-observability-verification',
    name: 'PA Observability & Synthetic Verification',
    description: 'Turn runtime failures into evidence, investigation proposals, and post-change verification checks.',
    sourceType: 'vendor-pattern',
    sourceRef: 'Checkly emails: synthetic monitoring and failure-to-evidence-to-verification workflow (Nov 2026)',
    capabilities: ['health.inspect', 'diagnostics.run', 'verification.run', 'evidence.record'],
    mode: 'propose',
    risk: 'medium',
    enabled: true,
  },
  {
    id: 'pa-correction-to-guardrail',
    name: 'PA Correction-to-Guardrail',
    description: 'Convert validated operator corrections into regression-test and policy proposals so lessons become durable controls.',
    sourceType: 'vendor-pattern',
    sourceRef: 'Every email: repeated corrections become checks and guardrails (Nov 2026)',
    capabilities: ['policy.propose', 'tests.propose', 'evidence.record'],
    mode: 'propose',
    risk: 'low',
    enabled: true,
  },
  {
    id: 'pa-database-governance',
    name: 'PA Database Governance',
    description: 'Inspect migration, grant, RLS and database-readiness evidence without applying schema or permission changes.',
    sourceType: 'installed-skill',
    sourceRef: 'skills://plugins/supabase/supabase/skill.md',
    capabilities: ['database.inspect', 'migration.inspect', 'security.review', 'evidence.record'],
    mode: 'read-only',
    risk: 'medium',
    enabled: true,
  },
  {
    id: 'pa-edge-security-watch',
    name: 'PA Edge Security Watch',
    description: 'Translate infrastructure and edge-provider security notices into RyanAI-specific findings and upgrade proposals.',
    sourceType: 'vendor-pattern',
    sourceRef: 'Cloudflare email: cloudflared security upgrade notice (Oct 2026)',
    capabilities: ['security.advisory', 'dependency.inspect', 'risk.assess', 'evidence.record'],
    mode: 'propose',
    risk: 'medium',
    enabled: true,
  },
  {
    id: 'pa-provider-model-routing',
    name: 'PA Provider & Model Routing Review',
    description: 'Compare model/provider options against task, reliability, privacy, budget and evidence requirements before proposing routing changes.',
    sourceType: 'vendor-pattern',
    sourceRef: 'OpenRouter email proposal reviewed on 25 Nov 2026; integration remains paused pending separate approval',
    capabilities: ['model.compare', 'provider.compare', 'routing.propose', 'evidence.record'],
    mode: 'propose',
    risk: 'medium',
    enabled: false,
  },
  {
    id: 'pa-incident-evidence',
    name: 'PA Incident Evidence & Recovery',
    description: 'Assemble incident timelines from AgentRun, health, logs and deployment evidence and preserve recovery proof.',
    sourceType: 'project',
    sourceRef: 'RyanAI AI Inspector, AgentRun evidence and verification contracts',
    capabilities: ['incident.triage', 'timeline.build', 'recovery.verify', 'evidence.record'],
    mode: 'read-only',
    risk: 'low',
    enabled: true,
  },
]);

export const ACTIVE_PA_SOURCED_SKILLS = Object.freeze(
  PA_SOURCED_SKILLS.filter((skill) => skill.enabled),
);

export function getPASourcedSkillIds(): readonly string[] {
  return ACTIVE_PA_SOURCED_SKILLS.map((skill) => skill.id);
}
