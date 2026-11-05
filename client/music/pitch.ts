/**
 * Einsingen: Tonhöhenerkennung und Umwandlung einer Tonhöhenspur in Noten – reine Funktionen
 * (kein DOM, kein AudioContext), damit sie im Worker laufen und ohne Browser testbar sind.
 *
 * `yin`, `smoothMedian`, `hysteresis`, `onsets` und der Kern von `segment` sind aus Marlons
 * Notenlese-Projekt CheatSheet (github.com/MarlonM-Org/CheatSheet, `src/domain/ueben.ts`
 * und `src/domain/notation.ts`) übernommen und fürs Sechzehntel-Raster vereinfacht.
 */
import { snapToScale } from '../../shared/music';

/** Ein Rahmen der Tonhöhenspur: Zeit in Sekunden ab Schlag 1, Ton als MIDI mit Nachkommastellen (null = unklar/Stille), Pegel (RMS) */
export interface PitchFrame {
  t: number;
  midi: number | null;
  rms: number;
}

export interface Segment {
  start: number;
  end: number;
  midi: number;
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function rms(buf: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return buf.length ? Math.sqrt(s / buf.length) : 0;
}

/**
 * Grundfrequenz nach YIN (de Cheveigné & Kawahara 2002): Differenzfunktion, kumulativ
 * normiert, erste Unterschreitung der Schwelle, parabolische Verfeinerung.
 * `fmin`/`fmax` begrenzen den Suchbereich (Gesang: 60–1200 Hz) und sparen Rechenzeit.
 */
export function yin(buf: Float32Array, sampleRate: number, opts: { threshold?: number; minRms?: number; fmin?: number; fmax?: number } = {}): { hz: number; clarity: number } | null {
  const threshold = opts.threshold ?? 0.15;
  const n = buf.length;
  if (rms(buf) < (opts.minRms ?? 0.003)) return null;
  const half = Math.floor(n / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / (opts.fmax ?? 1200)));
  const maxTau = Math.min(half - 1, Math.ceil(sampleRate / (opts.fmin ?? 60)));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let sum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    sum += d[tau];
    cmnd[tau] = sum ? (d[tau] * tau) / sum : 1;
  }
  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const a = cmnd[tau - 1], b = cmnd[tau], c = tau + 1 <= maxTau ? cmnd[tau + 1] : b;
  const den = a - 2 * b + c;
  const exact = den ? tau + (a - c) / (2 * den) : tau;
  return { hz: sampleRate / exact, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median der klaren Tonhöhen im Fenster von `width` Rahmen – tilgt einzelne Ausreißer (Oktavsprünge, Knackser) */
export function smoothMedian(frames: readonly PitchFrame[], width = 5): PitchFrame[] {
  const h = Math.floor(width / 2);
  return frames.map((f, i) => {
    if (f.midi === null) return { ...f };
    const w: number[] = [];
    for (let k = Math.max(0, i - h); k <= Math.min(frames.length - 1, i + h); k++) {
      const m = frames[k].midi;
      if (m !== null) w.push(m);
    }
    return { ...f, midi: median(w) };
  });
}

/**
 * Hysterese: Ein Ton läuft weiter, solange die Tonhöhe weniger als `jump` Halbtöne vom Median
 * des bisherigen Tons abweicht (Vibrato um die Halbtongrenze zerhackt keine gehaltenen Töne).
 * Eine Abweichung zählt erst, wenn der Median der nächsten `confirm` klaren Rahmen abweicht.
 * Kurze Aussetzer bis `gap` Sekunden werden überbrückt, wenn derselbe Ton weitergeht.
 * Jeder Rahmen bekommt den Median seines Tons.
 */
export function hysteresis(frames: readonly PitchFrame[], jump = 0.75, gap = 0.15, confirm = 3, attack = 0.06, smooth = 5): PitchFrame[] {
  const e = smoothMedian(frames, smooth);
  const raw = e.map((f) => f.midi);
  let members: number[] = [], tones: number[] = [], center = 0;
  let gapFrom = -1;
  const close = () => {
    for (const i of members) e[i].midi = center;
    members = [];
    tones = [];
    gapFrom = -1;
  };
  const lasting = (i: number, skip: number) => {
    const late: number[] = [], all: number[] = [];
    for (let k = i; k < raw.length && late.length < confirm; k++) {
      const m = raw[k];
      if (m === null) break;
      all.push(m);
      if (frames[k].t - frames[i].t >= skip) late.push(m);
    }
    const w = late.length ? late : all;
    return w.length > 0 && Math.abs(median(w) - center) >= jump;
  };
  for (let i = 0; i < e.length; i++) {
    const m = raw[i];
    if (m === null) {
      if (members.length && gapFrom < 0) gapFrom = i;
      continue;
    }
    if (members.length && gapFrom >= 0) {
      if (frames[i].t - frames[gapFrom].t <= gap && !lasting(i, attack)) {
        for (let k = gapFrom; k < i; k++) members.push(k);
        gapFrom = -1;
        members.push(i);
        tones.push(m);
        center = median(tones);
        continue;
      }
      close();
    } else if (members.length && (Math.abs(m - center) < jump || !lasting(i, 0))) {
      members.push(i);
      tones.push(m);
      center = median(tones);
      continue;
    } else if (members.length) close();
    members.push(i);
    tones.push(m);
    center = m;
  }
  if (members.length) close();
  return e;
}

/** Anschläge aus dem Pegel: Zeitpunkte, an denen die Lautstärke in `window` Sekunden um ≥ `riseDb` dB steigt (höchstens einer je `spacing`) */
export function onsets(frames: readonly PitchFrame[], riseDb = 6, window = 0.05, spacing = 0.09): number[] {
  if (frames.length < 3) return [];
  const db = frames.map((f) => 20 * Math.log10(f.rms + 1e-5));
  const rise = db.map((d, i) => {
    let low = d;
    for (let k = i - 1; k >= 0 && frames[i].t - frames[k].t <= window; k--) low = Math.min(low, db[k]);
    return d - low;
  });
  const out: number[] = [];
  let i = 0;
  while (i < rise.length) {
    if (rise[i] < riseDb) {
      i++;
      continue;
    }
    let best = i, j = i;
    while (j < rise.length && rise[j] >= riseDb) {
      if (rise[j] > rise[best]) best = j;
      j++;
    }
    const t = frames[best].t;
    if (!out.length || t - out[out.length - 1] >= spacing) out.push(t);
    i = j;
  }
  return out;
}

export interface SegmentOptions {
  /** kürzeste Note in Sekunden */
  minDur?: number;
  /** Lücke, über die gleiche Töne verbunden werden */
  gap?: number;
  /** Ansatzzeit, die bei der Tonhöhenbestimmung ignoriert wird */
  attack?: number;
  /** Anschlag-Schwelle in dB (0 = aus) */
  onsetDb?: number;
}

/**
 * Tonhöhenspur → Tonstücke (Start, Ende, MIDI ganzzahlig): Hysterese-Läufe, an Pegelanschlägen
 * geteilt (gleicher Ton neu angesetzt), Tonhöhe = Median ohne Ansatz, Oktavfehler kurzer
 * Stücke korrigiert, gleiche Töne über kurze Lücken ohne Anschlag verbunden, Mindestdauer.
 */
export function segment(framesIn: readonly PitchFrame[], o: SegmentOptions = {}): Segment[] {
  const minDur = o.minDur ?? 0.08, gap = o.gap ?? 0.12, attack = o.attack ?? 0.05;
  const frames = framesIn.filter((f) => f.t >= -0.02);
  if (frames.length < 2) return [];
  const dts: number[] = [];
  for (let i = 1; i < frames.length; i++) dts.push(frames[i].t - frames[i - 1].t);
  const dt = median(dts) || 0.02;
  const smooth = hysteresis(frames, 0.75, 0.15, 3, attack, 5);
  const hits = o.onsetDb === 0 ? [] : onsets(frames, o.onsetDb ?? 6, 0.05, 0.09);

  const runs: [number, number][] = [];
  for (let i = 0; i < smooth.length; ) {
    if (smooth[i].midi === null) {
      i++;
      continue;
    }
    let j = i;
    while (j < smooth.length && smooth[j].midi === smooth[i].midi) j++;
    runs.push([i, j]);
    i = j;
  }
  // An Anschlägen im Inneren teilen
  const split: [number, number][] = [];
  for (const [i, j] of runs) {
    const start = frames[i].t, end = frames[j - 1].t + dt;
    const bounds = [i];
    for (const t of hits) {
      if (t < start + minDur || t > end - minDur) continue;
      let k = bounds[bounds.length - 1];
      while (k < j && frames[k].t < t) k++;
      let g = k;
      while (g > i && frames[g - 1].midi !== null && t - frames[g - 1].t <= 0.08) g--;
      if (g === k || frames[g - 1]?.midi !== null) g = k;
      if (g < j && frames[g].t - frames[bounds[bounds.length - 1]].t >= minDur) bounds.push(g);
    }
    bounds.push(j);
    for (let g = 0; g + 1 < bounds.length; g++) split.push([bounds[g], bounds[g + 1]]);
  }
  const pieces: Segment[] = [];
  for (const [i, j] of split) {
    const start = frames[i].t, end = frames[j - 1].t + dt;
    const from = end - start > 2 * attack ? start + attack : start;
    let w: number[] = [];
    for (let k = i; k < j; k++) {
      const m = frames[k].midi;
      if (m !== null && frames[k].t >= from) w.push(m);
    }
    if (!w.length) for (let k = i; k < j; k++) if (frames[k].midi !== null) w.push(frames[k].midi as number);
    if (!w.length) continue;
    pieces.push({ start, end, midi: Math.round(median(w)) });
  }
  // Oktavfehler: kurzes Stück, das zu beiden Nachbarn ≈ eine Oktave springt → in deren Lage
  const short = 0.15;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.end - p.start >= short) continue;
    const a = pieces[i - 1], b = pieces[i + 1];
    const near = (q: Segment | undefined) => q && Math.abs(Math.abs(q.midi - p.midi) - 12) <= 1;
    if (near(a) && (near(b) || !b)) p.midi += a!.midi > p.midi ? 12 : -12;
    else if (near(b) && !a) p.midi += b!.midi > p.midi ? 12 : -12;
  }
  // Gleiche Töne über kurze Lücken verbinden, wenn kein Anschlag dazwischen liegt
  const merged: Segment[] = [];
  for (const s of pieces) {
    const v = merged[merged.length - 1];
    if (v && v.midi === s.midi && s.start - v.end < gap && !hits.some((t) => t >= v.end - 0.1 && t <= s.start + 0.08)) {
      v.end = s.end;
      continue;
    }
    merged.push({ ...s });
  }
  // Angeschliffener Ansatz: kurzes Stück direkt vor einem längeren, ≤ 2 Halbtöne → geht darin auf
  const out: Segment[] = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i], n = merged[i + 1];
    if (n && s.end - s.start < minDur * 1.5 && n.start - s.end < gap && Math.abs(n.midi - s.midi) <= 2 && n.end - n.start > s.end - s.start) {
      n.start = s.start;
      continue;
    }
    out.push(s);
  }
  return out.filter((s) => s.end - s.start >= minDur);
}

