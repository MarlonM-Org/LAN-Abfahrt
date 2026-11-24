/**
 * Das erste Gespräch (`rhythm`): Rhythmusspiel à la Klavier-Kacheln. Hier liegt alles, was Server, TV, Handy und
 * Bots gleich sehen müssen – rein, ohne DOM/Node, getestet in `scripts/test-rhythmus.ts`:
 *
 * - der Song (Song-Format v2, eigens komponiert, 100 BPM, gerade Achtel ohne Swing),
 * - die Notenspuren: jede Note ist ein Melodieton des Songs, ihre Zeit kommt exakt aus dem Sechzehntel-Raster
 *   (`rhStepTime`), die Spur (4 Tasten) aus der Tonhöhe – höher = weiter rechts, wie am Klavier,
 * - die Wertung eines Tipps (perfekt/gut/daneben) und die Trefferquote,
 * - der Soundcheck: Tipps im Takt eines Klicks vom TV → Ton-Versatz des TVs (AirPlay, HDMI, Bluetooth …).
 *
 * Zeiten sind „Songzeit“ in ms ab Takt 1 (der Einzähler liegt davor). Handys rechnen ihre Songzeit aus der
 * synchronisierten Server-Uhr minus dem Ton-Versatz des TVs – dann kommt die Note genau dann an der Linie an,
 * wenn der Ton aus dem Fernseher kommt, und genau dort wird auch gewertet.
 */
import { type Song, emptySong } from './music';
import { cat, chords, hits, mel, midiOf } from './musicCompose';

export const RH = {
  /** Tasten nebeneinander (Handy und TV) */
  LANES: 4,
  /** Treffer-Fenster um die Note (± ms) */
  PERFECT_MS: 60,
  GOOD_MS: 130,
  /** Ein Tipp bis so früh vor der nächsten Note der Spur verbraucht sie als „zu früh“ (Dauertippen lohnt nicht) */
  EARLY_MS: 220,
  /** So lange fällt eine Note von oben bis zur Linie */
  FALL_MS: 1500,
  /** Einzähler-Schläge vor Takt 1 */
  COUNT_IN: 4,
  /** Puffer, bis alle Geräte den Startzeitpunkt kennen */
  START_BUFFER_MS: 1500,
  /** Nach dem letzten Takt bis „vorbei“ */
  END_MS: 1500,
  /** Der Server wartet so lange über das Fenster hinaus auf späte Tipps (WLAN), bevor er „verpasst“ zählt */
  NET_GRACE_MS: 400,
  /** Spieler höchstens (je eine eigene Spur-Ansicht am TV) */
  MAX_PLAYERS: 8,
  /** Story: so viele Takte redet einer, dann der andere */
  PHRASE_BARS: 2,
  // ---------------------------------------------------------------- Soundcheck (Ton-Versatz des TVs)
  /** Klick-Abstand im Soundcheck (75 BPM): eindeutig messbar für Versätze von −240 bis +560 ms */
  KAL_BEAT_MS: 800,
  /** So viele Tipps braucht eine Messung */
  KAL_MIN: 8,
  /** Die letzten so vielen Tipps zählen */
  KAL_N: 12,
  /** Messung gilt als stabil, wenn die mittlere Hälfte der Tipps höchstens so weit streut (ms) */
  KAL_STREU: 70,
  /** Erlaubter Bereich des Versatzes (ms) */
  KAL_MIN_MS: -150,
  KAL_MAX_MS: 550,
  /** Fein-Abgleich am Handy während des Songs (Touch-Verzögerung je Gerät): höchstens ± so viel (ms) */
  FEIN_MAX: 80,
};

export const RH_SONG_ID = 'erstes-gespraech';

export const RHYTHM_TOPICS = ['Musik?', 'Reisen!', 'Haha!', 'Echt?!', 'Ich auch!', 'Lieblingsessen?', 'Peinlich ...', 'Träume', 'Kino?', 'Hund oder Katze?', 'Sterne!', 'Und du?'];

// ------------------------------------------------------------------ Song

const rep = (...parts: [string, number][]) => parts.flatMap(([p, n]) => Array<string>(n).fill(p)).join('|');
const N = midiOf;

/**
 * „Das erste Gespräch“ – F-Dur, 100 BPM, 24 Takte (≈ 58 s). Die Melodie wird von Abschnitt zu Abschnitt schwerer:
 * Viertel → Achtel → Synkopen (Töne auf der „und“) → kurze Sechzehntel-Läufe → alles gemischt → ruhiger Schluss.
 * Schlagzeug mit klarem Grundschlag (Bassdrum 1 + 3, Snare 2 + 4, gerade Achtel-HiHat), Begleitung als lange
 * Flächen – nichts betont den Nachschlag, damit der Takt eindeutig ist.
 */
