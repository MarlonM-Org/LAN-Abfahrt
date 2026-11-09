import type { MiniResult } from '../server/minigame';
import { BandGame } from '../server/band';
import {
  BAND, BAND_INFO, BAND_INSTS, BAND_SONGS, type BandInst, type BandState, bandAssign, bandBarMs, bandBonusCoins, bandCap, bandChart, bandMaxScore, bandSong, bandSongMs,
  bandStepMs, bandStepTime,
} from '../shared/band';
import { STEPS_PER_BAR, type Song } from '../shared/music';

/**
 * Tests ohne Browser für die Strand-Band: `npm run test:band`
 * - jeder Song: Länge, Schlussakkord; jede Instrumentenspur spielbar (Noten, Mindestabstand, Dichte, Bahnen,
 *   Halte-Noten mit Pause danach) und jede Note liegt auf einem Ton/Schlag, der wirklich im Song erklingt
 * - Besetzung (Vorschlag, Obergrenze), kompletter Ablauf mit Wertung, Groove und Band-Bonus
 */
let fails = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok ' : ' FEHLER'} ${name}${cond || !info ? '' : ` – ${info}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} statt ${JSON.stringify(want)}`);

/** Schritt einer Notenzeit (Umkehrung von bandStepTime, inkl. Swing) */
function stepOf(song: Song, t: number): number {
  const s = Math.round(t / bandStepMs(song));
  for (const c of [s, s - 1, s + 1]) if (c >= 0 && Math.abs(Math.round(bandStepTime(song, c)) - t) <= 1) return c;
  return -1;
}

/** Erklingt am Schritt wirklich etwas, das zum Instrument passt? */
function sounds(song: Song, inst: BandInst, step: number, lane: number): boolean {
  if (inst === 'drums') return lane === 1 ? song.drums.snare.includes(step) : song.drums.kick.includes(step);
  if (inst === 'shaker') return song.drums.hat.includes(step);
  const ch = inst === 'melody' ? song.lead : inst === 'bass' ? song.bass : song.harmony;
  return ch.notes.some((n) => n.step === step);
}

// ---------------------------------------------------------------- Songs und Spuren
console.log('Songs und Spuren');
for (const id of BAND_SONGS) {
  const song = bandSong(id);
  ok(`${id}: eingebauter Song vorhanden`, !!song);
  if (!song) continue;
  const ms = bandSongMs(song);
  ok(`${id}: Länge 50–75 s (${(ms / 1000).toFixed(1)} s)`, ms >= 50_000 && ms <= 75_000);
  const end = (song.bars - 1) * STEPS_PER_BAR;
  ok(`${id}: Schlussakkord im letzten Takt`, song.drums.kick.includes(end) && song.lead.notes.some((n) => n.step === end));
  for (const inst of BAND_INSTS) {
    const info = BAND_INFO[inst];
    const c = bandChart(song, inst);
    const lanes = info.laneNames.length;
    const label = `${id}/${info.short}`;
    const secs = ms / 1000;
    ok(`${label}: mindestens 40 Noten (${c.length})`, c.length >= 40);
    ok(`${label}: sortiert, ab Takt 1`, c.every((n, i) => n.t >= 0 && (i === 0 || n.t > c[i - 1].t)));
    const gaps = c.slice(1).map((n, i) => n.t - c[i].t);
    ok(`${label}: Mindestabstand ${info.minGap} ms`, gaps.every((g) => g >= info.minGap - 1), `kleinster ${Math.min(...gaps)}`);
    let peak = 0;
    for (let i = 0; i < c.length; i++) {
      let j = i;
      while (j < c.length && c[j].t - c[i].t < 4000) j++;
      peak = Math.max(peak, (j - i) / 4);
    }
    ok(`${label}: Dichte ${(c.length / secs).toFixed(2)}/s, Spitze ${peak.toFixed(2)}/s ≤ 5`, c.length / secs <= 4 && peak <= 5);
    ok(`${label}: längste Pause ≤ 4 s`, Math.max(...gaps) <= 4000, `${Math.max(...gaps)} ms`);
    ok(`${label}: Bahnen 0–${lanes - 1}, alle benutzt`, c.every((n) => n.lane >= 0 && n.lane < lanes) && Array.from({ length: lanes }, (_, l) => c.some((n) => n.lane === l)).every(Boolean));
    const holdsOk = c.every((n, i) => !n.len || (n.len >= info.holdMs * 0.8 && (!c[i + 1] || n.t + n.len <= c[i + 1].t - 150)));
    ok(`${label}: Halte-Noten nur wo erlaubt, mit Pause danach`, holdsOk && (info.holdMs > 0 || c.every((n) => !n.len)));
    const off = c.filter((n) => !sounds(song, inst, stepOf(song, n.t), n.lane));
    ok(`${label}: jede Note erklingt im Song`, !off.length, `${off.length} Noten ohne Ton, z. B. t=${off[0]?.t}`);
    ok(`${label}: Takt-Angabe passt zur Zeit`, c.every((n) => n.bar === Math.floor(stepOf(song, n.t) / STEPS_PER_BAR)));
    ok(`${label}: letzte Note = Schlussakkord`, c[c.length - 1].bar === song.bars - 1);
  }
}
ok('Swing: ungerade Schritte verschoben (Strandpromenade)', Math.abs(bandStepTime(bandSong('strandpromenade')!, 1) - bandStepMs(bandSong('strandpromenade')!) * 1.15) < 0.01);

