/**
 * Access to the phone's motion sensors through the browser (DeviceOrientation and
 * DeviceMotion events). Kept behind an interface so the monitor can be tested with simulated
 * events; tests never pretend to be a real device.
 */
export interface OrientationReading {
  t: number;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

export interface MotionReading {
  t: number;
  rotAlpha: number | null;
  rotBeta: number | null;
  rotGamma: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
}

export interface SensorSupport {
  orientation: boolean;
  motion: boolean;
  secure: boolean;
}

export interface SensorSource {
  support(): SensorSupport;
  /** True on browsers (iOS Safari) that require an explicit permission request from a tap. */
  needsPermission(): boolean;
  /** Must be called from a user gesture (button click). */
  requestPermission(): Promise<'granted' | 'denied'>;
  /** Starts listening; returns a function that removes every listener. */
  start(onOrientation: (r: OrientationReading) => void, onMotion: (r: MotionReading) => void): () => void;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

type PermissionCapable = { requestPermission?: () => Promise<string> };

export const browserSensorSource: SensorSource = {
  support() {
    const w = typeof window === 'undefined' ? undefined : window;
    return {
      orientation: !!w && 'DeviceOrientationEvent' in w,
      motion: !!w && 'DeviceMotionEvent' in w,
      secure: !!w && w.isSecureContext === true,
    };
  },
  needsPermission() {
    const O = (globalThis as unknown as { DeviceOrientationEvent?: PermissionCapable }).DeviceOrientationEvent;
    const M = (globalThis as unknown as { DeviceMotionEvent?: PermissionCapable }).DeviceMotionEvent;
    return typeof O?.requestPermission === 'function' || typeof M?.requestPermission === 'function';
  },
  async requestPermission() {
    const O = (globalThis as unknown as { DeviceOrientationEvent?: PermissionCapable }).DeviceOrientationEvent;
    const M = (globalThis as unknown as { DeviceMotionEvent?: PermissionCapable }).DeviceMotionEvent;
    try {
      // Requested together, inside the same tap, so iOS shows a single prompt.
      const results = await Promise.all([
        typeof M?.requestPermission === 'function' ? M.requestPermission() : Promise.resolve('granted'),
        typeof O?.requestPermission === 'function' ? O.requestPermission() : Promise.resolve('granted'),
      ]);
      return results.every((r) => r === 'granted') ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  },
  start(onOrientation, onMotion) {
    const handleOrientation = (e: Event) => {
      const o = e as DeviceOrientationEvent;
      onOrientation({ t: Date.now(), alpha: num(o.alpha), beta: num(o.beta), gamma: num(o.gamma) });
    };
    const handleMotion = (e: Event) => {
      const m = e as DeviceMotionEvent;
      const r = m.rotationRate;
      const g = m.accelerationIncludingGravity;
      onMotion({
        t: Date.now(),
        rotAlpha: num(r?.alpha),
        rotBeta: num(r?.beta),
        rotGamma: num(r?.gamma),
        ax: num(g?.x),
        ay: num(g?.y),
        az: num(g?.z),
      });
    };
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  },
};
