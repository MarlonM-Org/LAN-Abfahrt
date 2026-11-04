/**
 * Kleiner Standard-MIDI-Datei-Parser (SMF Format 0/1) ohne Abhängigkeiten – reine Funktionen,
 * damit die Musik-Werkstatt .mid-Dateien aus BeepBox, Bosca Ceoil & Co. importieren kann.
 * Gelesen werden Note-On/Off, Programmwechsel, Spurnamen, Tempo und Taktart; alles andere
 * wird übersprungen. Dazu die Umrechnung in Song-Format v2 (Sechzehntel-Raster) und ein
 * minimaler Export.
 */
import { MAX_BARS, MAX_NOTES, MIDI_MAX, MIDI_MIN, STEPS_PER_BAR, type Song, type SongNote, emptySong } from '../../shared/music';

export interface MidiNote {
  tick: number;
  midi: number;
  dur: number;
  velocity: number;
  channel: number;
}

/** Eine Stimme = Spur × Kanal (Format-0-Dateien haben alles in einer Spur) */
export interface MidiPart {
  track: number;
  channel: number;
  name: string;
  program: number;
  notes: MidiNote[];
  /** General-MIDI-Schlagzeug (Kanal 10) */
  drums: boolean;
}

export interface MidiFile {
  format: number;
  ticksPerBeat: number;
  /** Erstes Tempo in BPM (Standard 120) */
  bpm: number;
  timeSig: { num: number; den: number };
  parts: MidiPart[];
}

class Reader {
  pos = 0;
  constructor(readonly d: DataView) {}
  get eof() {
    return this.pos >= this.d.byteLength;
  }
  u8() {
    return this.d.getUint8(this.pos++);
  }
  u16() {
    const v = this.d.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.d.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  varlen() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
}

export function parseMidi(data: ArrayBuffer | Uint8Array): MidiFile {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (bytes.byteLength < 14 || r.str(4) !== 'MThd') throw new Error('Keine MIDI-Datei (MThd fehlt)');
  const hlen = r.u32();
  const format = r.u16();
  const ntracks = r.u16();
  const division = r.u16();
  if (division & 0x8000) throw new Error('SMPTE-Zeitbasis wird nicht unterstützt');
  if (!division) throw new Error('Ungültige Zeitbasis');
  r.pos += hlen - 6;
  if (format > 1) throw new Error('Nur MIDI-Format 0 und 1 (keine unabhängigen Spuren)');

  const out: MidiFile = { format, ticksPerBeat: division, bpm: 120, timeSig: { num: 4, den: 4 }, parts: [] };
  let tempoSet = false;
  let total = 0;

  for (let t = 0; t < ntracks && !r.eof; t++) {
    if (r.str(4) !== 'MTrk') throw new Error(`Spur ${t + 1}: MTrk fehlt`);
    const len = r.u32();
    const end = r.pos + len;
    let tick = 0;
    let status = 0;
    let trackName = '';
    const byChannel = new Map<number, MidiPart>();
    const open = new Map<string, { tick: number; velocity: number }>();
    const part = (ch: number) => {
      let p = byChannel.get(ch);
      if (!p) {
        p = { track: t, channel: ch, name: '', program: 0, notes: [], drums: ch === 9 };
        byChannel.set(ch, p);
      }
      return p;
    };
    const noteOff = (ch: number, n: number) => {
      const k = `${ch}:${n}`;
      const o = open.get(k);
      if (!o) return;
      open.delete(k);
      if (total >= MAX_NOTES * 4) return;
      total++;
      part(ch).notes.push({ tick: o.tick, midi: n, dur: Math.max(1, tick - o.tick), velocity: o.velocity, channel: ch });
    };
    while (r.pos < end) {
      tick += r.varlen();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const l = r.varlen();
        const start = r.pos;
        if (type === 0x03) trackName = r.str(l);
        else if (type === 0x51 && l === 3 && !tempoSet) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          if (us > 0) out.bpm = Math.round((60_000_000 / us) * 100) / 100;
          tempoSet = true;
        } else if (type === 0x58 && l >= 2 && t === 0) {
          out.timeSig = { num: r.u8(), den: 2 ** r.u8() };
        }
        r.pos = start + l;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.pos += r.varlen();
        continue;
      }
      if (b & 0x80) status = b;
      else r.pos--; // laufender Status: Datenbyte gehört noch zum letzten Befehl
      if (!status) throw new Error('Ungültiges Ereignis ohne Status');
      const kind = status & 0xf0;
      const ch = status & 0x0f;
      if (kind === 0x90 || kind === 0x80) {
        const n = r.u8();
        const v = r.u8();
        if (kind === 0x90 && v > 0) {
          const k = `${ch}:${n}`;
          if (open.has(k)) noteOff(ch, n);
          open.set(k, { tick, velocity: v });
        } else noteOff(ch, n);
      } else if (kind === 0xc0) {
        part(ch).program = r.u8();
      } else if (kind === 0xd0) r.u8();
      else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) r.pos += 2;
      else if (status === 0xf2) r.pos += 2;
      else if (status === 0xf3) r.pos += 1;
      // F1, F6, F8–FE: keine Daten
      b = 0;
    }
    // Offen gebliebene Töne am Spurende schließen
    for (const k of [...open.keys()]) {
      const [ch, n] = k.split(':').map(Number);
      noteOff(ch, n);
    }
    r.pos = end;
    for (const p of byChannel.values()) {
      if (!p.notes.length) continue;
      // Spurname gilt für die Spur; bei mehreren Kanälen in einer Spur (Format 0) heißt Kanal 10 trotzdem Schlagzeug
      p.name = trackName && !(p.drums && byChannel.size > 1) ? trackName : p.drums ? 'Schlagzeug' : `Spur ${t + 1}, Kanal ${p.channel + 1}`;
      p.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
      out.parts.push(p);
    }
  }
  if (!out.parts.length) throw new Error('Keine Noten in der Datei gefunden');
  return out;
}