function gespraechSong(): Song {
  const s = emptySong(RH_SONG_ID, 'Das erste Gespräch');
  s.author = 'LAN-Abfahrt';
  s.style = 'romantisch';
  s.bpm = 100;
  s.swing = 0;
  s.key = { root: 5, minor: false };
  const lead = cat(
    // 1–4: Hallo (Viertel)
    mel('A4:4 C5:4 F5:4 E5:4 | D5:4 F5:4 A5:8 | G5:4 F5:4 D5:4 Bb4:4 | C5:4 E5:4 G5:8'),
    // 5–8: Achtel
    mel('F5:2 E5:2 F5:4 A5:2 G5:2 F5:4 | D5:2 E5:2 F5:2 A5:2 D6:8 | D6:2 C6:2 Bb5:2 A5:2 G5:4 F5:4 | E5:2 F5:2 G5:4 C5:8'),
    // 9–12: Synkopen
    mel('C5:2 F5:4 A5:2 .:2 G5:4 F5:2 | A5:2 D6:4 C6:2 A5:4 F5:4 | D6:2 Bb5:4 F5:2 G5:2 A5:4 Bb5:2 | .:2 G5:4 E5:2 C5:4 .:4'),
    // 13–16: kurze Läufe (Sechzehntel)
    mel('F5:4 A5 Bb5 C6:2 F6:4 C6:4 | D6:2 C6:2 A5:2 F5:2 D5:4 E5 F5 G5 A5 | Bb5:4 A5:2 G5:2 F5:2 G5 A5 Bb5:4 | C6:2 Bb5 A5 G5:4 E5:2 F5 G5 C5:4'),
    // 17–20: alles gemischt
    mel('F5:2 Bb5:2 D6:3 C6 Bb5:4 A5:2 Bb5:2 | C6:2 G5:4 E5:2 G5 A5 Bb5 C6 E6:4 | E6:2 C6:2 A5:4 .:2 C6:2 A5:2 E5:2 | F5:2 A5:2 D6:2 F6:4 E6 D6 C6:4'),
    // 21–24: Schluss
    mel('D6:4 C6:2 Bb5:2 A5:4 G5:4 | G5:2 A5:2 Bb5:2 C6:2 E5:4 G5:4 | F5:8 A5:4 C6:4 | F6:12 .:4'),
  );
  const prog = `${rep(['F|Dm|Bb|C', 4])}|Bb|C|Am|Dm|Bb|C|F|F`;
  const calm = 'R - - - - - - - 5 - - - - - - -';
  const walk = 'R - - - R - - - 5 - - - R - - -';
  const bars = prog.split('|');
  const bassPats: string[] = bars.map((_, b) => (b < 8 || b >= 20 ? calm : walk));
  bassPats[23] = 'R - - - - - - - - - - - . . . .';
  const bass = chords(prog, N('F2'), bassPats);
  const harmony = chords(prog, N('A3'), bars.map((_, b) => (b >= 8 && b < 20 ? 'R35 - - - - - - - 35O - - - - - - -' : 'R35 - - - - - - - - - - - - - - -')));
  s.bars = lead.bars;
  s.lead = { wave: 'pulse25', volume: 0.085, env: 'pluck', notes: lead.notes };
  s.bass = { wave: 'triangle', volume: 0.15, env: 'pluck', notes: bass.notes };
  s.harmony = { wave: 'triangle', volume: 0.03, env: 'hold', notes: harmony.notes };
  const K1 = 'x.......x.......';
  const K2 = 'x.....x.x.......';
  const S = '....x.......x...';
  const SF = '....x.......x.xx';
  const H = 'x.x.x.x.x.x.x.x.';
  s.drums = {
    volume: 0.8,
    kick: hits(rep([K1, 8], [K2, 12], [K1, 3], ['x...............', 1])),
    snare: hits(rep(['................', 4], [S, 11], [SF, 1], [S, 3], [SF, 1], [S, 3], ['................', 1])),
    hat: hits(rep([H, 23], ['x...............', 1])),
  };
  return s;
}

let songCache: Song | null = null;
/** Der Song des Spiels (TV spielt genau diesen, Spuren kommen aus ihm) */
export function rhSong(): Song {
  return (songCache ??= gespraechSong());
}

// ------------------------------------------------------------------ Zeit

