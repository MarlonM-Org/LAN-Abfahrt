/**
 * Strand-Band (`band`): Rhythmus-Party für viele. Ein eingebauter Song läuft am TV, jedes Handy ist ein Instrument
 * mit eigener Notenspur. Hier liegt alles, was Server, TV, Handy und Bots gleich sehen müssen – vor allem die
 * Notenspuren: Sie werden deterministisch aus den Kanälen des Songs (Song-Format v2) erzeugt, deshalb stehen sie
 * nicht im Zustand (12 Spuren à ~150 Noten wären bei jedem Treffer ~30 KB) – jeder rechnet seine Spur selbst aus.
 *
 * Ausdünnen: Kandidaten (Töne bzw. Trommelschläge) bekommen eine Priorität nach Taktposition (Eins > Drei > Viertel
 * > Achtel > Sechzehntel, Snare-Backbeat bevorzugt); dann wird nach Priorität übernommen, was zu allen schon
 * übernommenen Noten den Mindestabstand des Instruments hat. So bleiben Schwerpunkte und Synkopen erhalten, ohne
 * dass es am Handy zu dicht wird. Lange Töne werden zu Halte-Noten (Melodie, Bass, Ukulele).
 */
import { STEPS_PER_BAR, type MelodicChannel, type Song, type SongNote } from './music';
import { builtinSong } from './musicBuiltin';

export type BandInst = 'drums' | 'melody' | 'bass' | 'chords' | 'shaker';
/** Teile des Songs, die der TV einzeln leiser/dumpfer drehen kann (siehe `PlayOptions.out` im Player) */
export type BandPart = 'lead' | 'bass' | 'harmony' | 'kick' | 'snare' | 'hat';

export interface BandInstInfo {
  name: string;
  /** Kurzname für Ergebnis-Zeilen (TV kürzt auf 16 Zeichen) */
  short: string;
  icon: string;
  /** Schwierigkeit 1–3 (bringt `bonus` Prozentpunkte in der Wertung) */
  stars: 1 | 2 | 3;
  /** Kurzbeschreibung fürs Handy */
  desc: string;
  laneNames: string[];
  /** Mindestabstand zweier Noten (ms) – bestimmt die Dichte */
  minGap: number;
  /** Ab dieser Tonlänge (ms) wird eine Note zur Halte-Note (0 = nie) */
  holdMs: number;
  /** Diese Song-Teile spielt das Instrument (TV dämpft sie bei Fehlern) */
  parts: BandPart[];
  /** Farbe am TV (Noten, Rahmen) */
  color: number;
}

export const BAND_INFO: Record<BandInst, BandInstInfo> = {
  drums: { name: 'Schlagzeug', short: 'Drums', icon: '🥁', stars: 3, desc: 'Bumm und Tschak – 2 Bahnen, flott', laneNames: ['BUMM', 'TSCHAK'], minGap: 200, holdMs: 0, parts: ['kick', 'snare'], color: 0xe0503f },
  melody: { name: 'Melodie', short: 'Melodie', icon: '🎺', stars: 3, desc: '3 Bahnen nach Tonhöhe + Halten', laneNames: ['TIEF', 'MITTE', 'HOCH'], minGap: 190, holdMs: 520, parts: ['lead'], color: 0xffd25e },
  bass: { name: 'Bass', short: 'Bass', icon: '🎸', stars: 2, desc: 'Tief und hoch – 2 Bahnen + Halten', laneNames: ['TIEF', 'HOCH'], minGap: 270, holdMs: 560, parts: ['bass'], color: 0x9b5fc0 },
  chords: { name: 'Ukulele', short: 'Ukulele', icon: '🪕', stars: 2, desc: 'Akkorde schrammeln – 2 Bahnen', laneNames: ['TIEF', 'HOCH'], minGap: 300, holdMs: 640, parts: ['harmony'], color: 0x46b04a },
  shaker: { name: 'Kokos-Shaker', short: 'Shaker', icon: '🥥', stars: 1, desc: 'Eine Bahn, ruhiger Takt', laneNames: ['SCHÜTTELN'], minGap: 400, holdMs: 0, parts: ['hat'], color: 0x3fa7e0 },
};

/** Reihenfolge beim Verteilen: erst die tragenden Instrumente, ab 6 Spielern doppelt besetzt */
export const BAND_INSTS: BandInst[] = ['drums', 'melody', 'bass', 'chords', 'shaker'];
export const isBandInst = (v: unknown): v is BandInst => typeof v === 'string' && (BAND_INSTS as string[]).includes(v);
/** Wertungsbonus in Prozentpunkten für schwere Instrumente (★ 0, ★★ +4, ★★★ +8) */
export const bandBonus = (inst: BandInst) => (BAND_INFO[inst].stars - 1) * 4;
export const bandStars = (inst: BandInst) => '★'.repeat(BAND_INFO[inst].stars);

