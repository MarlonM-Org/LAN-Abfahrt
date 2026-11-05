/**
 * Themen-Songs für die Minispiele (eingebaut, Song-Format v2) – alle selbst komponiert.
 *
 * Jeder Song ist 32 Takte lang (≈ 45–80 s), ohne Intro: Takt 32 führt jeweils zurück in Takt 1.
 * Aufbau meist A (Thema) – B (Gegenstück) – A' (Thema, anderes Ende) – C (Bridge/Breakdown).
 * Melodien stehen als „Ton:Länge“ (Sechzehntel) da, Bass und Begleitung werden aus der
 * Akkordfolge plus Rhythmus-Muster erzeugt (siehe `musicCompose.ts`).
 */
import { type Song, type StyleId, type Wave, emptySong } from './music';
import { type Part, cat, chords, hits, mel, midiOf } from './musicCompose';

interface Ch { wave: Wave; volume: number; env: 'hold' | 'pluck'; part: Part }

function theme(o: {
  id: string; title: string; style: StyleId; bpm: number; swing?: number; key: { root: number; minor: boolean };
  lead: Ch; bass: Ch; harmony: Ch;
  drums: { volume: number; kick: string; snare: string; hat: string };
}): Song {
  const s = emptySong(o.id, o.title);
  s.author = 'LAN-Abfahrt';
  s.style = o.style;
  s.bpm = o.bpm;
  s.swing = o.swing ?? 0;
  s.key = o.key;
  s.bars = o.lead.part.bars;
  for (const [name, c] of [['Melodie', o.lead], ['Bass', o.bass], ['Begleitung', o.harmony]] as const) {
    if (c.part.bars !== s.bars) throw new Error(`${o.id}: ${name} hat ${c.part.bars} statt ${s.bars} Takte`);
  }
  s.lead = { wave: o.lead.wave, volume: o.lead.volume, env: o.lead.env, notes: o.lead.part.notes };
  s.bass = { wave: o.bass.wave, volume: o.bass.volume, env: o.bass.env, notes: o.bass.part.notes };
  s.harmony = { wave: o.harmony.wave, volume: o.harmony.volume, env: o.harmony.env, notes: o.harmony.part.notes };
  s.drums = { volume: o.drums.volume, kick: hits(o.drums.kick), snare: hits(o.drums.snare), hat: hits(o.drums.hat) };
  for (const x of [s.drums.kick, s.drums.snare, s.drums.hat]) {
    if (x.some((v) => v >= s.bars * 16)) throw new Error(`${o.id}: Schlagzeug länger als ${s.bars} Takte`);
  }
  return s;
}

/** Schlagzeug-Takte wiederholen: [Muster, Anzahl] … */
const dr = (...parts: [string, number][]) => parts.flatMap(([p, n]) => Array<string>(n).fill(p)).join('|');
const N = (name: string) => midiOf(name);

// ------------------------------------------------------------------ Zauber-Arena

