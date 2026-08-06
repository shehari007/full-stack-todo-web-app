'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { PublicSettings, User } from '@/types/api';

interface AuthContextValue {
  user: User | null;
  settings: PublicSettings;
  isAuthenticated: boolean;
  /** Root or admin: the check the control-panel links are gated on. */
  isPrivileged: boolean;
  isRoot: boolean;
  /** Re-read the current user after a profile or security change. */
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

/**
 * Holds the signed-in user for client components.
 *
 * Seeded from the server render so the first paint already knows who is signed
 * in. A client-side fetch would flash a signed-out header on every load.
 *
 * This is presentation state only. It is never the basis for an authorisation
 * decision: the API re-checks the session and role on every request, so editing
 * `user.role` in devtools changes which buttons render and nothing else.
 */
export function AuthProvider({
  initialUser,
  settings,
  children,
}: {
  initialUser: User | null;
  settings: PublicSettings;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const { user: fresh } = await api.get<{ user: User }>('/api/auth/me');
      setUser(fresh);
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Cookies are cleared server-side regardless; a failure here should still
      // return the user to a signed-out state rather than trapping them.
    }
    setUser(null);
    // Discards cached server-rendered content for the previous user.
    router.refresh();
    router.push('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      settings,
      isAuthenticated: user !== null,
      isPrivileged: user?.role === 'root' || user?.role === 'admin',
      isRoot: user?.role === 'root',
      refresh,
      setUser,
      logout,
    }),
    [user, settings, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
