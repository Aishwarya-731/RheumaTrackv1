import { Stethoscope, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/app/providers/AuthProvider';
import { useServices } from '@/app/providers/ServicesProvider';
import { setPortal, type Portal } from '@/app/routes/portal';
import { Alert } from '@/components/ui/Feedback';
import { TextField } from '@/components/ui/Fields';
import { AuthLayout } from './AuthLayout';

const COPY: Record<Portal, { title: string; subtitle: string }> = {
  patient: { title: 'Patient sign in', subtitle: 'Track your symptoms and joint movement.' },
  clinician: { title: 'Clinician sign in', subtitle: 'Review records that patients have shared with you.' },
};

/** Switch between the two sign-in pages. Both use the same account system. */
export function PortalSwitch({ portal }: { portal: Portal }) {
  return (
    <nav className="portal-switch" aria-label="Sign-in type">
      <Link to="/login" aria-current={portal === 'patient' ? 'page' : undefined}>
        <UserRound aria-hidden /> Patient
      </Link>
      <Link to="/clinician/login" aria-current={portal === 'clinician' ? 'page' : undefined}>
        <Stethoscope aria-hidden /> Clinician
      </Link>
    </nav>
  );
}

export function LoginPage({ portal = 'patient' }: { portal?: Portal }) {
  const { signIn } = useAuth();
  const { mode } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setPortal(portal);
    try {
      await signIn(email, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={COPY[portal].title} subtitle={COPY[portal].subtitle}>
      <PortalSwitch portal={portal} />
      {mode === 'emulator' && (
        <Alert kind="info" title="Local development environment">
          Connected to the Firebase Emulator Suite on this computer. Run <code>npm run seed</code> to create the labelled synthetic sample accounts
          described in the README.
        </Alert>
      )}
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
        {formError && (
          <Alert kind="danger" role="alert">
            {formError}
          </Alert>
        )}
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <div className="row row-between">
          <Link to="/reset-password">Forgot password?</Link>
        </div>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" aria-hidden />}
          {busy ? 'Signing in…' : portal === 'clinician' ? 'Sign in as clinician' : 'Sign in'}
        </button>
      </form>
      {portal === 'patient' ? (
        <p className="muted">
          New to RheumaTrack? <Link to="/signup">Create an account</Link>
        </p>
      ) : (
        <div className="stack muted" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
          <p>
            No clinician access yet? <Link to="/signup?portal=clinician">Create an account</Link>, then request clinician access. An administrator approves each
            clinician.
          </p>
          <p className="subtle">Signing in here does not grant clinician access by itself; it is checked against your account.</p>
        </div>
      )}
    </AuthLayout>
  );
}
