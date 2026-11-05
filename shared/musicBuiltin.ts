/**
 * Eingebaute Songs der Bibliothek – reine Daten (kein DOM, kein Node).
 *
 * Die fünf alten Loops (party/action/romantic/spooky/bar) liegen noch im alten Kurzformat
 * (Akkorde + Melodie als Akkordindex) und werden hier in Song-Format v2 übersetzt – exakt so,
 * wie der alte Sequencer sie gespielt hat (Bass, leises Arpeggio, Melodie, Schlagzeug).
 * Dazu kommen neue Beispiel-Loops in weiteren Stilen, direkt in v2 (freie Tonhöhen), und die
 * längeren Themen-Songs für die Minispiele (`musicThemen.ts`).
 */
import { type Song, type SongInfo, type StyleId, type Wave, emptySong, songInfo } from './music';
import { hits, seq } from './musicCompose';
import { THEME_SONGS } from './musicThemen';

export { midiOf } from './musicCompose';

// ------------------------------------------------------------------ Altes Format

interface LegacyTrack {
  bpm: number;
  chords: number[][];
  lead: 'pulse25' | 'pulse50' | 'triangle';
  drums: 'four' | 'rock' | 'soft' | 'none';
  melody: number[][];
  swing?: number;
  leadVol: number;
}

const C = [60, 64, 67];
const G = [55, 59, 62];
const Am = [57, 60, 64];
const F = [53, 57, 60];
const Dm = [50, 53, 57];
const Bb = [46, 50, 53];
const Gm = [55, 58, 62];
const A = [57, 61, 64];
const Em = [52, 55, 59];
const D = [50, 54, 57];
const R = -1;

const LEGACY: Record<string, { title: string; style: StyleId; key: { root: number; minor: boolean }; track: LegacyTrack }> = {
  party: {
    title: 'Ferienhaus-Party', style: 'party', key: { root: 0, minor: false },
    track: {
      bpm: 124, chords: [C, G, Am, F], lead: 'pulse25', drums: 'four', leadVol: 0.07,
      melody: [
        [2, R, 1, R, 0, R, 1, 2, R, 2, R, 3, 2, R, 1, R],
        [1, R, 2, R, 1, R, 0, R, 1, 2, 1, R, 0, R, R, R],
        [0, R, 1, R, 2, R, 3, R, 2, R, 1, R, 2, R, 0, R],
        [1, R, 0, R, 1, 2, R, 3, R, 4, R, 3, 2, R, R, R],
      ],
    },
  },
  action: {
    title: 'Vollgas', style: 'action', key: { root: 9, minor: true },
    track: {
      bpm: 150, chords: [Am, F, C, G], lead: 'pulse50', drums: 'rock', leadVol: 0.06,
      melody: [
        [0, 0, 2, 0, 3, 0, 2, 1, 0, 0, 2, 0, 4, 3, 2, 1],
        [0, 0, 2, 0, 3, 0, 2, 1, 0, 1, 2, 3, 4, R, 3, R],
        [2, 2, 3, 2, 1, 0, 1, 2, 3, R, 2, R, 1, R, 0, R],
        [1, 1, 2, 1, 0, R, 1, 2, 4, 3, 2, 1, 2, R, R, R],
      ],
    },
  },
  romantic: {
    title: 'Abendrot', style: 'romantisch', key: { root: 5, minor: false },
    track: {
      bpm: 84, chords: [F, Dm, Bb, C], lead: 'triangle', drums: 'soft', leadVol: 0.12, swing: 0.12,
      melody: [
        [2, R, R, 1, 2, R, 3, R, 2, R, R, R, 1, R, R, R],
        [0, R, R, 1, 2, R, 1, R, 0, R, R, R, R, R, R, R],
        [1, R, R, 2, 3, R, 2, R, 1, R, 0, R, 1, R, R, R],
        [2, R, R, R, 1, R, R, R, 0, R, R, R, R, R, R, R],
      ],
    },
  },
  spooky: {
    title: 'Stromausfall', style: 'grusel', key: { root: 2, minor: true },
    track: {
      bpm: 92, chords: [Dm, Bb, Gm, A], lead: 'triangle', drums: 'soft', leadVol: 0.1,
      melody: [
        [0, R, R, 7, R, R, 2, R, 1, R, R, R, 0, R, R, R],
        [R, R, 2, R, R, 1, R, R, 0, R, R, R, R, R, R, R],
        [0, R, R, 7, R, R, 2, R, 3, R, R, 2, R, 1, R, R],
        [1, R, R, R, 0, R, R, R, R, R, R, R, R, R, R, R],
      ],
    },
  },
  bar: {
    title: 'Cocktailbar', style: 'bar', key: { root: 7, minor: false },
    track: {
      bpm: 108, chords: [G, Em, C, D], lead: 'pulse25', drums: 'four', leadVol: 0.06, swing: 0.18,
      melody: [
        [2, R, 2, 1, 2, R, 3, R, 2, R, 1, R, 0, R, R, R],
        [1, R, 1, 0, 1, R, 2, R, 1, R, 0, R, R, R, R, R],
        [0, R, 1, R, 2, R, 3, 4, 3, R, 2, R, 1, R, R, R],
        [2, R, 1, R, 0, R, 1, R, 2, R, R, R, R, R, R, R],
      ],
    },
  },
};