export const rhStepMs = (song: Pick<Song, 'bpm'>) => 60000 / song.bpm / 4;
export const rhBeatMs = (song: Pick<Song, 'bpm'>) => 60000 / song.bpm;
export const rhBarMs = (song: Pick<Song, 'bpm'>) => (60000 / song.bpm) * 4;
/** Zeit eines Schritts (ms ab Takt 1) – genau wie der Sequencer (`SongPlayer`): ungerade Schritte um `swing` verschoben */
export const rhStepTime = (song: Pick<Song, 'bpm' | 'swing'>, step: number) => {
  const sm = rhStepMs(song);
  return step * sm + (step % 2 === 1 ? song.swing * sm : 0);
};
export const rhSongMs = (song: Pick<Song, 'bpm' | 'bars'>) => song.bars * rhBarMs(song);

// ------------------------------------------------------------------ Notenspuren

export interface RhNote {
  /** Songzeit (ms ab Takt 1) */
  t: number;
  /** Taste 0–3 (links → rechts) */
  lane: number;
  /** Sechzehntel-Schritt im Song */
  step: number;
}

/** Bahn nach Tonhöhe: Rang des Tons unter den Tönen seines 2-Takt-Abschnitts (höher = weiter rechts) */
function pitchLanes(evs: { step: number; midi: number }[]): number[] {
  const win = (step: number) => Math.floor(step / 32);
  const pitches = new Map<number, number[]>();
  for (const e of evs) {
    const w = win(e.step);
    const list = pitches.get(w) ?? [];
    if (!list.includes(e.midi)) list.push(e.midi);
    pitches.set(w, list);
  }
  for (const list of pitches.values()) list.sort((a, b) => a - b);
  const lanes = evs.map((e) => {
    const list = pitches.get(win(e.step))!;
    const k = list.length;
    return k === 1 ? 1 : Math.round((list.indexOf(e.midi) * (RH.LANES - 1)) / (k - 1));
  });
  // Mehr Töne als Tasten: wechselt der Ton, wechselt auch die Taste (in Richtung der Tonhöhe) – wie am Klavier
  for (let i = 1; i < evs.length; i++) {
    const diff = evs[i].midi - evs[i - 1].midi;
    if (diff && lanes[i] === lanes[i - 1] && win(evs[i].step) === win(evs[i - 1].step)) {
      lanes[i] = Math.max(0, Math.min(RH.LANES - 1, lanes[i] + Math.sign(diff)));
    }
  }
  return lanes;
}

/** Alle Melodietöne als Noten (gleichzeitige Töne → höchster) */
function leadChart(song: Song): RhNote[] {
  const by = new Map<number, number>();
  for (const n of song.lead.notes) by.set(n.step, Math.max(by.get(n.step) ?? 0, n.midi));
  const evs = [...by].map(([step, midi]) => ({ step, midi })).sort((a, b) => a.step - b.step);
  const lanes = pitchLanes(evs);
  return evs.map((e, i) => ({ t: Math.round(rhStepTime(song, e.step)), lane: lanes[i], step: e.step }));
}

/** „Nicken“ beim Zuhören: die Bassdrum – Eins auf der linken, die anderen auf der rechten Mitteltaste */
function nodChart(song: Song): RhNote[] {
  return [...song.drums.kick].sort((a, b) => a - b).map((step) => ({ t: Math.round(rhStepTime(song, step)), lane: step % 16 === 0 ? 1 : 2, step }));
}

/** Story: Abschnitte, in denen jeweils einer redet (abwechselnd, `PHRASE_BARS` Takte) */
export function rhythmusPhrasen(order: string[], song = rhSong()): { from: number; to: number; speaker: string }[] {
  const len = RH.PHRASE_BARS * 16;
  const out: { from: number; to: number; speaker: string }[] = [];
  for (let p = 0; p * len < song.bars * 16; p++) {
    out.push({ from: Math.round(rhStepTime(song, p * len)), to: Math.round(rhStepTime(song, Math.min(song.bars * 16, (p + 1) * len))), speaker: order[p % order.length] });
  }
  return out;
}

const chartCache = new Map<string, RhNote[]>();

/**
 * Notenspur eines Spielers – deterministisch, jedes Gerät rechnet sie selbst aus (steht nicht im Zustand).
 * Wettkampf (oder allein): alle spielen dieselbe Spur, die ganze Melodie. Story: wer gerade redet, spielt die
 * Melodie seines Abschnitts, der andere nickt auf der Bassdrum mit; den Schlusston spielen beide.
 */
