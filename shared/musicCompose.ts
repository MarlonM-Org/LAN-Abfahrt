/**
 * Kleine Kompositions-Helfer für die eingebauten Songs (reine Daten, kein DOM/Node).
 *
 * - `seq` / `hits`: Raster-Schreibweise (16 Zeichen-Gruppen pro Takt, für kurze Loops)
 * - `mel`: Melodie als „Ton:Länge“-Folge, Takte durch „|“ getrennt (jeder Takt muss 16 ergeben)
 * - `chords`: Begleitung/Bass aus einer Akkordfolge und einem Rhythmus-Muster pro Takt
 * - `cat`: Teile (Abschnitte) hintereinander hängen
 * - `rep`: Schlagzeug-Takte wiederholen
 */
import { STEPS_PER_BAR, type SongNote } from './music';

const NAMES: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, H: 11 };

/** „A4“ → 69 */
export function midiOf(name: string): number {
  const m = /^([A-H][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Unbekannter Ton: ${name}`);
  return (Number(m[2]) + 1) * 12 + NAMES[m[1]];
}

/**
 * Takt aus 16 Zeichen-Gruppen: Tonname (z. B. „E5“) beginnt eine Note, „-“ verlängert sie
 * um einen Schritt, „.“ ist Pause. Mehrere Takte durch „|“ getrennt.
 */
export function seq(pattern: string): SongNote[] {
  const out: SongNote[] = [];
  pattern.split('|').forEach((bar, b) => {
    const tokens = bar.trim().split(/\s+/);
    if (tokens.length !== 16) throw new Error(`Takt ${b + 1} hat ${tokens.length} statt 16 Schritte: ${bar}`);
    tokens.forEach((tok, i) => {
      if (tok === '.') return;
      if (tok === '-') {
        const last = out[out.length - 1];
        if (last) last.len += 1;
        return;
      }
      out.push({ step: b * 16 + i, midi: midiOf(tok), len: 1 });
    });
  });
  return out;
}

/** Schlagzeug-Takt: „x“ = Schlag, „.“ = nichts; Takte durch „|“ */
export function hits(pattern: string): number[] {
  const out: number[] = [];
  pattern.split('|').forEach((bar, b) => {
    const t = bar.replace(/\s+/g, '');
    if (t.length !== 16) throw new Error(`Schlagzeug-Takt ${b + 1} hat ${t.length} statt 16 Schritte`);
    for (let i = 0; i < 16; i++) if (t[i] === 'x') out.push(b * 16 + i);
  });
  return out;
}

/** Schlagzeug-Abschnitte: [Takt-Muster, Anzahl] … → „|“-getrennte Takte für `hits` */
export function rep(...parts: [string, number][]): string {
  const out: string[] = [];
  for (const [p, n] of parts) for (let i = 0; i < n; i++) out.push(p);
  return out.join('|');
}

/** Ein Stück Musik mit fester Länge in Takten */
export interface Part {
  bars: number;
  notes: SongNote[];
}

/**
 * Melodie: „E5:3 B4 E5:2 .:2 …“ – Tonname mit Länge in Sechzehnteln (ohne „:n“ = 1),
 * „.“ = Pause. Takte durch „|“; jeder Takt muss genau 16 Schritte lang sein.
 * `gate` < 1 kürzt die klingende Länge (Staccato), der Rhythmus bleibt.
 */
export function mel(pattern: string, gate = 1): Part {
  const notes: SongNote[] = [];
  const bars = pattern.split('|');
  bars.forEach((bar, b) => {
    let pos = 0;
    for (const tok of bar.trim().split(/\s+/)) {
      const [name, l] = tok.split(':');
      const len = l === undefined ? 1 : Number(l);
      if (!Number.isFinite(len) || len <= 0) throw new Error(`Ungültige Länge in Takt ${b + 1}: ${tok}`);
      if (name !== '.') notes.push({ step: b * STEPS_PER_BAR + pos, midi: midiOf(name), len: gate < 1 ? Math.max(0.5, Math.round(len * gate * 4) / 4) : len });
      pos += len;
    }
    if (pos !== STEPS_PER_BAR) throw new Error(`Melodie-Takt ${b + 1} hat ${pos} statt 16 Schritte: ${bar}`);
  });
  return { bars: bars.length, notes };
}

/** Akkord „Am“, „Bb7“, „F#dim“, „Esus4“, „Cmaj7“ → Grundton (Tonklasse) und Intervalle */
function parseChord(name: string): { pc: number; third: number; fifth: number; seventh: number } {
  const m = /^([A-H][#b]?)(m|dim|aug|sus4|sus2)?(maj7|7)?$/.exec(name);
  if (!m) throw new Error(`Unbekannter Akkord: ${name}`);
  const q = m[2] ?? '';
  const third = q === 'm' || q === 'dim' ? 3 : q === 'sus4' ? 5 : q === 'sus2' ? 2 : 4;
  const fifth = q === 'dim' ? 6 : q === 'aug' ? 8 : 7;
  const seventh = m[3] === 'maj7' ? 11 : q === 'dim' && m[3] === '7' ? 9 : 10;
  return { pc: NAMES[m[1]], third, fifth, seventh };
}

/**
 * Begleitung aus Akkorden. `prog`: Takte durch „|“, pro Takt 1, 2 oder 4 Akkorde (gleich lang).
 * `lo`: tiefster erlaubter Grundton (MIDI) – der Grundton liegt immer in [lo, lo+11].
 * `pattern`: 16 Zeichen-Gruppen pro Takt (Liste = reihum je Takt). Eine Gruppe besteht aus
 * Stufen, die gleichzeitig klingen: R Grundton, 3 Terz, 5 Quinte, 7 Septime, O Oktave,
 * T Terz +8va, F Quinte +8va, L Quinte darunter; „-“ hält die letzte Gruppe, „.“ Pause.
 */
export function chords(prog: string, lo: number, pattern: string | string[], gate = 1): Part {
  const pats = (Array.isArray(pattern) ? pattern : [pattern]).map((p) => {
    const t = p.trim().split(/\s+/);
    if (t.length !== 16) throw new Error(`Begleitmuster hat ${t.length} statt 16 Schritte: ${p}`);
    return t;
  });
  const bars = prog.split('|').map((b) => b.trim().split(/\s+/).map(parseChord));
  const notes: SongNote[] = [];
  let last: SongNote[] = [];
  bars.forEach((cs, b) => {
    if (![1, 2, 4].includes(cs.length)) throw new Error(`Takt ${b + 1}: 1, 2 oder 4 Akkorde erlaubt`);
    const pat = pats[b % pats.length];
    for (let i = 0; i < 16; i++) {
      const tok = pat[i];
      const step = b * STEPS_PER_BAR + i;
      if (tok === '-') {
        for (const n of last) if (n.step + n.len >= step) n.len += 1;
        continue;
      }
      last = [];
      if (tok === '.') continue;
      const c = cs[Math.floor((i * cs.length) / 16)];
      const root = lo + ((((c.pc - lo) % 12) + 12) % 12);
      for (const ch of tok) {
        const off = { R: 0, '3': c.third, '5': c.fifth, '7': c.seventh, O: 12, T: 12 + c.third, F: 12 + c.fifth, L: c.fifth - 12 }[ch];
        if (off === undefined) throw new Error(`Unbekannte Stufe „${ch}“ im Muster`);
        const n = { step, midi: root + off, len: 1 };
        notes.push(n);
        last.push(n);
      }
    }
  });
  if (gate < 1) for (const n of notes) n.len = Math.max(0.5, Math.round(n.len * gate * 4) / 4);
  return { bars: bars.length, notes };
}

/** Teile hintereinander hängen (Schritte werden verschoben) */
export function cat(...parts: Part[]): Part {
  const notes: SongNote[] = [];
  let bars = 0;
  for (const p of parts) {
    for (const n of p.notes) notes.push({ ...n, step: n.step + bars * STEPS_PER_BAR });
    bars += p.bars;
  }
  return { bars, notes };
}
