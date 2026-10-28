import { Share2, ShieldCheck, UserX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSignedInUser } from '@/app/providers/AuthProvider';
import { useServices } from '@/app/providers/ServicesProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Alert, EmptyState, ErrorCard } from '@/components/ui/Feedback';
import { TextField } from '@/components/ui/Fields';
import { AppError } from '@/data/errors';
import { fmtDate, fmtDateTime } from '@/domain/format';
import {
  EMAIL_RE,
  effectiveInviteStatus,
  findActiveInviteFor,
  INVITE_STATUS_LABEL,
  INVITE_TTL_DAYS,
  inviteExpiresAt,
  normaliseEmail,
  SHARED_ACCESS_DESCRIPTION,
  type EffectiveInviteStatus,
} from '@/domain/invites';
import type { ShareGrant, ShareInvite } from '@/domain/types';

const STATUS_BADGE: Record<EffectiveInviteStatus, string> = {
  pending: 'badge-warning',
  accepted: 'badge-success',
  declined: 'badge-danger',
  revoked: 'badge-outline',
  expired: 'badge-outline',
};

export function SharingPage() {
  const { user, profile } = useSignedInUser();
  const { data } = useServices();
  const { notify } = useToast();
  const [invites, setInvites] = useState<ShareInvite[] | null>(null);
  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ShareInvite | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onError = (e: Error) => setError(e.message);
    const u1 = data.subscribeInvitesByPatient(user.uid, setInvites, onError);
    const u2 = data.subscribeSharesByPatient(user.uid, setShares, onError);
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      u1();
      u2();
      window.clearInterval(t);
    };
  }, [data, user.uid]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = normaliseEmail(email);
    setEmailError(undefined);
    setConsentError(undefined);
    if (!EMAIL_RE.test(value)) return setEmailError('Enter the clinician’s email address, e.g. doctor@example.com.');
    if (value === normaliseEmail(user.email)) return setEmailError('You cannot share with your own account.');
    if (!consent) return setConsentError('Tick the box to confirm you consent to sharing your records.');
    if (invites === null || shares === null) return;
    setBusy(true);
    try {
      const clinician = await data.lookupClinician(value);
      if (!clinician) {
        setEmailError('Clinician account not found. Check the email, or ask your clinician to sign in to RheumaTrack with a clinician account first.');
        return;
      }
      if (clinician.uid === user.uid) {
        setEmailError('You cannot share with your own account.');
        return;
      }
      const existing = findActiveInviteFor(invites, shares, clinician, Date.now());
      if (existing) {
        setEmailError(
          effectiveInviteStatus(existing) === 'pending'
            ? 'You already have a pending invitation for this clinician.'
            : 'This clinician already has access to your records.',
        );
        return;
      }
      await data.createInvite(user.uid, profile.displayName || user.email, clinician);
      notify('success', `Invitation sent to ${clinician.displayName || clinician.email}. It is waiting in their RheumaTrack account (no email is sent).`);
      setEmail('');
      setConsent(false);
    } catch (err) {
      if (err instanceof AppError && err.code === 'permission-denied') {
        setEmailError('This clinician account is not active. Ask your clinician to check their RheumaTrack access.');
      } else {
        notify('error', err instanceof Error ? err.message : 'Could not create the invitation. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="page"><ErrorCard message={error} /></div>;
  const all = [...(invites ?? [])].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Sharing</h1>
          <p>Give a clinician read-only access to your records. They must accept your invitation, and you can revoke access at any time.</p>
        </div>
      </div>
      <div className="grid grid-main-side">
        <section className="card stack" aria-labelledby="invite-title">
          <div className="card-title" id="invite-title">
            Invite a clinician
          </div>
          <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
            <TextField
              label="Clinician’s email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
              hint="The email your clinician uses to sign in to RheumaTrack."
              disabled={busy}
            />
            <div className="field">
              <label className="checkbox-row">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} aria-invalid={Boolean(consentError) || undefined} />
                <span style={{ fontSize: 'var(--fs-sm)' }}>I consent to this clinician viewing my records (read-only) until I revoke access.</span>
              </label>
              {consentError && (
                <span className="field-error" role="alert">
                  {consentError}
                </span>
              )}
            </div>
            <p className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
              {SHARED_ACCESS_DESCRIPTION}
            </p>
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy || invites === null || shares === null}>
                {busy ? <span className="spinner" aria-hidden /> : <Share2 aria-hidden />} {busy ? 'Checking…' : 'Send invitation'}
              </button>
            </div>
          </form>
        </section>
        <aside className="card stack">
          <div className="row">
            <ShieldCheck aria-hidden style={{ color: 'var(--accent)' }} />
            <div className="card-title">How access works</div>
          </div>
          <ul className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0, paddingLeft: 18 }}>
            <li>The invitation goes to that clinician’s RheumaTrack account. RheumaTrack does not send emails, so let them know.</li>
            <li>Nothing is shared until they accept. They can also decline.</li>
            <li>Invitations expire after {INVITE_TTL_DAYS} days without a response.</li>
            <li>Revoking ends access immediately; the database enforces it.</li>
          </ul>
        </aside>
      </div>

      <section className="card stack" aria-labelledby="invites-title">
        <div className="card-title" id="invites-title">
          Invitations and access
        </div>
        {invites === null || shares === null ? (
          <div className="skeleton" style={{ height: 80 }} aria-label="Loading invitations" />
        ) : all.length === 0 ? (
          <EmptyState icon={Share2} title="Not shared with anyone">
            Your records are visible only to you.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="invites-table">
              <thead>
                <tr>
                  <th>Clinician</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {all.map((i) => {
                  const share = shares.find((s) => s.inviteId === i.id);
                  const st = effectiveInviteStatus(i, now);
                  const accessEnded = st === 'accepted' && !share;
                  return (
                    <tr key={i.id} style={st === 'pending' || (st === 'accepted' && share) ? undefined : { opacity: 0.75 }}>
                      <td>
                        <div className="cell-strong">{i.clinicianName || i.clinicianEmail}</div>
                        {i.clinicianName && <div className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>{i.clinicianEmail}</div>}
                      </td>
                      <td>
                        <span className={`badge ${accessEnded ? 'badge-outline' : STATUS_BADGE[st]}`}>{accessEnded ? 'Access ended' : INVITE_STATUS_LABEL[st]}</span>
                        <div className="subtle" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>
                          {st === 'pending' && `Expires ${fmtDate(inviteExpiresAt(i))}`}
                          {st === 'accepted' && share && `Access since ${fmtDateTime(share.createdAt)}`}
                          {accessEnded && 'Removed by the clinician'}
                          {(st === 'declined' || st === 'revoked') && i.respondedAt !== null && fmtDateTime(i.respondedAt)}
                        </div>
                      </td>
                      <td>{fmtDateTime(i.createdAt)}</td>
                      <td>
                        {(st === 'pending' || (st === 'accepted' && share)) && (
                          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setRevoking(i)}>
                            <UserX aria-hidden /> {share ? 'Revoke access' : 'Cancel invitation'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Alert kind="info">Exports you download are files on your device. If you send them to anyone, they are outside RheumaTrack’s access controls.</Alert>

      <ConfirmDialog
        open={revoking !== null}
        title={revoking && shares?.some((s) => s.inviteId === revoking.id) ? 'Revoke access?' : 'Cancel invitation?'}
        body={
          revoking
            ? shares?.some((s) => s.inviteId === revoking.id)
              ? `${revoking.clinicianName || revoking.clinicianEmail} will immediately lose access to your records. You can invite them again later.`
              : `The invitation to ${revoking.clinicianName || revoking.clinicianEmail} will be withdrawn.`
            : ''
        }
        confirmLabel={revoking && shares?.some((s) => s.inviteId === revoking.id) ? 'Revoke' : 'Cancel invitation'}
        danger
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          const hadShare = shares?.some((s) => s.inviteId === revoking.id) ?? false;
          await data.revokeInvite(revoking, shares ?? []);
          notify('success', hadShare ? 'Access revoked.' : 'Invitation cancelled.');
        }}
      />
    </div>
  );
}
