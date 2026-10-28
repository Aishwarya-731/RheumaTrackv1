import { Download, Pause, Play, Radio, Smartphone, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { downloadText } from '@/app/download';
import { useRecords } from '@/app/providers/RecordsProvider';
import { useServices } from '@/app/providers/ServicesProvider';
import { useToast } from '@/app/providers/ToastProvider';
import { useChartTheme } from '@/components/charts/chartTheme';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Alert, EmptyState, ErrorCard } from '@/components/ui/Feedback';
import { Segmented, SelectField, TextAreaField } from '@/components/ui/Fields';
import { Modal } from '@/components/ui/Modal';
import { exportFileStamp } from '@/domain/export';
import { fmtDateTime, fmtDuration, fmtNumber } from '@/domain/format';
import { SIDES, sideLabel, type Side } from '@/domain/joints';
import {
  SENSOR_LIMITS,
  SENSOR_SEGMENTS,
  segmentLabel,
  sensorSamplesToCsv,
  summariseRecording,
  type SensorRecording,
  type SensorSample,
  type SensorSegment,
} from '@/domain/sensor';
import { browserSensorSource, type SensorSource } from './sensorSource';
import { useSensorMonitor, type Connection } from './useSensorMonitor';

export const ESTIMATE_LABEL = 'Phone orientation change — estimated, not a validated joint angle';

