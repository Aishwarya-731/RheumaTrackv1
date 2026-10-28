import { useCallback, useEffect, useRef, useState } from 'react';
import { changeFromBaseline, evaluateBaseline, SENSOR_LIMITS, type SensorBaseline, type SensorSample } from '@/domain/sensor';
import type { MotionReading, OrientationReading, SensorSource } from './sensorSource';

export type Connection = 'idle' | 'unsupported' | 'insecure' | 'requesting' | 'denied' | 'connecting' | 'no-data' | 'live' | 'error';
export type Phase = 'setup' | 'baseline' | 'baseline-failed' | 'ready' | 'recording' | 'paused' | 'review';

/** Events closer together than this are merged (≈66 Hz maximum stored rate). */
const MIN_SAMPLE_GAP_MS = 15;
const UI_TICK_MS = 100;
const LIVE_WINDOW_MS = 15_000;

export interface MonitorSnapshot {
  latest: SensorSample | null;
  liveChangeDeg: number | null;
  activeMs: number;
  sampleCount: number;
  baselineProgress: number;
  window: Array<{ t: number; v: number | null }>;
}

const EMPTY: MonitorSnapshot = { latest: null, liveChangeDeg: null, activeMs: 0, sampleCount: 0, baselineProgress: 0, window: [] };

function hasData(s: Pick<SensorSample, 'beta' | 'ax' | 'rotAlpha'>): boolean {
  return s.beta !== null || s.ax !== null || s.rotAlpha !== null;
}

/**
 * State machine for the phone sensor monitor:
 *   connect → (permission) → live readings
 *   capture baseline (hold still) → ready → recording ⇄ paused → review
 * Raw readings are kept in refs and published to React at 10 Hz.
 */