/** E-Moll mit harmonischem Moll (H-Dur als Dominante), funkelnde 16tel-Arpeggien */
function zauber(): Song {
  const A = 'Em|C|Am|B|Em|C|Am B|Em', B = 'C|D|Bm|Em|Am|D|G|B', C = 'Am|B|Em|C|Am|F|B|B';
  const head = 'E5:3 B4 E5:2 G5:2 F#5:2 E5:2 D#5:2 E5:2 | G5:4 E5:2 C5:2 .:2 E5:2 G5:2 C6:2 | B5:3 A5 G5:2 E5:2 A5:4 C6:2 B5:2 | A5:2 G5:2 F#5:2 D#5:2 F#5:4 B5:4 | E6:3 D#6 E6:2 B5:2 G5:2 B5:2 E5:4 | G5:2 A5:2 G5:2 E5:2 C5:4 E5:2 G5:2';
  const lead = cat(
    mel(`${head} | A5:2 C6:2 B5:2 A5:2 F#5:2 A5:2 D#5:4 | E5:8 .:4 B4:2 D#5:2`),
    mel('E5:4 G5:4 C6:6 B5:2 | A5:4 F#5:4 D5:4 A5:2 F#5:2 | B5:6 A5:2 F#5:4 D5:4 | E5:6 G5:2 B5:8 | C6:4 B5:2 A5:2 E5:4 A5:4 | F#5:4 A5:2 D6:2 C6:2 A5:2 F#5:4 | G5:4 B5:4 D6:4 B5:2 G5:2 | F#5:6 D#5:2 B4:4 .:4'),
    mel(`${head} | C6:2 B5:2 A5:2 C6:2 B5:4 D#6:4 | E6:8 B5:4 G5:4`),
    mel('A5:8 C6:8 | B5:8 D#6:4 F#6:4 | G6:8 E6:4 B5:4 | C6:8 E6:4 G6:4 | A5:4 E5:4 A5:4 C6:4 | C6:4 A5:4 F5:4 A5:4 | B5:4 A5:2 G5:2 F#5:4 D#5:4 | F#5:2 B4:2 D#5:2 F#5:2 A5:2 F#5:2 D#5:2 B4:2'),
  );
  const drive = 'R - . R O . R . 5 - . R O . 5 .';
  const bass = cat(chords(A, N('C2'), drive), chords(B, N('C2'), drive), chords(A, N('C2'), drive), chords(C, N('C2'), 'R - - - - - . R O - - - 5 - . .'));
  const sparkle = 'R 3 5 O T O 5 3 R 3 5 O T O 5 3';
  const harmony = cat(chords(A, N('E4'), sparkle), chords(B, N('E4'), sparkle), chords(A, N('E4'), sparkle), chords(C, N('E4'), 'O . F . T . F . O . F . T . F .'));
  const K = 'x.....x...x.....', S = '....x.......x...', H = 'x.x.x.x.x.x.x.x.';
  const SF = '....x.......xxxx';
  return theme({
    id: 'zauber', title: 'Arkanes Duell', style: 'magie', bpm: 138, key: { root: 4, minor: true },
    lead: { wave: 'pulse25', volume: 0.065, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.16, env: 'pluck', part: bass },
    harmony: { wave: 'pulse12', volume: 0.018, env: 'pluck', part: harmony },
    drums: {
      volume: 0.9,
      kick: dr([K, 24], ['x.......x.......', 6], ['x...x...x...x...', 2]),
      snare: dr([S, 7], [SF, 1], [S, 7], [SF, 1], [S, 7], [SF, 1], ['........x.......', 6], ['....x...x...x...', 1], ['x.x.x.x.xxxxxxxx', 1]),
      hat: dr([H, 24], ['..x...x...x...x.', 6], [H, 1], ['................', 1]),
    },
  });
}

// ------------------------------------------------------------------ Igel-Krieg

