/**
 * Wurf-Eingabe am Handy (Bowling, Boule …): Schwung mit dem Bewegungssensor (Knopf halten, schwingen, loslassen)
 * oder Wischen als Touch-Alternative. Die Wahl wird gespeichert und gilt für alle Wurfspiele.
 */
import { el, q, toast } from './core';
import { type MotionSample, type SwingScale, enableMotion, motionSupport, onMotion } from './motion';
import { BOWL_SCALE, type BowlThrow, type SwipePoint, type ThrowResult, swingToThrow, swipeToThrow } from './bowlingThrow';
import { type ThrowInfo, motionInfo, swipeInfo } from './motionFeedback';

const PREF_KEY = 'lanabfahrt.bowlMode';
type Mode = 'motion' | 'touch' | 'ask';

export interface ThrowInputTexts {
  /** Erklärung beim ersten Mal (Sensor oder Wischen?) */
  ask: string;
  /** Hinweis über dem Schwung-Knopf */
  motionHint: string;
  /** Text im Wisch-Feld (HTML erlaubt) */
  padText: string;
  /** zusätzliche CSS-Klasse für das Wisch-Feld */
  padClass?: string;
  /** Beschriftung des Sensor-Knopfs (HTML), Standard „HALTEN & SCHWINGEN“ */
  button?: string;
  /** Beschriftung, solange der Knopf gehalten wird (HTML) */
  holding?: string;
  /** Umrechnung der Sensordaten (Standard: Bowling-Schwung) – z. B. Darts: kurzes Schnippen */
  swing?: (samples: MotionSample[]) => ThrowResult;
  /** Umrechnung der Wischgeste (Standard: Tempo = Stärke) – z. B. Flunkyball: Länge = Kraft */
  swipe?: (pts: SwipePoint[], padH: number) => ThrowResult;
  /** Skala von `swing` fürs Feedback (Standard: Bowling) */
  scale?: SwingScale;
}

/** Rückmeldungen für die Feedback-Karte (siehe motionFeedback.ts) */
export interface ThrowInputHooks {
  /** Ein neuer Versuch beginnt (Knopf gedrückt / Finger aufs Wischfeld) */
  onStart?: () => void;
  /** Versuch zählte nicht als Wurf */
  onFail?: (reason: string, info: ThrowInfo) => void;
}

function initialMode(): Mode {
  const pref = localStorage.getItem(PREF_KEY);
  const sup = motionSupport();
  if (sup === 'insecure' || sup === 'unsupported' || pref === 'touch') return 'touch';
  if (pref === 'motion' && sup === 'ok') return 'motion';
  return 'ask';
}

/**
 * Baut die Wurf-Steuerung in `area` ein. `onThrow` wird genau einmal aufgerufen.
 * Rückgabe: stop() meldet den Bewegungssensor ab.
 */
