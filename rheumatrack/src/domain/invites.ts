import type { ShareGrant, ShareInvite } from './types';

/**
 * Invitation lifecycle (docs/SHARING.md).
 *
 *   pending ──accept──► accepted ──revoke (patient) / remove (clinician)──► access ends
 *      │ ├──decline──► declined
 *      │ └──revoke───► revoked   (patient cancels before a response)
 *      └──14 days without a response──► expired (derived; enforced by the Security Rules)
 */
export const INVITE_TTL_DAYS = 14;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type EffectiveInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export function inviteExpiresAt(invite: Pick<ShareInvite, 'createdAt'>): number {
  return invite.createdAt + INVITE_TTL_MS;
}

export function effectiveInviteStatus(invite: Pick<ShareInvite, 'status' | 'createdAt'>, now: number = Date.now()): EffectiveInviteStatus {
  if (invite.status === 'pending' && now >= inviteExpiresAt(invite)) return 'expired';
  return invite.status;
}

export const INVITE_STATUS_LABEL: Record<EffectiveInviteStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
  expired: 'Expired',
};

/** True when the invitation still blocks a new invitation to the same clinician. */
export function isActiveInvite(invite: ShareInvite, shares: readonly ShareGrant[], now: number = Date.now()): boolean {
  const st = effectiveInviteStatus(invite, now);
  if (st === 'pending') return true;
  if (st === 'accepted') return shares.some((s) => s.inviteId === invite.id);
  return false;
}

export function findActiveInviteFor(
  invites: readonly ShareInvite[],
  shares: readonly ShareGrant[],
  clinician: { uid?: string | null; email: string },
  now: number = Date.now(),
): ShareInvite | undefined {
  const email = clinician.email.trim().toLowerCase();
  return invites.find(
    (i) =>
      ((clinician.uid && i.clinicianUid === clinician.uid) || i.clinicianEmail === email) &&
      isActiveInvite(i, shares, now),
  );
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** What a clinician can see once an invitation is accepted (shown to both parties). */
export const SHARED_ACCESS_DESCRIPTION =
  'Read-only access to movement sessions, symptom check-ins, calibration records, phone sensor recordings, trends and reports. Clinicians cannot change or delete anything.';