export interface QuantizeOptions {
  bpm: number;
  /** Latenz/Vorlauf: wird von allen Zeiten abgezogen (Sekunden) */
  offset?: number;
  /** Töne auf diese Tonart ziehen */
  key?: { root: number; minor: boolean } | null;
  /** Schritt, an dem die Aufnahme beginnt (wird addiert) */
  startStep?: number;
  /** Höchster erlaubter Schritt (exklusiv) */
  maxStep?: number;
}

/** Tonstücke → Noten im Sechzehntel-Raster (monophon: Überlappungen werden gekürzt) */
export function quantize(segs: readonly Segment[], o: QuantizeOptions): { step: number; midi: number; len: number }[] {
  const stepDur = 60 / o.bpm / 4;
  const off = o.offset ?? 0;
  const out: { step: number; midi: number; len: number }[] = [];
  for (const s of segs) {
    const step = Math.round((s.start - off) / stepDur);
    const endStep = Math.max(step + 1, Math.round((s.end - off) / stepDur));
    const midi = o.key ? snapToScale(s.midi, o.key) : s.midi;
    const prev = out[out.length - 1];
    if (prev && prev.step === step) {
      // Zwei Stücke auf demselben Schritt: das längere gewinnt
      if (endStep - step > prev.len) out[out.length - 1] = { step, midi, len: endStep - step };
      continue;
    }
    if (prev && prev.step + prev.len > step) prev.len = step - prev.step;
    out.push({ step, midi, len: endStep - step });
  }
  const base = o.startStep ?? 0;
  return out
    .map((n) => ({ ...n, step: n.step + base }))
    .filter((n) => n.step >= base && n.len > 0 && (o.maxStep === undefined || n.step < o.maxStep))
    .map((n) => (o.maxStep !== undefined && n.step + n.len > o.maxStep ? { ...n, len: o.maxStep - n.step } : n));
}