/** B-Dur-Marsch mit Humptata, pfeifenden „Granaten“ (chromatisch fallend) und Trio in Es-Dur */
function igelkrieg(): Song {
  const A = 'Bb|Bb|F7|Bb|Bb|Eb|Bb F|Bb', B = 'Gm|Gm|Cm|F|Eb|F|Bb Gm|C7 F7', T = 'Eb|Bb7|Eb|Ab|Eb|Bb7|F7|F7';
  const head = 'F5:2 F5 F5 Bb5:3 F5 D5:2 F5:2 Bb4:4 | D5:2 D5 Eb5 F5:2 G5:2 F5:4 D5:4 | C5:2 C5 D5 Eb5:2 F5:2 A5:3 G5 F5:2 Eb5:2 | D5:2 Bb4:2 C5:2 D5:2 Bb4:4 .:4 | F5:2 F5 F5 Bb5:3 F5 D6:2 C6:2 Bb5:4 | G5:2 G5 G5 Bb5:2 G5:2 Eb5:4 G5:4';
  const lead = cat(
    mel(`${head} | F5:2 D5:2 Bb4:2 D5:2 C5:2 A4:2 F4:2 A4:2 | Bb4:2 .:2 Bb4 . Bb4:2 .:8`, 0.6),
    mel('D6:2 C#6:2 C6:2 B5:2 Bb5:2 A5:2 Ab5:2 G5:2 | .:2 G4 . G4 . Bb4:2 D5:4 .:4 | Eb6:2 D6:2 C#6:2 C6:2 B5:2 Bb5:2 A5:2 G5:2 | A5:2 .:2 A5 . C6:2 A5:2 F5:2 Eb5:4 | G5:3 Bb5 Eb6:4 D6:2 C6:2 Bb5:4 | A5:3 C6 F6:4 Eb6:2 D6:2 C6:4 | D6:2 Bb5:2 F5:2 Bb5:2 G5:2 D5:2 Bb4:2 G4:2 | C5:2 E5:2 G5:2 Bb5:2 A5:2 F5:2 Eb5:2 C5:2', 0.75),
    mel(`${head} | D6:2 Bb5:2 F5:2 D5:2 Eb5:2 C5:2 A4:2 C5:2 | Bb4:2 F4:2 Bb4:2 .:2 Bb5:2 .:6`, 0.6),
    mel('G5:6 F5:2 Eb5:4 G5:4 | F5:6 Ab5:2 D5:4 F5:4 | Eb5:4 G5:4 Bb5:6 C6:2 | C6:8 Ab5:4 Eb5:4 | Bb5:6 G5:2 Eb5:4 Bb4:4 | Ab5:4 F5:4 D5:4 Bb4:4 | A5:2 A5 A5 C6:2 A5:2 Eb5:4 F5:4 | C5 . C5 . C5 . Eb5:2 F5:2 A5:2 C6:4', 0.9),
  );
  const oom = 'R - - . . . . . L - - . . . . .', pah = '. . . . 35 - . . . . . . 35 - . .';
  const bass = cat(chords(A, N('D2'), oom), chords(B, N('D2'), oom), chords(A, N('D2'), oom), chords(T, N('D2'), oom));
  const harmony = cat(chords(A, N('F3'), pah), chords(B, N('F3'), pah), chords(A, N('F3'), pah), chords(T, N('F3'), '. . . . 35 . 35 . . . . . 35 . 35 .'));
  const K = 'x.......x.......', S = '....x.x.....x.xx', H = 'x.x.x.x.x.x.x.x.', ROLL = 'x.xxx.xxx.xxxxxx';
  const NONE = '................', BOOM = 'x...x.x.....x.xx';
  return theme({
    id: 'igelkrieg', title: 'Igel im Gleichschritt', style: 'action', bpm: 120, key: { root: 10, minor: false },
    lead: { wave: 'pulse50', volume: 0.06, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.17, env: 'pluck', part: bass },
    harmony: { wave: 'pulse25', volume: 0.025, env: 'pluck', part: harmony },
    drums: {
      volume: 0.9,
      kick: dr([K, 32]),
      snare: dr([S, 7], [ROLL, 1], [NONE, 1], [BOOM, 1], [NONE, 1], [BOOM, 1], [S, 3], [ROLL, 1], [S, 7], [ROLL, 1], ['....x.......x...', 7], ['x.x.x.x.xxxxxxxx', 1]),
      hat: dr([H, 32]),
    },
  });
}

// ------------------------------------------------------------------ Rennen

/** A-Dur, 168 BPM, Oktav-Bass und „Motor“-HiHats; C-Teil mit F–G–A-Aufstieg */
function rennen(): Song {
  const A = 'A|E|F#m|D|A|E|D|E', B = 'Bm|E|C#m|F#m|D|E|D E|E', C = 'F|G|A|A|F|G|E|E';
  const head = 'E5:4 A5:4 C#6:2 B5:2 A5:2 E5:2 | G#5:4 B5:4 E6:6 D6:2 | C#6:4 A5:2 F#5:2 C#6:4 E6:4 | D6:6 C#6:2 B5:2 A5:2 F#5:4 | E5:2 A5:2 C#6:2 E6:2 C#6:2 A5:2 E5:4 | B5:2 G#5:2 E5:2 G#5:2 B5:4 E6:4';
  const lead = cat(
    mel(`${head} | F#6:4 E6:2 D6:2 A5:4 F#5:4 | E6:8 B5:2 G#5:2 E5:4`),
    mel('D6:4 B5:4 F#5:4 B5:4 | E6:4 D6:2 B5:2 G#5:4 E5:4 | E6:4 C#6:2 G#5:2 E6:4 G#6:4 | F#6:6 E6:2 C#6:4 A5:4 | A5:2 D6:2 F#6:2 D6:2 A5:2 D6:2 F#6:4 | G#5:2 B5:2 E6:2 B5:2 G#5:2 B5:2 E6:4 | F#6:2 E6:2 D6:2 C#6:2 B5:2 C#6:2 D6:2 E6:2 | E6:12 .:4'),
    mel(`${head} | F#6:2 A6:2 F#6:2 D6:2 A5:2 F#5:2 D5:4 | E5:2 G#5:2 B5:2 E6:2 G#6:4 B5:4`),
    mel('A5:4 C6:4 F6:8 | B5:4 D6:4 G6:8 | A6:6 E6:2 C#6:4 A5:4 | C#6:2 E6:2 A6:2 E6:2 C#6:2 A5:2 E5:4 | C6:4 A5:2 F5:2 C6:4 F6:4 | D6:4 B5:2 G5:2 D6:4 G6:4 | E6:4 D6:2 B5:2 G#5:4 B5:4 | E5:2 G#5:2 B5:2 G#5:2 B4:2 C#5:2 D5:2 D#5:2'),
  );
  const oct = 'R . O . R . O . R . O . R . O .';
  const bass = cat(chords(A, N('E2'), oct), chords(B, N('E2'), oct), chords(A, N('E2'), oct), chords(C, N('E2'), oct));
  const stab = '. . 35 . . . 35 . . . 35 . . . 35 .';
  const harmony = cat(chords(A, N('C4'), stab), chords(B, N('C4'), stab), chords(A, N('C4'), stab), chords(C, N('C4'), '. . 35 . 35 . 35 . . . 35 . 35 . 35 .'));
  const K = 'x...x...x...x...', S = '....x.......x...', H = 'x.xxx.xxx.xxx.xx';
  return theme({
    id: 'rennen', title: 'Turbo-Runde', style: 'retro', bpm: 168, key: { root: 9, minor: false },
    lead: { wave: 'pulse25', volume: 0.065, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.16, env: 'pluck', part: bass },
    harmony: { wave: 'pulse12', volume: 0.022, env: 'pluck', part: harmony },
    drums: {
      volume: 0.9,
      kick: dr([K, 15], ['x...x...x.......', 1], [K, 16]),
      snare: dr([S, 7], ['....x.......x.xx', 1], [S, 7], ['....x...x.xxxxxx', 1], [S, 7], ['....x.......x.xx', 1], [S, 7], ['....x...xxxxxxxx', 1]),
      hat: dr([H, 32]),
    },
  });
}

