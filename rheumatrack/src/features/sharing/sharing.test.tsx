import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { addMemoryAccount } from '@/data/memory/memoryServices';
import { INVITE_TTL_MS, effectiveInviteStatus, findActiveInviteFor } from '@/domain/invites';
import { CLINICIAN, PATIENT, renderApp, setupServices } from '@/test/renderApp';
import { makeSession } from '@/test/factories';

vi.mock('@/features/viewer3d/SamplePlayer3D', () => ({ default: () => <div /> }));
vi.mock('@/features/viewer3d/BodyViewer3D', () => ({ default: () => <div /> }));

const SECOND = { uid: 'c2', email: 'second@example.test', emailVerified: true, displayName: 'Dr Second' };

async function sendInvite(user: ReturnType<typeof userEvent.setup>, email: string, consent = true) {
  const input = screen.getByLabelText('Clinician’s email');
  await user.clear(input);
  await user.type(input, email);
  const box = screen.getByRole('checkbox');
  if (consent && !(box as HTMLInputElement).checked) await user.click(box);
  await user.click(screen.getByRole('button', { name: 'Send invitation' }));
}

describe('invitation lifecycle (domain)', () => {
  it('derives expiry after 14 days and ignores ended invitations for duplicates', () => {
    const base = { id: 'i', patientUid: 'p', patientName: 'P', clinicianEmail: 'd@x.co', clinicianUid: 'c', clinicianName: 'D', respondedAt: null };
    expect(effectiveInviteStatus({ ...base, status: 'pending', createdAt: 0 }, INVITE_TTL_MS - 1)).toBe('pending');
    expect(effectiveInviteStatus({ ...base, status: 'pending', createdAt: 0 }, INVITE_TTL_MS)).toBe('expired');
    expect(effectiveInviteStatus({ ...base, status: 'declined', createdAt: 0 }, INVITE_TTL_MS * 2)).toBe('declined');
    const accepted = { ...base, status: 'accepted' as const, createdAt: 0 };
    const share = { id: 'p_c', patientUid: 'p', clinicianUid: 'c', clinicianEmail: 'd@x.co', patientName: 'P', inviteId: 'i', createdAt: 0 };
    expect(findActiveInviteFor([accepted], [share], { uid: 'c', email: 'd@x.co' })).toBeDefined();
    expect(findActiveInviteFor([accepted], [], { uid: 'c', email: 'd@x.co' })).toBeUndefined();
    expect(findActiveInviteFor([{ ...base, status: 'declined', createdAt: 0 }], [], { uid: 'c', email: 'd@x.co' })).toBeUndefined();
  });
});

