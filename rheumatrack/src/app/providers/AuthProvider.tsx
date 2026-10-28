import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browserTimeZone, DEFAULT_REMINDERS } from '@/domain/reminders';
import type { Role, UserProfile } from '@/domain/types';
import { toAppError } from '@/data/errors';
import type { AuthUser } from '@/data/services';
import { useServices } from './ServicesProvider';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Role read from the server-side roles collection; never from client state alone. */
  role: Role;
  profile: UserProfile | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth, data } = useServices();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<Role>('patient');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingName = useRef<string | null>(null);

  useEffect(() => {
    let profileUnsub: (() => void) | null = null;
    let roleUnsub: (() => void) | null = null;
    let cancelled = false;
    const unsub = auth.onChange((u) => {
      profileUnsub?.();
      profileUnsub = null;
      roleUnsub?.();
      roleUnsub = null;
      setUser(u);
      setError(null);
      if (!u) {
        setProfile(null);
        setRole('patient');
        setStatus('signed-out');
        return;
      }
      setStatus('loading');
      void (async () => {
        try {
          const [r, existing] = await Promise.all([data.getRole(u.uid), data.getProfile(u.uid)]);
          if (cancelled) return;
          if (!existing) {
            await data.createProfile(u.uid, {
              displayName: pendingName.current ?? u.displayName ?? '',
              email: u.email,
              reminders: { ...DEFAULT_REMINDERS, timezone: browserTimeZone() },
            });
            pendingName.current = null;
          }
          if (cancelled) return;
          setRole(r);
          // Live role: a role granted or removed by an administrator applies without signing out.
          roleUnsub = data.subscribeRole(
            u.uid,
            (live) => setRole(live),
            () => undefined,
          );
          profileUnsub = data.subscribeProfile(
            u.uid,
            (p) => {
              setProfile(p);
              if (p) setStatus('signed-in');
            },
            (e) => {
              setError(e.message);
              setStatus('error');
            },
          );
        } catch (e) {
          if (cancelled) return;
          setError(toAppError(e).message);
          setStatus('error');
        }
      })();
    });
    return () => {
      cancelled = true;
      profileUnsub?.();
      roleUnsub?.();
      unsub();
    };
  }, [auth, data, attempt]);

  // Clinicians keep their directory entry current so patients can find them by email.
  const directoryKey = role === 'clinician' && user && profile ? `${user.uid}|${user.email}|${profile.displayName}` : null;
  useEffect(() => {
    if (!directoryKey || !user || !profile) return;
    data
      .ensureClinicianDirectoryEntry({ uid: user.uid, email: user.email, displayName: profile.displayName || user.displayName || user.email })
      .catch((e: unknown) => console.warn('Could not update the clinician directory entry:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryKey, data]);

  const signIn = useCallback((email: string, password: string) => auth.signIn(email, password), [auth]);
  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      pendingName.current = displayName.trim();
      await auth.signUp(email, password, displayName);
    },
    [auth],
  );
  const signOut = useCallback(() => auth.signOut(), [auth]);
  const refreshUser = useCallback(async () => {
    const u = await auth.reload();
    if (u) {
      setUser(u);
      setRole(await data.getRole(u.uid));
    }
  }, [auth, data]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const value = useMemo(
    () => ({ status, user, role, profile, error, signIn, signUp, signOut, refreshUser, retry }),
    [status, user, role, profile, error, signIn, signUp, signOut, refreshUser, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For components rendered only inside protected routes. */
export function useSignedInUser(): { user: AuthUser; profile: UserProfile; role: Role } {
  const { user, profile, role } = useAuth();
  if (!user || !profile) throw new Error('useSignedInUser used outside a protected route');
  return { user, profile, role };
}
