import type { Side } from './joints';

/**
 * Phone motion-sensor recordings (docs/PHONE_SENSOR.md).
 *
 * The browser provides DeviceOrientation (alpha/beta/gamma, degrees) and DeviceMotion
 * (rotation rate in deg/s, acceleration including gravity in m/s²). Those raw readings are
 * stored exactly as received.
 *
 * One value is DERIVED: "phone orientation change" — the angle between the phone's long axis
 * now and its long axis during the still baseline. When the phone is strapped lengthwise along
 * a limb segment, this approximates how far that segment has rotated. It is an ESTIMATE from a
 * consumer phone, not a validated joint angle, and is always labelled as such.
 *
 * Method "orientation" (preferred): long axis from the W3C DeviceOrientation Euler angles.
 *   R = Rz(alpha) · Rx(beta) · Ry(gamma);  device y-axis in Earth frame = R · [0, 1, 0]
 *     = [ −sin α · cos β,  cos α · cos β,  sin β ]
 *   Gamma (rotation about the long axis itself) does not move the long axis, so forearm
 *   pronation/supination does not register as a change.
 * Method "gravity" (fallback when orientation is unavailable): the angle between the current
 *   and baseline gravity vectors from accelerationIncludingGravity. Linear acceleration during
 *   quick movement adds error, so readings are noisier.
 */

export type SensorSegment = 'forearm' | 'upper-arm' | 'hand' | 'thigh' | 'shin' | 'foot';
export type ChangeMethod = 'orientation' | 'gravity';

export const SENSOR_SEGMENTS: ReadonlyArray<{ id: SensorSegment; label: string; hint: string }> = [
  { id: 'forearm', label: 'Forearm', hint: 'Strap the phone lengthwise along the forearm, screen facing out, top of the phone toward the wrist. Useful for elbow flexion/extension.' },
  { id: 'upper-arm', label: 'Upper arm', hint: 'Strap the phone lengthwise on the outside of the upper arm, top toward the elbow. Useful for shoulder flexion/abduction.' },
  { id: 'hand', label: 'Back of the hand', hint: 'Hold or strap the phone flat on the back of the hand, top toward the fingers. Useful for wrist flexion/extension.' },
  { id: 'thigh', label: 'Thigh', hint: 'Strap the phone lengthwise on the front of the thigh, top toward the knee. Useful for hip flexion.' },
  { id: 'shin', label: 'Shin', hint: 'Strap the phone lengthwise on the front of the shin, top toward the ankle. Useful for knee flexion/extension.' },
  { id: 'foot', label: 'Top of the foot', hint: 'Strap the phone flat on the top of the foot, top toward the toes. Useful for ankle dorsi-/plantarflexion.' },
];

export const SENSOR_LIMITS = {
  /** A recording stops automatically at this length (active time). */
  maxDurationMs: 5 * 60 * 1000,
  maxSamples: 30_000,
  /** Baseline: hold still for this long; the long axis must not wander more than maxDeviationDeg. */
  baselineDurationMs: 2000,
  baselineMinSamples: 15,
  baselineMaxDeviationDeg: 3,
  /** No sensor event within this time after starting → "no data". */
  noDataTimeoutMs: 3000,
} as const;

export type Vec3 = [number, number, number];

export interface SensorSample {
  /** Epoch ms. */
  t: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** Rotation rate, deg/s (DeviceMotion rotationRate alpha/beta/gamma). */
  rotAlpha: number | null;
  rotBeta: number | null;
  rotGamma: number | null;
  /** Acceleration including gravity, m/s². */
  ax: number | null;
  ay: number | null;
  az: number | null;
  /** Derived, degrees — estimated phone orientation change from the baseline. */
  changeDeg: number | null;
}

export interface SensorBaseline {
  method: ChangeMethod;
  vector: Vec3;
  sampleCount: number;
  durationMs: number;
  maxDeviationDeg: number;
  passed: boolean;
  messages: string[];
}

export interface SensorSummary {
  sampleCount: number;
  activeDurationMs: number;
  meanRateHz: number;
  changeMinDeg: number | null;
  changeMaxDeg: number | null;
  changeRangeDeg: number | null;
  peakRotationRateDegS: number | null;
  peakAccelerationMs2: number | null;
}

export interface SensorRecording {
  id: string;
  ownerUid: string;
  segment: SensorSegment;
  side: Side;
  method: ChangeMethod;
  startedAt: number;
  endedAt: number;
  createdAt: number;
  summary: SensorSummary;
  baseline: { vector: Vec3; durationMs: number; maxDeviationDeg: number };
  deviceInfo: string;
  notes: string;
  chunkCount: number;
  schemaVersion: 1;
}

const DEG = Math.PI / 180;