// ------------------------------------------------------------------ Arena (Kampf)

/** C-Moll, synkopiertes Bass-Riff, Sägezahn-Powerchords; Breakdown mit phrygischem Des */
function arena(): Song {
  const A = 'Cm|Cm|Ab|Bb|Cm|Cm|Ab Bb|G', B = 'Fm|Fm|Cm|Cm|Ab|Bb|G|G', C = 'Cm|Db|Cm|Db|Ab|Bb|G|G';
  const head = 'C5:2 C5 Eb5 .:2 G5:2 F5:2 Eb5:2 D5:2 Eb5:2 | C5:4 G4:4 Bb4:2 C5:6 | Ab5:3 G5:3 Eb5:2 C5:4 Eb5:4 | F5:3 Eb5:3 D5:2 Bb4:4 D5:4 | G5:2 G5 Bb5 .:2 C6:2 Bb5:2 G5:2 F5:2 G5:2 | Eb5:4 C5:4 D5:2 Eb5:6';
  const lead = cat(
    mel(`${head} | C6:3 Bb5:3 Ab5:2 D6:3 C6:3 Bb5:2 | B5:8 G5:4 D5:4`),
    mel('F5:4 Ab5:4 C6:6 Bb5:2 | Ab5:3 G5:3 F5:2 C5:8 | Eb5:4 G5:4 C6:6 D6:2 | Eb6:3 D6:3 C6:2 G5:8 | Ab5:2 C6:2 Eb6:2 C6:2 Ab5:2 Eb5:2 C5:4 | Bb4:2 D5:2 F5:2 Bb5:2 D6:2 Bb5:2 F5:4 | G5:2 B5:2 D6:2 F6:2 Eb6:2 D6:2 B5:4 | G5:4 .:2 G5 . G5:4 .:4'),
    mel(`${head} | Eb6:2 C6:2 Ab5:2 C6:2 F6:2 D6:2 Bb5:2 D6:2 | G6:4 D6:4 B5:4 G5:4`),
    mel('C6:6 G5:2 .:8 | Db6:6 Ab5:2 .:8 | C6:2 Eb6:2 G6:4 F6:2 Eb6:2 D6:4 | Db6:2 F6:2 Ab6:4 F6:2 Eb6:2 Db6:4 | C6:4 Ab5:2 Eb5:2 C6:4 Eb6:4 | D6:4 Bb5:2 F5:2 D6:4 F6:4 | G6:8 F6:4 D6:4 | B5:2 G5:2 D5:2 B4:2 G4:2 B4:2 D5:2 B4:2'),
  );
  const riff = 'R - . R . . O . R - . R 5 . O .';
  const bass = cat(chords(A, N('C2'), riff), chords(B, N('C2'), riff), chords(A, N('C2'), riff), chords(C, N('C2'), [riff, riff, riff, riff, riff, riff, riff, riff]));
  const power = 'R5 - - . . . R5 - . . R5 - - . . .';
  const harmony = cat(chords(A, N('C3'), power), chords(B, N('C3'), power), chords(A, N('C3'), power),
    chords(C, N('C3'), ['R5 - - - - - - - - - - - . . . .', 'R5 - - - - - - - - - - - . . . .', 'R5 - - - - - - - - - - - . . . .', 'R5 - - - - - - - - - - - . . . .', power, power, power, power]));
  const K = 'x..x....x..x....', S = '....x.......x...', H = 'x.x.x.x.x.x.x.x.';
  const HIT = 'x.....x.x.......';
  return theme({
    id: 'arena', title: 'Ring frei!', style: 'action', bpm: 150, key: { root: 0, minor: true },
    lead: { wave: 'pulse50', volume: 0.06, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.17, env: 'pluck', part: bass },
    harmony: { wave: 'saw', volume: 0.016, env: 'hold', part: harmony },
    drums: {
      volume: 1,
      kick: dr([K, 15], [HIT, 1], [K, 8], ['x.......x.......', 4], [K, 4]),
      snare: dr([S, 7], ['....x.......x.xx', 1], [S, 7], [HIT, 1], [S, 7], ['....x.......x.xx', 1], ['................', 4], [S, 3], ['x.x.x.x.xxxxxxxx', 1]),
      hat: dr([H, 15], ['................', 1], [H, 8], ['....x.......x...', 4], [H, 4]),
    },
  });
}