export function rhythmusNoten(order: string[], id: string, wettkampf: boolean, song = rhSong()): RhNote[] {
  const solo = wettkampf || order.length < 2;
  const key = solo ? `${song.id}:alle` : `${song.id}:${order.join(',')}:${id}`;
  const hit = chartCache.get(key);
  if (hit) return hit;
  const lead = leadChart(song);
  let notes: RhNote[];
  if (solo) notes = lead;
  else {
    const len = RH.PHRASE_BARS * 16;
    const last = (song.bars - 1) * 16;
    const speaks = (step: number) => step >= last || order[Math.floor(step / len) % order.length] === id;
    notes = [...lead.filter((n) => speaks(n.step)), ...nodChart(song).filter((n) => !speaks(n.step))].sort((a, b) => a.t - b.t);
  }
  chartCache.set(key, notes);
  return notes;
}

// ------------------------------------------------------------------ Wertung

/** Bewertung einer Note: 0 offen, 1 daneben (verpasst oder zu früh), 2 gut, 3 perfekt */
export type RhMark = 0 | 1 | 2 | 3;
export const MARK_CHARS = ['.', 'x', 'g', 'p'] as const;
export const marksToString = (m: ArrayLike<number>) => Array.from(m, (v) => MARK_CHARS[v] ?? '.').join('');
export const markAt = (s: string, i: number): RhMark => Math.max(0, MARK_CHARS.indexOf((s[i] ?? '.') as (typeof MARK_CHARS)[number])) as RhMark;

/**
 * Ein Tipp auf Taste `lane` zur (korrigierten) Songzeit `t`: Die früheste offene Note dieser Taste, deren Fenster
 * noch nicht vorbei ist, wird bewertet – perfekt (±60 ms), gut (±130 ms) oder „zu früh“ (bis 220 ms vorher,
 * Note ist dann verbraucht). Liegt keine Note in Reichweite, ist es ein Fehltipp (`null`, kostet die Serie).
 */
export function tippWerten(chart: RhNote[], marks: ArrayLike<number>, lane: number, t: number): { i: number; mark: 1 | 2 | 3; d: number } | null {
  for (let i = 0; i < chart.length; i++) {
    const n = chart[i];
    if (n.lane !== lane || marks[i]) continue;
    const d = t - n.t;
    if (d > RH.GOOD_MS) continue;
    if (d < -RH.EARLY_MS) return null;
    const a = Math.abs(d);
    return { i, mark: a <= RH.PERFECT_MS ? 3 : a <= RH.GOOD_MS ? 2 : 1, d };
  }
  return null;
}

/** Offene Noten, deren Fenster zur Songzeit `t` (plus `frist`) vorbei ist → verpasst */
export function verpassteNoten(chart: RhNote[], marks: ArrayLike<number>, t: number, frist = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < chart.length; i++) {
    const n = chart[i];
    if (n.t + RH.GOOD_MS + frist >= t) break;
    if (!marks[i]) out.push(i);
  }
  return out;
}

/** Trefferquote in Prozent: getroffene Noten (perfekt oder gut) von allen */
export const trefferQuote = (perfect: number, good: number, total: number) => (total ? Math.round(((perfect + good) / total) * 100) : 0);

/** Wert für die Rangliste im Wettkampf: Trefferquote zuerst, bei Gleichstand mehr „perfekt“ */
export const wettkampfWert = (perfect: number, good: number, total: number) => trefferQuote(perfect, good, total) * 1000 + perfect;

/** „Im Takt“ (Story, gemeinsam): perfekt 2 Punkte, gut 1 – Anteil an den möglichen Punkten (0–1) */
export const imTakt = (perfect: number, good: number, total: number) => (total ? (perfect * 2 + good) / (total * 2) : 0);

// ------------------------------------------------------------------ Soundcheck

