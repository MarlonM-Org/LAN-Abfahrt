/**
 * Bewegungssensor auf dem Handy (für Bowling, Ententeich, Kipp-Lenkung …).
 *
 * - iPhones liefern Sensordaten nur über HTTPS und erst nach einer Erlaubnis,
 *   die aus einem Tap heraus angefragt werden muss → enableMotion() im Click-Handler aufrufen.
 * - Ohne HTTPS (oder ohne Sensor) muss jedes Spiel eine Touch-Alternative anbieten.
 */

export type MotionSupport = 'ok' | 'needs-permission' | 'insecure' | 'unsupported';

export interface MotionSample {
  /** Ausrichtung in Grad (deviceorientation): alpha = Kompass, beta = vor/zurück, gamma = links/rechts */
  alpha: number;
  beta: number;
  gamma: number;
  /** Beschleunigung inkl. Schwerkraft in m/s² */
  ax: number;
  ay: number;
  az: number;
  /** Drehrate in °/s */
  rotAlpha: number;
  rotBeta: number;
  rotGamma: number;
  /** performance.now() */
  t: number;
}

type MotionPermissionFn = () => Promise<'granted' | 'denied'>;
const permissionFn = (target: unknown): MotionPermissionFn | undefined =>
  (target as { requestPermission?: MotionPermissionFn } | undefined)?.requestPermission;

let granted = false;

export function motionSupport(): MotionSupport {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (granted) return 'ok';
  return permissionFn(window.DeviceMotionEvent) ? 'needs-permission' : 'ok';
}

/** Muss direkt aus einem Tap/Click aufgerufen werden. Liefert true, wenn Sensordaten kommen dürfen. */
export async function enableMotion(): Promise<boolean> {
  const support = motionSupport();
  if (support === 'ok') return (granted = true);
  if (support !== 'needs-permission') return false;
  try {
    const motion = await permissionFn(window.DeviceMotionEvent)!();
    const orient = permissionFn(window.DeviceOrientationEvent);
    const orientation = orient ? await orient() : 'granted';
    granted = motion === 'granted' && orientation === 'granted';
  } catch {
    granted = false;
  }
  return granted;
}

/** Abonniert Sensordaten; gibt eine Abmelde-Funktion zurück. */
export function onMotion(cb: (s: MotionSample) => void): () => void {
  const s: MotionSample = { alpha: 0, beta: 0, gamma: 0, ax: 0, ay: 0, az: 0, rotAlpha: 0, rotBeta: 0, rotGamma: 0, t: 0 };
  const orient = (e: DeviceOrientationEvent) => {
    s.alpha = e.alpha ?? 0;
    s.beta = e.beta ?? 0;
    s.gamma = e.gamma ?? 0;
  };
  const motion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    s.ax = a?.x ?? 0;
    s.ay = a?.y ?? 0;
    s.az = a?.z ?? 0;
    s.rotAlpha = e.rotationRate?.alpha ?? 0;
    s.rotBeta = e.rotationRate?.beta ?? 0;
    s.rotGamma = e.rotationRate?.gamma ?? 0;
    s.t = performance.now();
    cb(s);
  };
  window.addEventListener('deviceorientation', orient);
  window.addEventListener('devicemotion', motion);
  return () => {
    window.removeEventListener('deviceorientation', orient);
    window.removeEventListener('devicemotion', motion);
  };
}

/** Drehrate gesamt (°/s) */
export const swingRot = (s: MotionSample) => Math.hypot(s.rotAlpha, s.rotBeta, s.rotGamma);
/** Beschleunigung ohne Schwerkraft (m/s²) */
export const swingAcc = (s: MotionSample) => Math.abs(Math.hypot(s.ax, s.ay, s.az) - 9.81);

/**
 * Skala eines Schwung-Verfahrens (für das Feedback am Handy): `level` rechnet einen Messwert in die
 * Roh-Stärke 0 … 1 um, mit der auch die Wurf-Umrechnung arbeitet; `windowMs` = ausgewertetes Zeitfenster
 * vor dem Loslassen; `yawLimit` = ab so viel Grad gilt die Kompass-Drehung als Sprung und wird ignoriert.
 */
export interface SwingScale {
  level: (s: MotionSample) => number;
  windowMs: number;
  yawLimit: number;
}