export function mountThrowInput(
  area: HTMLElement,
  root: HTMLElement,
  texts: ThrowInputTexts,
  onThrow: (t: BowlThrow, info: ThrowInfo) => void,
  hooks: ThrowInputHooks = {},
) {
  let thrown = false;
  const doThrow = (t: BowlThrow, info: ThrowInfo) => {
    if (thrown) return;
    thrown = true;
    stopMotion();
    onThrow(t, info);
  };

  let unsub: (() => void) | null = null;
  const stopMotion = () => {
    unsub?.();
    unsub = null;
  };
  const show = (mode: Mode) => {
    stopMotion();
    area.innerHTML = '';
    if (mode === 'ask') showAsk();
    else if (mode === 'motion') showMotion();
    else showTouch();
  };

  const showAsk = () => {
    const box = el(`
      <div class="bw-ask">
        <p>${texts.ask}</p>
        <button class="bw-enable">Bewegungssensor aktivieren</button>
        <button class="secondary small bw-touch">Lieber wischen</button>
      </div>
    `);
    q(box, '.bw-enable').addEventListener('click', async () => {
      const ok = await enableMotion();
      if (!ok) {
        toast('Kein Zugriff auf den Bewegungssensor – dann wischen!');
        localStorage.setItem(PREF_KEY, 'touch');
        return show('touch');
      }
      localStorage.setItem(PREF_KEY, 'motion');
      show('motion');
    });
    q(box, '.bw-touch').addEventListener('click', () => {
      localStorage.setItem(PREF_KEY, 'touch');
      show('touch');
    });
    area.append(box);
  };

  const btnText = texts.button ?? 'HALTEN &amp;<br/>SCHWINGEN';
  const showMotion = () => {
    const box = el(`
      <p class="bw-hint">${texts.motionHint}</p>
      <button class="big-btn bw-swing">${btnText}</button>
      <button class="secondary small bw-switch">Lieber wischen</button>
    `);
    area.append(box);
    const btn = q<HTMLButtonElement>(box, '.bw-swing');
    const hint = q(box, '.bw-hint');
    let samples: MotionSample[] = [];
    let recording = false;
    let gotSample = false;
    unsub = onMotion((m) => {
      if (!root.isConnected) return stopMotion();
      if (m.t > 0 && (m.ax || m.ay || m.az || m.rotAlpha || m.rotBeta || m.rotGamma)) gotSample = true;
      if (recording) samples.push({ ...m });
    });
    // Kommen gar keine Sensordaten (z. B. Laptop), auf Wischen umschalten
    window.setTimeout(() => {
      if (root.isConnected && !gotSample && !thrown && area.contains(btn)) {
        toast('Kein Bewegungssensor gefunden – wisch stattdessen!');
        show('touch');
      }
    }, 1500);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (thrown) return;
      btn.setPointerCapture(e.pointerId);
      samples = [];
      recording = true;
      btn.classList.add('holding');
      hooks.onStart?.();
      btn.innerHTML = texts.holding ?? 'SCHWINGEN …<br/><small>und loslassen!</small>';
      navigator.vibrate?.(15);
    });
    const release = () => {
      if (!recording) return;
      recording = false;
      btn.classList.remove('holding');
      btn.innerHTML = btnText;
      const r = (texts.swing ?? swingToThrow)(samples);
      const info = motionInfo(samples, texts.scale ?? BOWL_SCALE);
      if (r.ok) doThrow(r.t, info);
      else {
        hint.textContent = r.reason;
        hooks.onFail?.(r.reason, info);
      }
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    q(box, '.bw-switch').addEventListener('click', () => {
      localStorage.setItem(PREF_KEY, 'touch');
      show('touch');
    });
  };

  const showTouch = () => {
    const sup = motionSupport();
    const box = el(`
      <div class="swipe-pad bw-pad ${texts.padClass ?? ''}">
        <p class="pad-text">${texts.padText}</p>
        <div class="bw-ball"></div>
      </div>
      ${sup === 'ok' || sup === 'needs-permission' ? '<button class="secondary small bw-switch">Mit Schwung werfen (Sensor)</button>' : ''}
      ${sup === 'insecure' ? '<p class="bw-hint">Schwung-Steuerung geht nur über HTTPS – hier wird gewischt.</p>' : ''}
    `);
    area.append(box);
    const pad = q(box, '.bw-pad');
    const ball = q(box, '.bw-ball');
    const text = q(box, '.pad-text');
    let pts: SwipePoint[] = [];
    let pid: number | null = null;
    let origin = { x: 0, y: 0 };
    pad.addEventListener('pointerdown', (e) => {
      if (thrown) return;
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      pts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      const r = pad.getBoundingClientRect();
      origin = { x: r.left, y: r.top };
      hooks.onStart?.();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      ball.style.left = `${e.clientX - origin.x}px`;
      ball.style.top = `${e.clientY - origin.y}px`;
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      ball.style.left = '';
      ball.style.top = '';
      const r = (texts.swipe ?? swipeToThrow)(pts, pad.clientHeight);
      const info = swipeInfo(pts);
      if (r.ok) doThrow(r.t, info);
      else {
        text.textContent = r.reason;
        // bloßes Antippen braucht keine Auswertung
        if (pts.length > 2) hooks.onFail?.(r.reason, info);
      }
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    box.querySelector('.bw-switch')?.addEventListener('click', async () => {
      const ok = motionSupport() === 'ok' ? true : await enableMotion();
      if (!ok) return toast('Kein Zugriff auf den Bewegungssensor.');
      localStorage.setItem(PREF_KEY, 'motion');
      show('motion');
    });
  };

  show(initialMode());
  return { stop: stopMotion, get thrown() { return thrown; } };
}
