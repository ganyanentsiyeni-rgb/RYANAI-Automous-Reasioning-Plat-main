#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const render = read('render.yaml');
const renderConfig = parseYaml(render);
const stagingConfig = parseYaml(read('render.staging.yaml'));
const stagingProjects = Array.isArray(stagingConfig.projects) ? stagingConfig.projects : [];
const stagingServices = stagingProjects.flatMap((project) => (project.environments ?? []).flatMap((environment) => environment.services ?? []));
const stagingApi = stagingServices.find((service) => service.name === 'ryanai-api-staging');
const stagingRedis = stagingServices.find((service) => service.name === 'ryanai-redis-staging');
const stagingServiceNames = stagingServices.map((service) => service.name);
const renderProjects = Array.isArray(renderConfig.projects) ? renderConfig.projects : [];
const productionEnvironment = renderProjects.flatMap((project) => project.environments ?? []).find((environment) => environment.name === 'Production');
const u2ebEnvironment = renderProjects.flatMap((project) => project.environments ?? []).find((environment) => environment.name === 'U2EB');
const renderServices = Array.isArray(renderConfig.services)
  ? renderConfig.services
  : (productionEnvironment?.services ?? u2ebEnvironment?.services ?? []);
const u2ebServices = u2ebEnvironment?.services ?? [];
const u2ebDatabases = u2ebEnvironment?.databases ?? [];
const u2ebApi = u2ebServices.find((service) => service.name === 'ryanai-api-u2eb');
const u2ebWeb = u2ebServices.find((service) => service.name === 'ryanai-web-u2eb');
const u2ebRedis = u2ebServices.find((service) => service.name === 'ryanai-redis-u2eb');
const u2ebMcp = u2ebServices.find((service) => service.name === 'ryanai-mcp-u2eb');
const u2ebDatabase = u2ebDatabases.find((database) => database.name === 'ryanai_database');
const renderApi = productionEnvironment
  ? renderServices.find((service) => service.name === 'ryanai-api')
  : u2ebApi;
const renderWeb = productionEnvironment
  ? renderServices.find((service) => service.name === 'ryanai-web')
  : u2ebWeb;
const renderRedis = productionEnvironment
  ? renderServices.find((service) => service.name === 'ryanai-redis')
  : u2ebRedis;
// Keep Production names separate from the active U2EB service list so the
// isolation check does not compare U2EB resources against themselves.
const renderServiceNames = productionEnvironment
  ? renderServices.map((service) => service.name)
  : (Array.isArray(renderConfig.services) ? renderConfig.services.map((service) => service.name) : []);
const expectedRenderServiceNames = productionEnvironment
  ? ['ryanai-api', 'ryanai-web', 'ryanai-redis']
  : ['ryanai-api-u2eb', 'ryanai-web-u2eb', 'ryanai-redis-u2eb', 'ryanai-mcp-u2eb'];
const effectiveEnvVars = (service, config) => {
  const projects = Array.isArray(config?.projects) ? config.projects : [];
  const groups = new Map(projects.flatMap((project) => (project.environments ?? []).flatMap((environment) =>
    (environment.envVarGroups ?? []).map((group) => [group.name, group.envVars ?? []]),
  )));
  const referencedGroups = (service?.envVars ?? [])
    .filter((item) => item.fromGroup)
    .flatMap((item) => groups.get(item.fromGroup) ?? []);
  return [...referencedGroups, ...(service?.envVars ?? []).filter((item) => !item.fromGroup)];
};
const hasUniqueEnvKeys = (service, config) => {
  const keys = effectiveEnvVars(service, config).map((item) => item.key);
  return keys.length === new Set(keys).size;
};
const envVar = (service, key, config = renderConfig) =>
  effectiveEnvVars(service, config).find((item) => item.key === key);
const isSyncFalse = (service, key, config = renderConfig) => envVar(service, key, config)?.sync === false;
const isFalse = (service, key, config = renderConfig) => envVar(service, key, config)?.value === 'false';