export const BAND = {
  /** Instrument wählen + Bereit (danach startet der Song sowieso; alle bereit → sofort) */
  PICK_MS: 25_000,
  /** Puffer, bis alle Geräte den Startzeitpunkt kennen (wie beim Gespräch) */
  START_BUFFER_MS: 1500,
  /** Einzähler vor Takt 1 (Schläge) */
  COUNT_IN: 4,
  /** Toleranzfenster am Handy (± ms um die Note, nach der Selbst-Kalibrierung) */
  PERFECT_MS: 70,
  GOOD_MS: 140,
  /** Ein Tipp bis so früh vor einer Note verbraucht sie als „zu früh“ (sonst wäre Dauertippen gratis) */
  EARLY_MS: 260,
  /** Halte-Note: so viel zu früh losgelassen zählt noch als gehalten */
  HOLD_TOL_MS: 140,
  /** So lange (ms) fällt eine Note von oben bis zur Trefferlinie */
  FALL_MS: 1500,
  /**
   * Selbst-Kalibrierung am Handy: der Median der letzten Abweichungen verschiebt das Bewertungsfenster
   * (Touch-Verzögerung, TV-Ton hinkt hinterher) – höchstens in diesem Bereich (ms).
   */
  BIAS_MIN: -40,
  BIAS_MAX: 120,
  /** Takt gilt als „im Groove“, wenn die Band (verbundene Spieler) mindestens diesen Anteil ihrer Noten getroffen hat */
  GROOVE_ACC: 0.75,
  /** Ein Takt wird so lange nach seinem Ende ausgewertet (Treffer sind dann sicher da) */
  BAR_GRACE_MS: 800,
  /** Nach dem letzten Ton bis „vorbei“ */
  END_MS: 1800,
  /** Ziel-Länge kurzer Loops (werden wiederholt) */
  TARGET_MS: 56_000,
  /** Band-Bonus (Münzen für alle) ab so vielen Groove-Takten am Stück */
  BONUS_BARS: [[16, 3], [10, 2], [6, 1]] as [number, number][],
};

/** Songs der Strand-Band (eingebaut, damit jedes Gerät die Spuren selbst ausrechnen kann) */
export const BAND_SONGS = ['sport', 'wasser', 'western', 'igelkrieg', 'poolparty', 'strandpromenade'];

export interface BandNote {
  /** ms ab Takt 1 (Songzeit; der Einzähler liegt davor) */
  t: number;
  lane: number;
  /** Halte-Note: Länge in ms */
  len?: number;
  /** Takt (für den Groove der Band) */
  bar: number;
}

// ------------------------------------------------------------------ Zustand

export interface BandPlayer {
  inst: BandInst;
  ready: boolean;
  /** Punkte bisher (perfekt 2, gut 1, Halten +1) und Höchstpunkte der bisher bewerteten Noten */
  score: number;
  judged: number;
  perfect: number;
  good: number;
  miss: number;
  combo: number;
  best: number;
  /** Form der letzten Noten (0–1): der TV dreht die Spur dieses Instruments bei schlechter Form leiser/dumpfer */
  form: number;
  /** Letzte Bewertung (für Effekte am TV): q 0 = daneben, 1 = gut, 2 = perfekt, 3 = Halten geschafft */
  last: { q: 0 | 1 | 2 | 3; seq: number } | null;
}

export interface BandState {
  sub: 'pick' | 'play' | 'over';
  /** ID des eingebauten Songs (`bandSong()` liefert die gespielte Fassung) */
  song: string;
  title: string;
  bpm: number;
  /** Server-Zeit (ms) von Takt 1 – davor läuft der Einzähler; 0 = noch nicht gestartet */
  startAt: number;
  /** Länge des Songs (ms ab Takt 1) */
  duration: number;
  /** Instrument-Wahl: Restzeit (ms), sonst 0 */
  endsIn: number;
  playSeq: number;
  /** Reihenfolge auf der Bühne */
  order: string[];
  players: Record<string, BandPlayer>;
  /** Höchstens so viele pro Instrument */
  cap: number;
  /** Groove: Takte am Stück, in denen die Band genau genug war (aktuell + beste Serie) */
  groove: number;
  bestGroove: number;
  /** Stimmung am Strand (0–100), folgt jedem Treffer */
  energy: number;
  /** Zuletzt ausgewerteter Takt (für Effekte am TV), `acc` = Trefferquote in % */
  lastBar: { bar: number; ok: boolean; acc: number } | null;
  /** Anteil getroffener Noten der ganzen Band bisher (0–100) */
  bandAcc: number;
}

// ------------------------------------------------------------------ Zeit