// ------------------------------------------------------------------ Western (Wasserpistolen-Duell)

/** A-Moll mit andalusischer Kadenz, gepfiffene Melodie (Dreieck), Galopp-Begleitung, Uhr-Ticken im Showdown */
function western(): Song {
  const A = 'Am|Am|G|G|F|F|E|E', B = 'Dm|Am|Dm|E|Dm|Am|F E|Am', C = 'Am|Am|Dm|Dm|Bb|Bb|E|E';
  const head = 'A5:2 . E5 A5:4 B5:2 C6:2 B5:4 | A5:12 .:4 | G5:2 . D5 G5:4 A5:2 B5:2 A5:4 | G5:12 .:4 | F5:2 . C5 F5:4 A5:2 C6:2 E6:4 | D6:4 C6:4 A5:8';
  const lead = cat(
    mel(`${head} | B5:4 G#5:4 E5:4 F5:2 G#5:2 | E5:12 .:4`),
    mel('D6:4 F6:2 E6:2 D6:4 A5:4 | C6:4 E6:2 D6:2 C6:4 A5:4 | F5:2 A5:2 D6:2 F6:2 E6:4 D6:4 | E6:6 D6:2 B5:4 G#5:4 | A5:4 D6:4 F6:6 E6:2 | E6:4 C6:4 A5:8 | C6:4 A5:4 B5:4 G#5:4 | A5:8 .:2 E5:2 A5:2 .:2'),
    mel('E6:16 | .:8 E6:2 D6:2 C6:2 B5:2 | A5:16 | .:8 A5:2 C6:2 D6:2 F6:2 | F6:12 D6:4 | Bb5:12 .:4 | G#5:4 B5:4 D6:4 E6:4 | F6:2 E6:2 D6:2 B5:2 G#5:8'),
    mel(`${head} | B5:2 C6:2 B5:2 G#5:2 E5:4 G#5:4 | B5:8 .:4 E5:4`),
  );
  const trot = 'R - . . L - . . R - . . L - . .';
  const bass = cat(chords(A, N('E2'), trot), chords(B, N('E2'), trot), chords(C, N('E2'), 'R - - - - - - - R - - - - - - -'), chords(A, N('E2'), trot));
  const gallop = '. . 35 35 . . 35 . . . 35 35 . . 35 .';
  const harmony = cat(chords(A, N('A3'), gallop), chords(B, N('A3'), gallop), chords(C, N('A3'), 'F . . . F . . . F . . . F . . .'), chords(A, N('A3'), gallop));
  const K = 'x.......x.......', S = '....x.......x...', H = 'x.xxx.xxx.xxx.xx';
  return theme({
    id: 'western', title: 'Showdown am Pool', style: 'western', bpm: 126, key: { root: 9, minor: true },
    lead: { wave: 'triangle', volume: 0.11, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.15, env: 'pluck', part: bass },
    harmony: { wave: 'pulse12', volume: 0.022, env: 'pluck', part: harmony },
    drums: {
      volume: 0.7,
      kick: dr([K, 16], ['x...............', 7], ['x...x...x...x...', 1], [K, 8]),
      snare: dr([S, 15], ['....x.......xxxx', 1], ['................', 7], ['........x.x.xxxx', 1], [S, 7], ['....x...x...x.x.', 1]),
      hat: dr([H, 16], ['x...x...x...x...', 7], ['................', 1], [H, 8]),
    },
  });
}