/** Übersetzt einen alten Loop 1:1 in Song v2 (gleiche Töne, Längen und Lautstärken wie früher) */
export function fromLegacy(id: string, title: string, style: StyleId, key: { root: number; minor: boolean }, t: LegacyTrack): Song {
  const s = emptySong(id, title);
  s.author = 'LAN-Abfahrt';
  s.style = style;
  s.key = key;
  s.bpm = t.bpm;
  s.swing = t.swing ?? 0;
  s.bars = t.chords.length;
  s.lead = { wave: t.lead, volume: t.leadVol, env: 'pluck', notes: [] };
  s.bass = { wave: 'triangle', volume: 0.16, env: 'pluck', notes: [] };
  s.harmony = t.lead === 'triangle'
    ? { wave: 'triangle', volume: 0.04, env: 'pluck', notes: [] }
    : { wave: 'pulse25', volume: 0.025, env: 'pluck', notes: [] };
  // Hats waren bei „soft“ halb so laut; Kick/Snare gibt es dort nicht
  s.drums = { volume: t.drums === 'soft' ? 0.5 : 1, kick: [], snare: [], hat: [] };
  for (let bar = 0; bar < t.chords.length; bar++) {
    const chord = t.chords[bar];
    for (let i = 0; i < 16; i++) {
      const step = bar * 16 + i;
      if (i % 4 === 0 || (t.drums === 'rock' && i % 2 === 0)) s.bass.notes.push({ step, midi: chord[0] - 12, len: 1.8 });
      if (t.lead !== 'triangle' && i % 2 === 0) s.harmony.notes.push({ step, midi: chord[(i / 2) % 3] + 12, len: 0.8 });
      if (t.lead === 'triangle' && i % 4 === 2) s.harmony.notes.push({ step, midi: chord[Math.floor(i / 4) % 3] + 12, len: 3 });
      const note = t.melody[bar % t.melody.length][i];
      if (note >= 0) {
        const pitch = note >= 7 ? chord[(note - 7) % 3] + 24 : chord[note % 3] + 12 + (note >= 3 ? 12 : 0);
        s.lead.notes.push({ step, midi: pitch, len: t.lead === 'triangle' ? 3 : 1.6 });
      }
      if (t.drums === 'four' && i % 4 === 0) s.drums.kick.push(step);
      if (t.drums === 'rock' && (i === 0 || i === 8 || i === 10)) s.drums.kick.push(step);
      if ((t.drums === 'four' || t.drums === 'rock') && i % 8 === 4) s.drums.snare.push(step);
      if (t.drums !== 'none' && i % 2 === 1) s.drums.hat.push(step);
    }
  }
  return s;
}

// ------------------------------------------------------------------ Neue Loops (v2)

