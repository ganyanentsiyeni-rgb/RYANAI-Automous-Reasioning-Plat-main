import { AUTONOMOUS_REASONING_SKILL } from './autonomousReasoning.js';
import { ZA_GOVERNMENT_PROCUREMENT_SKILL } from '../agents/governmentProcurementAgent.js';
import {
  AGENT_PA_SKILL,
  SOVEREIGN_FIREWALL_SKILL,
  SELF_HEALING_SKILL,
  GENX_HARDCORE_SECURITY_SKILL
} from './agentPAScript.js';
import { ACTIVE_PA_SOURCED_SKILLS, PA_SOURCED_SKILLS } from './paSourcedSkills.js';

export type { AgentSkill } from './autonomousReasoning.js';
export type { PASourcedSkill, PASkillRisk, PASkillSourceType } from './paSourcedSkills.js';

export { AUTONOMOUS_REASONING_SKILL } from './autonomousReasoning.js';

export {
  AGENT_PA_SKILL,
  SOVEREIGN_FIREWALL_SKILL,
  SELF_HEALING_SKILL,
  GENX_HARDCORE_SECURITY_SKILL
} from './agentPAScript.js';

export { ACTIVE_PA_SOURCED_SKILLS, PA_SOURCED_SKILLS } from './paSourcedSkills.js';

export const ACTIVE_SKILLS = Object.freeze({
  autonomousReasoning: AUTONOMOUS_REASONING_SKILL,
  agentPaCore: AGENT_PA_SKILL,
  sovereignFirewall: SOVEREIGN_FIREWALL_SKILL,
  selfHealing: SELF_HEALING_SKILL,
  genXHardCoreSecurity: GENX_HARDCORE_SECURITY_SKILL,
  zaGovernmentProcurement: ZA_GOVERNMENT_PROCUREMENT_SKILL,
  paSourcedSkills: ACTIVE_PA_SOURCED_SKILLS,
});

export const RYANAI_SKILL_REGISTRY = Object.freeze({
  autonomousReasoning: 'AUTONOMOUS_REASONING_SKILL',
  agentPaCore: 'AGENT_PA_SKILL',
  sovereignFirewall: 'SOVEREIGN_FIREWALL_SKILL',
  selfHealing: 'SELF_HEALING_SKILL',
  genXHardCoreSecurity: 'GENX_HARDCORE_SECURITY_SKILL',
  zaGovernmentProcurement: 'ZA_GOVERNMENT_PROCUREMENT_SKILL',
  paSourcedSkills: PA_SOURCED_SKILLS,
});
