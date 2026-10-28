import { describe, expect, it } from 'vitest';
import {
  angleBetweenDeg,
  changeFromBaseline,
  chooseMethod,
  evaluateBaseline,
  longAxisVector,
  sensorSamplesToCsv,
  summariseRecording,
  type SensorSample,
} from './sensor';

function sample(t: number, o: Partial<SensorSample> = {}): SensorSample {
  return { t, alpha: 0, beta: 0, gamma: 0, rotAlpha: 0, rotBeta: 0, rotGamma: 0, ax: 0, ay: 0, az: 9.81, changeDeg: null, ...o };
}
const round = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

describe('long-axis vector from DeviceOrientation (W3C Z-X′-Y″ convention)', () => {
  it('flat phone, top pointing north → +Y', () => {
    expect(round(longAxisVector(0, 0, 0))).toEqual([0, 1, 0]);
  });
  it('beta 90° (phone upright) → long axis points up (+Z)', () => {
    expect(round(longAxisVector(0, 90, 0))).toEqual([0, 0, 1]);
  });
  it('alpha 90° rotates the long axis toward −X (west)', () => {
    expect(round(longAxisVector(90, 0, 0))).toEqual([-1, 0, 0]);
  });
  it('gamma (rotation about the long axis) does not change it', () => {
    expect(round(longAxisVector(30, 40, 75))).toEqual(round(longAxisVector(30, 40, -20)));
  });
  it('a tilt of the phone by θ gives a change of θ', () => {
    expect(angleBetweenDeg(longAxisVector(0, 10), longAxisVector(0, 55))).toBeCloseTo(45, 9);
    expect(angleBetweenDeg(longAxisVector(0, 0), longAxisVector(0, 0))).toBe(0);
  });
});

describe('baseline', () => {
  const still = Array.from({ length: 40 }, (_, i) => sample(i * 55, { beta: 20 + (i % 2 ? 0.5 : -0.5), alpha: 100 }));

  it('passes a still, long-enough hold and uses the orientation method', () => {
    const b = evaluateBaseline(still);
    expect(b.passed).toBe(true);
    expect(b.method).toBe('orientation');
    expect(b.maxDeviationDeg).toBeLessThan(1);
  });
  it('fails a moving hold, a short hold and a hold without data', () => {
    expect(evaluateBaseline(still.map((s, i) => ({ ...s, beta: i * 2 }))).passed).toBe(false);
    expect(evaluateBaseline(still.slice(0, 10)).passed).toBe(false);
    expect(evaluateBaseline(still.map((s) => ({ ...s, beta: null, ax: null, ay: null, az: null }))).passed).toBe(false);
  });
  it('falls back to gravity when orientation is unavailable', () => {
    const noOrient = still.map((s) => ({ ...s, alpha: null, beta: null, gamma: null }));
    expect(chooseMethod(noOrient)).toBe('gravity');
    const b = evaluateBaseline(noOrient);
    expect(b.method).toBe('gravity');
    expect(b.passed).toBe(true);
  });
});

describe('change from baseline and summary', () => {
  it('measures change relative to the baseline vector', () => {
    const b = evaluateBaseline(Array.from({ length: 40 }, (_, i) => sample(i * 55, { beta: 0 })));
    expect(changeFromBaseline(sample(0, { beta: 30 }), b)).toBeCloseTo(30, 6);
    expect(changeFromBaseline(sample(0, { beta: null }), b)).toBeNull();
  });
  it('gravity method: tilting gravity by 90° gives 90°', () => {
    const b = evaluateBaseline(Array.from({ length: 40 }, (_, i) => sample(i * 55, { alpha: null, beta: null, gamma: null, ax: 0, ay: 0, az: 9.81 })));
    expect(changeFromBaseline(sample(0, { alpha: null, beta: null, gamma: null, ax: 0, ay: 9.81, az: 0 }), b)).toBeCloseTo(90, 6);
  });
  it('summarises only real values', () => {
    const s = summariseRecording(
      [sample(0, { changeDeg: 5, rotAlpha: 3, rotBeta: 4, rotGamma: 0 }), sample(100, { changeDeg: 65 }), sample(200, { changeDeg: null, ax: null })],
      2000,
    );
    expect(s).toMatchObject({ sampleCount: 3, changeMinDeg: 5, changeMaxDeg: 65, changeRangeDeg: 60, peakRotationRateDegS: 5, meanRateHz: 1.5 });
    expect(summariseRecording([], 0)).toMatchObject({ changeRangeDeg: null, peakRotationRateDegS: null, meanRateHz: 0 });
  });
  it('exports every sample with blanks for missing values and a labelled estimate column', () => {
    const csv = sensorSamplesToCsv([sample(Date.UTC(2026, 9, 27), { changeDeg: 12.5 }), sample(Date.UTC(2026, 9, 27) + 20, { beta: null, changeDeg: null })], { segment: 'shin', side: 'left', method: 'orientation' });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toMatch(/not a validated joint angle/);
    expect(lines[2]).toMatch(/phoneOrientationChangeDeg_estimated$/);
    expect(lines[3]).toBe('2026-10-27T00:00:00.000Z,0,0,0,0,0,0,0,0,0,9.81,12.5');
    expect(lines[4]).toBe('2026-10-27T00:00:00.020Z,20,0,,0,0,0,0,0,0,9.81,');
  });
});