const CONNECTION_TEXT: Record<Connection, { badge: string; kind: string }> = {
  idle: { badge: 'Not connected', kind: 'badge-outline' },
  unsupported: { badge: 'Not supported', kind: 'badge-danger' },
  insecure: { badge: 'Needs https', kind: 'badge-danger' },
  requesting: { badge: 'Waiting for permission', kind: 'badge-warning' },
  denied: { badge: 'Permission denied', kind: 'badge-danger' },
  connecting: { badge: 'Waiting for readings…', kind: 'badge-warning' },
  'no-data': { badge: 'No readings', kind: 'badge-danger' },
  live: { badge: 'Live', kind: 'badge-success' },
  error: { badge: 'Error', kind: 'badge-danger' },
};

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function ChangeChart({ points, height = 220, testId }: { points: Array<{ t: number; v: number | null }>; height?: number; testId?: string }) {
  const t = useChartTheme();
  const t0 = points[0]?.t ?? 0;
  const step = Math.max(1, Math.ceil(points.length / 1200));
  const data = points.filter((_, i) => i % step === 0).map((p) => ({ s: (p.t - t0) / 1000, v: p.v }));
  return (
    <div className="chart-box" style={{ height }} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="s" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v.toFixed(0)}s`} tick={t.tick} stroke={t.grid} />
          <YAxis domain={[0, 'auto']} tick={t.tick} stroke={t.grid} unit="°" width={50} />
          <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}° (estimated)`, 'Orientation change']} labelFormatter={(l) => `${Number(l).toFixed(1)} s`} />
          <Line type="linear" dataKey="v" stroke={t.series[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Reading({ label, value, unit, dp = 1 }: { label: string; value: number | null | undefined; unit: string; dp?: number }) {
  return (
    <div className="reading">
      <span className="reading-label">{label}</span>
      <span className="reading-value num">
        {value === null || value === undefined ? '—' : value.toFixed(dp)}
        {value !== null && value !== undefined && <small> {unit}</small>}
      </span>
    </div>
  );
}

export function SensorPage({ source = browserSensorSource }: { source?: SensorSource }) {
  const { readOnly } = useRecords();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Phone sensor</h1>
          <p>Record movement with your phone’s built-in motion sensors. Raw readings are kept exactly as received; the orientation change is an estimate, kept separate from imported movement data and range-of-motion figures.</p>
        </div>
        <span className="badge badge-violet">
          <Smartphone aria-hidden /> Estimated from phone sensors
        </span>
      </div>
      {!readOnly && <SensorMonitor source={source} />}
      <SensorRecordingsList />
    </div>
  );
}

function SensorMonitor({ source }: { source: SensorSource }) {
  const { ownerUid } = useRecords();
  const { data } = useServices();
  const { notify } = useToast();
  const m = useSensorMonitor(source);
  const [segment, setSegment] = useState<SensorSegment>('forearm');
  const [side, setSide] = useState<Side>('right');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const segmentDef = SENSOR_SEGMENTS.find((s) => s.id === segment);
  const s = m.snapshot.latest;
  const conn = CONNECTION_TEXT[m.connection];
  const placementLocked = m.phase !== 'setup' && m.phase !== 'baseline-failed';
  const summary = useMemo(() => (m.recorded ? summariseRecording(m.recorded.samples, m.recorded.activeMs) : null), [m.recorded]);

  const save = async () => {
    if (!m.recorded || !m.baseline || !summary || saving) return;
    setSaving(true);
    try {
      await data.createSensorRecording(
        ownerUid,
        {
          segment,
          side,
          method: m.baseline.method,
          summary,
          baseline: { vector: m.baseline.vector, durationMs: m.baseline.durationMs, maxDeviationDeg: m.baseline.maxDeviationDeg },
          deviceInfo: navigator.userAgent,
          notes: notes.trim(),
        },
        m.recorded.samples,
      );
      notify('success', 'Sensor recording saved.');
      setNotes('');
      m.discard();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Could not save the recording. Your data is still here — try again.');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (!m.recorded || !m.baseline) return;
    downloadText(`rheumatrack_phone_${side}_${segment}_${exportFileStamp()}.csv`, sensorSamplesToCsv(m.recorded.samples, { segment, side, method: m.baseline.method }), 'text/csv');
  };

  return (
    <>
      <div className="grid grid-main-side">
        <section className="card stack" aria-labelledby="placement-title">
          <div className="card-title" id="placement-title">
            1. Place the phone
          </div>
          <div className="form-grid">
            <SelectField<SensorSegment>
              label="Body segment"
              value={segment}
              onChange={setSegment}
              options={SENSOR_SEGMENTS.map((x) => ({ value: x.id, label: x.label }))}
              disabled={placementLocked}
            />
            <div className="field">
              <span className="field-label">Side</span>
              <Segmented<Side> label="Side" value={side} onChange={(v) => !placementLocked && setSide(v)} options={SIDES.map((x) => ({ value: x, label: sideLabel(x) }))} />
            </div>
          </div>
          {segmentDef && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{segmentDef.hint}</p>}
          <ul className="subtle" style={{ fontSize: 'var(--fs-sm)', margin: 0, paddingLeft: 18 }}>
            <li>Use an armband or sports strap so the phone cannot slip. Do not hold it loosely.</li>
            <li>Keep this page open with the screen on while recording.</li>
            <li>Stop if any movement is painful.</li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="conn-title">
          <div className="row row-between">
            <div className="card-title" id="conn-title">
              2. Connect sensors
            </div>
            <span className={`badge ${conn.kind}`} data-testid="sensor-connection">
              {m.connection === 'live' && <Radio aria-hidden />} {conn.badge}
            </span>
          </div>
          {m.connection === 'unsupported' && (
            <Alert kind="danger" role="alert" title="Motion sensors are not available in this browser">
              Open RheumaTrack on a phone (Chrome on Android, Safari on iPhone). Desktop computers usually have no motion sensors.
            </Alert>
          )}
          {m.connection === 'insecure' && (
            <Alert kind="danger" role="alert" title="A secure connection is required">
              Browsers only provide motion sensors over https. Use the deployed site (https://…vercel.app) on your phone, not an http:// local address.
            </Alert>
          )}
          {m.connection === 'denied' && (
            <Alert kind="danger" role="alert" title="Permission was denied">
              On iPhone: close the tab, open it again and tap Allow. If no prompt appears, check Settings → Safari → Motion &amp; Orientation Access. On Android, check the site
              settings for motion sensors.
            </Alert>
          )}
          {m.connection === 'no-data' && (
            <Alert kind="warning" role="alert" title="No sensor readings received">
              This device or browser is not sending motion data. Desktop computers and some browsers do not have motion sensors. Try a phone.
            </Alert>
          )}
          {m.connection === 'error' && <Alert kind="danger" role="alert" title="Could not start the sensors">Reload the page and try again.</Alert>}
          {m.connection !== 'live' && m.connection !== 'connecting' && m.connection !== 'requesting' && m.connection !== 'unsupported' && m.connection !== 'insecure' && (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => void m.connect()}>
                <Smartphone aria-hidden /> {m.connection === 'idle' ? 'Connect phone sensors' : 'Try again'}
              </button>
            </div>
          )}
          {(m.connection === 'connecting' || m.connection === 'requesting') && (
            <span className="row muted">
              <span className="spinner" aria-hidden /> {m.connection === 'requesting' ? 'Waiting for your permission…' : 'Waiting for the first readings…'}
            </span>
          )}
          <div className="reading-grid" aria-live="off" data-testid="live-readings">
            <Reading label="Tilt front–back (β)" value={s?.beta} unit="°" />
            <Reading label="Tilt left–right (γ)" value={s?.gamma} unit="°" />
            <Reading label="Heading (α)" value={s?.alpha} unit="°" />
            <Reading label="Rotation rate β" value={s?.rotBeta} unit="°/s" />
            <Reading label="Rotation rate γ" value={s?.rotGamma} unit="°/s" />
            <Reading label="Rotation rate α" value={s?.rotAlpha} unit="°/s" />
            <Reading label="Accel. incl. gravity x" value={s?.ax} unit="m/s²" dp={2} />
            <Reading label="Accel. incl. gravity y" value={s?.ay} unit="m/s²" dp={2} />
            <Reading label="Accel. incl. gravity z" value={s?.az} unit="m/s²" dp={2} />
          </div>
          <p className="subtle" style={{ fontSize: 'var(--fs-xs)' }}>Raw readings from the browser. Accelerations and rotation rates are not angles.</p>
        </section>
      </div>

      <section className="card stack" aria-labelledby="rec-title">
        <div className="row row-between">
          <div className="card-title" id="rec-title">
            3. Baseline and recording
          </div>
          {m.phase === 'recording' && (
            <span className="badge badge-danger">
              <span className="status-dot rec-dot" aria-hidden /> Recording
            </span>
          )}
          {m.phase === 'paused' && <span className="badge badge-warning">Paused</span>}
        </div>

        {(m.phase === 'setup' || m.phase === 'baseline-failed') && (
          <div className="stack">
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              Hold the {segmentLabel(segment).toLowerCase()} still in its starting position, then capture a baseline. Changes are measured from this position.
            </p>
            {m.phase === 'baseline-failed' && m.baseline && (
              <Alert kind="warning" role="alert" title="Baseline not captured">
                {m.baseline.messages.join(' ')}
              </Alert>
            )}
            <div>
              <button type="button" className="btn btn-primary" disabled={m.connection !== 'live'} onClick={m.captureBaseline}>
                {m.phase === 'baseline-failed' ? 'Try the baseline again' : `Capture baseline (hold still ${SENSOR_LIMITS.baselineDurationMs / 1000} s)`}
              </button>
            </div>
            {m.connection !== 'live' && <p className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>Connect the phone sensors first.</p>}
          </div>
        )}

        {m.phase === 'baseline' && (
          <div className="stack" role="status">
            <strong>Hold still…</strong>
            <div className="progress" aria-hidden>
              <div style={{ width: `${Math.round(m.snapshot.baselineProgress * 100)}%` }} />
            </div>
          </div>
        )}

        {(m.phase === 'ready' || m.phase === 'recording' || m.phase === 'paused') && (
          <div className="stack">
            {m.phase === 'ready' && m.baseline && <Alert kind="success" title="Baseline captured">{m.baseline.messages.join(' ')}</Alert>}
            <div className="rec-bar">
              <div>
                <div className="subtle" style={{ fontSize: 'var(--fs-xs)' }}>{ESTIMATE_LABEL}</div>
                <div className="stat-value" data-testid="live-change">
                  {m.snapshot.liveChangeDeg === null ? '—' : `${m.snapshot.liveChangeDeg.toFixed(1)}°`}
                </div>
              </div>
              <div className="rec-stats num">
                <div>
                  <span className="subtle">Time</span> <strong data-testid="rec-timer">{mmss(m.snapshot.activeMs)}</strong>
                  <span className="subtle"> / {mmss(SENSOR_LIMITS.maxDurationMs)}</span>
                </div>
                <div>
                  <span className="subtle">Samples</span> <strong data-testid="rec-samples">{m.snapshot.sampleCount.toLocaleString('en')}</strong>
                </div>
              </div>
              <div className="row">
                {m.phase === 'ready' && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={m.startRecording}>
                      <Play aria-hidden /> Start recording
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={m.resetBaseline}>
                      New baseline
                    </button>
                  </>
                )}
                {m.phase === 'recording' && (
                  <button type="button" className="btn btn-secondary" onClick={m.pause}>
                    <Pause aria-hidden /> Pause
                  </button>
                )}
                {m.phase === 'paused' && (
                  <button type="button" className="btn btn-secondary" onClick={m.resume}>
                    <Play aria-hidden /> Resume
                  </button>
                )}
                {(m.phase === 'recording' || m.phase === 'paused') && (
                  <button type="button" className="btn btn-danger" onClick={m.stop}>
                    <Square aria-hidden /> Stop
                  </button>
                )}
              </div>
            </div>
            <ChangeChart points={m.snapshot.window} testId="live-chart" />
          </div>
        )}

        {m.phase === 'review' && m.recorded && summary && (
          <div className="stack">
            {m.autoStopReason && <Alert kind="info">{m.autoStopReason}</Alert>}
            {summary.sampleCount === 0 ? (
              <Alert kind="warning" title="Nothing was recorded">
                No readings arrived while recording. Discard and try again.
              </Alert>
            ) : (
              <>
                <dl className="kv" data-testid="sensor-summary">
                  <dt>Placement</dt>
                  <dd>
                    {sideLabel(side)} {segmentLabel(segment).toLowerCase()}
                  </dd>
                  <dt>Recording time</dt>
                  <dd>{fmtDuration(summary.activeDurationMs)}</dd>
                  <dt>Samples</dt>
                  <dd className="num">
                    {summary.sampleCount.toLocaleString('en')} ({fmtNumber(summary.meanRateHz, 1)} per second)
                  </dd>
                  <dt>Orientation change (estimated)</dt>
                  <dd className="num">
                    {summary.changeRangeDeg === null ? '—' : `${fmtNumber(summary.changeMinDeg, 1)}° to ${fmtNumber(summary.changeMaxDeg, 1)}° (range ${fmtNumber(summary.changeRangeDeg, 1)}°)`}
                  </dd>
                  <dt>Peak rotation rate</dt>
                  <dd className="num">{summary.peakRotationRateDegS === null ? '—' : `${fmtNumber(summary.peakRotationRateDegS, 0)} °/s`}</dd>
                  <dt>Method</dt>
                  <dd>{m.baseline?.method === 'gravity' ? 'Gravity direction (orientation unavailable; noisier)' : 'Phone long-axis direction from orientation sensors'}</dd>
                </dl>
                <ChangeChart points={m.recorded.samples.map((x) => ({ t: x.t, v: x.changeDeg }))} testId="review-chart" />
                <p className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>{ESTIMATE_LABEL}. It is stored separately from imported movement sessions and is not used in range-of-motion figures.</p>
              </>
            )}
            <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} style={{ minHeight: 70 }} disabled={saving} />
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || summary.sampleCount === 0}>
                {saving && <span className="spinner" aria-hidden />} {saving ? 'Saving…' : 'Save recording'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={saving || summary.sampleCount === 0}>
                <Download aria-hidden /> Export CSV
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDiscard(true)} disabled={saving}>
                Discard
              </button>
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this recording?"
        body="The readings from this recording will be lost. Export or save first if you want to keep them."
        confirmLabel="Discard"
        danger
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => m.discard()}
      />
    </>
  );
}