// ---------------------------------------------------------------- Besetzung
console.log('Besetzung');
eq('Vorschlag 2 Spieler: Schlagzeug + Melodie', Object.values(bandAssign(['a', 'b'])), ['drums', 'melody']);
eq('Vorschlag 7 Spieler: ab dem 6. doppelt', Object.values(bandAssign(['a', 'b', 'c', 'd', 'e', 'f', 'g'])), ['drums', 'melody', 'bass', 'chords', 'shaker', 'drums', 'melody']);
eq('Obergrenze pro Instrument (2/5/8/12 Spieler)', [2, 5, 8, 12].map(bandCap), [2, 2, 3, 4]);
eq('Band-Bonus nach Groove-Serie', [0, 5, 6, 10, 16, 30].map(bandBonusCoins), [0, 0, 1, 2, 3, 3]);

// ---------------------------------------------------------------- Ablauf
console.log('Ablauf');
function setup(n: number, mode: 'arcade' | 'party' = 'party') {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const out: { result: MiniResult | null; changes: number; off: Set<string> } = { result: null, changes: 0, off: new Set() };
  const g = new BandGame(ids, {
    onChange: () => out.changes++,
    finish: (r) => (out.result = r),
    isConnected: (id) => !out.off.has(id),
    nameOf: (id) => id,
    mode,
    board: mode === 'party',
  });
  const st = () => g.snapshot().state as BandState;
  return { g, ids, out, st };
}
type Internal = { end(): void; finish(): void; evalBars(final?: boolean): void };

