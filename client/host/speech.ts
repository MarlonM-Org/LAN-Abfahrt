/**
 * Sprecher auf dem TV: kurze Ansagen über `speechSynthesis` („Drei, zwei, eins, los!“,
 * „Lena gewinnt!“). Bevorzugt eine deutsche Stimme, Lautstärke = Gesamt × Effekte,
 * schweigt bei „Stumm“, eigene kleine Warteschlange (nie mehr als 2 Ansagen im Rückstand).
 * Abschaltbar im Musikmenü (Schalter „Sprecher“, gemerkt in localStorage).
 */
import { audioReady, getFxVolume, getVolume, isMuted } from './music';

const LS_SPEECH = 'lan-abfahrt.sprecher';

const read = () => {
  try {
    return localStorage.getItem(LS_SPEECH) !== '0';
  } catch {
    return true;
  }
};

let enabled = read();
let voice: SpeechSynthesisVoice | null = null;
let pending = 0;
const listeners = new Set<() => void>();

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
export const isSpeechOn = () => enabled;

export function setSpeechOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(LS_SPEECH, on ? '1' : '0');
  } catch {
    /* privates Fenster o. Ä. – dann eben nur für diese Sitzung */
  }
  if (!on && speechSupported()) {
    speechSynthesis.cancel();
    pending = 0;
  }
  listeners.forEach((fn) => fn());
}

export function onSpeechChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Deutsche Stimme suchen (Edge/Chrome unter Windows: „Microsoft … Online (Natural)“ klingt am besten) */
function pickVoice() {
  if (!speechSupported()) return;
  const all = speechSynthesis.getVoices();
  const de = all.filter((v) => v.lang?.toLowerCase().startsWith('de'));
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1) + (v.lang === 'de-DE' ? 1 : 0);
  voice = de.sort((a, b) => score(b) - score(a))[0] ?? null;
}
if (speechSupported()) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export interface SayOpts {
  /** Laufende/wartende Ansagen abbrechen (Countdown: sonst hängt der Sprecher hinterher) */
  interrupt?: boolean;
  rate?: number;
  pitch?: number;
}

/** Eine Ansage. Ohne Wirkung, wenn abgeschaltet, stumm, Audio noch gesperrt oder nicht unterstützt. */
export function say(text: string, opts: SayOpts = {}) {
  if (!enabled || !text || !speechSupported() || isMuted() || !audioReady()) return;
  const vol = getVolume() * getFxVolume();
  if (vol < 0.02) return;
  try {
    if (opts.interrupt) {
      speechSynthesis.cancel();
      pending = 0;
    }
    if (pending >= 2) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? 'de-DE';
    if (voice) u.voice = voice;
    u.volume = Math.min(1, vol);
    u.rate = opts.rate ?? 1.1;
    u.pitch = opts.pitch ?? 1;
    pending++;
    const done = () => {
      pending = Math.max(0, pending - 1);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  } catch {
    pending = 0;
  }
}

/** Namen für die Ansage aufbereiten („Bot Lena“ → „Lena“) */
export const spokenName = (name: string | undefined) => (name ?? '').replace(/^Bot\s+/, '').trim() || 'Jemand';
