import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export type OAuthProvider = 'google' | 'github';

export type AuthValue = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthValue | null>(null);
