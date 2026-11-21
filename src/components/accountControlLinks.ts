import {
  CircleHelp,
  ClipboardList,
  Plug,
  Settings2,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

export const ACCOUNT_CONTROL_LINKS = [
  { label: 'Profile & account preferences', description: 'Your name, language, voice and workspace defaults', href: '#/settings', icon: UserRound },
  { label: 'Personalization & AI preferences', description: 'Assistant behaviour, model and voice preferences', href: '#/settings?section=copilot-behavior-settings-title', icon: Settings2 },
  { label: 'Security & sessions', description: 'Password, email verification and other signed-in devices', href: '#/settings?section=account-security-title', icon: ShieldCheck },
  { label: 'Connected integrations', description: 'GitHub authorization and available integrations', href: '#/settings?section=github-settings-title', icon: Plug },
  { label: 'Community Survey', description: 'Share feedback to improve RyanAI', href: '#/survey', icon: ClipboardList },
  { label: 'Help & support', description: 'Guidance and frequently asked questions', href: '#/help', icon: CircleHelp },
] as const;