export function longAxisVector(alpha: number | null, beta: number, _gamma?: number | null): Vec3 {
  const a = (alpha ?? 0) * DEG;
  const b = beta * DEG;
  return [-Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalise(v: Vec3): Vec3 | null {
  const n = norm(v);
  if (!(n > 1e-9)) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Angle between two vectors in degrees (0–180). */
export function angleBetweenDeg(u: Vec3, v: Vec3): number {
  const nu = norm(u);
  const nv = norm(v);
  if (!(nu > 0) || !(nv > 0)) return NaN;
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/** Vector used by the chosen method for one sample, or null when the sample lacks the data. */
export function sampleVector(s: Pick<SensorSample, 'alpha' | 'beta' | 'gamma' | 'ax' | 'ay' | 'az'>, method: ChangeMethod): Vec3 | null {
  if (method === 'orientation') {
    if (s.beta === null || !Number.isFinite(s.beta)) return null;
    return longAxisVector(s.alpha, s.beta, s.gamma);
  }
  if (s.ax === null || s.ay === null || s.az === null) return null;
  return normalise([s.ax, s.ay, s.az]);
}

/** Orientation is preferred whenever beta values are present. */
export function chooseMethod(samples: ReadonlyArray<Pick<SensorSample, 'beta' | 'ax'>>): ChangeMethod | null {
  if (samples.some((s) => s.beta !== null)) return 'orientation';
  if (samples.some((s) => s.ax !== null)) return 'gravity';
  return null;
}

export function evaluateBaseline(samples: readonly SensorSample[]): SensorBaseline {
  const messages: string[] = [];
  const method = chooseMethod(samples) ?? 'orientation';
  const vecs = samples.map((s) => sampleVector(s, method)).filter((v): v is Vec3 => v !== null);
  const durationMs = samples.length >= 2 ? (samples[samples.length - 1] as SensorSample).t - (samples[0] as SensorSample).t : 0;
  let passed = true;
  if (vecs.length < SENSOR_LIMITS.baselineMinSamples) {
    passed = false;
    messages.push(`Only ${vecs.length} usable readings were received; at least ${SENSOR_LIMITS.baselineMinSamples} are needed.`);
  }
  const sum: Vec3 = [0, 0, 0];
  for (const v of vecs) {
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  const mean = normalise(sum) ?? [0, 1, 0];
  let maxDev = 0;
  for (const v of vecs) maxDev = Math.max(maxDev, angleBetweenDeg(v, mean));
  if (durationMs < SENSOR_LIMITS.baselineDurationMs * 0.9) {
    passed = false;
    messages.push(`The hold lasted ${(durationMs / 1000).toFixed(1)} s; hold still for ${SENSOR_LIMITS.baselineDurationMs / 1000} s.`);
  }
  if (vecs.length > 0 && maxDev > SENSOR_LIMITS.baselineMaxDeviationDeg) {
    passed = false;
    messages.push(`The phone moved ${maxDev.toFixed(1)}° during the hold (limit ${SENSOR_LIMITS.baselineMaxDeviationDeg}°). Keep the limb still and try again.`);
  }
  if (passed) messages.push(`Baseline captured from ${vecs.length} readings (movement during hold ${maxDev.toFixed(1)}°).`);
  return { method, vector: mean, sampleCount: vecs.length, durationMs, maxDeviationDeg: maxDev, passed, messages };
}

export function changeFromBaseline(s: SensorSample, baseline: Pick<SensorBaseline, 'method' | 'vector'>): number | null {
  const v = sampleVector(s, baseline.method);
  if (!v) return null;
  const a = angleBetweenDeg(v, baseline.vector);
  return Number.isFinite(a) ? a : null;
}

export function summariseRecording(samples: readonly SensorSample[], activeDurationMs: number): SensorSummary {
  let cmin = Infinity;
  let cmax = -Infinity;
  let rotPeak = -Infinity;
  let accPeak = -Infinity;
  for (const s of samples) {
    if (s.changeDeg !== null) {
      cmin = Math.min(cmin, s.changeDeg);
      cmax = Math.max(cmax, s.changeDeg);
    }
    if (s.rotAlpha !== null && s.rotBeta !== null && s.rotGamma !== null) rotPeak = Math.max(rotPeak, Math.hypot(s.rotAlpha, s.rotBeta, s.rotGamma));
    if (s.ax !== null && s.ay !== null && s.az !== null) accPeak = Math.max(accPeak, Math.hypot(s.ax, s.ay, s.az));
  }
  const fin = (x: number) => (Number.isFinite(x) ? x : null);
  return {
    sampleCount: samples.length,
    activeDurationMs,
    meanRateHz: activeDurationMs > 0 ? (samples.length / activeDurationMs) * 1000 : 0,
    changeMinDeg: fin(cmin),
    changeMaxDeg: fin(cmax),
    changeRangeDeg: Number.isFinite(cmin) && Number.isFinite(cmax) ? cmax - cmin : null,
    peakRotationRateDegS: fin(rotPeak),
    peakAccelerationMs2: fin(accPeak),
  };
}

export const SENSOR_CSV_COLUMNS = [
  'timestamp',
  'elapsedMs',
  'alphaDeg',
  'betaDeg',
  'gammaDeg',
  'rotationRateAlphaDegPerS',
  'rotationRateBetaDegPerS',
  'rotationRateGammaDegPerS',
  'accelXIncludingGravityMs2',
  'accelYIncludingGravityMs2',
  'accelZIncludingGravityMs2',
  'phoneOrientationChangeDeg_estimated',
] as const;

export function sensorSamplesToCsv(samples: readonly SensorSample[], meta: { segment: SensorSegment; side: Side; method: ChangeMethod }): string {
  const v = (x: number | null) => (x === null ? '' : String(x));
  const t0 = samples[0]?.t ?? 0;
  const head = [
    `# RheumaTrack phone sensor recording — ${meta.side} ${meta.segment}; change method: ${meta.method}`,
    '# phoneOrientationChangeDeg_estimated is an estimate from a consumer phone, not a validated joint angle.',
    SENSOR_CSV_COLUMNS.join(','),
  ];
  const rows = samples.map((s) =>
    [new Date(s.t).toISOString(), s.t - t0, v(s.alpha), v(s.beta), v(s.gamma), v(s.rotAlpha), v(s.rotBeta), v(s.rotGamma), v(s.ax), v(s.ay), v(s.az), v(s.changeDeg)].join(','),
  );
  return [...head, ...rows].join('\n') + '\n';
}

export function segmentLabel(segment: SensorSegment): string {
  return SENSOR_SEGMENTS.find((s) => s.id === segment)?.label ?? segment;
}