function SensorRecordingsList() {
  const { ownerUid, readOnly } = useRecords();
  const { data } = useServices();
  const { notify } = useToast();
  const [recs, setRecs] = useState<SensorRecording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SensorRecording | null>(null);
  const [samples, setSamples] = useState<SensorSample[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SensorRecording | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => data.subscribeSensorRecordings(ownerUid, setRecs, (e) => setError(e.message)), [data, ownerUid]);
  useEffect(() => {
    if (!viewing) return;
    let cancelled = false;
    setSamples(null);
    setLoadError(null);
    data.getSensorRecordingSamples(ownerUid, viewing).then(
      (x) => !cancelled && setSamples(x),
      (e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Could not load the recording.'),
    );
    return () => {
      cancelled = true;
    };
  }, [data, ownerUid, viewing]);

  const exportRec = async (r: SensorRecording) => {
    setExporting(r.id);
    try {
      const x = await data.getSensorRecordingSamples(ownerUid, r);
      downloadText(`rheumatrack_phone_${r.side}_${r.segment}_${r.id}.csv`, sensorSamplesToCsv(x, r), 'text/csv');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  };

  if (error) return <ErrorCard message={error} />;
  return (
    <section className="card stack" aria-labelledby="saved-title">
      <div className="card-title" id="saved-title">
        Saved phone sensor recordings
      </div>
      {recs === null ? (
        <div className="skeleton" style={{ height: 60 }} aria-label="Loading recordings" />
      ) : recs.length === 0 ? (
        <EmptyState icon={Smartphone} title="No phone sensor recordings yet">
          {readOnly ? 'The patient has not saved any phone sensor recordings.' : 'Recordings you save appear here.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="sensor-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Placement</th>
                <th>Duration</th>
                <th>Orientation change (est.)</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button type="button" className="link-btn cell-strong" onClick={() => setViewing(r)}>
                      {fmtDateTime(r.startedAt)}
                    </button>
                  </td>
                  <td>
                    {sideLabel(r.side)} {segmentLabel(r.segment).toLowerCase()}
                  </td>
                  <td className="num">{fmtDuration(r.summary.activeDurationMs)}</td>
                  <td className="num">{r.summary.changeRangeDeg === null ? '—' : `range ${fmtNumber(r.summary.changeRangeDeg, 1)}°`}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                      <button type="button" className="icon-btn" aria-label={`Export recording from ${fmtDateTime(r.startedAt)} as CSV`} disabled={exporting === r.id} onClick={() => void exportRec(r)}>
                        {exporting === r.id ? <span className="spinner" aria-hidden /> : <Download aria-hidden />}
                      </button>
                      {!readOnly && (
                        <button type="button" className="icon-btn" aria-label={`Delete recording from ${fmtDateTime(r.startedAt)}`} onClick={() => setDeleting(r)}>
                          <Trash2 aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="subtle" style={{ fontSize: 'var(--fs-sm)' }}>
        <TriangleAlert aria-hidden style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> {ESTIMATE_LABEL}.
      </p>

      <Modal
        open={viewing !== null}
        wide
        title={viewing ? `Phone sensor — ${sideLabel(viewing.side)} ${segmentLabel(viewing.segment).toLowerCase()}` : ''}
        onClose={() => setViewing(null)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setViewing(null)}>
            Close
          </button>
        }
      >
        {viewing && (
          <div className="stack">
            <dl className="kv">
              <dt>Recorded</dt>
              <dd>{fmtDateTime(viewing.startedAt)}</dd>
              <dt>Duration</dt>
              <dd>{fmtDuration(viewing.summary.activeDurationMs)}</dd>
              <dt>Samples</dt>
              <dd className="num">{viewing.summary.sampleCount.toLocaleString('en')}</dd>
              <dt>Orientation change</dt>
              <dd className="num">
                {viewing.summary.changeRangeDeg === null ? '—' : `${fmtNumber(viewing.summary.changeMinDeg, 1)}° to ${fmtNumber(viewing.summary.changeMaxDeg, 1)}° (estimated)`}
              </dd>
              <dt>Notes</dt>
              <dd>{viewing.notes || '—'}</dd>
            </dl>
            {loadError ? <Alert kind="danger" role="alert">{loadError}</Alert> : samples ? <ChangeChart points={samples.map((x) => ({ t: x.t, v: x.changeDeg }))} /> : <div className="skeleton" style={{ height: 220 }} />}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this sensor recording?"
        body="The recording and all of its readings will be permanently removed."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await data.deleteSensorRecording(ownerUid, deleting);
          notify('success', 'Sensor recording deleted.');
        }}
      />
    </section>
  );
}