// ------------------------------------------------------------------ Sport

/** F-Dur, Bläser-Puls, Stadion-Stampfen; C-Teil als Ruf-und-Antwort-Fangesang */
function sport(): Song {
  const A = 'F|Bb|C|F|Dm|Bb|C|C', B = 'Bb|C|Am|Dm|Gm|C|F|C', A2 = 'F|Bb|C|F|Dm|Bb|C|F', C = 'F|F|Bb|Bb|C|C|C|C';
  const head = 'C5:2 F5:2 A5:2 C6:4 A5:2 C6:2 .:2 | D6:4 C6:2 Bb5:2 F5:4 D5:4 | E5:2 G5:2 C6:2 E6:4 D6:2 C6:2 .:2 | A5:4 F5:4 .:2 C5:2 F5:2 A5:2 | D6:4 A5:2 F5:2 D6:2 E6:2 F6:4 | F6:4 D6:2 Bb5:2 F5:4 Bb5:4';
  const lead = cat(
    mel(`${head} | C6:2 .:2 C6:2 .:2 E6:2 D6:2 C6:2 Bb5:2 | G5:8 .:4 C5:2 C5:2`, 0.85),
    mel('D6:2 D6:2 F6:4 D6:2 Bb5:2 F5:4 | E6:2 E6:2 G6:4 E6:2 C6:2 G5:4 | C6:4 E6:4 A6:6 G6:2 | F6:4 D6:4 A5:8 | Bb5:2 D6:2 G6:2 D6:2 Bb5:2 G5:2 Bb5:4 | C6:2 E6:2 G6:2 E6:2 C6:2 G5:2 E6:4 | F6:6 E6:2 C6:4 A5:4 | G5:2 .:2 G5:2 .:2 C6:2 .:2 E6:4', 0.85),
    mel(`${head} | C6:2 .:2 C6:2 .:2 E6:2 F6:2 G6:4 | F6:4 C6:2 A5:2 F5:8`, 0.85),
    mel('F5:2 .:2 F5:2 .:2 A5:2 .:2 C6:4 | .:8 A5:2 C6:2 A5:4 | F5:2 .:2 F5:2 .:2 Bb5:2 .:2 D6:4 | .:8 Bb5:2 D6:2 Bb5:4 | G5:2 .:2 G5:2 .:2 C6:2 .:2 E6:4 | .:8 E6:2 G6:2 E6:4 | C6:2 D6:2 E6:2 F6:2 G6:2 F6:2 E6:2 D6:2 | C6:2 Bb5:2 A5:2 G5:2 E5:2 .:2 C5:2 .:2', 0.85),
  );
  const walk = 'R . O . 5 . O . R . O . 5 . 3 .';
  const bass = cat(chords(A, N('D2'), walk), chords(B, N('D2'), walk), chords(A2, N('D2'), walk), chords(C, N('D2'), walk));
  const comp = '. . R35 . . . R35 . . . R35 . . R35 R35 .';
  const harmony = cat(chords(A, N('F3'), comp), chords(B, N('F3'), comp), chords(A2, N('F3'), comp), chords(C, N('F3'), comp));
  const K = 'x...x...x...x...', S = '....x.......x...', H = 'x.x.x.x.x.x.x.x.', F = '....x.......x.xx';
  const CHANT = '....x.......x.x.';
  return theme({
    id: 'sport', title: 'Anpfiff am Strand', style: 'sport', bpm: 132, key: { root: 5, minor: false },
    lead: { wave: 'pulse50', volume: 0.06, env: 'hold', part: lead },
    bass: { wave: 'triangle', volume: 0.16, env: 'pluck', part: bass },
    harmony: { wave: 'pulse25', volume: 0.02, env: 'pluck', part: harmony },
    drums: {
      volume: 0.9,
      kick: dr([K, 24], ['x.x.....x.x.....', 6], [K, 2]),
      snare: dr([S, 7], [F, 1], [S, 7], [F, 1], [S, 7], ['....x...x.x.x...', 1], [CHANT, 6], ['x.x.x.x.x.x.x.x.', 1], ['x.x.x.x.xxxxxxxx', 1]),
      hat: dr([H, 32]),
    },
  });
}

