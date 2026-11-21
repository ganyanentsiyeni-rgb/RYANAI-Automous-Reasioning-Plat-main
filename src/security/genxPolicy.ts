export type GenXDecision = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
export type GenXAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'NETWORK' | 'CREDENTIAL_ACCESS';

export interface GenXSecurityEvent {
  agentId: string;
  principal: string;
  toolName: string;
  action: GenXAction;
  target?: string;
  command?: string;
  environment?: 'development' | 'staging' | 'production';
  /** Set only by trusted API handlers after Supabase verification; never from model/tool input. */
  actorType?: 'human' | 'agent' | 'service';
  /** Trusted route-only context: true only after requireOwner succeeds. */
  ownerAuthorized?: boolean;
  /** True only after the owner has supplied the request-specific confirmation phrase. */
  ownerConfirmed?: boolean;
}

export interface GenXPolicyResult {
  decision: GenXDecision;
  ruleId: string;
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const BLOCKED_TOOL_NAMES = new Set([
  'execute_shell_command', 'shell', 'terminal', 'raw_exec', 'run_command',
  'metasploit', 'msfconsole', 'msfvenom', 'sqlmap', 'hydra', 'medusa',
  'john', 'hashcat', 'aircrack-ng', 'bettercap', 'ettercap', 'responder',
  'masscan', 'nmap', 'crackmapexec', 'netexec', 'impacket', 'bloodhound',
  'mimikatz', 'lazagne', 'evil-winrm', 'empire',
]);

const SAFE_READ_ONLY_TOOLS = new Set([
  'system_diagnostics', 'read_workspace_file', 'query_stackoverflow_agents',
  'security_status', 'trivy_scan', 'clamav_scan', 'dependency_audit',
  'za_public_procurement_data',
  'mcp_tool_registry', 'mcp_repository_status', 'mcp_platform_health', 'mcp_stack_manifest',
]);

const SENSITIVE_TARGET = /(secret|credential|token|private.?key|password|\.env|vault)/i;
const COMMAND_CONTROL = /[;&|<>\x60\n\r]|\$\(|\$\{|\\\\|(^|\s)(sudo|su|chmod|chown|curl|wget|nc|ncat|netcat|ssh|scp|sftp|powershell|pwsh|cmd\.exe|bash|sh|python|node|perl|ruby|php|ftp|telnet|iptables|ufw|netsh|reg)(\s|$)/i;

export function evaluateGenXSecurityEvent(event: GenXSecurityEvent): GenXPolicyResult {
  const tool = event.toolName.trim().toLowerCase();
  if (!event.agentId.trim() || !event.principal.trim() || !tool) {
    return { decision: 'DENY', ruleId: 'GX-IDENTITY-001', reason: 'Agent and principal identity are mandatory.', severity: 'HIGH' };
  }
  // A human may propose the dedicated isolated test runner, but execution is
  // never auto-authorized here. REQUIRE_APPROVAL keeps the request behind the
  // existing owner approval endpoint; production and arbitrary commands remain denied.
  if (event.command === undefined && event.action === 'EXECUTE' &&
      tool === 'test_runner' && event.target === 'pa:isolated-test-suite' &&
      event.actorType === 'human' &&
      (event.environment === 'development' || event.environment === 'staging')) {
    return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-ISOLATED-TEST-APPROVAL-001', reason: 'The isolated test runner may be proposed in development or staging, but requires explicit human approval before execution.', severity: 'HIGH' };
  }
  if (event.command !== undefined || event.action === 'EXECUTE' || BLOCKED_TOOL_NAMES.has(tool)) {
    return { decision: 'DENY', ruleId: 'GX-EXEC-001', reason: 'Arbitrary command execution and offensive security tooling are disabled by Gen-X policy.', severity: 'CRITICAL' };
  }
  if (event.action === 'CREDENTIAL_ACCESS' || SENSITIVE_TARGET.test(event.target ?? '')) {
    return { decision: 'DENY', ruleId: 'GX-SECRETS-001', reason: 'Agents cannot read or export credentials, secrets, private keys, or environment files.', severity: 'CRITICAL' };
  }
  // Validate untrusted target strings before granting any read-only tool exception.
  // Otherwise a nominally safe reader could receive shell-control or injection payloads.
  if (event.target !== undefined && COMMAND_CONTROL.test(event.target)) {
    return { decision: 'DENY', ruleId: 'GX-INJECTION-001', reason: 'Target contains shell-control or command-injection syntax.', severity: 'HIGH' };
  }
  // Owner-confirmed lifecycle request records are allowed only through the
  // owner-guarded API route. This authorizes appending request/audit events;
  // it does not authorize a Supabase Auth mutation or agent execution.
  if (event.toolName === 'ryanai_account_lifecycle' && event.actorType === 'human' &&
      event.ownerAuthorized === true && event.action === 'CREATE' &&
      /^auth\.users\/[0-9a-f-]{36}$/i.test(event.target ?? '')) {
    return { decision: 'ALLOW', ruleId: 'GX-OWNER-LIFECYCLE-REQUEST-001', reason: 'Verified owner may create a pending account-lifecycle request record; no account mutation is authorized by this rule.', severity: 'HIGH' };
  }
  if (event.toolName === 'ryanai_account_lifecycle' && event.actorType === 'human' &&
      event.ownerAuthorized === true && event.ownerConfirmed === true && event.action === 'UPDATE' &&
      /^auth\.users\/[0-9a-f-]{36}$/i.test(event.target ?? '')) {
    return { decision: 'ALLOW', ruleId: 'GX-OWNER-LIFECYCLE-CONFIRM-001', reason: 'Verified owner explicitly confirmed the lifecycle request record; no account mutation is authorized by this rule.', severity: 'HIGH' };
  }
  // Authenticated human requests may manage only their own Memory Vault records.
  // Agent/service callers do not inherit this exception; their mutations still require approval.
  if (event.actorType === 'human' && event.toolName === 'api_user_memory' && event.target === 'self' &&
      ['READ', 'CREATE', 'UPDATE', 'DELETE'].includes(event.action)) {
    return { decision: 'ALLOW', ruleId: 'GX-HUMAN-MEMORY-001', reason: "Verified user action is limited to that user's own memory records.", severity: 'LOW' };
  }
  if (event.action === 'DELETE' && event.environment === 'production') {
    return { decision: 'DENY', ruleId: 'GX-PROD-DELETE-001', reason: 'Production deletion is prohibited for autonomous agents.', severity: 'CRITICAL' };
  }
  // A direct, authenticated API reasoning request is explicit user consent to use
  // the configured reasoning providers. It does not authorize arbitrary network access.
  if (event.actorType === 'human' && event.toolName === 'api_reasoning_request' &&
      event.action === 'NETWORK' && event.target === 'configured-approved-provider') {
    return { decision: 'ALLOW', ruleId: 'GX-HUMAN-REASONING-001', reason: 'Verified user requested reasoning through the configured provider policy.', severity: 'LOW' };
  }
  // Aerial development inference is an explicit authenticated-human request against
  // the configured development runtime. Staging/production remains approval-gated.
  if (event.actorType === 'human' && event.toolName === 'aerial_ai_ran_inference' &&
      event.action === 'NETWORK' && event.target === 'configured-aerial-runtime' &&
      event.environment === 'development') {
    return { decision: 'ALLOW', ruleId: 'GX-HUMAN-AERIAL-DEV-001', reason: 'Verified user requested inference through the configured development Aerial runtime.', severity: 'LOW' };
  }
  if (event.action === 'CREATE' || event.action === 'UPDATE' || event.action === 'DELETE' || event.action === 'NETWORK') {
    return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-HIL-001', reason: 'Mutating or network actions require an authenticated human approval and scoped credentials.', severity: 'HIGH' };
  }
  if (event.action === 'READ' && SAFE_READ_ONLY_TOOLS.has(tool)) {
    return { decision: 'ALLOW', ruleId: 'GX-READ-001', reason: 'Known read-only tool is allowed within its own access controls.', severity: 'LOW' };
  }
  return { decision: 'REQUIRE_APPROVAL', ruleId: 'GX-DEFAULT-DENY-001', reason: 'Unknown tools and actions are not trusted by default.', severity: 'MEDIUM' };
}

export function isGenXOffensiveTool(toolName: string): boolean {
  return BLOCKED_TOOL_NAMES.has(toolName.trim().toLowerCase());
}