const rootDockerfile = read('Dockerfile');
const apiDockerfile = read('Dockerfile.api');
const poolerAdapter = read('src/server/supabasePooler.ts');
const generatedClientCopy = read('scripts/copy-server-assets.mjs');
const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const featureFlags = read('src/server/comms/featureFlags.ts');
const commsPlugin = read('src/server/comms/index.ts');
const commsAttachments = read('src/server/comms/attachments.ts');
const twilioWebhook = read('src/server/routes/twilioWebhook.ts');
const slackInteractions = read('src/server/routes/slackInteractions.ts');
const railway = JSON.parse(read('railway.json'));
const renderRepair = read('.github/workflows/guarded-render-api-source-repair.yml');
const renderDeploy = read('.github/workflows/deploy-render.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const railwayDeploy = read('.github/workflows/deploy-railway.yml');

function dockerStage(source, preferredNames) {
  const stages = [...source.matchAll(/^FROM\s+.+?\s+AS\s+([\w-]+)\s*$/gim)];
  for (const preferredName of preferredNames) {
    const index = stages.findIndex((match) => match[1] === preferredName);
    if (index < 0) continue;
    const start = stages[index].index;
    const nextStart = stages[index + 1]?.index ?? source.length;
    return source.slice(start, nextStart);
  }
  return '';
}

const rootApiStage = dockerStage(rootDockerfile, ['api']);
const standaloneApiStage = dockerStage(apiDockerfile, ['api-runtime', 'api']);
const hasVerifiedCaContract = (stage) =>
  stage.includes('NODE_USE_SYSTEM_CA=1')
  && stage.includes('NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('SUPABASE_SSL_ROOT_CERT_PATH=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('COPY certs/supabase/prod-ca-2021.crt /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('update-ca-certificates')
  && stage.includes('test -s /etc/ssl/cert.pem')
  && stage.includes('test -s /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt')
  && stage.includes('scripts/verify-node-ca.sh')
  && !stage.includes('NODE_TLS_REJECT_UNAUTHORIZED');

const hasLegacyVercelIntegration =
  existsSync(new URL('../vercel.json', import.meta.url))
  || existsSync(new URL('../.github/workflows/deploy-vercel.yml', import.meta.url))
  || existsSync(new URL('../.github/workflows/vercel-deploy.yml', import.meta.url))
  || Boolean(packageJson.dependencies?.['@vercel/analytics'])
  || Boolean(packageJson.devDependencies?.['@vercel/analytics'])
  || ciWorkflow.includes('VERCEL_')
  || renderDeploy.includes('VERCEL_')
  || railwayDeploy.includes('VERCEL_');

const checks = [
  ['Vercel project, build package, deployment workflows, and CI credentials are absent', !hasLegacyVercelIntegration],
  ['Render Blueprint declares services through a supported top-level or project-environment list', Array.isArray(renderConfig.services) || renderProjects.some((project) => (project.environments ?? []).some((environment) => Array.isArray(environment.services)))],
  ['Render Blueprint declares exactly the API, web, and Redis resources', renderServices.length === expectedRenderServiceNames.length && expectedRenderServiceNames.every((name) => renderServiceNames.includes(name)) && new Set(renderServiceNames).size === 3],
  ['Render API and web environment variable keys are unique', hasUniqueEnvKeys(renderApi, renderConfig) && hasUniqueEnvKeys(renderWeb, renderConfig) && hasUniqueEnvKeys(u2ebMcp, renderConfig)],
  ['Render API and web use the official repository and main branch', renderApi?.repo === 'https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' && renderWeb?.repo === renderApi?.repo && renderApi?.branch === 'main' && renderWeb?.branch === 'main'],
  ['Render API uses the standalone Docker image and /health', renderApi?.runtime === 'docker' && renderApi?.dockerfilePath === './Dockerfile.api' && renderApi?.healthCheckPath === '/health'],
  ['Render web is the live-aligned Static Site and publishes the Vite dist output', renderWeb?.runtime === 'static' && renderWeb?.buildCommand === 'npm ci --legacy-peer-deps && npm run build:web' && renderWeb?.staticPublishPath === './dist' && !renderWeb?.dockerfilePath && !renderWeb?.dockerTarget && !renderWeb?.healthCheckPath],
  ['Render API, web, and Redis are in Oregon', renderApi?.region === 'oregon' && renderRedis?.region === 'oregon' && Array.isArray(renderRedis?.ipAllowList) && renderRedis.ipAllowList.length === 0],
  ['Render API and web auto-deploy remain disabled', renderApi?.autoDeployTrigger === 'off' && renderWeb?.autoDeployTrigger === 'off'],
  ['Render web points to the official API service through a dynamic hostname reference', envVar(renderWeb, 'VITE_API_BASE_URL', renderConfig)?.fromService?.name === (productionEnvironment ? 'ryanai-api' : 'ryanai-api-u2eb') && envVar(renderWeb, 'VITE_API_BASE_URL', renderConfig)?.fromService?.envVarKey === 'RENDER_EXTERNAL_HOSTNAME'],
  ['Render does not override the API Docker command', !renderApi?.dockerCommand],
  ['Render does not run automatic Prisma migrations during API deployment', !renderApi?.preDeployCommand && !render.includes('prisma migrate deploy')],
  ['Render requires the exact protected Supabase Session Pooler hostname', isSyncFalse(renderApi, 'SUPABASE_SESSION_POOLER_HOST', renderConfig) && !/aws-[^\s]+\.pooler\.supabase\.com/.test(render)],
  ['Render restores the optional pooled audiobook database setting', !productionEnvironment || isSyncFalse(renderApi, 'AUDIOBOOK_DATABASE_URL', renderConfig)],
  ['Render restores the optional direct audiobook migration database setting', !productionEnvironment || isSyncFalse(renderApi, 'AUDIOBOOK_DATABASE_URL_UNPOOLED', renderConfig)],
  ['Render keeps communications disabled by default', isFalse(renderApi, 'COMMUNICATIONS_ENABLED', renderConfig)],
  ['Render keeps communication attachments disabled by default', isFalse(renderApi, 'COMMUNICATION_ATTACHMENTS_ENABLED', renderConfig)],
  ['Render keeps malware scanning and orphan cleanup disabled by default', isFalse(renderApi, 'ATTACHMENT_SCANNER_ENABLED', renderConfig) && isFalse(renderApi, 'ATTACHMENT_ORPHAN_CLEANUP_ENABLED', renderConfig)],
  ['Both production API Docker targets use system and Supabase CA roots with verified TLS', hasVerifiedCaContract(rootApiStage) && hasVerifiedCaContract(standaloneApiStage)],
  ['Neither API runtime image disables TLS certificate verification', !rootApiStage.includes('NODE_TLS_REJECT_UNAUTHORIZED') && !standaloneApiStage.includes('NODE_TLS_REJECT_UNAUTHORIZED')],
  ['Both API runtime images execute the CA validation wrapper before the server', rootApiStage.includes('exec sh scripts/verify-node-ca.sh') && standaloneApiStage.includes('exec sh scripts/verify-node-ca.sh')],
  ['Supabase Session Pooler uses full TLS and strict certificate acceptance', poolerAdapter.includes("database.searchParams.set('sslmode', 'verify-full')") && poolerAdapter.includes("database.searchParams.set('sslaccept', 'strict')")],
  ['Server build copies and verifies the generated audiobook Prisma runtime client', packageJson.scripts['build:server'] === 'tsc -p tsconfig.server.json && node scripts/copy-server-assets.mjs' && generatedClientCopy.includes("new URL('../src/generated/audiobook-prisma/', import.meta.url)") && generatedClientCopy.includes("new URL('index.js', generatedClientSource)") && generatedClientCopy.includes("new URL('../dist/server/generated/audiobook-prisma/', import.meta.url)") && generatedClientCopy.includes('await access(generatedClientEntry)') && generatedClientCopy.includes('await cp(generatedClientSource, generatedClientDestination') && generatedClientCopy.includes('recursive: true')],
  ['Example environment defaults keep communications and uploads disabled', envExample.includes('COMMUNICATIONS_ENABLED=false') && envExample.includes('COMMUNICATION_ATTACHMENTS_ENABLED=false') && envExample.includes('ATTACHMENT_SCANNER_ENABLED=false') && envExample.includes('ATTACHMENT_ORPHAN_CLEANUP_ENABLED=false')],
  ['Communications and attachment switches require exact explicit opt-in', featureFlags.includes("process.env.COMMUNICATIONS_ENABLED === 'true'") && featureFlags.includes("process.env.COMMUNICATION_ATTACHMENTS_ENABLED === 'true'") && featureFlags.includes("process.env.ATTACHMENT_SCANNER_ENABLED === 'true'")],
  ['Comms, Twilio, and Slack plugins fail closed when communications are disabled', commsPlugin.includes('if (!isCommunicationsEnabled())') && twilioWebhook.includes('if (!isCommunicationsEnabled())') && slackInteractions.includes('if (!isCommunicationsEnabled())')],
  ['Comms attachment routes and storage helpers fail closed when uploads are disabled', (commsPlugin.split('areCommunicationAttachmentsEnabled()').length - 1) >= 5 && (commsAttachments.split('areCommunicationAttachmentsEnabled()').length - 1) >= 2],
  ['Render API source repair workflow is manual, exact-main gated, credential-gated, and does not deploy', renderRepair.includes('workflow_dispatch:') && renderRepair.includes("inputs.confirmation == 'REPAIR-ONLY'") && renderRepair.includes('TARGET_SHA') && renderRepair.includes('check-runs') && renderRepair.includes('RENDER_API_KEY') && renderRepair.includes('--request PATCH') && !renderRepair.includes('workflow_run:') && !renderRepair.includes('/deploys') && renderRepair.includes('https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main') && !renderRepair.includes('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat')],
  ['Render API config audit runs only after the core CI dependencies', ciWorkflow.includes('render-api-config-audit:') && ciWorkflow.includes('needs: [validate, subprojects, integration, issue-435-supabase]') && ciWorkflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'")],
  ['Render CI configuration audit is read-only and checks the authorised source without deploying', ciWorkflow.includes('GET only') && ciWorkflow.includes('Report configuration drift without changing the service') && ciWorkflow.includes('https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main') && !ciWorkflow.includes('--request PATCH') && !ciWorkflow.includes('/deploys')],
  ['Render deployment requires explicit enablement and approval', renderDeploy.includes("vars.RENDER_STAGING_DEPLOY_ENABLED == 'true'") && renderDeploy.includes("vars.RENDER_STAGING_ISOLATION_CONFIRMED == 'true'")],
  ['Render staging deploys only the exact open PR head after CI/security passes', renderDeploy.includes('commits/${TARGET_SHA}/pulls') && renderDeploy.includes('head.sha == $sha') && renderDeploy.includes('check-runs') && renderDeploy.includes('conclusion == "success"') && renderDeploy.includes('inputs.confirmation == \'STAGE\'')],
  ['Render staging deploy refuses production service IDs and verifies staging service identity', renderDeploy.includes('RENDER_STAGING_SERVICE_ID') && renderDeploy.includes('ryanai-staging') && renderDeploy.includes('srv-dbk4giu7bikc7394a4r0')],
  ['Railway uses Dockerfile.api and /health', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Render is the default frontend and API delivery provider', renderWeb?.runtime === 'static' && renderApi?.runtime === 'docker'],
  ['Railway is the default Docker and persistent-workload provider', railway.build?.dockerfilePath === 'Dockerfile.api' && railway.deploy?.healthcheckPath === '/health'],
  ['Railway staging deploy is manual, limited to exact open PR heads, and isolated', railwayDeploy.includes('workflow_dispatch:') && !railwayDeploy.includes('workflow_run:') && railwayDeploy.includes("inputs.confirmation == 'STAGE'") && railwayDeploy.includes("vars.RAILWAY_STAGING_ISOLATION_CONFIRMED == 'true'") && railwayDeploy.includes('RAILWAY_STAGING_PROJECT_ID') && railwayDeploy.includes('RAILWAY_STAGING_ENVIRONMENT_ID') && railwayDeploy.includes('commits/${TARGET_SHA}/pulls')],
];

const stagingEnvVar = (key) => envVar(stagingApi, key, stagingConfig);
const stagingSyncFalse = (key) => stagingEnvVar(key)?.sync === false;
const stagingFalse = (key) => stagingEnvVar(key)?.value === 'false';
checks.push(
  ['The active Render Blueprint is a protected U2EB-only environment with no Production resources declared', renderProjects.length === 1 && !productionEnvironment && u2ebEnvironment?.permissions?.protection === 'enabled'],
  ['Render Blueprint uses the currently authorised GitHub repository for RyanAI self-integration', render.includes('https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main') && !render.includes('RyanAI-Automated/RYANAI-Automous-Reasioning-Plat')],
  ['Staging Blueprint contains exactly the staging API and staging Redis resources', stagingServices.length === 2 && stagingServiceNames.includes('ryanai-api-staging') && stagingServiceNames.includes('ryanai-redis-staging') && new Set(stagingServiceNames).size === 2],
  ['Staging API uses the authorised repository, main branch, Dockerfile.api, and liveness endpoint', stagingApi?.repo === 'https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' && stagingApi?.branch === 'main' && stagingApi?.runtime === 'docker' && stagingApi?.dockerfilePath === './Dockerfile.api' && stagingApi?.healthCheckPath === '/health'],
  ['Staging API is explicitly classified as staging and does not auto-deploy', stagingEnvVar('NODE_ENV')?.value === 'staging' && stagingApi?.autoDeployTrigger === 'off'],
  ['Staging database, Supabase URL, pooler host, publishable key, and CORS origin require explicit values', ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SESSION_POOLER_HOST', 'SUPABASE_PUBLISHABLE_KEY', 'CORS_ORIGINS'].every(stagingSyncFalse)],
  ['Staging API does not generate or hardcode authentication secrets', !stagingApi?.envVars?.some((item) => item.generateValue === true || item.key === 'JWT_SECRET')],
  ['Staging Redis is a separate staging resource in Oregon with private-only ingress', stagingRedis?.type === 'keyvalue' && stagingRedis?.region === 'oregon' && Array.isArray(stagingRedis?.ipAllowList) && stagingRedis.ipAllowList.length === 0 && stagingApi?.envVars?.some((item) => item.key === 'REDIS_URL' && item.fromService?.name === 'ryanai-redis-staging')],
  ['Staging disables schedulers, alerts, communications, attachments, scanning, and cleanup by default', ['SCHEDULER_ENABLED', 'ALERTS_ENABLED', 'COMMUNICATIONS_ENABLED', 'COMMUNICATION_ATTACHMENTS_ENABLED', 'ATTACHMENT_SCANNER_ENABLED', 'ATTACHMENT_ORPHAN_CLEANUP_ENABLED'].every(stagingFalse)],
  ['U2EB Blueprint declares exactly the API, web, MCP, and Redis resources without a managed database', u2ebServices.length === 4 && new Set(u2ebServices.map((service) => service.name)).size === 4 && Boolean(u2ebMcp) && !u2ebDatabase],
  ['U2EB MCP uses the dedicated Docker service, manual deployment, health endpoint, and authorised API origin', u2ebMcp?.runtime === 'docker' && u2ebMcp?.dockerfilePath === './mcp-server/Dockerfile' && u2ebMcp?.healthCheckPath === '/health' && u2ebMcp?.autoDeployTrigger === 'off' && u2ebMcp?.repo === 'https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main' && envVar(u2ebMcp, 'RYANAI_API_BASE_URL', renderConfig)?.value === 'https://ryanai-api-u2eb.onrender.com'],
  ['U2EB MCP explicitly allows the currently provisioned Render hostname and test frontend origin', envVar(u2ebMcp, 'MCP_ALLOWED_HOSTS', renderConfig)?.value?.split(',').includes('ryanai-mcp-u2eb-u2eb.onrender.com') && envVar(u2ebMcp, 'MCP_ALLOWED_ORIGINS', renderConfig)?.value?.includes('https://ryanai-web-u2eb.onrender.com')],
  ['U2EB API and MCP require the same separately managed delegation and service credentials', ['RYANAI_MCP_DELEGATION_SECRET', 'RYANAI_MCP_SERVICE_TOKEN'].every((key) => isSyncFalse(u2ebApi, key, renderConfig) && isSyncFalse(u2ebMcp, key, renderConfig))],
  ['U2EB API health observer targets the dedicated MCP health endpoint', envVar(u2ebApi, 'RYANAI_MCP_HEALTH_URL', renderConfig)?.value === 'https://ryanai-mcp-u2eb-u2eb.onrender.com/health'],
  ['U2EB API adopts the existing Docker service and remains manual-deploy only', u2ebApi?.runtime === 'docker' && u2ebApi?.dockerfilePath === './Dockerfile.api' && u2ebApi?.healthCheckPath === '/health' && u2ebApi?.autoDeployTrigger === 'off' && u2ebApi?.repo === 'https://github.com/ganyanentsiyeni-rgb/RYANAI-Automous-Reasioning-Plat-main'],
  ['U2EB API receives PostgreSQL and Redis URLs through resource references, not hardcoded credentials', isSyncFalse(u2ebApi, 'DATABASE_URL', renderConfig) && envVar(u2ebApi, 'REDIS_URL', renderConfig)?.fromService?.name === 'ryanai-redis-u2eb' && envVar(u2ebApi, 'REDIS_URL', renderConfig)?.fromService?.property === 'connectionString'],
  ['U2EB API is staging-classified and keeps schedulers, alerts, and outbound communications disabled', envVar(u2ebApi, 'NODE_ENV', renderConfig)?.value === 'staging' && ['SCHEDULER_ENABLED', 'ALERTS_ENABLED', 'COMMUNICATIONS_ENABLED', 'COMMUNICATION_ATTACHMENTS_ENABLED', 'ATTACHMENT_SCANNER_ENABLED', 'ATTACHMENT_ORPHAN_CLEANUP_ENABLED'].every((key) => envVar(u2ebApi, key, renderConfig)?.value === 'false')],
  ['U2EB web uses the existing static site and dynamically references the U2EB API hostname', u2ebWeb?.runtime === 'static' && u2ebWeb?.buildCommand === 'npm ci --legacy-peer-deps && npm run build:web' && u2ebWeb?.staticPublishPath === './dist' && u2ebWeb?.autoDeployTrigger === 'off' && envVar(u2ebWeb, 'VITE_API_BASE_URL', renderConfig)?.fromService?.name === 'ryanai-api-u2eb' && envVar(u2ebWeb, 'VITE_API_BASE_URL', renderConfig)?.fromService?.envVarKey === 'RENDER_EXTERNAL_HOSTNAME'],
  ['U2EB web receives the authorised Supabase project URL and requires an explicitly supplied browser key', envVar(u2ebWeb, 'VITE_SUPABASE_URL', renderConfig)?.sync === false && (isSyncFalse(u2ebWeb, 'VITE_SUPABASE_PUBLISHABLE_KEY', renderConfig) || isSyncFalse(u2ebWeb, 'VITE_SUPABASE_ANON_KEY', renderConfig))],
  ['U2EB Redis retains its existing name and Oregon region without changing database plan or credentials', u2ebRedis?.type === 'keyvalue' && u2ebRedis?.region === 'oregon' && Array.isArray(u2ebRedis?.ipAllowList) && u2ebRedis.ipAllowList.length === 0 && !u2ebDatabase],
  ['U2EB resource names do not overlap Production or the isolated staging Blueprint', !u2ebServices.some((service) => renderServiceNames.includes(service.name) || stagingServiceNames.includes(service.name)) && !stagingServiceNames.includes('ryanai-redis-u2eb')],
  ['Production and staging Blueprint resource names do not overlap', !renderServiceNames.some((name) => stagingServiceNames.includes(name))],
);

for (const [name, passed] of checks) console.log((passed ? 'PASS' : 'FAIL') + ' | ' + name);
const failed = checks.filter(([, passed]) => !passed);
console.log('\nDeployment contract validation: ' + (checks.length - failed.length) + '/' + checks.length + ' passed.');
if (failed.length) process.exitCode = 1;