export const bandStepMs = (song: Pick<Song, 'bpm'>) => 60000 / song.bpm / 4;
export const bandBeatMs = (song: Pick<Song, 'bpm'>) => 60000 / song.bpm;
export const bandBarMs = (song: Pick<Song, 'bpm'>) => (60000 / song.bpm) * 4;
/** Zeit eines Schritts in ms – genau wie der Sequencer (`SongPlayer`): ungerade Schritte um `swing` verschoben */
export const bandStepTime = (song: Pick<Song, 'bpm' | 'swing'>, step: number) => {
  const sm = bandStepMs(song);
  return step * sm + (step % 2 === 1 ? song.swing * sm : 0);
};
/** Länge des Songs (ms) bis zum Ende des letzten Takts */
export const bandSongMs = (song: Pick<Song, 'bpm' | 'bars'>) => song.bars * bandBarMs(song);

// ------------------------------------------------------------------ Song

const songCache = new Map<string, Song | null>();

/**
 * Der Song, wie die Band ihn spielt: kurze Loops so oft hintereinander, bis er ~TARGET_MS lang ist, dazu ein
 * Schlussakkord (Grundton der Tonart, alle Trommeln) im letzten Takt – den hauen alle gemeinsam.
 */
export function bandSong(id: string): Song | null {
  if (songCache.has(id)) return songCache.get(id)!;
  const src = builtinSong(id);
  if (!src) {
    songCache.set(id, null);
    return null;
  }
  const barMs = bandBarMs(src);
  const reps = Math.max(1, Math.ceil(BAND.TARGET_MS / (src.bars * barMs) - 0.05));
  const total = src.bars * reps * STEPS_PER_BAR;
  const rep = (ns: SongNote[]) => Array.from({ length: reps }, (_, r) => ns.map((n) => ({ ...n, step: n.step + r * src.bars * STEPS_PER_BAR }))).flat();
  const repSteps = (xs: number[]) => Array.from({ length: reps }, (_, r) => xs.map((x) => x + r * src.bars * STEPS_PER_BAR)).flat();
  const root = src.key.root;
  const third = src.key.minor ? 3 : 4;
  const end = total; // erster Schritt des Schlusstakts
  const s: Song = {
    ...src,
    bars: src.bars * reps + 1,
    lead: { ...src.lead, notes: [...rep(src.lead.notes), { step: end, midi: 72 + root, len: 10 }] },
    bass: { ...src.bass, notes: [...rep(src.bass.notes), { step: end, midi: 36 + root, len: 10 }] },
    harmony: {
      ...src.harmony,
      notes: [...rep(src.harmony.notes), ...[0, third, 7].map((iv) => ({ step: end, midi: 60 + root + iv, len: 10 }))],
    },
    drums: {
      ...src.drums,
      kick: [...repSteps(src.drums.kick), end],
      snare: [...repSteps(src.drums.snare), end],
      hat: [...repSteps(src.drums.hat), end],
    },
  };
  songCache.set(id, s);
  return s;
}

// ------------------------------------------------------------------ Notenspuren

interface Ev {
  step: number;
  /** Tonhöhe (Melodiekanäle) bzw. Bahn-Vorgabe (Trommeln) */
  midi: number;
  lane?: number;
  /** Länge in Schritten */
  len: number;
  prio: number;
}

/** Gewicht der Taktposition: Eins 4, Drei 3, Viertel 2, Achtel 1, Sechzehntel 0 */
const metric = (step: number) => (step % 16 === 0 ? 4 : step % 8 === 0 ? 3 : step % 4 === 0 ? 2 : step % 2 === 0 ? 1 : 0);

/** Gleichzeitige Töne (Akkorde) zu einem Ereignis zusammenfassen: höchster (Melodie, Ukulele) bzw. tiefster Ton (Bass) */
function melodicEvents(ch: MelodicChannel, low: boolean): Ev[] {
  const by = new Map<number, SongNote[]>();
  for (const n of ch.notes) {
    const list = by.get(n.step);
    if (list) list.push(n);
    else by.set(n.step, [n]);
  }
  return [...by].map(([step, ns]) => {
    const midi = low ? Math.min(...ns.map((n) => n.midi)) : Math.max(...ns.map((n) => n.midi));
    const len = Math.max(...ns.map((n) => n.len));
    return { step, midi, len, prio: metric(step) + (len >= 4 ? 0.5 : 0) };
  });
}

function drumEvents(song: Song): Ev[] {
  const snare = new Set(song.drums.snare);
  const out: Ev[] = song.drums.snare.map((step) => ({ step, midi: 0, lane: 1, len: 1, prio: metric(step) + 1.5 }));
  for (const step of song.drums.kick) if (!snare.has(step)) out.push({ step, midi: 0, lane: 0, len: 1, prio: metric(step) + 0.2 });
  return out;
}

