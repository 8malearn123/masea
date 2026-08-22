import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from '@masiat/shared';
import { supabase } from '@/lib/supabase';
import {
  clearDemo,
  demoProfile,
  demoSession,
  findDemoAccount,
  loadDemo,
  saveDemo,
} from '@/lib/demo';

interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

async function loadProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return (data as UserProfile) ?? null;
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,

  init: async () => {
    const demo = loadDemo();
    if (demo) {
      set({ session: demoSession(demo), profile: demoProfile(demo), loading: false });
      return;
    }

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const profile = session ? await loadProfile(session.user.id) : null;
    set({ session, profile, loading: false });

    supabase.auth.onAuthStateChange(async (_event, s) => {
      const p = s ? await loadProfile(s.user.id) : null;
      set({ session: s, profile: p });
    });
  },

  signIn: async (email, password) => {
    const demo = findDemoAccount(email, password);
    if (demo) {
      saveDemo(demo);
      set({ session: demoSession(demo), profile: demoProfile(demo) });
      return {};
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  },

  signOut: async () => {
    clearDemo();
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },
}));
