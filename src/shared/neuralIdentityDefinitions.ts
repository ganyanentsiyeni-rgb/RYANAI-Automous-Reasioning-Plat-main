import {
  BrainCircuit,
  Network,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type NeuralIdentityId = 'ryan' | 'alex' | 'genx' | 'specialist';

type NeuralIdentityDefinition = {
  name: string;
  role: string;
  description: string;
  icon: LucideIcon;
  tone: 'cyan' | 'violet' | 'emerald' | 'amber';
};

export const NEURAL_IDENTITIES: Record<NeuralIdentityId, NeuralIdentityDefinition> = {
  ryan: {
    name: 'Ryan',
    role: 'Primary assistant',
    description: 'RyanAI primary assistant identity',
    icon: BrainCircuit,
    tone: 'cyan',
  },
  alex: {
    name: 'Alex',
    role: 'Collaboration partner',
    description: 'Alex collaboration and task handoff identity',
    icon: Sparkles,
    tone: 'violet',
  },
  genx: {
    name: 'Gen-X',
    role: 'Governance authority',
    description: 'Gen-X policy and authorization identity',
    icon: ShieldCheck,
    tone: 'emerald',
  },
  specialist: {
    name: 'Specialist',
    role: 'Focused agent',
    description: 'Specialist reasoning and domain task identity',
    icon: Network,
    tone: 'amber',
  },
};