{
  const { g, ids, st, out } = setup(5);
  const s0 = st();
  ok('Start in der Instrument-Wahl mit Countdown', s0.sub === 'pick' && s0.endsIn > 20_000 && s0.endsIn <= BAND.PICK_MS);
  eq('Vorschlag: jedes Instrument einmal', [...new Set(ids.map((id) => s0.players[id].inst))].sort(), [...BAND_INSTS].sort());
  ok('Song aus der Liste', BAND_SONGS.includes(s0.song) && s0.duration === Math.round(bandSongMs(bandSong(s0.song)!)));
  const drummer = ids.find((id) => s0.players[id].inst === 'drums')!;
  const shaker = ids.find((id) => s0.players[id].inst === 'shaker')!;
  g.input(shaker, 'inst', { inst: 'drums' });
  eq('Wechsel aufs Schlagzeug (Platz frei)', st().players[shaker].inst, 'drums');
  const bass = ids.find((id) => s0.players[id].inst === 'bass')!;
  g.input(bass, 'inst', { inst: 'drums' });
  eq('Drittes Schlagzeug bei 5 Spielern: voll', st().players[bass].inst, 'bass');
  g.input(bass, 'inst', { inst: 'gitarre' });
  eq('Unbekanntes Instrument wird ignoriert', st().players[bass].inst, 'bass');
  g.input(shaker, 'inst', { inst: 'shaker' });
  for (const id of ids.slice(0, 4)) g.input(id, 'ready', {});
  ok('Noch nicht alle bereit → wartet', st().sub === 'pick' && st().players[ids[0]].ready);
  g.input(ids[0], 'inst', { inst: 'melody' });
  ok('Nach „Bereit“ kein Wechsel mehr', st().players[ids[0]].inst === s0.players[ids[0]].inst);
  out.off.add(ids[4]);
  g.playerDisconnected();
  ok('Letzter Wartender weg → Song startet', st().sub === 'play');
  out.off.delete(ids[4]);
  const s1 = st();
  ok('Start liegt in der Zukunft (Puffer + Einzähler)', s1.startAt > Date.now() + BAND.START_BUFFER_MS - 50);
  ok('Zustand ohne Notenspuren (klein)', JSON.stringify(s1).length < 3000, `${JSON.stringify(s1).length} Zeichen`);

  // Alle spielen perfekt, nur der Shaker trifft gar nichts
  const song = bandSong(s1.song)!;
  for (const id of ids) {
    const chart = bandChart(song, s1.players[id].inst);
    chart.forEach((n, i) => {
      const q = id === shaker ? 0 : 2;
      g.input(id, 'hit', { i, q });
      if (n.len && q) g.input(id, 'hold', { i, ok: true });
    });
  }
  const d = drummer;
  const before = st().players[d].score;
  g.input(d, 'hit', { i: 0, q: 2 });
  g.input(d, 'hit', { i: 99999, q: 2 });
  g.input(d, 'hit', { i: 1.5, q: 2 });
  eq('Doppelte/ungültige Treffer zählen nicht', st().players[d].score, before);
  ok('Patzer drücken die Form des Shakers', st().players[shaker].form < 0.05 && st().players[drummer].form === 1);
  ok('Combo der Perfekten = alle Noten', st().players[drummer].best === bandChart(song, 'drums').length);
  (g as unknown as Internal).end();
  const s2 = st();
  ok('Ende → over', s2.sub === 'over');
  ok(`Groove: Band (4/5 perfekt) lange im Groove (${s2.bestGroove}/${song.bars} Takte)`, s2.bestGroove >= 16 && s2.groove <= s2.bestGroove);
  (g as unknown as Internal).finish();
  g.dispose();
  const r = out.result!;
  ok('Ergebnis da', !!r);
  eq('Shaker (0 %) ist Letzter', r.groups[r.groups.length - 1], [shaker]);
  ok('Perfekte mit ★★★ vor ★★ (Schwierigkeitsbonus)', r.groups[0].every((id) => BAND_INFO[s2.players[id].inst].stars === 3));
  eq('Details: Prozent + Bonus + Instrument', r.details[drummer], '100% +8 Drums');
  ok('Band-Bonus: +3 Münzen für alle (Platz 1 = 10 + 3)', r.coins?.[0] === 13 && r.coins[r.coins.length - 1] === 1 + 3);
  ok('Untertitel nennt den Bonus', /\+3 Münzen für alle/.test(r.subtitle), r.subtitle);
  ok('Höchstpunkte: 2 pro Note + 1 pro Halte-Note', bandMaxScore(bandChart(song, 'melody')) === bandChart(song, 'melody').reduce((a, n) => a + 2 + (n.len ? 1 : 0), 0));
}

{
  // Arcade, schwache Band: kein Bonus, Halten nur nach getroffenem Kopf
  const { g, ids, st, out } = setup(3, 'arcade');
  g.skip!();
  const s = st();
  ok('VIP überspringt die Wahl → Song startet', s.sub === 'play');
  const song = bandSong(s.song)!;
  const melody = ids.find((id) => s.players[id].inst === 'melody')!;
  const chart = bandChart(song, 'melody');
  const hold = chart.findIndex((n) => n.len);
  if (hold >= 0) {
    g.input(melody, 'hold', { i: hold, ok: true });
    eq('Halten ohne Kopf zählt nicht', st().players[melody].score, 0);
  }
  for (const id of ids) bandChart(song, s.players[id].inst).forEach((_, i) => g.input(id, 'hit', { i, q: i % 2 ? 1 : 0 }));
  (g as unknown as Internal).end();
  (g as unknown as Internal).finish();
  g.dispose();
  const r = out.result!;
  ok('Halb getroffen: kein Groove, kein Bonus', st().bestGroove < 6 && bandBonusCoins(st().bestGroove) === 0 && r.coins![0] === 10, JSON.stringify(r.coins));
  ok('Arcade-Untertitel ohne Münzen', !/Münzen/.test(r.subtitle), r.subtitle);
}

{
  // „Nochmal“ nimmt einen anderen Song
  const a = setup(2).st().song;
  const b = setup(2).st().song;
  ok('Nochmal: anderer Song als zuletzt', a !== b, `${a} / ${b}`);
}

ok('Takt-Länge passt zum Tempo (120 BPM = 2 s)', bandBarMs({ bpm: 120 }) === 2000);

if (fails) {
  console.log(`\n${fails} Fehler`);
  process.exit(1);
}
console.log('\nAlles ok');
process.exit(0);
