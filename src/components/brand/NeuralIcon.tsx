import type { LucideIcon } from 'lucide-react';

type NeuralIconProps = {
  icon: LucideIcon;
  active?: boolean;
  size?: 'desktop' | 'mobile' | 'brand' | 'mobile-brand';
};

/**
 * Shared RyanAI icon treatment: restrained cyan energy, a violet reasoning
 * accent, and a motion-safe halo for the currently selected workspace.
 */
export default function NeuralIcon({
  icon: Icon,
  active = false,
  size = 'desktop',
}: NeuralIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`ryan-neural-icon ryan-neural-icon--${size}${active ? ' is-active' : ''}`}
    >
      <Icon className="ryan-neural-icon__glyph" strokeWidth={1.8} />
    </span>
  );
}