export function useSensorMonitor(source: SensorSource) {
  const [connection, setConnection] = useState<Connection>('idle');
  const [phase, setPhase] = useState<Phase>('setup');
  const [baseline, setBaseline] = useState<SensorBaseline | null>(null);
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(EMPTY);
  const [autoStopReason, setAutoStopReason] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ samples: SensorSample[]; activeMs: number } | null>(null);

  const stopListening = useRef<(() => void) | null>(null);
  const phaseRef = useRef<Phase>('setup');
  const baselineRef = useRef<SensorBaseline | null>(null);
  const orient = useRef<OrientationReading | null>(null);
  const motion = useRef<MotionReading | null>(null);
  const lastSampleT = useRef(0);
  const latest = useRef<SensorSample | null>(null);
  const live = useRef<Array<{ t: number; v: number | null }>>([]);
  const baselineBuf = useRef<SensorSample[]>([]);
  const baselineStart = useRef(0);
  const rec = useRef<SensorSample[]>([]);
  const activeAccum = useRef(0);
  const activeSince = useRef<number | null>(null);
  const gotData = useRef(false);
  const noDataTimer = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const activeMs = () => activeAccum.current + (activeSince.current !== null ? Date.now() - activeSince.current : 0);

  const releaseWakeLock = () => {
    const w = wakeLock.current;
    wakeLock.current = null;
    w?.release().catch(() => undefined);
  };

  const finishRecording = useCallback(
    (reason: string | null) => {
      if (activeSince.current !== null) {
        activeAccum.current += Date.now() - activeSince.current;
        activeSince.current = null;
      }
      setAutoStopReason(reason);
      setRecorded({ samples: rec.current.slice(), activeMs: activeAccum.current });
      releaseWakeLock();
      setPhaseBoth('review');
    },
    [setPhaseBoth],
  );

  const ingest = useCallback(
    (t: number) => {
      const o = orient.current;
      const m = motion.current;
      const s: SensorSample = {
        t,
        alpha: o?.alpha ?? null,
        beta: o?.beta ?? null,
        gamma: o?.gamma ?? null,
        rotAlpha: m?.rotAlpha ?? null,
        rotBeta: m?.rotBeta ?? null,
        rotGamma: m?.rotGamma ?? null,
        ax: m?.ax ?? null,
        ay: m?.ay ?? null,
        az: m?.az ?? null,
        changeDeg: null,
      };
      if (!hasData(s)) return;
      // Orientation and motion events arrive separately; ones closer together than the minimum
      // gap update the most recent sample instead of creating a new one (nothing is dropped).
      const prev = latest.current;
      if (prev && t - lastSampleT.current < MIN_SAMPLE_GAP_MS) {
        Object.assign(prev, { ...s, t: prev.t });
        const b0 = baselineRef.current;
        prev.changeDeg = b0 ? changeFromBaseline(prev, b0) : null;
        const last = live.current[live.current.length - 1];
        if (last) last.v = prev.changeDeg;
        return;
      }
      lastSampleT.current = t;
      if (!gotData.current) {
        gotData.current = true;
        setConnection('live');
      }
      const b = baselineRef.current;
      if (b) s.changeDeg = changeFromBaseline(s, b);
      latest.current = s;
      live.current.push({ t, v: s.changeDeg });
      while (live.current.length > 0 && t - (live.current[0] as { t: number }).t > LIVE_WINDOW_MS) live.current.shift();

      const p = phaseRef.current;
      if (p === 'baseline') {
        baselineBuf.current.push(s);
        if (t - baselineStart.current >= SENSOR_LIMITS.baselineDurationMs) {
          const result = evaluateBaseline(baselineBuf.current);
          setBaseline(result);
          if (result.passed) {
            baselineRef.current = result;
            setPhaseBoth('ready');
          } else {
            setPhaseBoth('baseline-failed');
          }
        }
      } else if (p === 'recording') {
        rec.current.push(s);
        if (rec.current.length >= SENSOR_LIMITS.maxSamples) finishRecording(`Stopped automatically at ${SENSOR_LIMITS.maxSamples.toLocaleString('en')} samples.`);
        else if (activeMs() >= SENSOR_LIMITS.maxDurationMs) finishRecording(`Stopped automatically at the ${SENSOR_LIMITS.maxDurationMs / 60000}-minute limit.`);
      }
    },
    [finishRecording, setPhaseBoth],
  );

  const disconnect = useCallback(() => {
    stopListening.current?.();
    stopListening.current = null;
    if (noDataTimer.current !== null) window.clearTimeout(noDataTimer.current);
    noDataTimer.current = null;
    releaseWakeLock();
  }, []);

  const connect = useCallback(async () => {
    const sup = source.support();
    if (!sup.orientation && !sup.motion) return setConnection('unsupported');
    if (!sup.secure) return setConnection('insecure');
    if (source.needsPermission()) {
      setConnection('requesting');
      const r = await source.requestPermission();
      if (r !== 'granted') return setConnection('denied');
    }
    try {
      disconnect();
      gotData.current = false;
      setConnection('connecting');
      stopListening.current = source.start(
        (r) => {
          orient.current = r;
          ingest(r.t);
        },
        (r) => {
          motion.current = r;
          ingest(r.t);
        },
      );
      noDataTimer.current = window.setTimeout(() => {
        if (!gotData.current) setConnection('no-data');
      }, SENSOR_LIMITS.noDataTimeoutMs);
    } catch {
      setConnection('error');
    }
  }, [source, ingest, disconnect]);

  // Publish to React at a fixed rate; clean everything up on unmount.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = phaseRef.current;
      setSnapshot({
        latest: latest.current,
        liveChangeDeg: latest.current?.changeDeg ?? null,
        activeMs: activeMs(),
        sampleCount: rec.current.length,
        baselineProgress: p === 'baseline' && latest.current ? Math.min(1, (latest.current.t - baselineStart.current) / SENSOR_LIMITS.baselineDurationMs) : 0,
        window: live.current.slice(),
      });
    }, UI_TICK_MS);
    return () => {
      window.clearInterval(id);
      disconnect();
    };
  }, [disconnect]);

  const captureBaseline = useCallback(() => {
    baselineRef.current = null;
    setBaseline(null);
    baselineBuf.current = [];
    baselineStart.current = Date.now();
    live.current = [];
    setPhaseBoth('baseline');
  }, [setPhaseBoth]);

  const startRecording = useCallback(() => {
    rec.current = [];
    activeAccum.current = 0;
    activeSince.current = Date.now();
    live.current = [];
    setRecorded(null);
    setAutoStopReason(null);
    setPhaseBoth('recording');
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request('screen')
      .then((w) => (wakeLock.current = w))
      .catch(() => undefined);
  }, [setPhaseBoth]);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'recording') return;
    if (activeSince.current !== null) activeAccum.current += Date.now() - activeSince.current;
    activeSince.current = null;
    setPhaseBoth('paused');
  }, [setPhaseBoth]);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    activeSince.current = Date.now();
    setPhaseBoth('recording');
  }, [setPhaseBoth]);

  const stop = useCallback(() => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'paused') finishRecording(null);
  }, [finishRecording]);

  const discard = useCallback(() => {
    rec.current = [];
    activeAccum.current = 0;
    activeSince.current = null;
    setRecorded(null);
    setAutoStopReason(null);
    setPhaseBoth(baselineRef.current ? 'ready' : 'setup');
  }, [setPhaseBoth]);

  const resetBaseline = useCallback(() => {
    baselineRef.current = null;
    setBaseline(null);
    setPhaseBoth('setup');
  }, [setPhaseBoth]);

  return { connection, phase, baseline, snapshot, recorded, autoStopReason, connect, captureBaseline, startRecording, pause, resume, stop, discard, resetBaseline };
}
