/**
 * Tests ohne Browser für Guess the Song (`npm run test:lieder`):
 * Rundenzahl/Genres pro Spielerzahl, Dateinamen, Ordner → Genre, Katalog-Abgleich, Deezer-Trefferwahl,
 * Rundenplan (reihum, jedes Genre einmal), Antwortzahl 4 → 6 → 8 und Punkte.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIEDER, liederNorm, liederOptions, liederPerPlayer, liederPoints, liederRounds } from '../shared/lieder';
import type { LiederState } from '../shared/types';
import { KATALOG } from '../server/liederkatalog';
import { LiederTon, parseName, pickDeezer } from '../server/liederton';
import { LiederGame } from '../server/lieder';
import type { MiniCtx, MiniResult } from '../server/minigame';

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok ' : 'FEHLER'} ${msg}`);
  if (!cond) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Regeln

console.log('Regeln');
ok(liederPerPlayer(2) === 4 && liederRounds(2) === 8, '1 gegen 1: je 4 Genres, 8 Songs');
ok(liederPerPlayer(3) === 3 && liederRounds(3) === 9, 'zu dritt: je 3 Genres, 9 Songs');
ok(liederPerPlayer(6) === 2 && liederRounds(6) === 12, 'zu sechst: je 2 Genres, 12 Songs');
ok(liederPerPlayer(9) === 1 && liederRounds(9) === 9, 'ab 7: je 1 Genre, ein Song pro Spieler');
ok([1, 2, 3, 4, 5, 6, 7, 8].map((r) => liederOptions(r, 8)).join(',') === '4,4,4,6,6,6,8,8', 'Antworten 4 → 6 → 8 (8 Runden)');
ok(liederPoints(2000) === 5 && liederPoints(6000) === 4 && liederPoints(11_000) === 3 && liederPoints(19_000) === 2, 'Punkte: 2 + Tempo-Bonus');
const titles = new Set<string>();
const dupes = KATALOG.filter((k) => {
  const key = `${k.genre}|${liederNorm(k.title)}`;
  const d = titles.has(key);
  titles.add(key);
  return d;
});
ok(!dupes.length, `Katalog: ${KATALOG.length} Lieder, keine doppelten Titel pro Genre${dupes.length ? ` (${dupes.map((d) => d.title).join(', ')})` : ''}`);
ok(KATALOG.every((k) => k.year >= 1950 && k.year <= 2026 && k.title && k.artist), 'Katalog: Jahr, Titel, Interpret vorhanden');

// ------------------------------------------------------------------ Dateien

console.log('Eigene Dateien');
const p1 = parseName('01 - a-ha - Take On Me (Remastered)');
ok(p1.artist === 'a-ha' && p1.title === 'Take On Me (Remastered)', 'Dateiname mit Tracknummer');
const p2 = parseName('Sandburg');
ok(p2.artist === '' && p2.title === 'Sandburg', 'Dateiname ohne Interpret');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lieder-'));
const touch = (rel: string) => {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), 'x');
};
touch('80er/a-ha - Take On Me.mp3');
touch('Hip-Hop/Eminem - Lose Yourself.m4a');
touch('Urlaubshits/Ferien Band - Sonnenbrand.mp3');
touch('Wham! - Wake Me Up Before You Go-Go.mp3');
touch('notizen.txt');
const ton = new LiederTon(tmp, '');
const lib = ton.library();
const byTitle = (t: string) => lib.songs.find((s) => s.title === t);
ok(byTitle('Take On Me')?.genre === '80er' && byTitle('Take On Me')?.year === 1985, 'Ordner „80er“ → Genre 80er, Jahr aus dem Katalog');
ok(byTitle('Lose Yourself')?.genre === 'hiphop', 'Ordner „Hip-Hop“ → Genre Hip-Hop & R&B');
ok(byTitle('Sonnenbrand')?.genre === 'ordner-urlaubshits' && lib.genres.some((g) => g.name === 'Urlaubshits'), 'unbekannter Ordner → eigenes Genre');
ok(byTitle('Wake Me Up Before You Go-Go')?.genre === '80er', 'Datei ohne Ordner → Genre aus dem Katalog');
ok(lib.songs.filter((s) => s.quelle === 'datei').length === 4, 'nur Audiodateien zählen');
ok(lib.songs.some((s) => s.quelle === 'synth') && lib.genres[0].id === 'soundtrack', 'Soundtrack-Genre immer dabei');
ok(!lib.songs.some((s) => s.quelle === 'vorschau'), 'ohne LIEDER_VORSCHAU keine Hörproben');
const withDz = new LiederTon(tmp, 'deezer').library();
ok(withDz.songs.filter((s) => s.quelle === 'vorschau').length === KATALOG.length - 3, 'LIEDER_VORSCHAU=deezer: Katalog dazu (ohne die 3 schon als Datei vorhandenen)');
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ Deezer-Treffer

console.log('Deezer-Trefferwahl');
const lied = { id: 'x', title: 'Take On Me', artist: 'a-ha', year: 1985, genre: '80er', quelle: 'vorschau' as const };
const res = {
  data: [
    { id: 1, title: 'Take On Me (Karaoke Version)', artist: { name: 'Karaoke Stars' }, preview: 'k' },
    { id: 2, title: 'Take On Me (Live)', artist: { name: 'a-ha' }, preview: 'l' },
    { id: 3, title: 'Take On Me', artist: { name: 'a-ha' }, preview: 'p' },
    { id: 4, title: 'Take On Me', artist: { name: 'Weezer' }, preview: 'w' },
  ],
};
ok(pickDeezer(res, lied)?.id === 3, 'Original statt Live/Karaoke/Cover');
ok(pickDeezer({ data: [{ id: 5, title: 'Something Else', artist: { name: 'a-ha' }, preview: 's' }] }, lied) === null, 'falscher Titel → kein Treffer');

// ------------------------------------------------------------------ Spielablauf

console.log('Spielablauf (1 gegen 1, nur Soundtrack + Ordner)');
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lieder-'));
for (const [g, n] of [['80er', 5], ['Rock', 5], ['Schlager', 5], ['90er', 5]] as const) for (let i = 0; i < n; i++) fs.mkdirSync(path.join(tmp2, g), { recursive: true }), fs.writeFileSync(path.join(tmp2, g, `Band ${i} - ${g} Lied ${i}.mp3`), 'x');
const ton2 = new LiederTon(tmp2, '');
let result: MiniResult | null = null;
const ctx: MiniCtx = {
  onChange: () => undefined,
  finish: (r) => (result = r),
  isConnected: () => true,
  nameOf: (id) => id,
  isBot: () => false,
  hosts: () => 0,
  mode: 'arcade',
};
const game = new LiederGame(['A', 'B'], ctx, ton2);
const st = () => (game.snapshot() as { state: LiederState }).state;
ok(st().sub === 'pick' && st().perPlayer === 4 && st().genres.length === 5, 'Genre-Wahl: je 4 aus 5 Genres');
game.input('A', 'genres', { genres: ['80er', 'rock', 'schlager', '90er'] });
game.input('B', 'genres', { genres: ['soundtrack', 'rock'] });
ok(!st().picked.includes('B'), 'falsche Anzahl wird abgelehnt');
game.input('B', 'genres', { genres: ['soundtrack', 'rock', '80er', '80er'] });
ok(!st().picked.includes('B'), 'doppeltes Genre wird abgelehnt');
game.input('B', 'genres', { genres: ['soundtrack', 'rock', '80er', 'schlager'] });
await sleep(1100);
const s1 = st();
ok(s1.sub === 'genres' && s1.plan?.length === 8, 'alle fertig → Übersicht mit 8 Runden');
const plan = s1.plan ?? [];
ok(plan.every((p, i) => i === 0 || p.owner !== plan[i - 1].owner), 'reihum: abwechselnd A und B');
ok(['A', 'B'].every((id) => plan.filter((p) => p.owner === id).map((p) => p.genre).sort().join() === [...(s1.picks?.[id] ?? [])].sort().join()), 'jedes gewählte Genre genau einmal');
game.skip();
const answers: Record<number, number> = {};
for (let r = 1; r <= 8; r++) {
  for (let t = 0; t < 60 && st().sub !== 'play'; t++) await sleep(100);
  const s = st();
  ok(s.sub === 'play' && s.round === r && s.options.length === liederOptions(r, 8) && new Set(s.options.map(liederNorm)).size === s.options.length, `Runde ${r}: ${s.options.length} verschiedene Antworten (${s.genres.find((g) => g.id === s.genre)?.name})`);
  // A tippt richtig (Lösung aus dem privaten Zustand eines „Bots“ geht hier nicht → aus dem Spiel selbst)
  const idx = (game as unknown as { cur: { index: number } }).cur.index;
  answers[r] = idx;
  game.input('A', 'answer', { round: r, index: idx });
  game.input('B', 'answer', { round: r, index: (idx + 1) % s.options.length });
  for (let t = 0; t < 40 && st().sub !== 'reveal'; t++) await sleep(100);
  ok(st().sub === 'reveal' && st().gain?.A === LIEDER.BASE + 3 + LIEDER.FIRST_BONUS && st().gain?.B === 0, `Runde ${r}: richtig + schnell = ${LIEDER.BASE + 3 + LIEDER.FIRST_BONUS}, falsch = 0`);
  game.skip();
}
for (let t = 0; t < 20 && !result; t++) await sleep(100);
ok(!!result && (result as MiniResult).groups[0][0] === 'A', 'Ende: A gewinnt');
game.dispose();
fs.rmSync(tmp2, { recursive: true, force: true });

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests ok');
process.exit(failed ? 1 : 0);