export interface ImportChoice {
  /** Index in `parts` oder null = Kanal bleibt leer */
  lead: number | null;
  bass: number | null;
  harmony?: number | null;
  drums: number | null;
}

/** General-MIDI-Schlagzeugnoten → Kick/Snare/HiHat (alles andere fällt weg) */
export function drumKind(note: number): 'kick' | 'snare' | 'hat' | null {
  if (note === 35 || note === 36) return 'kick';
  if (note === 37 || note === 38 || note === 39 || note === 40) return 'snare';
  if (note === 42 || note === 44 || note === 46 || note === 49 || note === 51 || note === 53) return 'hat';
  return null;
}

export interface ImportResult {
  song: Song;
  /** Hinweise für den Nutzer (abgeschnittene Takte, fallen gelassene Noten …) */
  notes: string[];
}

/**
 * Stimmen in einen Song übernehmen: Ticks auf Sechzehntel runden, Länge mindestens 1 Schritt,
 * ganze leere Takte am Anfang abschneiden, auf MAX_BARS begrenzen.
 */
export function midiToSong(file: MidiFile, choice: ImportChoice, base: Song = emptySong()): ImportResult {
  const tps = file.ticksPerBeat / 4; // Ticks je Sechzehntel (4/4 angenommen)
  const song = structuredClone(base);
  const info: string[] = [];
  song.bpm = Math.max(40, Math.min(260, Math.round(file.bpm)));
  const chosen = [choice.lead, choice.bass, choice.harmony ?? null, choice.drums].filter((i): i is number => i !== null).map((i) => file.parts[i]).filter(Boolean);
  if (!chosen.length) throw new Error('Keine Stimme ausgewählt');
  const firstTick = Math.min(...chosen.map((p) => p.notes[0]?.tick ?? 0));
  const offsetBars = Math.floor(firstTick / (tps * STEPS_PER_BAR));
  const offset = offsetBars * tps * STEPS_PER_BAR;
  const lastTick = Math.max(...chosen.flatMap((p) => p.notes.map((n) => n.tick + n.dur)));
  const neededBars = Math.max(1, Math.ceil((lastTick - offset) / (tps * STEPS_PER_BAR)));
  song.bars = Math.min(MAX_BARS, neededBars);
  if (neededBars > MAX_BARS) info.push(`Datei hat ${neededBars} Takte – nur die ersten ${MAX_BARS} wurden übernommen.`);
  if (offsetBars > 0) info.push(`${offsetBars} leere Takte am Anfang übersprungen.`);
  const total = song.bars * STEPS_PER_BAR;

  let dropped = 0;
  const melodic = (p: MidiPart | undefined): SongNote[] => {
    if (!p) return [];
    const out: SongNote[] = [];
    for (const n of p.notes) {
      const step = Math.round((n.tick - offset) / tps);
      const endStep = Math.round((n.tick + n.dur - offset) / tps);
      const len = Math.max(1, endStep - step);
      if (step < 0 || step >= total || n.midi < MIDI_MIN || n.midi > MIDI_MAX) {
        dropped++;
        continue;
      }
      out.push({ step, midi: n.midi, len: Math.min(len, total - step) });
    }
    // Doppelte (gleicher Schritt + Ton) zusammenfassen
    const seen = new Set<string>();
    return out.filter((n) => {
      const k = `${n.step}:${n.midi}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, MAX_NOTES);
  };
  if (choice.lead !== null) song.lead.notes = melodic(file.parts[choice.lead]);
  if (choice.bass !== null) song.bass.notes = melodic(file.parts[choice.bass]);
  if (choice.harmony !== null && choice.harmony !== undefined) song.harmony.notes = melodic(file.parts[choice.harmony]);
  if (choice.drums !== null) {
    const p = file.parts[choice.drums];
    const d = { kick: new Set<number>(), snare: new Set<number>(), hat: new Set<number>() };
    let other = 0;
    for (const n of p?.notes ?? []) {
      const step = Math.round((n.tick - offset) / tps);
      if (step < 0 || step >= total) continue;
      const kind = p?.drums ? drumKind(n.midi) : n.midi % 3 === 0 ? 'kick' : n.midi % 3 === 1 ? 'snare' : 'hat';
      if (!kind) {
        other++;
        continue;
      }
      d[kind].add(step);
    }
    song.drums = { ...song.drums, kick: [...d.kick].sort((a, b) => a - b), snare: [...d.snare].sort((a, b) => a - b), hat: [...d.hat].sort((a, b) => a - b) };
    if (other) info.push(`${other} Schlagzeugnoten ohne Entsprechung (nur Kick, Snare, HiHat) weggelassen.`);
  }
  if (dropped) info.push(`${dropped} Noten außerhalb des Bereichs weggelassen.`);
  return { song, notes: info };
}

// ------------------------------------------------------------------ Export

function varlen(v: number): number[] {
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}

/** Song als MIDI-Datei (Format 1: Tempo-Spur + Melodie, Bass, Begleitung, Schlagzeug auf Kanal 10) */
export function songToMidi(song: Song): Uint8Array<ArrayBuffer> {
  const TPB = 96;
  const tps = TPB / 4;
  const track = (events: { tick: number; bytes: number[] }[]) => {
    events.sort((a, b) => a.tick - b.tick);
    const body: number[] = [];
    let last = 0;
    for (const e of events) {
      body.push(...varlen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    body.push(0, 0xff, 0x2f, 0);
    const len = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
  };
  const name = (s: string) => ({ tick: 0, bytes: [0xff, 0x03, ...varlen(s.length), ...[...s].map((c) => c.charCodeAt(0) & 0x7f)] });
  const us = Math.round(60_000_000 / song.bpm);
  const tempo = track([name(song.title.replace(/[^\x20-\x7e]/g, '?')), { tick: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { tick: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] }]);
  const melodic = (notes: SongNote[], ch: number, label: string, program: number) => {
    const ev = [name(label), { tick: 0, bytes: [0xc0 | ch, program] }];
    for (const n of notes) {
      const on = n.step * tps;
      const off = Math.max(on + 1, Math.round((n.step + n.len) * tps));
      ev.push({ tick: on, bytes: [0x90 | ch, n.midi, 100] }, { tick: off, bytes: [0x80 | ch, n.midi, 0] });
    }
    return track(ev);
  };
  const drums = () => {
    const ev = [name('Schlagzeug')];
    const hit = (steps: number[], note: number) => {
      for (const s of steps) ev.push({ tick: s * tps, bytes: [0x99, note, 100] }, { tick: s * tps + tps, bytes: [0x89, note, 0] });
    };
    hit(song.drums.kick, 36);
    hit(song.drums.snare, 38);
    hit(song.drums.hat, 42);
    return track(ev);
  };
  const tracks = [tempo, melodic(song.lead.notes, 0, 'Melodie', 80), melodic(song.bass.notes, 1, 'Bass', 38), melodic(song.harmony.notes, 2, 'Begleitung', 81), drums()];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (TPB >> 8) & 255, TPB & 255];
  return new Uint8Array([...header, ...tracks.flat()]);
}
