/**
 * Tests ohne Browser für die Musik-Werkstatt: Tonhöhen-Pipeline (synthetischer Gesang),
 * MIDI-Parser (erzeugte .mid) und alle eingebauten Songs (Gültigkeit, Zuordnung, Offline-Rendern).
 * Aufruf: `npm run test:music`
 */
import { ASSIGN_SCENES, MAX_BARS, STEPS_PER_BAR, STYLES, defaultSongForScene, emptySong, validateSong } from '../shared/music';
import { BUILTIN_IDS, BUILTIN_SONGS } from '../shared/musicBuiltin';
import { THEME_SONGS } from '../shared/musicThemen';
import { db, longestSilence, peakOf, renderSong, rmsOf } from './musicRender';
import { midiToSong, parseMidi, songToMidi } from '../client/music/midi';
import { type PitchFrame, hzToMidi, quantize, rms, segment, yin } from '../client/music/pitch';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ Synthetischer Gesang

interface Note { step: number; midi: number; len: number }

/** Eine Melodie als Audiosignal: Sinus/Sägezahn mit Vibrato, Ansatz-Hüllkurve, kurzer Lücke zwischen Noten, Rauschen */
function synthVoice(notes: Note[], bpm: number, sr: number, wave: 'sine' | 'saw', opts: { vibratoCents?: number; noise?: number; gapMs?: number; detuneCents?: number } = {}) {
  const stepDur = 60 / bpm / 4;
  const total = Math.max(...notes.map((n) => n.step + n.len)) * stepDur + 0.3;
  const buf = new Float32Array(Math.ceil(total * sr));
  const vib = opts.vibratoCents ?? 0, noise = opts.noise ?? 0, gap = (opts.gapMs ?? 30) / 1000, det = opts.detuneCents ?? 0;
  for (const n of notes) {
    const t0 = n.step * stepDur, t1 = (n.step + n.len) * stepDur - gap;
    let phase = 0;
    const base = midiHz(n.midi + det / 100);
    for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) {
      const t = i / sr, rel = t - t0;
      const f = base * 2 ** ((vib * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
      phase += (2 * Math.PI * f) / sr;
      const env = Math.min(1, rel / 0.03) * Math.min(1, (t1 - t) / 0.03);
      const s = wave === 'sine' ? Math.sin(phase) : ((phase / Math.PI) % 2) - 1;
      buf[i] += 0.3 * env * s;
    }
  }
  if (noise) for (let i = 0; i < buf.length; i++) buf[i] += noise * (Math.random() * 2 - 1);
  return buf;
}

/** Spur wie im Browser: Fenster 2048, Schritt 1024, Zeit = Fenstermitte */
function track(buf: Float32Array, sr: number): PitchFrame[] {
  const frames: PitchFrame[] = [];
  const win = 2048, hop = 1024;
  for (let i = 0; i + win <= buf.length; i += hop) {
    const slice = buf.subarray(i, i + win);
    const p = yin(slice, sr, { minRms: 0.01 });
    frames.push({ t: (i + win / 2) / sr, midi: p && p.clarity > 0.8 ? hzToMidi(p.hz) : null, rms: rms(slice) });
  }
  return frames;
}

function compare(got: Note[], want: Note[]) {
  let pitchOk = 0, timeOk = 0, lenOk = 0;
  for (const w of want) {
    const g = got.find((x) => x.step === w.step) ?? got.find((x) => Math.abs(x.step - w.step) <= 1) ?? got.find((x) => Math.abs(x.step - w.step) <= 2);
    if (!g) continue;
    if (g.midi === w.midi) pitchOk++;
    if (g.step === w.step) timeOk++;
    if (Math.abs(g.len - w.len) <= 1) lenOk++;
  }
  return { pitchOk, timeOk, lenOk, extra: Math.max(0, got.length - want.length), n: want.length };
}

const MELODY: Note[] = [
  { step: 0, midi: 60, len: 4 }, { step: 4, midi: 62, len: 4 }, { step: 8, midi: 64, len: 2 }, { step: 10, midi: 65, len: 2 }, { step: 12, midi: 67, len: 4 },
  { step: 16, midi: 67, len: 2 }, { step: 18, midi: 67, len: 2 }, { step: 20, midi: 69, len: 4 }, { step: 24, midi: 72, len: 6 }, { step: 30, midi: 71, len: 2 },
  { step: 32, midi: 69, len: 3 }, { step: 35, midi: 67, len: 1 }, { step: 36, midi: 65, len: 4 }, { step: 40, midi: 64, len: 2 }, { step: 42, midi: 62, len: 2 }, { step: 44, midi: 60, len: 4 },
];

console.log('\nTonhöhen-Pipeline (Melodie mit 16 Noten, 100 BPM, Sechzehntel-Raster):');
const sr = 48000, bpm = 100;
const cases: [string, Float32Array][] = [
  ['Sinus, sauber', synthVoice(MELODY, bpm, sr, 'sine')],
  ['Sinus + Vibrato ±40 Cent', synthVoice(MELODY, bpm, sr, 'sine', { vibratoCents: 40 })],
  ['Sägezahn + Vibrato ±40 Cent + Rauschen (−26 dB)', synthVoice(MELODY, bpm, sr, 'saw', { vibratoCents: 40, noise: 0.015 })],
  ['Sägezahn, 30 Cent zu tief, Vibrato, Rauschen, ohne Lücken', synthVoice(MELODY, bpm, sr, 'saw', { vibratoCents: 30, noise: 0.01, detuneCents: -30, gapMs: 0 })],
];
let worst = 1;
for (const [name, buf] of cases) {
  const frames = track(buf, sr);
  const segs = segment(frames);
  const notes = quantize(segs, { bpm });
  const r = compare(notes, MELODY);
  const acc = r.pitchOk / r.n;
  worst = Math.min(worst, acc);
  console.log(`  ${name}: ${notes.length} Noten erkannt (erwartet ${r.n}) – Tonhöhe ${r.pitchOk}/${r.n}, Start exakt ${r.timeOk}/${r.n}, Länge ±1 ${r.lenOk}/${r.n}`);
  check(acc >= 0.9 && notes.length >= r.n - 1 && notes.length <= r.n + 2, `${name}: ≥ 90 % Tonhöhen richtig, Notenzahl passt`);
}
// Einzelne Frequenzen
for (const m of [48, 60, 69, 76, 84]) {
  const buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * Math.sin((2 * Math.PI * midiHz(m) * i) / sr);
  const p = yin(buf, sr);
  check(!!p && Math.abs(hzToMidi(p.hz) - m) < 0.05, `YIN: MIDI ${m} → ${p ? hzToMidi(p.hz).toFixed(3) : 'null'}`);
}
check(yin(new Float32Array(2048), sr) === null, 'YIN: Stille → null');
const noiseBuf = new Float32Array(2048).map(() => Math.random() * 0.4 - 0.2);
check(yin(noiseBuf, sr) === null || yin(noiseBuf, sr)!.clarity < 0.8, 'YIN: Rauschen → kein klarer Ton');
// Tonart-Snap und Offset
{
  const segs = segment(track(synthVoice([{ step: 0, midi: 61, len: 4 }, { step: 4, midi: 66, len: 4 }], bpm, sr, 'sine', { detuneCents: 20 }), sr));
  const q = quantize(segs, { bpm, key: { root: 0, minor: false } });
  check(q.length === 2 && (q[0].midi === 60 || q[0].midi === 62) && (q[1].midi === 65 || q[1].midi === 67), `Skalen-Snap C-Dur: ${q.map((n) => n.midi).join(',')}`);
  const q2 = quantize(segs, { bpm, startStep: 32, maxStep: 36 });
  check(q2.length === 1 && q2[0].step === 32 && q2[0].len === 4, `Startschritt + Begrenzung: ${JSON.stringify(q2)}`);
}

// ------------------------------------------------------------------ MIDI

console.log('\nMIDI-Parser:');
{
  // Hin und zurück: eingebauter Song → MIDI → Song
  const song = BUILTIN_SONGS.find((s) => s.id === 'poolparty')!;
  const bytes = songToMidi(song);
  const file = parseMidi(bytes);
  check(file.format === 1 && file.ticksPerBeat === 96 && Math.round(file.bpm) === song.bpm, `Header: Format ${file.format}, ${file.ticksPerBeat} Ticks, ${file.bpm} BPM`);
  check(file.parts.length === 4 && file.parts[3].drums, `Stimmen: ${file.parts.map((p) => `${p.name}(${p.notes.length})`).join(', ')}`);
  const back = midiToSong(file, { lead: 0, bass: 1, harmony: 2, drums: 3 });
  const same = (a: { step: number; midi: number; len: number }[], b: { step: number; midi: number; len: number }[]) =>
    a.length === b.length && a.every((n, i) => n.step === b[i].step && n.midi === b[i].midi && Math.round(n.len) === Math.round(b[i].len));
  check(same(back.song.lead.notes, song.lead.notes), 'Melodie identisch nach Import');
  check(same(back.song.bass.notes, song.bass.notes), 'Bass identisch nach Import');
  check(JSON.stringify(back.song.drums.kick) === JSON.stringify(song.drums.kick) && JSON.stringify(back.song.drums.hat) === JSON.stringify(song.drums.hat), 'Schlagzeug identisch nach Import');
  check(back.song.bars === song.bars, `Takte: ${back.song.bars}`);
  check(validateSong(back.song).ok, 'Importierter Song ist gültig');
}
{
  // Format 0, laufender Status, Note-On mit Velocity 0, 480 Ticks, Tempo 90, Noten zwischen den Sechzehnteln, 2 leere Takte vorweg
  const v = (n: number) => (n < 128 ? [n] : [((n >> 7) & 0x7f) | 0x80, n & 0x7f]);
  const ev: number[] = [];
  const us = Math.round(60_000_000 / 90);
  ev.push(0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255);
  ev.push(0, 0xff, 0x03, 5, ...[...'Floet'].map((c) => c.charCodeAt(0)));
  ev.push(...v(2 * 4 * 480), 0x90, 60, 90); // Takt 3, Schlag 1 (laufender Status ab hier)
  ev.push(...v(230), 60, 0, ...v(10), 64, 90, ...v(240), 64, 0); // leicht neben dem Raster
  ev.push(...v(0), 0x99, 36, 100, ...v(60), 36, 0, ...v(180), 42, 100, ...v(60), 42, 0, ...v(180), 38, 100, ...v(60), 38, 0, ...v(60), 75, 100, ...v(60), 75, 0);
  ev.push(0, 0xf0, 2, 1, 0xf7); // SysEx überspringen
  ev.push(0, 0xb0, 7, 100); // Controller
  ev.push(0, 0xff, 0x2f, 0);
  const len = ev.length;
  const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, (len >> 8) & 255, len & 255, ...ev]);
  const f = parseMidi(bytes);
  check(f.format === 0 && f.ticksPerBeat === 480 && f.bpm === 90, `Format 0: ${f.ticksPerBeat} Ticks, ${f.bpm} BPM`);
  check(f.parts.length === 2 && f.parts[0].name === 'Floet' && f.parts[1].drums && f.parts[1].name === 'Schlagzeug', `Stimmen: ${f.parts.map((p) => p.name).join(' / ')}`);
  const r = midiToSong(f, { lead: 0, bass: null, drums: 1 });
  check(r.song.lead.notes.length === 2 && r.song.lead.notes[0].step === 0 && r.song.lead.notes[0].len === 2 && r.song.lead.notes[1].step === 2 && r.song.lead.notes[1].len === 2, `Quantisierung: ${JSON.stringify(r.song.lead.notes)}`);
  // Schlagzeug beginnt nach der Melodie (Tick 4320 = Schritt 36 − 32 Versatz = 4)
  check(r.song.drums.kick[0] === 4 && r.song.drums.hat[0] === 6 && r.song.drums.snare[0] === 8, `Schlagzeug-Zuordnung: ${JSON.stringify(r.song.drums)}`);
  check(r.notes.some((n) => n.includes('2 leere Takte')) && r.notes.some((n) => n.includes('ohne Entsprechung')), `Hinweise: ${r.notes.join(' | ')}`);
}
{
  let err = '';
  try {
    parseMidi(new Uint8Array([1, 2, 3]));
  } catch (e) {
    err = (e as Error).message;
  }
  check(err.includes('MThd'), `Kaputte Datei abgelehnt: ${err}`);
  const s = emptySong();
  check(validateSong(s).ok, 'Leerer Song gültig');
}

