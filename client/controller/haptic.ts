import { audio, unlockAudio } from './audio';

/**
 * Rückmeldung bei Eingaben/Treffern – ein Aufruf für alle Handys:
 *   Android: `navigator.vibrate` (Muster wie bisher)
 *   iPhone (kein Vibrations-API): sehr kurzer WebAudio-Klick + kurzer Rand-Blitz am Bildschirmrand
 * Statt fester Muster gehen auch benannte Stärken.
 */
export type HapticKind = 'tick' | 'tap' | 'hit' | 'bad' | 'win';

const PATTERN: Record<HapticKind, number | number[]> = {
  tick: 8,
  tap: 15,
  hit: 40,
  bad: [80, 60, 160],
  win: [40, 30, 70],
};

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// iPhone: AudioContext muss durch einen Tap entsperrt werden – beim ersten Berühren einmal erledigen
if (!canVibrate && typeof document !== 'undefined') {
  const unlock = () => {
    unlockAudio();
    document.removeEventListener('pointerup', unlock, true);
    document.removeEventListener('touchend', unlock, true);
  };
  document.addEventListener('pointerup', unlock, true);
  document.addEventListener('touchend', unlock, true);
}

let flashEl: HTMLElement | null = null;
let flashTimer: number | undefined;

function flash(strong: boolean) {
  flashEl ??= document.getElementById('haptic-flash');
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.id = 'haptic-flash';
    document.body.append(flashEl);
  }
  flashEl.classList.toggle('strong', strong);
  flashEl.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flashEl?.classList.remove('on'), strong ? 160 : 90);
}

function click(ms: number) {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(ms > 30 ? 140 : 320, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(ms > 30 ? 0.09 : 0.05, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.08, 0.012 + ms / 2000));
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.1);
}

export function haptic(kind: HapticKind | number | number[] = 'tap') {
  const pattern = typeof kind === 'string' ? PATTERN[kind] : kind;
  if (canVibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* egal */
    }
    return;
  }
  const total = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : pattern;
  click(total);
  // ganz kurze Ticks (Stick, Knopf-Wiederholung) nur hörbar, sonst flackert der Rand dauernd
  if (total >= 12) flash(total >= 60);
}
