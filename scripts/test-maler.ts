/**
 * Tests ohne Browser für Montagsmaler live (`npm run test:maler`):
 * Wortliste (Größe, keine Dubletten), unscharfer Vergleich (Umlaute, Tippfehler, knapp daneben, andere Wörter),
 * Hinweis-Muster, Striche (Ops, Schlüsselbild, verpasste Nachrichten), Geheimhaltung und ein kompletter Ablauf.
 */
import { MALER, MALER_WORDS, type MalerPrivate, type MalerState, applyInkOp, malerAlts, malerDrawerPer, malerFits, malerGuessPoints, malerHint, malerMatch, malerNorm } from '../shared/maler';
import type { PostStroke } from '../shared/types';
import { MalerGame } from '../server/maler';
import type { MiniCtx, MiniResult } from '../server/minigame';

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok ' : 'FEHLER'} ${msg}`);
  if (!cond) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Wortliste

console.log('Wortliste');
const seen = new Map<string, string>();
const dupes: string[] = [];
for (const e of MALER_WORDS) for (const a of malerAlts(e)) {
  const n = malerNorm(a);
  if (seen.has(n)) dupes.push(`${a} (${seen.get(n)})`);
  seen.set(n, e);
}
ok(MALER_WORDS.length >= 200, `${MALER_WORDS.length} Begriffe (mind. 200)`);
ok(!dupes.length, `keine Dubletten, auch nicht normalisiert${dupes.length ? `: ${dupes.join(', ')}` : ''}`);
ok(MALER_WORDS.every((e) => malerAlts(e)[0].length >= 2 && malerAlts(e)[0].length <= 16), 'Anzeigewort 2–16 Zeichen (passt auf TV und Handy)');

// ------------------------------------------------------------------ Vergleich

console.log('Vergleich');
ok(malerMatch('strand', 'Strand') === 'hit', 'Groß/klein egal');
ok(malerMatch('  der Strand ', 'Strand') === 'hit', 'Artikel und Leerzeichen egal');
ok(malerMatch('Loewe', 'Löwe') === 'hit' && malerMatch('löwe', 'Löwe') === 'hit', 'ö = oe');
ok(malerMatch('Fussball', 'Fußball') === 'hit', 'ß = ss');
ok(malerMatch('U Boot', 'U-Boot') === 'hit' && malerMatch('uboot', 'U-Boot') === 'hit', 'Bindestrich/Leerzeichen egal');
ok(malerMatch('Sonnenbrile', 'Sonnenbrille') === 'hit', 'Tippfehler bei langem Wort zählt');
ok(malerMatch('Sonenbrile', 'Sonnenbrille') === 'hit', 'zwei Tippfehler bei langem Wort zählen');
ok(malerMatch('Kaze', 'Katze') === 'hit', 'ein Tippfehler bei 5 Buchstaben zählt');
ok(malerMatch('Hnd', 'Hund') === 'close', 'kurzes Wort: Tippfehler nur „knapp daneben“');
ok(malerMatch('Birne', 'Biene') === 'miss' || malerMatch('Birne', 'Biene') === 'close', 'anderes Wort der Liste (Birne ≠ Biene) zählt nicht');
ok(malerMatch('Möwe', 'Löwe') !== 'hit', 'Möwe ≠ Löwe');
ok(malerMatch('Pinsel', 'Insel') !== 'hit', 'anderer Anfangsbuchstabe zählt nicht als Tippfehler (Pinsel ≠ Insel)');
ok(malerMatch('Brille', 'Sonnenbrille') === 'close', 'Teilwort → knapp daneben');
ok(malerMatch('Hundehütte', 'Hund') === 'close', 'Wort steckt im Tipp → knapp daneben (bleibt am TV geheim)');
ok(malerMatch('Smartphone', 'Handy|Smartphone|Telefon') === 'hit', 'Alternativen zählen');
ok(malerMatch('Banane', 'Strand') === 'miss', 'falsch ist falsch');
ok(malerMatch('', 'Strand') === 'miss', 'leer ist falsch');

console.log('Hinweise & Punkte');
ok(malerHint('Sonne') === '_____', 'Muster ohne Hinweis');
ok(malerHint('U-Boot', [0]) === 'U-____', 'Bindestrich bleibt, aufgedeckt groß');
ok(malerHint('Fuß', [2]) === '__ß', 'ß bleibt ß');
ok(malerFits('Strand', '__RA__') && !malerFits('Strand', '__RO__') && !malerFits('Sonne', '______'), 'Bot-Filter nach Muster');
ok(malerGuessPoints(1, 0) === 13 && malerGuessPoints(0, 5) === 3 && malerGuessPoints(0.5, 1) === 9, 'Rater: 3 + Restzeit (bis 7) + Platz-Bonus 3/2/1');
ok(malerDrawerPer(2) === 6 && malerDrawerPer(5) === 2 && malerDrawerPer(11) === 1, 'Maler pro Rater: ~12 insgesamt');

console.log('Striche');
const st: PostStroke[] = [];
applyInkOp(st, { t: 's', c: 1, w: 0, p: [1, 2] });
applyInkOp(st, { t: 'a', p: [3, 4, 5, 6] });
applyInkOp(st, { t: 's', c: 2, w: 2, p: [9, 9] });
ok(st.length === 2 && st[0].p.join() === '1,2,3,4,5,6', 'Strich anfangen + anhängen');
ok(applyInkOp(st, { t: 'u' }) && st.length === 1, 'Zurück nimmt den letzten Strich');
ok(applyInkOp(st, { t: 'x' }) && st.length === 0, 'Leeren');