// ------------------------------------------------------------------ Krimi

/** G-Moll, Schleich-Staccato mit Swing, Spannungs-Tremolo; C-Teil nur Herzschlag und Uhr-Ticken */
function krimi(): Song {
  const A = 'Gm|Gm|Eb|D|Gm|Gm|Cm|D', B = 'Eb|Eb|Cm|Cm|Ab|Ab|D|D', C = 'Gm|Gm|Gm|Gm|Eb|Eb|D|D';
  const head = '.:2 D5 . D5 . Eb5 . D5:2 .:2 Bb4:2 .:2 | .:2 G4 . A4 . Bb4 . C5:2 C#5:2 D5:4 | .:2 G5 . G5 . Ab5 . G5:2 .:2 Eb5:2 .:2 | F#5:4 A5:2 .:2 C6:2 .:2 A5:2 F#5:2 | .:2 D6 . C6 . Bb5 . A5:2 Bb5:2 G5:4 | .:4 D5:2 .:2 G5:2 .:2 Bb5:2 A5:2';
  const lead = cat(
    mel(`${head} | G5:2 .:2 Eb5:2 .:2 C5:2 .:2 Eb5:2 G5:2 | F#5:6 .:2 D5:2 Eb5:2 E5:2 F#5:2`),
    mel('G5:8 Bb5:8 | Ab5:8 G5:8 | Eb5:8 G5:8 | F#5:8 G5:8 | C6:8 Eb6:8 | D6:8 C6:8 | A5:4 F#5:4 D5:4 F#5:4 | A5:2 .:2 A5:2 .:2 C6:2 .:2 D6:2 .:2'),
    mel(`${head} | Eb6:2 .:2 C6:2 .:2 G5:2 .:2 Eb5:2 C5:2 | D5:2 .:2 D5 . D5 . D5:8`),
    mel('.:16 | .:12 Bb5 . A5 . | G5:2 .:14 | .:12 D6 . C#6 . | Bb5:6 .:2 G5:6 .:2 | Ab5:6 .:2 G5:6 .:2 | F#5:4 .:4 A5:4 .:4 | C6:2 .:2 A5:2 .:2 F#5:2 .:2 D5:2 .:2'),
  );
  const sneak = 'R . . . 5 . R . . . 5 . 7 . 5 .';
  const bass = cat(chords(A, N('D2'), sneak), chords(B, N('D2'), 'R . . . R . . . R . . . R . . .'), chords(A, N('D2'), sneak), chords(C, N('D2'), 'R . . R . . . . . . . . . . . .'));
  const harmony = cat(
    chords(A, N('G3'), '. . . . 35 . . . . . . . 35 . . .'),
    chords(B, N('G3'), 'T F T F T F T F T F T F T F T F'),
    chords(A, N('G3'), '. . . . 35 . . . . . . . 35 . . .'),
    chords(C, N('G3'), 'R5 - - - - - - - R5 - - - - - - -'),
  );
  const K = 'x.....x.........', S = '............x...', H = '..x...x...x...x.', NONE = '................';
  return theme({
    id: 'krimi', title: 'Auf leisen Sohlen', style: 'krimi', bpm: 100, swing: 0.12, key: { root: 7, minor: true },
    lead: { wave: 'triangle', volume: 0.11, env: 'pluck', part: lead },
    bass: { wave: 'triangle', volume: 0.16, env: 'pluck', part: bass },
    harmony: { wave: 'pulse12', volume: 0.02, env: 'pluck', part: harmony },
    drums: {
      volume: 0.6,
      kick: dr([K, 8], ['x.......x.......', 8], [K, 8], ['x..x............', 8]),
      snare: dr([S, 8], [NONE, 7], ['........x.x.x.x.', 1], [S, 7], ['....x.x.x.......', 1], [NONE, 8]),
      hat: dr([H, 8], ['x.x.x.x.x.x.x.x.', 8], [H, 8], ['x...x...x...x...', 7], [H, 1]),
    },
  });
}

