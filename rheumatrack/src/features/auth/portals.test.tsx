import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { landingFor } from '@/app/routes/portal';
import { CLINICIAN, OTHER, PATIENT, renderApp, setupServices } from '@/test/renderApp';

vi.mock('@/features/viewer3d/SamplePlayer3D', () => ({ default: () => <div /> }));
vi.mock('@/features/viewer3d/BodyViewer3D', () => ({ default: () => <div /> }));

async function signInOn(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), 'Password1');
  await user.click(screen.getByRole('button', { name: /^Sign in/ }));
}

describe('landing rules', () => {
  it('lands by server-side role; the portal never grants a role', () => {
    expect(landingFor('patient', 'patient', null)).toBe('/');
    expect(landingFor('patient', 'clinician', null)).toBe('/clinician/access');
    expect(landingFor('clinician', 'patient', null)).toBe('/clinician');
    expect(landingFor('clinician', 'clinician', '/clinician/patients/x')).toBe('/clinician/patients/x');
    expect(landingFor('patient', null, '/history')).toBe('/history');
    expect(landingFor('patient', null, '/clinician')).toBe('/');
    expect(landingFor('patient', null, '/login')).toBe('/');
  });
});

describe('separate patient and clinician sign-in', () => {
  it('shows distinct pages with a switch between them', async () => {
    const user = userEvent.setup();
    renderApp('/login', setupServices(), null);
    expect(await screen.findByRole('heading', { name: 'Patient sign in' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Clinician/ }));
    expect(await screen.findByRole('heading', { name: 'Clinician sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clinician/ })).toHaveAttribute('aria-current', 'page');
  });

  it('a clinician signing in on the clinician page lands in the clinician area', async () => {
    const user = userEvent.setup();
    renderApp('/clinician/login', setupServices(), null);
    await signInOn(user, CLINICIAN.email);
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(screen.getByText('Clinician portal')).toBeInTheDocument();
  });

  it('a patient account on the clinician page gets no clinician access, only the request page', async () => {
    const services = setupServices();
    const user = userEvent.setup();
    renderApp('/clinician/login', services, null);
    await signInOn(user, OTHER.email);
    expect(await screen.findByText('This account doesn’t have clinician access')).toBeInTheDocument();
    expect(services.state.roles.get(OTHER.uid)).toBeUndefined();
    await user.type(await screen.findByLabelText('Hospital / clinic / organisation'), 'City Rheumatology');
    await user.type(screen.getByLabelText('Professional registration number'), 'REG-123');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Request pending review')).toBeInTheDocument();
    expect(services.state.clinicianRequests.get(OTHER.uid)).toMatchObject({ status: 'pending', organisation: 'City Rheumatology' });
    expect(services.state.roles.get(OTHER.uid)).toBeUndefined();

    // An administrator grants the role: the live listener switches to the clinician area.
    act(() => {
      services.state.roles.set(OTHER.uid, 'clinician');
      services.notify();
    });
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    await waitFor(() => expect(services.state.clinicianDirectory.get(OTHER.email)?.uid).toBe(OTHER.uid));
  });

  it('a clinician signing in on the patient page still lands in the clinician area', async () => {
    const user = userEvent.setup();
    renderApp('/login', setupServices(), null);
    await signInOn(user, CLINICIAN.email);
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
  });

  it('signed-out visits to clinician pages go to the clinician sign-in page', async () => {
    renderApp('/clinician', setupServices(), null);
    expect(await screen.findByRole('heading', { name: 'Clinician sign in' })).toBeInTheDocument();
  });

  it('a patient cannot open clinician pages by URL', async () => {
    renderApp('/clinician', setupServices(), PATIENT.uid);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
