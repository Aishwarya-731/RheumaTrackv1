import { Clock, ShieldAlert, Stethoscope } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth, useSignedInUser } from '@/app/providers/AuthProvider';
import { useServices } from '@/app/providers/ServicesProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { setPortal } from '@/app/routes/portal';
import { Alert, ErrorCard } from '@/components/ui/Feedback';
import { TextAreaField, TextField } from '@/components/ui/Fields';
import { fmtDateTime } from '@/domain/format';
import type { ClinicianAccessRequest } from '@/domain/types';

/**
 * Shown when someone signs in through the clinician page without the clinician role.
 * The role itself is only ever granted by an administrator; this page files a request.
 * The role is watched live, so approval takes effect here without signing out.
 */
export function ClinicianAccessPage() {
  const { user, profile, role } = useSignedInUser();
  const { signOut } = useAuth();
  const { data } = useServices();
  const { notify } = useToast();
  const [request, setRequest] = useState<ClinicianAccessRequest | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ name: profile.displayName || user.displayName, organisation: '', professionalId: '', note: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => data.subscribeClinicianRequest(user.uid, setRequest, (e) => setError(e.message)), [data, user.uid]);

  if (role === 'clinician') return <Navigate to="/clinician" replace />;
  if (error) return <div className="page"><ErrorCard message={error} /></div>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (v.name.trim().length < 2) next.name = 'Enter your full name.';
    if (v.organisation.trim().length < 2) next.organisation = 'Enter your hospital, clinic or organisation.';
    if (v.professionalId.trim().length < 2) next.professionalId = 'Enter your professional registration number.';
    if (v.note.length > 1000) next.note = 'Keep the note under 1000 characters.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await data.createClinicianRequest({ uid: user.uid, email: user.email, displayName: v.name, organisation: v.organisation, professionalId: v.professionalId, note: v.note });
      notify('success', 'Request submitted. An administrator will review it.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-header">
        <div>
          <h1>Clinician access</h1>
          <p>Clinician access lets you review records that patients choose to share with you. It is approved by an administrator.</p>
        </div>
      </div>
      <Alert kind="warning" title="This account doesn’t have clinician access">
        You signed in on the clinician page as {user.email}. This account is currently a personal (patient) account.
      </Alert>

      {request === undefined ? (
        <div className="skeleton" style={{ height: 120 }} aria-label="Loading request status" />
      ) : request ? (
        <section className="card stack" aria-labelledby="req-title">
          <div className="row">
            {request.status === 'rejected' ? <ShieldAlert aria-hidden style={{ color: 'var(--danger)' }} /> : <Clock aria-hidden style={{ color: 'var(--warning)' }} />}
            <div className="card-title" id="req-title">
              {request.status === 'pending' && 'Request pending review'}
              {request.status === 'approved' && 'Request approved — finishing setup'}
              {request.status === 'rejected' && 'Request not approved'}
            </div>
          </div>
          <dl className="kv">
            <dt>Submitted</dt>
            <dd>{fmtDateTime(request.createdAt)}</dd>
            <dt>Name</dt>
            <dd>{request.displayName}</dd>
            <dt>Organisation</dt>
            <dd>{request.organisation}</dd>
            <dt>Registration no.</dt>
            <dd>{request.professionalId}</dd>
          </dl>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            {request.status === 'rejected'
              ? 'Contact your RheumaTrack administrator if you think this is a mistake.'
              : 'When an administrator grants access, this page switches to the clinician area automatically. You do not need to sign out.'}
          </p>
        </section>
      ) : (
        <section className="card stack" aria-labelledby="form-title">
          <div className="row">
            <Stethoscope aria-hidden style={{ color: 'var(--accent)' }} />
            <div className="card-title" id="form-title">
              Request clinician access
            </div>
          </div>
          <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
            <div className="form-grid">
              <TextField label="Full name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} autoComplete="name" disabled={busy} />
              <TextField label="Email" value={user.email} disabled hint="Patients invite you using this email." />
            </div>
            <div className="form-grid">
              <TextField label="Hospital / clinic / organisation" value={v.organisation} onChange={(e) => setV({ ...v, organisation: e.target.value })} error={errors.organisation} disabled={busy} />
              <TextField label="Professional registration number" value={v.professionalId} onChange={(e) => setV({ ...v, professionalId: e.target.value })} error={errors.professionalId} disabled={busy} />
            </div>
            <TextAreaField label="Note for the administrator (optional)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} error={errors.note} maxLength={1100} style={{ minHeight: 80 }} disabled={busy} />
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy && <span className="spinner" aria-hidden />} {busy ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="row">
        <Link to="/" className="btn btn-secondary" onClick={() => setPortal('patient')}>
          Continue to patient dashboard
        </Link>
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