// ------------------------------------------------------------------ Wasser

/** D-Dur, Calypso-Rhythmus (3+3+2), Tropf-Kaskaden; C-Teil „unter Wasser“ im Halbtempo */
function wasser(): Song {
  const A = 'D|G|D|A|D|G|Em A|D', B = 'Bm|G|D|A|Bm|G|E|A', C = 'G|A|F#m|Bm|G|A|Bm A|A';
  const head = 'F#5:2 A5:2 .:2 F#5:2 A5:2 B5:2 A5:4 | G5:2 B5:2 .:2 G5:2 B5:2 D6:2 B5:4 | A5:3 F#5:3 D5:2 A5:3 F#5:3 D5:2 | E5:2 G5:2 A5:2 C#6:2 E6:4 .:4 | D6:3 C#6:3 A5:2 F#5:2 A5:2 D6:4 | B5:3 A5:3 G5:2 D5:2 G5:2 B5:4';
  const lead = cat(
    mel(`${head} | G5:2 E5:2 B4:2 E5:2 C#5:2 E5:2 A5:2 G5:2 | F#5:8 D6 A5 F#5 D5 .:4`),
    mel('D6:3 B5:3 F#5:2 B5:4 D6:4 | D6:3 B5:3 G5:2 D6:2 E6:2 D6:4 | F#6:2 E6:2 D6:2 A5:2 F#5:4 A5:4 | E6:6 C#6:2 A5:4 .:2 A5 B5 | D6:3 B5:3 F#5:2 B5:3 D6:3 F#6:2 | G6:4 F#6:2 E6:2 D6:4 B5:4 | G#5:2 B5:2 E6:2 G#6:2 E6:4 B5:4 | A6 G6 E6 C#6 A5 G5 E5 C#5 .:8'),
    mel(`${head} | B5:2 G5:2 E5:2 G5:2 A5:2 C#6:2 E6:2 G6:2 | F#6:2 .:2 D6 A5 F#5 D5 .:8`),
    mel('B5:8 D6:8 | C#6:8 E6:8 | F#6:6 E6:2 C#6:8 | D6:8 B5:8 | G5:2 B5:2 D6:2 G6:2 F#6:2 D6:2 B5:4 | A5:2 C#6:2 E6:2 A6:2 G6:2 E6:2 C#6:4 | B5:2 D6:2 F#6:4 E6:2 C#6:2 A5:4 | E5:2 G5:2 A5:2 C#6:2 E6:2 C#6:2 A5 G5 E5:2'),
  );
  const bounce = 'R - . R . . 5 . R - . R . . 5 .';
  const bass = cat(chords(A, N('D2'), bounce), chords(B, N('D2'), bounce), chords(A, N('D2'), bounce), chords(C, N('D2'), 'R - - - . . . . 5 - - - . . . .'));
  const skank = '. . 35 . . 35 . . . . 35 . . 35 . .';
  const harmony = cat(chords(A, N('A3'), skank), chords(B, N('A3'), skank), chords(A, N('A3'), skank), chords(C, N('A3'), '35 - - - . . . . 35 - - - . . . .'));
  const K = 'x...x...x...x...', S = '....x.......x...', H = '..xx..x...xx..x.', F = '....x.......x.xx';
  const HALF_K = 'x.........x.....', HALF_S = '........x.......';
  return theme({
    id: 'wasser', title: 'Platsch!', style: 'chill', bpm: 136, key: { root: 2, minor: false },
    lead: { wave: 'pulse25', volume: 0.065, env: 'pluck', part: lead },
    bass: { wave: 'triangle', volume: 0.16, env: 'pluck', part: bass },
    harmony: { wave: 'pulse25', volume: 0.02, env: 'pluck', part: harmony },
    drums: {
      volume: 0.8,
      kick: dr([K, 15], ['x...x...x.......', 1], [K, 8], [HALF_K, 7], [K, 1]),
      snare: dr([S, 7], [F, 1], [S, 7], ['....x...x.x.x.x.', 1], [S, 7], [F, 1], [HALF_S, 7], ['....x...x.x.xxxx', 1]),
      hat: dr([H, 24], ['..x...x...x...x.', 8]),
    },
  });
}

export const THEME_SONGS: Song[] = [zauber(), igelkrieg(), rennen(), arena(), western(), sport(), krimi(), wasser()];