describe('patient sends an invitation', () => {
  it('validates the email and consent, keeping what was typed', async () => {
    const user = userEvent.setup();
    renderApp('/sharing');
    await screen.findByRole('heading', { name: 'Sharing' });
    await sendInvite(user, 'not-an-email');
    expect(await screen.findByText(/Enter the clinician’s email address/)).toBeInTheDocument();
    await sendInvite(user, PATIENT.email);
    expect(await screen.findByText('You cannot share with your own account.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await sendInvite(user, CLINICIAN.email, false);
    expect(await screen.findByText(/Tick the box to confirm/)).toBeInTheDocument();
    expect(screen.getByLabelText('Clinician’s email')).toHaveValue(CLINICIAN.email);
  });

  it('reports "Clinician account not found" for an email without a clinician account', async () => {
    const services = setupServices();
    const user = userEvent.setup();
    renderApp('/sharing', services);
    await screen.findByRole('heading', { name: 'Sharing' });
    await sendInvite(user, 'other@example.test'); // a patient account, not a clinician
    expect(await screen.findByText(/Clinician account not found/)).toBeInTheDocument();
    await sendInvite(user, 'nobody@example.test');
    expect(await screen.findByText(/Clinician account not found/)).toBeInTheDocument();
    expect(services.state.invites).toHaveLength(0);
  });

  it('creates a pending invitation addressed to the clinician account and blocks duplicates', async () => {
    const services = setupServices();
    const user = userEvent.setup();
    renderApp('/sharing', services);
    await screen.findByRole('heading', { name: 'Sharing' });
    await sendInvite(user, `  ${CLINICIAN.email.toUpperCase()} `);
    expect(await screen.findByText(/Invitation sent to Dr Example/)).toBeInTheDocument();
    expect(services.state.invites).toHaveLength(1);
    expect(services.state.invites[0]).toMatchObject({ clinicianUid: CLINICIAN.uid, clinicianEmail: CLINICIAN.email, status: 'pending' });
    expect(within(screen.getByTestId('invites-table')).getByText('Pending')).toBeInTheDocument();
    await sendInvite(user, CLINICIAN.email);
    expect(await screen.findByText('You already have a pending invitation for this clinician.')).toBeInTheDocument();
    expect(services.state.invites).toHaveLength(1);
  });

  it('refuses an invitation to a directory entry whose clinician role was removed', async () => {
    const services = setupServices();
    services.state.roles.delete(CLINICIAN.uid);
    const user = userEvent.setup();
    renderApp('/sharing', services);
    await screen.findByRole('heading', { name: 'Sharing' });
    await sendInvite(user, CLINICIAN.email);
    expect(await screen.findByText(/This clinician account is not active/)).toBeInTheDocument();
    expect(services.state.invites).toHaveLength(0);
  });
});

describe('clinician receives the invitation', () => {
  function servicesWithInvite() {
    const services = setupServices();
    addMemoryAccount(services.state, SECOND, 'Password1', 'clinician');
    services.state.sessions.set(PATIENT.uid, [makeSession({ id: 's1', ownerUid: PATIENT.uid })]);
    services.state.invites.push({
      id: 'inv1', patientUid: PATIENT.uid, patientName: 'Pat Example', clinicianEmail: CLINICIAN.email, clinicianUid: CLINICIAN.uid,
      clinicianName: 'Dr Example', status: 'pending', createdAt: Date.now(), respondedAt: null,
    });
    return services;
  }

  it('the invited clinician sees it — even with an unverified email — and accepts', async () => {
    const services = servicesWithInvite();
    services.state.accounts.get(CLINICIAN.uid)!.user.emailVerified = false;
    const user = userEvent.setup();
    renderApp('/clinician', services, CLINICIAN.uid);
    const list = await screen.findByTestId('pending-invites');
    expect(within(list).getByText('Pat Example')).toBeInTheDocument();
    expect(within(list).getByText(/Requested access: Read-only access/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('link', { name: 'Pat Example' })).toBeInTheDocument();
    expect(services.state.shares).toHaveLength(1);
    expect(services.state.invites[0]?.status).toBe('accepted');
  });

  it('another clinician does not see the invitation and cannot read the patient', async () => {
    const services = servicesWithInvite();
    renderApp('/clinician', services, SECOND.uid);
    expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
    await expect(services.data.acceptInvite(services.state.invites[0]!, SECOND.uid, SECOND.email)).rejects.toThrow();
    await expect(services.data.declineInvite(services.state.invites[0]!)).rejects.toThrow();
    expect(services.state.shares).toHaveLength(0);
  });

  it('declining notifies the patient side and grants no access', async () => {
    const services = servicesWithInvite();
    const user = userEvent.setup();
    const view = renderApp('/clinician', services, CLINICIAN.uid);
    await user.click(within(await screen.findByTestId('pending-invites')).getByRole('button', { name: 'Decline' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(services.state.invites[0]?.status).toBe('declined'));
    expect(services.state.shares).toHaveLength(0);
    view.unmount();
    renderApp('/sharing', services, PATIENT.uid);
    expect(await within(await screen.findByTestId('invites-table')).findByText('Declined')).toBeInTheDocument();
  });

  it('an expired invitation is not shown as pending and cannot be accepted', async () => {
    const services = servicesWithInvite();
    services.state.invites[0]!.createdAt = Date.now() - INVITE_TTL_MS - 1000;
    renderApp('/clinician', services, CLINICIAN.uid);
    expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
    await expect(services.data.acceptInvite(services.state.invites[0]!, CLINICIAN.uid, CLINICIAN.email)).rejects.toThrow();
  });

  it('after the patient revokes, the clinician loses access', async () => {
    const services = servicesWithInvite();
    const user = userEvent.setup();
    services.signInAs(CLINICIAN.uid);
    await services.data.acceptInvite(services.state.invites[0]!, CLINICIAN.uid, CLINICIAN.email);
    renderApp('/sharing', services, PATIENT.uid);
    await user.click(await screen.findByRole('button', { name: /Revoke access/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(services.state.shares).toHaveLength(0));
    services.signInAs(CLINICIAN.uid);
    const err = await new Promise<Error | null>((resolve) => services.data.subscribeSessions(PATIENT.uid, () => resolve(null), resolve));
    expect(err?.message).toMatch(/permission/);
  });
});
