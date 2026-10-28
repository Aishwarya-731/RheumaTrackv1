/**
 * Phone sensor monitor tests with a SIMULATED sensor source. These check the page logic
 * (permissions, states, baseline, pause/resume, saving, export, clean-up). They are not a
 * substitute for trying it on a real phone.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/App';
import { RecordsProvider } from '@/app/providers/RecordsProvider';
import { CLINICIAN, PATIENT, renderApp, setupServices } from '@/test/renderApp';
import { SensorPage } from './SensorPage';
import type { MotionReading, OrientationReading, SensorSource, SensorSupport } from './sensorSource';

class FakeSource implements SensorSource {
  onO: ((r: OrientationReading) => void) | null = null;
  onM: ((r: MotionReading) => void) | null = null;
  stopped = 0;
  constructor(
    public sup: SensorSupport = { orientation: true, motion: true, secure: true },
    public permission: 'none' | 'granted' | 'denied' = 'none',
  ) {}
  support() {
    return this.sup;
  }
  needsPermission() {
    return this.permission !== 'none';
  }
  async requestPermission() {
    return this.permission === 'denied' ? ('denied' as const) : ('granted' as const);
  }
  start(onO: (r: OrientationReading) => void, onM: (r: MotionReading) => void) {
    this.onO = onO;
    this.onM = onM;
    return () => {
      this.stopped++;
      this.onO = null;
      this.onM = null;
    };
  }
  /** Emits n orientation+motion readings, `stepMs` apart, starting at `t0`. */
  emit(t0: number, n: number, beta: (i: number) => number, stepMs = 50) {
    act(() => {
      for (let i = 0; i < n; i++) {
        const t = t0 + i * stepMs;
        this.onM?.({ t, rotAlpha: 1, rotBeta: 2, rotGamma: 3, ax: 0.1, ay: 9.7, az: 1.2 });
        this.onO?.({ t: t + 1, alpha: 30, beta: beta(i), gamma: 5 });
      }
    });
  }
}

function renderSensor(source: FakeSource, services = setupServices()) {
  services.signInAs(PATIENT.uid);
  const utils = render(
    <AppProviders services={services}>
      <MemoryRouter>
        <RecordsProvider ownerUid={PATIENT.uid}>
          <SensorPage source={source} />
        </RecordsProvider>
      </MemoryRouter>
    </AppProviders>,
  );
  return { ...utils, services };
}

describe('phone sensor monitor (simulated sensor events)', () => {
  it('explains when motion sensors are unsupported or the page is not secure', async () => {
    const user = userEvent.setup();
    const a = renderSensor(new FakeSource({ orientation: false, motion: false, secure: true }));
    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    expect(await screen.findByText('Motion sensors are not available in this browser')).toBeInTheDocument();
    a.unmount();
    renderSensor(new FakeSource({ orientation: true, motion: true, secure: false }));
    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    expect(await screen.findByText('A secure connection is required')).toBeInTheDocument();
  });

  it('handles a denied permission request (iPhone)', async () => {
    const user = userEvent.setup();
    renderSensor(new FakeSource(undefined, 'denied'));
    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    expect(await screen.findByText('Permission was denied')).toBeInTheDocument();
  });

  it('reports "no readings" when the device sends nothing', async () => {
    const user = userEvent.setup();
    renderSensor(new FakeSource());
    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    expect(screen.getByTestId('sensor-connection')).toHaveTextContent('Waiting for readings');
    expect(await screen.findByText('No sensor readings received', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('rejects a baseline taken while moving', async () => {
    const user = userEvent.setup();
    const src = new FakeSource(undefined, 'granted');
    renderSensor(src);
    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    src.emit(Date.now(), 3, () => 10);
    await waitFor(() => expect(screen.getByTestId('sensor-connection')).toHaveTextContent('Live'));
    await user.click(screen.getByRole('button', { name: /Capture baseline/ }));
    src.emit(Date.now() + 100, 50, (i) => i * 3);
    expect(await screen.findByText('Baseline not captured')).toBeInTheDocument();
    expect(screen.getByText(/The phone moved/)).toBeInTheDocument();
  });

  it('records with baseline, pause/resume and stop, then saves and exports real samples', async () => {
    const user = userEvent.setup();
    const src = new FakeSource();
    const { services, unmount } = renderSensor(src);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    await user.click(await screen.findByRole('button', { name: 'Connect phone sensors' }));
    src.emit(Date.now(), 2, () => 10);
    await waitFor(() => expect(within(screen.getByTestId('live-readings')).getByText('10.0')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Capture baseline/ }));
    let t = Date.now() + 100;
    src.emit(t, 50, () => 10);
    expect(await screen.findByText('Baseline captured')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    t += 5000;
    src.emit(t, 20, (i) => 10 + i * 3); // tilt up to 67°
    await waitFor(() => expect(screen.getByTestId('rec-samples')).toHaveTextContent('20'));
    await waitFor(() => expect(screen.getByTestId('live-change')).toHaveTextContent('57.0°'));

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    t += 2000;
    src.emit(t, 10, () => 90); // not recorded while paused
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    t += 2000;
    src.emit(t, 5, () => 10);
    await waitFor(() => expect(screen.getByTestId('rec-samples')).toHaveTextContent('25'));
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    const summary = await screen.findByTestId('sensor-summary');
    expect(within(summary).getByText(/25 \(/)).toBeInTheDocument();
    expect(within(summary).getByText(/0\.0° to 57\.0° \(range 57\.0°\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save recording' }));
    await waitFor(() => expect(services.state.sensorRecordings.get(PATIENT.uid)).toHaveLength(1));
    const rec = services.state.sensorRecordings.get(PATIENT.uid)![0]!;
    expect(rec).toMatchObject({ segment: 'forearm', side: 'right', method: 'orientation' });
    expect(rec.summary.sampleCount).toBe(25);
    const stored = services.state.sensorSamples.get(rec.id)!;
    expect(stored).toHaveLength(25);
    expect(stored.every((s) => s.beta !== 90)).toBe(true);
    expect(await screen.findByTestId('sensor-table')).toBeInTheDocument();

    unmount();
    expect(src.stopped).toBeGreaterThanOrEqual(1);
    expect(src.onO).toBeNull();
  });

  it('clinicians with a share see saved recordings read-only, without the live monitor', async () => {
    const services = setupServices();
    services.state.sensorRecordings.set(PATIENT.uid, [
      {
        id: 'r1', ownerUid: PATIENT.uid, segment: 'shin', side: 'left', method: 'orientation', startedAt: Date.now() - 60_000, endedAt: Date.now(),
        createdAt: Date.now(), deviceInfo: '', notes: '', chunkCount: 1, schemaVersion: 1,
        summary: { sampleCount: 10, activeDurationMs: 20000, meanRateHz: 0.5, changeMinDeg: 0, changeMaxDeg: 40, changeRangeDeg: 40, peakRotationRateDegS: 50, peakAccelerationMs2: 10 },
        baseline: { vector: [0, 1, 0], durationMs: 2000, maxDeviationDeg: 1 },
      },
    ]);
    services.state.shares.push({ id: `${PATIENT.uid}_${CLINICIAN.uid}`, patientUid: PATIENT.uid, clinicianUid: CLINICIAN.uid, clinicianEmail: CLINICIAN.email, patientName: 'Pat', inviteId: 'i1', createdAt: 0 });
    renderApp(`/clinician/patients/${PATIENT.uid}/sensor`, services, CLINICIAN.uid);
    const table = await screen.findByTestId('sensor-table');
    expect(within(table).getByText('Left shin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect phone sensors' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});