function song(o: {
  id: string; title: string; style: StyleId; bpm: number; swing?: number; key: { root: number; minor: boolean };
  lead: { wave: Wave; volume: number; env?: 'hold' | 'pluck'; notes: string };
  bass: { wave?: Wave; volume?: number; env?: 'hold' | 'pluck'; notes: string };
  harmony?: { wave: Wave; volume: number; env?: 'hold' | 'pluck'; notes: string };
  drums: { volume?: number; kick: string; snare: string; hat: string };
}): Song {
  const s = emptySong(o.id, o.title);
  s.author = 'LAN-Abfahrt';
  s.style = o.style;
  s.bpm = o.bpm;
  s.swing = o.swing ?? 0;
  s.key = o.key;
  s.lead = { wave: o.lead.wave, volume: o.lead.volume, env: o.lead.env ?? 'hold', notes: seq(o.lead.notes) };
  s.bass = { wave: o.bass.wave ?? 'triangle', volume: o.bass.volume ?? 0.16, env: o.bass.env ?? 'hold', notes: seq(o.bass.notes) };
  s.harmony = o.harmony ? { wave: o.harmony.wave, volume: o.harmony.volume, env: o.harmony.env ?? 'pluck', notes: seq(o.harmony.notes) } : s.harmony;
  s.drums = { volume: o.drums.volume ?? 1, kick: hits(o.drums.kick), snare: hits(o.drums.snare), hat: hits(o.drums.hat) };
  const total = Math.max(...[...s.lead.notes, ...s.bass.notes, ...s.harmony.notes].map((n) => n.step + 1), ...s.drums.kick, ...s.drums.snare, ...s.drums.hat, 1);
  s.bars = Math.max(1, Math.ceil(total / 16));
  return s;
}

