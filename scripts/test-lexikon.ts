import type { MiniCtx, MiniResult } from '../server/minigame';
import { LexikonGame, lexPick, lexResetAbend } from '../server/lexikon';
import { LEX_ENTRIES, type LexEntry } from '../server/lexikonData';
import { LEXIKON, LEX_TOO_CLOSE, type LexPrivate, type LexState, lexClean, lexKey, lexRounds, lexTokens, lexTooClose } from '../shared/lexikon';

/**
 * Tests ohne Browser fürs Lügen-Lexikon: `npm run test:lexikon`
 * Einträge (Dubletten, Lücke, Länge der Wahrheit, Haus-Lügen ≠ Wahrheit und untereinander verschieden), der unscharfe
 * Vergleich „zu nah an der Wahrheit“ und kompletter Ablauf mit Schein-Spielern (Abweisen, Zusammenfassen, Auffüllen,
 * Punkte, letzte Frage doppelt, kein Eintrag doppelt pro Abend).
 */
let fails = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok ' : ' FEHLER'} ${name}${cond || !info ? '' : ` – ${info}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} statt ${JSON.stringify(want)}`);
const STOP_WORDS = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']);

// ---------------------------------------------------------------- Einträge
{
  const byCat = (c: LexEntry['cat']) => LEX_ENTRIES.filter((e) => e.cat === c).length;
  console.log(`\n${LEX_ENTRIES.length} Einträge: ${byCat('wort')} Wörter, ${byCat('herkunft')} Wortherkunft, ${byCat('fakt')} Fakten`);
  ok('Mindestens 150 Einträge', LEX_ENTRIES.length >= 150);
  const problems: string[] = [];
  const prompts = new Map<string, string>();
  for (const e of LEX_ENTRIES) {
    const where = `„${e.q.slice(0, 48)}“`;
    const bad = (why: string) => problems.push(`${where}: ${why}`);
    const pk = lexTokens(e.q).join(' ');
    if (prompts.has(pk)) bad('doppelte Aufgabe');
    prompts.set(pk, e.q);
    if ((e.q.match(/___/g) ?? []).length !== 1 || /_{4,}/.test(e.q)) bad('braucht genau eine Lücke ___');
    if (!e.a || lexClean(e.a) !== e.a) bad(`Wahrheit „${e.a}“ nicht sauber (leer, Satzzeichen am Ende, zu lang)`);
    if (e.a.length > 30) bad(`Wahrheit zu lang (${e.a.length} Zeichen)`);
    const words = e.a.split(/\s+/).filter((w) => !STOP_WORDS.has(w.toLowerCase()));
    if (words.length > 4) bad(`Wahrheit hat ${words.length} Wörter`);
    if (!lexTooClose(e.a, [e.a])) bad('Wahrheit erkennt sich selbst nicht');
    if (!e.why || e.why.length > 140 || !/[.!?“]$/.test(e.why)) bad(`Erklärung fehlt, ist zu lang (${e.why.length}) oder ohne Satzende`);
    if (e.lies.length < 2 || e.lies.length > 3) bad(`${e.lies.length} Haus-Lügen (2–3)`);
    const keys = new Set([lexKey(e.a)]);
    for (const l of e.lies) {
      if (!l || lexClean(l) !== l) bad(`Haus-Lüge „${l}“ nicht sauber oder länger als ${LEXIKON.MAX_TEXT} Zeichen`);
      if (lexTooClose(l, [e.a, ...e.alt])) bad(`Haus-Lüge „${l}“ zu nah an der Wahrheit`);
      if (keys.has(lexKey(l))) bad(`Haus-Lüge „${l}“ doppelt`);
      keys.add(lexKey(l));
    }
    for (const a of e.alt) if (e.lies.includes(a)) bad(`„${a}“ ist Schreibweise UND Haus-Lüge`);
  }
  ok('Alle Einträge sauber', !problems.length, `\n    ${problems.join('\n    ')}`);
}