/** Nach Priorität übernehmen, was zu allen bisherigen Noten den Mindestabstand hat */
function thin(song: Song, evs: Ev[], minGap: number): Ev[] {
  const sorted = [...evs].sort((a, b) => b.prio - a.prio || a.step - b.step);
  const times: number[] = [];
  const kept: Ev[] = [];
  for (const e of sorted) {
    const t = bandStepTime(song, e.step);
    // Nachbarn in der sortierten Zeitliste suchen
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const prev = lo > 0 ? times[lo - 1] : -Infinity;
    const next = lo < times.length ? times[lo] : Infinity;
    if (t - prev < minGap || next - t < minGap) continue;
    times.splice(lo, 0, t);
    kept.push(e);
  }
  return kept.sort((a, b) => a.step - b.step);
}

/** Bahn nach Tonhöhe: Rang des Tons unter den Tönen seines 2-Takt-Abschnitts */
function pitchLanes(evs: Ev[], lanes: number) {
  const windows = new Map<number, Ev[]>();
  for (const e of evs) {
    const w = Math.floor(e.step / (STEPS_PER_BAR * 2));
    const list = windows.get(w);
    if (list) list.push(e);
    else windows.set(w, [e]);
  }
  for (const [w, list] of windows) {
    const pitches = [...new Set(list.map((e) => e.midi))].sort((a, b) => a - b);
    const k = pitches.length;
    for (const e of list) {
      const r = pitches.indexOf(e.midi);
      if (k === 1) e.lane = lanes === 3 ? 1 : w % lanes;
      else if (k <= lanes) e.lane = Math.round((r * (lanes - 1)) / (k - 1));
      else e.lane = Math.min(lanes - 1, Math.floor((r * lanes) / k));
    }
  }
}

const chartCache = new Map<string, BandNote[]>();

/** Notenspur eines Instruments für einen Song (aus `bandSong`) – deterministisch, gecacht */
export function bandChart(song: Song, inst: BandInst): BandNote[] {
  const key = `${song.id}:${song.bars}:${inst}`;
  const hit = chartCache.get(key);
  if (hit) return hit;
  const info = BAND_INFO[inst];
  const lanes = info.laneNames.length;
  let evs: Ev[];
  if (inst === 'drums') evs = drumEvents(song);
  else if (inst === 'shaker') evs = song.drums.hat.map((step) => ({ step, midi: 0, lane: 0, len: 1, prio: metric(step) }));
  else evs = melodicEvents(inst === 'melody' ? song.lead : inst === 'bass' ? song.bass : song.harmony, inst === 'bass');
  const kept = thin(song, evs, info.minGap);
  if (inst !== 'drums' && inst !== 'shaker') pitchLanes(kept, lanes);
  const stepMs = bandStepMs(song);
  const notes: BandNote[] = kept.map((e, i) => {
    const t = Math.round(bandStepTime(song, e.step));
    const n: BandNote = { t, lane: e.lane ?? 0, bar: Math.floor(e.step / STEPS_PER_BAR) };
    if (info.holdMs && e.len * stepMs >= info.holdMs) {
      // Halten endet rechtzeitig vor der nächsten Note (Daumen braucht eine Pause), höchstens 2,4 s
      const next = kept[i + 1] ? bandStepTime(song, kept[i + 1].step) : Infinity;
      const end = Math.min(t + e.len * stepMs, next - Math.max(160, info.minGap * 0.7), t + 2400);
      if (end - t >= info.holdMs * 0.8) n.len = Math.round(end - t);
    }
    return n;
  });
  chartCache.set(key, notes);
  return notes;
}

/** Höchstpunktzahl einer Spur: 2 pro Note (perfekt), +1 pro Halte-Note */
export const bandMaxScore = (chart: BandNote[]) => chart.reduce((s, n) => s + 2 + (n.len ? 1 : 0), 0);

// ------------------------------------------------------------------ Besetzung

/** So viele Spieler dürfen dasselbe Instrument spielen (bei 12 Spielern 4) */
export const bandCap = (players: number) => Math.max(2, Math.ceil(players / BAND_INSTS.length) + 1);

/** Vorschlag: der Reihe nach Schlagzeug, Melodie, Bass, Ukulele, Shaker – ab 6 Spielern doppelt */
export function bandAssign(ids: string[]): Record<string, BandInst> {
  return Object.fromEntries(ids.map((id, i) => [id, BAND_INSTS[i % BAND_INSTS.length]]));
}

/** Gruppen-Bonus (Münzen) für die längste Groove-Serie */
export function bandBonusCoins(bestBars: number): number {
  for (const [bars, coins] of BAND.BONUS_BARS) if (bestBars >= bars) return coins;
  return 0;
}