const NEW_SONGS: Song[] = [
  song({
    id: 'strandpromenade', title: 'Strandpromenade', style: 'chill', bpm: 96, swing: 0.15, key: { root: 0, minor: false },
    lead: {
      wave: 'triangle', volume: 0.11,
      notes: 'E5 - - . G5 - - . A5 - G5 - E5 - - . | C5 - - . E5 - - . D5 - C5 - A4 - - - | A4 - C5 - F5 - - . E5 - D5 - C5 - - . | D5 - - . B4 - - . G4 - A4 - B4 - D5 -',
    },
    bass: { volume: 0.15, notes: 'C3 - - - - - . . G2 - - - - - . . | A2 - - - - - . . E3 - - - - - . . | F2 - - - - - . . C3 - - - - - . . | G2 - - - - - . . D3 - - - - - . .' },
    harmony: {
      wave: 'pulse12', volume: 0.03,
      notes: '. . E4 . . . G4 . . . E4 . . . G4 . | . . C4 . . . E4 . . . C4 . . . E4 . | . . A3 . . . C4 . . . A3 . . . C4 . | . . B3 . . . D4 . . . B3 . . . D4 .',
    },
    drums: { volume: 0.6, kick: 'x.........x.....|x.........x.....|x.........x.....|x.........x.....', snare: '........x.......|........x.......|........x.......|........x.......', hat: '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x...x.' },
  }),
  song({
    id: 'pixel-arcade', title: 'Pixel-Arcade', style: 'retro', bpm: 140, key: { root: 9, minor: true },
    lead: {
      wave: 'pulse12', volume: 0.07, env: 'pluck',
      notes: 'A5 . A5 . C6 . A5 . E5 . G5 . A5 - - . | F5 . A5 . C6 . A5 . F5 . E5 . D5 - - . | E5 . G5 . C6 . G5 . E5 . C5 . D5 . E5 . | D5 . D5 . G5 . B5 . D6 - - . B5 . G5 .',
    },
    bass: {
      volume: 0.16, env: 'pluck',
      notes: 'A2 . A3 . A2 . A3 . A2 . A3 . A2 . A3 . | F2 . F3 . F2 . F3 . F2 . F3 . F2 . F3 . | C3 . C4 . C3 . C4 . C3 . C4 . C3 . C4 . | G2 . G3 . G2 . G3 . G2 . G3 . G2 . G3 .',
    },
    harmony: {
      wave: 'pulse25', volume: 0.02,
      notes: 'A4 . C5 . E5 . C5 . A4 . C5 . E5 . C5 . | F4 . A4 . C5 . A4 . F4 . A4 . C5 . A4 . | C5 . E5 . G5 . E5 . C5 . E5 . G5 . E5 . | G4 . B4 . D5 . B4 . G4 . B4 . D5 . B4 .',
    },
    drums: { kick: 'x.......x.x.....|x.......x.x.....|x.......x.x.....|x.......x.x.....', snare: '....x.......x...|....x.......x...|....x.......x...|....x.......x..x', hat: '.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x|.x.x.x.x.x.x.x.x' },
  }),
  song({
    id: 'gipfelsturm', title: 'Gipfelsturm', style: 'episch', bpm: 112, key: { root: 2, minor: true },
    lead: {
      wave: 'pulse50', volume: 0.065,
      notes: 'D5 - - - F5 - - - A5 - - - - - - - | A#4 - - - D5 - - - F5 - - - G5 - A5 - | C6 - - - A5 - - - F5 - - - E5 - D5 - | E5 - - - - - - - D5 - - - - - - .',
    },
    bass: {
      volume: 0.17, env: 'pluck',
      notes: 'D2 . D2 . D2 . D2 . D2 . D2 . D2 . D2 . | A#1 . A#1 . A#1 . A#1 . A#1 . A#1 . A#1 . A#1 . | F2 . F2 . F2 . F2 . F2 . F2 . F2 . F2 . | C2 . C2 . C2 . C2 . C2 . C2 . C2 . C2 .',
    },
    harmony: {
      wave: 'pulse25', volume: 0.03, env: 'hold',
      notes: 'A3 - - - - - - - - - - - - - - - | F3 - - - - - - - - - - - - - - - | C4 - - - - - - - - - - - - - - - | G3 - - - - - - - - - - - - - - -',
    },
    drums: { kick: 'x..x..x.x..x..x.|x..x..x.x..x..x.|x..x..x.x..x..x.|x..x..x.x..x..x.', snare: '....x.......x...|....x.......x...|....x.......x...|....x.......x.xx', hat: '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x...x.' },
  }),
  song({
    id: 'poolparty', title: 'Poolparty', style: 'party', bpm: 128, key: { root: 0, minor: false },
    lead: {
      wave: 'pulse25', volume: 0.07, env: 'pluck',
      notes: 'A5 . A5 . C6 . A5 . F5 . G5 . A5 . . . | G5 . G5 . B5 . G5 . D5 . E5 . G5 . . . | E5 . G5 . C6 . G5 . E5 . C5 . E5 . G5 . | A5 - - . E5 - - . C5 . D5 . E5 - - .',
    },
    bass: {
      volume: 0.16, env: 'pluck',
      notes: 'F2 - . F2 . . F3 . F2 - . F2 . . F3 . | G2 - . G2 . . G3 . G2 - . G2 . . G3 . | C3 - . C3 . . C4 . C3 - . C3 . . C4 . | A2 - . A2 . . A3 . A2 - . A2 . . A3 .',
    },
    harmony: {
      wave: 'pulse12', volume: 0.025,
      notes: '. . F4 . . . A4 . . . C5 . . . A4 . | . . G4 . . . B4 . . . D5 . . . B4 . | . . E4 . . . G4 . . . C5 . . . G4 . | . . A4 . . . C5 . . . E5 . . . C5 .',
    },
    drums: { kick: 'x...x...x...x...|x...x...x...x...|x...x...x...x...|x...x...x...x...', snare: '....x.......x...|....x.......x...|....x.......x...|....x.......x.x.', hat: '..x...x...x...x.|..x...x...x...x.|..x...x...x...x.|..x...x...x...x.' },
  }),
];

export const BUILTIN_SONGS: Song[] = [
  ...Object.entries(LEGACY).map(([id, l]) => fromLegacy(id, l.title, l.style, l.key, l.track)),
  ...NEW_SONGS,
  ...THEME_SONGS,
];

export const BUILTIN_IDS = new Set(BUILTIN_SONGS.map((s) => s.id));
export const builtinSong = (id: string) => BUILTIN_SONGS.find((s) => s.id === id);
export const BUILTIN_INFOS: SongInfo[] = BUILTIN_SONGS.map((s) => songInfo(s, true));