// ---------------------------------------------------------------- Unscharfer Vergleich
{
  console.log('\nZu nah an der Wahrheit?');
  const near = (a: string, t: string[]) => lexTooClose(a, t);
  eq('Groß/klein, Artikel, Satzzeichen', near('  DIE rache des PAPSTES!!', ['Rache des Papstes']), true);
  eq('Alle Wörter der Wahrheit drin', near('Die späte Rache des Papstes', ['Rache des Papstes']), true);
  eq('Nur ein Wort der Wahrheit', near('Rache der Nonne', ['Rache des Papstes']), false);
  eq('Endung egal (Kapuzinern ≈ Kapuziner)', near('Kapuzinern', ['Kapuzinermönchen', 'Kapuziner']), true);
  eq('Tippfehler (vertauscht)', near('Plfaumenmus', ['Pflaumenmus']), true);
  eq('Tippfehler (Buchstabe fehlt)', near('Elwetrisch', ['Elwetritsch']), true);
  eq('Tippfehler in mehreren Wörtern', near('Rache des Paptes', ['Rache des Papstes']), true);
  eq('Kurze Wörter: „nachts zu sehen“ ≠ „nicht zu sehen“', near('nur nachts zu sehen', ['nicht zu sehen']), false);
  eq('Ähnlich, aber anders (Bulgarisch ≠ Ungarisch)', near('Bulgarischen', ['Ungarischen']), false);
  eq('Kurzes Wort: Hosen ≠ Hoden', near('Hosen', ['Hoden']), false);
  eq('Umlaute ausgeschrieben', near('Aepfel', ['Äpfel']), true);
  eq('Zusammengesetzt: Mineralwasser ⊃ Wasser', near('Mineralwasser', ['Wasser']), true);
  eq('Zahl allein = Zahl mit Einheit', near('38', ['38 Minuten']), true);
  eq('„etwa 38 Minuten“', near('etwa 38 Minuten', ['38 Minuten']), true);
  eq('Gleiche Zahl, andere Einheit ist eine Lüge', near('38 Tage', ['38 Minuten']), false);
  eq('Andere Zahl ist eine Lüge', near('39 Minuten', ['38 Minuten']), false);
  eq('Ausgeschriebene Zahl über Schreibweise', near('3', ['drei', '3']), true);
  eq('Leere Lüge ist nie „zu nah“', near('   ', ['drei']), false);
  eq('Zusammenfassen: „Ein Hut“ = „hut.“', lexKey('Ein Hut') === lexKey(lexClean('hut.')), true);
  eq('Zusammenfassen: „Die Männchen“ = „MAENNCHEN“', lexKey('Die Männchen') === lexKey('MAENNCHEN'), true);
  eq('Säubern: Anführungszeichen und Punkt weg', lexClean('  „Ein  Hut.“  '), 'Ein Hut');
}

// ---------------------------------------------------------------- Ablauf mit Schein-Spielern
function setup(n: number, mode: MiniCtx['mode'] = 'arcade', onBoard = false) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const out: { result: MiniResult | null } = { result: null };
  const g = new LexikonGame(ids, { onChange: () => undefined, finish: (r) => (out.result = r), isConnected: () => true, nameOf: (id) => id, mode, board: onBoard });
  const st = () => g.snapshot().state as LexState;
  const pv = (id: string) => (g.privateFor(id) as { state: LexPrivate }).state;
  const entry = () => LEX_ENTRIES.find((e) => e.q === st().prompt)!;
  return { ids, g, st, pv, entry, out };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const truthIdx = (st: LexState, e: LexEntry) => st.options!.findIndex((o) => o === e.a);

