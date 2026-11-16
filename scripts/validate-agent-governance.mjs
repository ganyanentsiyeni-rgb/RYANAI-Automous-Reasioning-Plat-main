import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_POLICY } from '../mcp-server/tool-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(root, 'governance', 'agent-governance-policy.json');

export function validateAgentGovernancePolicy(policy, toolPolicy = TOOL_POLICY) {
  const errors = [];
  if (policy?.schema_version !== 1) errors.push('schema_version must be 1');
  if (policy?.default_decision !== 'DENY') errors.push('default_decision must be DENY');
  if (policy?.authority?.authorization_owner !== 'Gen-X and trusted API authorization boundary') errors.push('authorization must remain outside model control');
  for (const field of ['agents_may_grant_or_expand_permissions','agents_may_approve_their_own_actions','agents_may_merge','agents_may_deploy','agents_may_access_secrets','production_access']) {
    if (policy?.authority?.[field] !== false) errors.push(`authority.${field} must be false`);
  }
  if (policy?.runtime_enforcement?.profile_enforcement_status !== 'CONTRACT_ONLY') errors.push('agent profile runtime binding must not be overstated');
  if (policy?.runtime_enforcement?.sandbox_status !== 'NOT_ISOLATED') errors.push('project checks must not be described as sandbox-isolated');
  if (policy?.tool_policy?.run_project_checks?.decision !== 'ALLOW_IF_OPERATOR_ALLOWLISTED_IN_TRUSTED_LOCAL_RUNTIME') errors.push('project checks must remain local operator-allowlisted only');
  if (policy?.tool_policy?.operator_allowlist_required !== true) errors.push('operator allowlist must be required');
  if (policy?.tool_policy?.execution_time_api_reauthorization_required !== true) errors.push('execution-time API reauthorization must be required');
  if (policy?.audit?.persistence_status !== 'NOT_IMPLEMENTED_IN_THIS_CHANGE') errors.push('audit persistence status must not overstate implementation');
  if (policy?.audit?.secret_values_recorded !== false || policy?.audit?.raw_prompt_or_tool_payload_recorded !== false) errors.push('audit must exclude secrets and raw payloads');
  const reserved = new Set(['default_decision','operator_allowlist_required','delegated_identity_required_for_http','execution_time_api_reauthorization_required','audit_metadata_required']);
  const declaredTools = Object.keys(policy?.tool_policy ?? {}).filter((name) => !reserved.has(name));
  for (const name of Object.keys(toolPolicy)) {
    if (!declaredTools.includes(name)) errors.push(`tool ${name} is missing from governance policy`);
    const declared = policy?.tool_policy?.[name];
    if (declared && declared.capability !== toolPolicy[name].capability) errors.push(`tool ${name} capability does not match the runtime registry`);
    if (toolPolicy[name].audit !== 'required') errors.push(`tool ${name} must require audit metadata`);
    if (toolPolicy[name].secretAccess !== false || toolPolicy[name].productionAccess !== false) errors.push(`tool ${name} exceeds the approved access boundary`);
  }
  for (const name of declaredTools) if (!Object.hasOwn(toolPolicy, name)) errors.push(`governance policy declares unknown MCP tool ${name}`);
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const result = validateAgentGovernancePolicy(policy);
  if (!result.valid) {
    console.error('Agent governance policy validation failed:', result.errors.join('; '));
    process.exitCode = 1;
  } else {
    console.log('Agent governance policy valid: deny-by-default, Gen-X authority, operator allowlist, delegated reauthorization and non-production access boundaries verified.');
  }
}
