import { NEURAL_IDENTITIES, type NeuralIdentityId } from './neuralIdentityDefinitions';
export type { NeuralIdentityId } from './neuralIdentityDefinitions';

type NeuralIdentityProps = {
  identity: NeuralIdentityId;
  compact?: boolean;
  className?: string;
};

/**
 * Consistent visual identity for RyanAI's collaborating intelligence roles.
 * This is a presentation primitive only; it does not assert runtime activity,
 * authorization, or task ownership.
 */
export default function NeuralIdentity({
  identity,
  compact = false,
  className = '',
}: NeuralIdentityProps) {
  const definition = NEURAL_IDENTITIES[identity];
  const Icon = definition.icon;

  return (
    <span
      className={`ryan-neural-identity ryan-neural-identity--${definition.tone} ${className}`.trim()}
      aria-label={`${definition.name}, ${definition.role}`}
      title={definition.description}
    >
      <Icon aria-hidden="true" className="ryan-neural-identity__icon" />
      <span className="ryan-neural-identity__copy">
        <span className="ryan-neural-identity__name">{definition.name}</span>
        {!compact && (
          <span className="ryan-neural-identity__role">{definition.role}</span>
        )}
      </span>
    </span>
  );
}