/** Eine Frage schnell durchspielen: jeder schreibt eine eigene Lüge, `finders` tippen auf die Wahrheit, der Rest auf p0s Lüge */
function playQuick(t: ReturnType<typeof setup>, finders: string[]) {
  const { ids, g, st, pv } = t;
  const r = st().round;
  ids.forEach((id, i) => g.input(id, 'lie', { round: r, text: `Erfindung Nummer ${'abcdefghijklmnop'[i]}` }));
  if (st().sub === 'write') g.skip();
  const e = t.entry();
  for (const id of ids) {
    const own = pv(id).mine;
    const fool = pv('p0').mine[0];
    const target = finders.includes(id) || id === 'p0' || own.includes(fool) ? truthIdx(st(), e) : fool;
    g.input(id, 'pick', { round: r, idx: target });
  }
  g.skip();
  while (st().sub === 'reveal') g.skip();
}

await (async () => {
  console.log('\nAblauf (4 Spieler, Arcade)');
  lexResetAbend();
  const t = setup(4);
  const { g, st, pv } = t;
  eq('4 Spieler → 5 Fragen', st().rounds, lexRounds(4));
  eq('Start: Schreiben, Frage 1, Faktor 1', [st().sub, st().round, st().mult], ['write', 1, 1]);
  const e = t.entry();
  ok('Aufgabe kommt aus dem Lexikon', !!e);
  // Abweisen
  g.input('p0', 'lie', { round: 1, text: e.a.toUpperCase() });
  eq('Wahrheit in Großbuchstaben wird abgewiesen', [pv('p0').lie, pv('p0').reject?.text, pv('p0').reject?.seq], [null, LEX_TOO_CLOSE, 1]);
  g.input('p0', 'lie', { round: 1, text: `  „${e.a}“!! ` });
  eq('… auch mit Anführungszeichen und Ausrufezeichen', pv('p0').reject?.seq, 2);
  if (e.alt.length) {
    g.input('p0', 'lie', { round: 1, text: e.alt[0] });
    eq(`… und als Umschreibung („${e.alt[0]}“)`, [pv('p0').lie, pv('p0').reject?.seq], [null, 3]);
  }
  g.input('p0', 'lie', { round: 1, text: '   ' });
  eq('Leere Lüge wird abgewiesen', pv('p0').reject?.text.startsWith('Schreib etwas'), true);
  g.input('p0', 'lie', { round: 2, text: 'Falsche Runde' });
  eq('Falsche Runde wird ignoriert', pv('p0').lie, null);
  // Annehmen + Zusammenfassen
  g.input('p0', 'lie', { round: 1, text: 'Eine völlig erfundene Sache' });
  g.input('p1', 'lie', { round: 1, text: 'eine VÖLLIG erfundene Sache.' });
  eq('Lügen angenommen', [pv('p0').lie, st().written], ['Eine völlig erfundene Sache', ['p0', 'p1']]);
  g.input('p0', 'lie', { round: 1, text: 'Noch eine' });
  eq('Nur eine Lüge pro Frage', pv('p0').lie, 'Eine völlig erfundene Sache');
  g.input('p2', 'suggest', { round: 1 });
  const sug = pv('p2').suggest;
  ok('„Lüge vorschlagen“ liefert eine Haus-Lüge dieses Eintrags', !!sug && e.lies.includes(sug.text), JSON.stringify(sug));
  g.input('p2', 'suggest', { round: 1 });
  ok('Nochmal vorschlagen: neuer Vorschlag', pv('p2').suggest!.seq === 2 && pv('p2').suggest!.text !== sug!.text);
  const p2lie = pv('p2').suggest!.text;
  g.input('p2', 'lie', { round: 1, text: p2lie });
  g.input('p3', 'draft', { round: 1, text: 'Quatsch mit Soße' });
  eq('Entwurf zählt noch nicht als abgegeben', st().written.includes('p3'), false);
  ok('Snapshot verrät nichts', st().options === null && st().steps.length === 0 && st().authors === null && st().why === null);
  g.skip();
  // Abstimmung
  const s = st();
  eq('Nach dem Schreiben: Abstimmung', s.sub, 'vote');
  eq('Entwurf von p3 wurde zur Lüge', pv('p3').lie, 'Quatsch mit Soße');
  const opts = s.options!;
  eq('Wahrheit genau einmal dabei', opts.filter((o) => lexKey(o) === lexKey(e.a)).length, 1);
  eq('Gleiche Lügen zusammengefasst', opts.filter((o) => lexKey(o) === lexKey('Eine völlig erfundene Sache')).length, 1);
  eq('Haus-Lüge, die p2 genommen hat, nur einmal', opts.filter((o) => lexKey(o) === lexKey(p2lie)).length, 1);
  eq(`Aufgefüllt auf ${LEXIKON.MIN_OPTIONS} Antworten`, opts.length, LEXIKON.MIN_OPTIONS);
  eq('Keine doppelten Antworten', new Set(opts.map(lexKey)).size, opts.length);
  const merged = opts.findIndex((o) => lexKey(o) === lexKey('Eine völlig erfundene Sache'));
  const p2i = opts.indexOf(p2lie);
  const ti = truthIdx(s, e);
  eq('p0 und p1 sehen dieselbe eigene Lüge', [pv('p0').mine, pv('p1').mine], [[merged], [merged]]);
  ok('Snapshot im Abstimmen: keine Autoren, keine Wahrheit', s.authors === null && s.steps.length === 0 && !JSON.stringify(s).includes('"truth"'));
  g.input('p0', 'pick', { round: 1, idx: merged });
  eq('Eigene Lüge ist nicht wählbar', pv('p0').pick, null);
  g.input('p0', 'pick', { round: 1, idx: ti });
  g.input('p1', 'pick', { round: 1, idx: merged });
  eq('Auch die zusammengefasste nicht', pv('p1').pick, null);
  g.input('p1', 'pick', { round: 1, idx: p2i });
  g.input('p2', 'pick', { round: 1, idx: merged });
  g.input('p3', 'pick', { round: 1, idx: p2i });
  eq('Alle haben getippt', st().voted, ['p0', 'p1', 'p2', 'p3']);
  g.skip();
  // Aufdecken
  eq('Aufdecken: 2 Lügen + Wahrheit', [st().sub, st().stepCount, st().steps.length], ['reveal', 3, 1]);
  eq('Erst die Lüge mit den wenigsten Reinfällern', st().steps[0], { idx: merged, truth: false, by: ['p0', 'p1'], pickers: ['p2'], points: 50 });
  eq('Punkte erst bei der Wahrheit', [st().points.p0, st().why], [0, null]);
  g.skip();
  eq('Dann p2s Lüge (2 reingefallen)', st().steps[1], { idx: p2i, truth: false, by: ['p2'], pickers: ['p1', 'p3'], points: 100 });
  g.skip();
  eq('Zum Schluss die Wahrheit', st().steps[2], { idx: ti, truth: true, by: [], pickers: ['p0'], points: 100 });
  eq('Erklärung + Autoren aller Antworten', [st().why, st().authors![merged], st().authors![ti]], [e.why, ['p0', 'p1'], null]);
  eq('Punkte: Wahrheit 100, je Reinfaller 50 (geteilt bei gleicher Lüge: jeder voll)', st().points, { p0: 150, p1: 50, p2: 100, p3: 0 });
  g.skip();
  eq('Zwischenstand', st().sub, 'scores');
  const prompts = [e.q];
  g.skip();
  eq('Frage 2 beginnt', [st().sub, st().round], ['write', 2]);
  prompts.push(st().prompt);
  playQuick(t, ['p1']);
  g.skip();
  prompts.push(st().prompt);
  playQuick(t, []);
  g.skip();
  prompts.push(st().prompt);
  playQuick(t, []);
  g.skip();
  eq('Letzte Frage zählt doppelt', [st().round, st().mult], [5, LEXIKON.FINAL_MULT]);
  prompts.push(st().prompt);
  const before = st().points.p3;
  playQuick(t, ['p3']);
  eq('Wahrheit in der letzten Frage: +200', st().points.p3 - before, LEXIKON.TRUTH_POINTS * LEXIKON.FINAL_MULT);
  eq('Fünf verschiedene Einträge', new Set(prompts).size, 5);
  g.skip();
  eq('Nach der letzten Frage: Ende', st().sub, 'over');
  await sleep(700);
  ok('Ergebnis gemeldet', !!t.out.result && t.out.result.groups.flat().length === 4, JSON.stringify(t.out.result));
  ok('Untertitel nennt die beste Lüge', !!t.out.result?.subtitle.startsWith('Beste Lüge'), t.out.result?.subtitle);
  g.dispose();

  // ---------------------------------------------------------------- Kein Eintrag doppelt pro Abend
  console.log('\nPro Abend');
  const t2 = setup(4);
  const seen2: string[] = [];
  while (t2.st().sub !== 'over') {
    if (t2.st().sub === 'write') seen2.push(t2.st().prompt);
    t2.g.skip();
  }
  ok('Zweites Spiel: keine Frage aus dem ersten', !seen2.some((p) => prompts.includes(p)), seen2.join(' | '));
  eq('Ohne Lügen: Haus-Lügen füllen auf, nur die Wahrheit wird aufgedeckt', t2.st().stepCount, 1);
  t2.g.dispose();
  lexResetAbend();
  const all = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const tt = setup(9);
    while (tt.st().sub !== 'over') {
      if (tt.st().sub === 'write') all.add(tt.st().prompt);
      tt.g.skip();
    }
    tt.g.dispose();
    if (all.size >= LEX_ENTRIES.length) break;
  }
  eq('Alle Einträge kommen dran, bevor sich einer wiederholt', all.size, LEX_ENTRIES.length);
  const picked = lexPick(5);
  eq('Danach geht es von vorn los', picked.length, 5);
  ok('Kategorien wechseln sich ab', picked.every((p, i) => i === 0 || p.cat !== picked[i - 1].cat || picked.slice(i).every((x) => x.cat === p.cat)));

  // ---------------------------------------------------------------- Spielerzahlen + Spielbrett
  console.log('\nSpielerzahlen');
  {
    const t3 = setup(3);
    eq('3 Spieler: 5 Fragen', t3.st().rounds, 5);
    t3.ids.forEach((id, i) => t3.g.input(id, 'lie', { round: 1, text: `Lüge ${'xyz'[i]}` }));
    t3.g.skip();
    eq('3 Spieler: trotzdem 6 Antworten (Haus-Lügen)', t3.st().options!.length, LEXIKON.MIN_OPTIONS);
    t3.g.dispose();
  }
  {
    const t12 = setup(12);
    eq('12 Spieler: 3 Fragen', t12.st().rounds, 3);
    t12.ids.forEach((id, i) => t12.g.input(id, 'lie', { round: 1, text: `Lüge Nummer ${'abcdefghijkl'[i]}` }));
    eq('Alle fertig → geht von selbst weiter (kurz durchatmen)', t12.st().sub, 'write');
    await sleep(1000);
    eq('12 Spieler: 13 Antworten, keine Haus-Lüge', [t12.st().sub, t12.st().options!.length], ['vote', 13]);
    t12.g.dispose();
  }
  {
    eq('Einzelspiel aus der Party-Lobby: voller Rundenplan', setup(5, 'party').st().rounds, lexRounds(5));
    const tp = setup(5, 'party', true);
    eq('Spielbrett: eine Frage, kein Faktor', [tp.st().rounds, tp.st().mult], [1, 1]);
    while (tp.st().sub !== 'over') tp.g.skip();
    eq('Spielbrett: nach der Wahrheit direkt zur Auswertung', tp.st().sub, 'over');
    tp.g.dispose();
  }
})();

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(fails ? 1 : 0);
