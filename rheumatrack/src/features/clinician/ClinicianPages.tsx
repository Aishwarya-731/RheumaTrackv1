import { ArrowLeft, Inbox, UserMinus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { useSignedInUser } from '@/app/providers/AuthProvider';
import { RecordsProvider, useRecords } from '@/app/providers/RecordsProvider';
import { useServices } from '@/app/providers/ServicesProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Alert, EmptyState, ErrorCard, LoadingCard } from '@/components/ui/Feedback';
import { AppError } from '@/data/errors';
import { fmtDate, fmtDateTime } from '@/domain/format';
import { effectiveInviteStatus, INVITE_STATUS_LABEL, inviteExpiresAt, SHARED_ACCESS_DESCRIPTION } from '@/domain/invites';
import type { ShareGrant, ShareInvite } from '@/domain/types';

export function ClinicianHomePage() {
  const { user } = useSignedInUser();
  const { data } = useServices();
  const { notify } = useToast();
  const [invites, setInvites] = useState<ShareInvite[] | null>(null);
  const [shares, setShares] = useState<ShareGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: 'accept' | 'decline' } | null>(null);
  const [declining, setDeclining] = useState<ShareInvite | null>(null);
  const [removing, setRemoving] = useState<ShareGrant | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onError = (e: Error) => setError(e.message);
    const u1 = data.subscribeSharesByClinician(user.uid, setShares, onError);
    const u2 = data.subscribeInvitesForClinician({ uid: user.uid, email: user.email, emailVerified: user.emailVerified }, setInvites, onError);
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      u1();
      u2();
      window.clearInterval(t);
    };
  }, [data, user.uid, user.email, user.emailVerified]);

  if (error) return <div className="page"><ErrorCard message={error} /></div>;
  const pending = (invites ?? []).filter((i) => effectiveInviteStatus(i, now) === 'pending');
  const recent = (invites ?? []).filter((i) => effectiveInviteStatus(i, now) !== 'pending').slice(0, 10);

  const accept = async (i: ShareInvite) => {
    if (busy) return;
    setBusy({ id: i.id, action: 'accept' });
    try {
      await data.acceptInvite(i, user.uid, user.email);
      notify('success', `You can now view ${i.patientName}’s records.`);
    } catch (e) {
      notify('error', e instanceof AppError && e.code === 'permission-denied' ? 'This invitation can no longer be accepted (it may have been cancelled or expired).' : e instanceof Error ? e.message : 'Could not accept the invitation.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Patients</h1>
          <p>Invitations from patients, and patients who have shared their records with you. Access is read-only and the patient can revoke it at any time.</p>
        </div>
      </div>

      <section className="card stack" aria-labelledby="pending-title">
        <div className="row row-between">
          <div className="card-title" id="pending-title">
            Pending invitations
          </div>
          {pending.length > 0 && <span className="badge badge-warning">{pending.length} waiting</span>}
        </div>
        {invites === null ? (
          <div className="skeleton" style={{ height: 60 }} aria-label="Loading invitations" />
        ) : pending.length === 0 ? (
          <EmptyState icon={Inbox} title="No pending invitations">
            When a patient invites {user.email}, the invitation appears here.
          </EmptyState>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="pending-invites">
            {pending.map((i) => (
              <li key={i.id} className="invite-row">
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <div style={{ fontWeight: 650 }}>{i.patientName}</div>
                  <div className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
                    Sent {fmtDateTime(i.createdAt)} · expires {fmtDate(inviteExpiresAt(i))}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                    Requested access: {SHARED_ACCESS_DESCRIPTION}
                  </div>
                </div>
                <div className="row" style={{ flex: 'none' }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => setDeclining(i)}>
                    Decline
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void accept(i)}>
                    {busy?.id === i.id && busy.action === 'accept' && <span className="spinner" aria-hidden />} Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" aria-labelledby="patients-title">
        <div className="card-title" id="patients-title">
          Shared with you
        </div>
        {shares === null ? (
          <LoadingCard lines={3} />
        ) : shares.length === 0 ? (
          <EmptyState icon={Users} title="No patients have shared records with you" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Access since</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-strong">
                      <Link to={`/clinician/patients/${s.patientUid}`}>{s.patientName}</Link>
                    </td>
                    <td>{fmtDateTime(s.createdAt)}</td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(s)}>
                        <UserMinus aria-hidden /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="card stack" aria-labelledby="history-title">
          <div className="card-title" id="history-title">
            Recent invitation history
          </div>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6, fontSize: 'var(--fs-sm)' }}>
            {recent.map((i) => (
              <li key={i.id} className="row row-between">
                <span>{i.patientName}</span>
                <span className="badge badge-outline">{INVITE_STATUS_LABEL[effectiveInviteStatus(i, now)]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={declining !== null}
        title="Decline this invitation?"
        body={declining ? `${declining.patientName} will see that you declined. They can invite you again later.` : ''}
        confirmLabel="Decline"
        danger
        onClose={() => setDeclining(null)}
        onConfirm={async () => {
          if (!declining) return;
          await data.declineInvite(declining);
          notify('success', 'Invitation declined.');
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this patient?"
        body="You will lose access to their records. The patient would need to invite you again."
        confirmLabel="Remove"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await data.removeShareAsClinician(removing);
          notify('success', 'Patient removed.');
        }}
      />
    </div>
  );
}

/** Wraps the patient's pages in a read-only records context for the clinician. */
export function ClinicianPatientLayout() {
  const { patientUid } = useParams();
  if (!patientUid) return null;
  const base = `/clinician/patients/${patientUid}`;
  return (
    <RecordsProvider ownerUid={patientUid} readOnly basePath={base}>
      <PatientHeader base={base} />
      <Outlet />
    </RecordsProvider>
  );
}

function PatientHeader({ base }: { base: string }) {
  const { ownerUid, error } = useRecords();
  const { data } = useServices();
  const [name, setName] = useState<string>('');
  useEffect(() => {
    data.getProfile(ownerUid).then((p) => setName(p?.displayName ?? ''), () => setName(''));
  }, [data, ownerUid]);
  const links = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/joints`, label: 'Joints & ROM', end: false },
    { to: `${base}/history`, label: 'History', end: false },
    { to: `${base}/analytics`, label: 'Trends', end: false },
    { to: `${base}/sensor`, label: 'Phone sensor', end: false },
    { to: `${base}/reports`, label: 'Reports', end: false },
  ];
  return (
    <div className="page no-print" style={{ paddingBottom: 0 }}>
      <div className="row row-between">
        <div className="row">
          <Link to="/clinician" className="btn btn-ghost btn-sm">
            <ArrowLeft aria-hidden /> All patients
          </Link>
          <strong>{name || 'Patient'}</strong>
          <span className="badge badge-outline">Read-only</span>
        </div>
      </div>
      {error ? (
        <Alert kind="danger" title="Access unavailable" role="alert">
          {error} The patient may have revoked access.
        </Alert>
      ) : (
        <nav className="tabs" aria-label="Patient sections">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="tab" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
