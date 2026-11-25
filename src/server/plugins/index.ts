/**
 * Public API for the server plugin integration module.
 *
 * External server consumers must import plugin capabilities from this file.
 * Internal plugin implementation files may depend on one another directly.
 */
export { pluginRegistry, createDefaultPluginRegistry } from './pluginCatalog.js';
export { normalizePluginPreferences, type PluginPreferences, type PluginPreference } from './pluginPreference.js';
export { pluginRegistryRoutes } from './routes.js';
export { providerAuthorizationRoutes } from './providerAuthorizationRoutes.js';
export {
  providerHealthRoutes,
} from './providerHealthRoutes.js';
export { describeCapabilityState, type CapabilityState } from './capabilityState.js';
export {
  resolveProviderCapabilityState,
  type ProviderCapabilityState,
  type ProviderConnectionEvidence,
  type ProviderExecutionStatus,
  type ProviderAuthenticationStatus,
  type ProviderHealthStatus,
} from './providerCapabilityState.js';
export {
  readStoredProviderHealthEvidence,
  probeAuthenticatedProvider,
  type StoredProviderHealthEvidence,
  type ProviderHealthProbeResult,
} from './providerHealth.js';