/** Lage eines Tipps im Klick-Raster: 0 … beat (ms nach dem letzten Klick) */
export function kalPhase(at: number, kalAt: number, beat = RH.KAL_BEAT_MS): number {
  const d = (at - kalAt) % beat;
  return d < 0 ? d + beat : d;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Soundcheck auswerten: Tipps (Lage im Klick-Raster) → Versatz in ms (positiv = der Ton kommt später, als die Uhr
 * sagt). Rund um den Kreis gerechnet (Mittel der Winkel, dann Median), damit ein Versatz nahe der Rastergrenze nicht
 * zerfällt; eindeutig im Bereich −0,3 … +0,7 Schläge (−240 … +560 ms bei 800 ms).
 */
export function kalAuswerten(phasen: number[], beat = RH.KAL_BEAT_MS): { wert: number; streu: number; stabil: boolean } | null {
  const xs = phasen.slice(-RH.KAL_N);
  if (xs.length < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const p of xs) {
    sx += Math.cos((2 * Math.PI * p) / beat);
    sy += Math.sin((2 * Math.PI * p) / beat);
  }
  const mitte = ((Math.atan2(sy, sx) / (2 * Math.PI)) * beat + beat) % beat;
  // Jeden Tipp in das Fenster mitte ± beat/2 legen, dann Median und Streuung (mittlere Hälfte)
  const nah = xs.map((p) => {
    let d = p - mitte;
    if (d > beat / 2) d -= beat;
    if (d < -beat / 2) d += beat;
    return mitte + d;
  });
  let wert = median(nah);
  const s = [...nah].sort((a, b) => a - b);
  const streu = s[Math.floor((s.length * 3) / 4)] - s[Math.floor(s.length / 4)];
  wert = ((wert % beat) + beat) % beat;
  if (wert >= beat * 0.7) wert -= beat;
  wert = Math.max(RH.KAL_MIN_MS, Math.min(RH.KAL_MAX_MS, Math.round(wert)));
  return { wert, streu: Math.round(streu), stabil: xs.length >= RH.KAL_MIN && streu <= RH.KAL_STREU };
}

/** Ton-Versatz des Raums aus den stabilen Messungen der Spieler (Median – ein Ausreißer-Handy verschiebt nichts) */
export function raumVersatz(werte: number[]): number | null {
  if (!werte.length) return null;
  return Math.max(RH.KAL_MIN_MS, Math.min(RH.KAL_MAX_MS, Math.round(median(werte))));
}

/**
 * Fein-Abgleich am Handy während des Songs: Median der letzten Abweichungen (Tipp − Note, ohne Abgleich) – gleicht
 * die Touch-Verzögerung des einzelnen Handys aus. Verschiebt nur das Bewertungsfenster (± `FEIN_MAX`), nie das
 * Notenbild; mit wenigen Tipps nur anteilig (sonst würde ein einzelner Patzer alles verschieben).
 */
export function feinAbgleich(abw: number[], start = 0): number {
  const xs = abw.slice(-10);
  if (!xs.length) return Math.max(-RH.FEIN_MAX, Math.min(RH.FEIN_MAX, start));
  const w = Math.min(1, xs.length / 6);
  const m = median(xs);
  return Math.round(Math.max(-RH.FEIN_MAX, Math.min(RH.FEIN_MAX, start * (1 - w) + m * w)));
}

// ------------------------------------------------------------------ Zustand

export interface RhythmPlayer {
  ready: boolean;
  /** Soundcheck dieses Handys: Anzahl Tipps, gemessener Wert (ms), Streuung, stabil */
  kal: { n: number; wert: number | null; streu: number; stabil: boolean };
  perfect: number;
  good: number;
  /** Verpasst oder zu früh */
  miss: number;
  /** Tipps ohne Note in Reichweite */
  fehl: number;
  combo: number;
  best: number;
  /** Bewertung jeder Note der eigenen Spur: '.' offen, 'x' daneben, 'g' gut, 'p' perfekt */
  marks: string;
  /** Zuletzt bewertet (für Effekte am TV) */
  last: { i: number; m: 1 | 2 | 3; seq: number } | null;
}

export interface RhythmState {
  sub: 'ready' | 'play' | 'over';
  /** Wettkampf (nicht in der Story): alle dieselbe Spur, Gewinner nach Trefferquote. Sonst gemeinsam (Herzen) */
  wettkampf: boolean;
  bpm: number;
  /** Soundcheck: Serverzeit eines Klicks, Abstand der Klicks (ms) */
  kalAt: number;
  kalBeat: number;
  /** Ton-Versatz des TVs in ms (raumweit, gilt für Notenbild und Wertung aller Handys) */
  versatz: number;
  versatzQuelle: 'keiner' | 'gespeichert' | 'gemessen';
  /** Neu einmessen verlangt (VIP/Laptop): „Bereit“ erst nach eigenem Soundcheck oder bewusst „ohne“ */
  pflicht: boolean;
  /** Serverzeit von Takt 1 (davor der Einzähler); 0 = noch nicht gestartet */
  startAt: number;
  /** Songlänge (ms ab Takt 1) */
  duration: number;
  playSeq: number;
  /** Reihenfolge (Story: wer zuerst redet; TV-Spalten) */
  order: string[];
  players: Record<string, RhythmPlayer>;
  /** Story: wer gerade redet (Songzeit) */
  phrases: { from: number; to: number; speaker: string; topic: string }[];
  /** Story: gemeinsame Sympathie 0–100 */
  sympathy: number;
}
