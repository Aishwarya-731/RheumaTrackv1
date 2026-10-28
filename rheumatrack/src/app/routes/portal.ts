import type { Role } from '@/domain/types';

/**
 * Which sign-in page the user came through. It only decides where they land after signing in;
 * permissions always come from the server-side role (/roles/{uid}), never from this value.
 */
export type Portal = 'patient' | 'clinician';
const KEY = 'rt.portal';

export function setPortal(p: Portal): void {
  try {
    sessionStorage.setItem(KEY, p);
  } catch {
    /* ignore */
  }
}

export function readPortal(): Portal | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === 'clinician' || v === 'patient' ? v : null;
  } catch {
    return null;
  }
}

export function loginPathFor(path: string): string {
  return path.startsWith('/clinician') ? '/clinician/login' : '/login';
}

/** Landing page after sign-in. */
export function landingFor(role: Role, portal: Portal | null, from: string | null): string {
  const safeFrom = from && !/^\/(clinician\/)?(login|signup)/.test(from) && !from.startsWith('/reset-password') ? from : null;
  if (role === 'clinician') return safeFrom && (safeFrom.startsWith('/clinician') || safeFrom.startsWith('/settings')) ? safeFrom : '/clinician';
  if (portal === 'clinician') return '/clinician/access';
  return safeFrom && !safeFrom.startsWith('/clinician') ? safeFrom : '/';
}