// ------------------------------------------------------------------ Eingebaute Songs

console.log('\nEingebaute Songs:');
{
  check(BUILTIN_IDS.size === BUILTIN_SONGS.length, `${BUILTIN_SONGS.length} Songs, IDs eindeutig`);
  const titles = new Set(BUILTIN_SONGS.map((s) => s.title));
  check(titles.size === BUILTIN_SONGS.length, 'Titel eindeutig');
  const old = BUILTIN_SONGS.filter((s) => !THEME_SONGS.includes(s));
  const oldRms = old.map((s) => db(rmsOf(renderSong(s).mix))).sort((a, b) => a - b);
  const median = oldRms[Math.floor(oldRms.length / 2)];
  for (const s of BUILTIN_SONGS) {
    const v = validateSong(JSON.parse(JSON.stringify(s)));
    const problems: string[] = [];
    if (!v.ok) problems.push(v.error);
    else if (JSON.stringify(v.song.lead.notes) !== JSON.stringify(s.lead.notes)) problems.push('Validierung verändert Noten');
    if (!STYLES.some((x) => x.id === s.style)) problems.push(`Stil ${s.style}`);
    if (s.bars > MAX_BARS) problems.push(`${s.bars} Takte`);
    const total = s.bars * STEPS_PER_BAR;
    for (const c of [s.lead, s.bass, s.harmony]) {
      if (c.notes.some((n) => n.midi < 28 || n.midi > 96)) problems.push('Ton außerhalb 28–96');
      // Was über das Loop-Ende hinausklingt, darf höchstens einen Takt lang sein
      if (c.notes.some((n) => n.step + n.len > total + STEPS_PER_BAR)) problems.push('Note ragt weit über das Ende');
    }
    const r = renderSong(s);
    const peak = peakOf(r.mix), rms = db(rmsOf(r.mix)), silent = longestSilence(r.mix, r.sr);
    if (peak >= 0.95) problems.push(`übersteuert (Spitze ${peak.toFixed(2)})`);
    for (const [k, a] of Object.entries(r.channels)) {
      const used = k === 'drums' ? s.drums.kick.length + s.drums.snare.length + s.drums.hat.length > 0 : s[k as 'lead'].notes.length > 0;
      if (used && rmsOf(a) < 1e-4) problems.push(`Kanal ${k} stumm`);
    }
    if (silent > 1) problems.push(`${silent.toFixed(1)} s Stille`);
    const theme = THEME_SONGS.includes(s);
    if (theme) {
      if (r.seconds < 45 || r.seconds > 90) problems.push(`Loop ${r.seconds.toFixed(1)} s (soll 45–90 s)`);
      if ([s.lead, s.bass, s.harmony].some((c) => c.notes.length === 0) || !s.drums.kick.length) problems.push('nicht alle Kanäle belegt');
      if (Math.abs(rms - median) > 6) problems.push(`Pegel ${rms.toFixed(1)} dB weicht > 6 dB von den alten Loops (${median.toFixed(1)} dB) ab`);
    }
    check(!problems.length, `${s.id} „${s.title}“ (${styleOf(s.style)}): ${s.bars} Takte, ${r.seconds.toFixed(1)} s, Spitze ${peak.toFixed(2)}, RMS ${rms.toFixed(1)} dBFS${problems.length ? ' – ' + problems.join('; ') : ''}`);
  }
  // Jede Szene (und angekündigte Spiele) bekommt einen vorhandenen Song; Themen-Songs sind zugeordnet
  const scenes = [...ASSIGN_SCENES.map((x) => x.id).filter((x) => x !== 'standard'), 'zauber', 'wpistole', 'angeln'];
  const missing = scenes.filter((x) => !BUILTIN_IDS.has(defaultSongForScene(x)));
  check(!missing.length, `Standard-Song für alle ${scenes.length} Szenen vorhanden${missing.length ? ': fehlt für ' + missing.join(', ') : ''}`);
  const used = new Set(scenes.map(defaultSongForScene));
  const unused = THEME_SONGS.filter((s) => !used.has(s.id)).map((s) => s.id);
  check(!unused.length, `Alle Themen-Songs einer Szene zugeordnet${unused.length ? ': ' + unused.join(', ') : ''}`);
  const counts = new Map<string, number>();
  for (const x of scenes) counts.set(defaultSongForScene(x), (counts.get(defaultSongForScene(x)) ?? 0) + 1);
  check(Math.max(...counts.values()) <= 7, `Abwechslung: höchstens 7 Szenen pro Song (${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')})`);
  const want: Record<string, string> = { zauber: 'zauber', igel: 'igelkrieg', kart: 'rennen', autoball: 'rennen', smash: 'arena', wpistole: 'western', volley: 'sport', murder: 'krimi', wasser: 'wasser', angeln: 'wasser' };
  const wrong = Object.entries(want).filter(([k, v]) => defaultSongForScene(k) !== v);
  check(!wrong.length, `Themen-Zuordnung${wrong.length ? ' falsch: ' + wrong.map(([k]) => k).join(', ') : ''}`);
}

function styleOf(id: string) {
  return STYLES.find((x) => x.id === id)?.name ?? id;
}

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(failed ? 1 : 0);