// ------------------------------------------------------------------ Ablauf

console.log('Spielablauf (3 Spieler)');
let result: MiniResult | null = null;
const offline = new Set<string>();
const ctx: MiniCtx = {
  onChange: () => undefined,
  finish: (r) => (result = r),
  isConnected: (id) => !offline.has(id),
  nameOf: (id) => id,
  isBot: () => false,
  mode: 'arcade',
};
const game = new MalerGame(['A', 'B', 'C'], ctx);
const S = () => (game.snapshot() as { state: MalerState }).state;
const P = (id: string) => (game.privateFor(id) as { state: MalerPrivate }).state;
ok(S().sub === 'choose' && S().rounds === 3 && new Set(S().order).size === 3, 'jeder malt einmal, Reihenfolge ohne Doppelte');
const d1 = S().drawer;
const others = ['A', 'B', 'C'].filter((x) => x !== d1);
ok(P(d1).choices?.length === 3 && P(others[0]).choices === null, 'nur der Maler sieht die 3 Wörter');
const word = P(d1).choices![1];
game.input(d1, 'choose', { round: 1, index: 1 });
ok(S().sub === 'draw' && P(d1).word === word && P(others[0]).word === null, 'Wort gewählt: nur der Maler kennt es');
ok(!JSON.stringify(game.snapshot()).toLowerCase().includes(`"${word.toLowerCase()}"`) && S().hint === malerHint(word), 'Wort steht nicht im Snapshot, nur das Muster');
// Striche
game.input(d1, 'ink', { round: 1, n: 0, ops: [{ t: 's', c: 0, w: 1, p: [10, 10, 20, 20] }, { t: 'a', p: [30, 30] }] });
game.input(others[0], 'ink', { round: 1, n: 2, ops: [{ t: 'x' }] });
let ink = S().ink;
ok(ink.seq === 2 && ink.from === 0 && ink.ops.length === 2 && !ink.full, 'Ops im Snapshot, Rater dürfen nicht malen');
game.input(d1, 'ink', { round: 1, n: 5, ops: [{ t: 'a', p: [40, 40] }] });
ok(S().ink.seq === 2 && P(d1).need, 'falscher Zähler (verlorene Nachricht) → Server bittet ums ganze Bild');
game.input(d1, 'full', { round: 1, n: 6, s: [{ c: 0, w: 1, p: [10, 10, 20, 20, 30, 30, 40, 40] }] });
ok(!P(d1).need && S().ink.seq === 4, 'ganzes Bild übernommen (Leeren + Strich als Ops)');
game.input(d1, 'ink', { round: 1, n: 6, ops: [{ t: 'a', p: [50, 50] }] });
ok(S().ink.seq === 5, 'danach geht es mit dem neuen Zähler weiter');
game.hostInput('sync');
ink = S().ink;
ok(!!ink.full && ink.full.length === 1 && ink.full[0].p.length === 10, 'TV fragt nach → Schlüsselbild mit allen Strichen');
// Raten
game.input(others[0], 'guess', { round: 1, text: 'xyzzy' });
ok(S().chat.length === 1 && S().chat[0].text === 'xyzzy' && P(others[0]).mine[0].res === 'miss', 'falscher Tipp → Chat am TV');
await sleep(MALER.GUESS_GAP_MS + 20);
const close = word.length >= 3 ? `${word}xxx` : null;
if (close) {
  game.input(others[0], 'guess', { round: 1, text: close });
  ok(S().chat.length === 1 && P(others[0]).mine[1]?.res === 'close', 'knapp daneben → nur privat, nicht im Chat');
  await sleep(MALER.GUESS_GAP_MS + 20);
}
game.input(others[0], 'guess', { round: 1, text: word.toLowerCase() });
const s1 = S();
ok(s1.guessed[0] === others[0] && s1.chat[s1.chat.length - 1].ok === true && s1.chat[s1.chat.length - 1].text === null, 'richtig → „✓ hat’s“ ohne Text');
ok(P(others[0]).role === 'got' && P(others[0]).word === word, 'wer es hat, sieht das Wort');
ok(s1.points[others[0]] >= 10 && s1.points[d1] === malerDrawerPer(2), `Punkte: Rater ${s1.points[others[0]]}, Maler ${s1.points[d1]}`);
await sleep(MALER.GUESS_GAP_MS + 20);
game.input(others[1], 'guess', { round: 1, text: word });
await sleep(MALER.ALL_DONE_MS + 200);
ok(S().sub === 'reveal' && S().why === 'all' && S().word === word && !!S().ink.full, 'alle haben’s → Auflösung mit Wort und ganzem Bild');
game.skip();
ok(S().sub === 'choose' && S().round === 2 && S().ink.seq === 0, 'nächstes Bild, Leinwand leer');
// Bild 2: Maler geht während der Wortwahl → übersprungen
const d2 = S().drawer;
offline.add(d2);
await sleep(700);
ok(S().round === 3 && S().drawer !== d2, 'Maler weg bei der Wortwahl → nächster Maler');
offline.delete(d2);
game.skip();
ok(S().sub === 'draw', 'VIP überspringt die Wortwahl → zufälliges Wort');
game.skip();
ok(S().sub === 'reveal' && S().why === 'skip', 'VIP löst das Bild auf');
game.skip();
for (let t = 0; t < 20 && !result; t++) await sleep(100);
ok(!!result && (result as MiniResult).groups.flat().length === 3, `Ende: ${(result as MiniResult | null)?.subtitle ?? '–'}`);
game.dispose();

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests ok');
process.exit(failed ? 1 : 0);
