import type { MiniCtx, MiniResult } from '../server/minigame';
import { BusfahrerGame } from '../server/busfahrer';
import {
  BUS, BUS_FRAGEN, type BusCard, type BusFrage, type BusState, type BusTipp, busAnswer, busBotTipp, busChancen, busDeck,
  busFrageText, busFragenOk, busOptions, busSips, busTippHint,
} from '../shared/busfahrer';
import { MINI_HOWTO, MINI_INFO } from '../shared/games';

/**
 * Tests ohne Browser für den Busfahrer (MiniKind `hilo`): `npm run test:busfahrer`
 * Kartenvergleiche, Schluckzahlen, „gleich“, „dazwischen/außerhalb“ (auch Karte 1 = Karte 2), „Symbol schon gesehen“,
 * angebotene Tipps, Bot-Tipps und ein kompletter Ablauf mit Schein-Spielern (Aufdecken erst, wenn alle getippt haben,
 * kein Zeitlimit, VIP überspringt, Offline-Spieler setzen aus, mehrere Durchgänge, Ergebnis).
 */
let fails = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok ' : ' FEHLER'} ${name}${cond || !info ? '' : ` – ${info}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} statt ${JSON.stringify(want)}`);

// Karten kurz schreiben: 'h7' = Herz 7, 'sA' = Pik Ass (h ♥, d ♦, c ♣, s ♠; B D K A)
const RANKS: Record<string, number> = { B: 11, D: 12, K: 13, A: 14 };
const k = (t: string): BusCard => ({ suit: 'hdcs'.indexOf(t[0]), rank: RANKS[t.slice(1)] ?? Number(t.slice(1)) });
const ks = (...t: string[]) => t.map(k);

// ---------------------------------------------------------------- Grundlagen
{
  console.log('\nGrundlagen');
  eq('Vier Karten: Rot/Schwarz, Höher/Tiefer, Dazwischen, Symbol', BUS.FRAGEN, ['farbe', 'hoehe', 'zwischen', 'symbol']);
  ok('Reihenfolge der Fragen gültig', busFragenOk(BUS.FRAGEN));
  ok('„Dazwischen“ als erste Karte geht nicht', !busFragenOk(['zwischen', 'farbe']));
  ok('„Höher“ braucht eine Karte davor', !busFragenOk(['hoehe']));
  eq('Ein Durchgang als Standard', BUS.DURCHGAENGE, 1);
  eq('Kein Zeitlimit beim Tippen', BUS.GUESS_MS, null);
  const deck = busDeck();
  eq('Stapel: 52 Karten', deck.length, 52);
  eq('Stapel: keine doppelten', new Set(deck.map((c) => `${c.suit}-${c.rank}`)).size, 52);
  eq('Werte 2 … 14 (Ass hoch)', [Math.min(...deck.map((c) => c.rank)), Math.max(...deck.map((c) => c.rank))], [2, 14]);
  eq('Titel „Busfahrer“', MINI_INFO.hilo.title, 'Busfahrer');
  ok('Regelkarte erwähnt die Schlücke', MINI_HOWTO.hilo.controls.some((c) => c.text.includes('1, 2, 3, 4')));
}

// ---------------------------------------------------------------- Karte 1: Rot oder Schwarz
{
  console.log('\nKarte 1 – Rot oder Schwarz (1 Schluck)');
  eq('Herz ist rot', busAnswer('farbe', [], k('h5')), 'rot');
  eq('Karo ist rot', busAnswer('farbe', [], k('dK')), 'rot');
  eq('Kreuz ist schwarz', busAnswer('farbe', [], k('c2')), 'schwarz');
  eq('Pik ist schwarz', busAnswer('farbe', [], k('sA')), 'schwarz');
  eq('Optionen', busOptions('farbe', []), ['rot', 'schwarz']);
  eq('Richtig = 0', busSips(0, 'rot', 'rot'), 0);
  eq('Falsch = 1 Schluck', busSips(0, 'schwarz', 'rot'), 1);
  eq('Kein Tipp = 1 Schluck', busSips(0, undefined, 'rot'), 1);
}

// ---------------------------------------------------------------- Karte 2: Höher, tiefer, gleich
{
  console.log('\nKarte 2 – Höher, tiefer oder gleich (2 Schlücke)');
  const c = ks('h7');
  eq('9 nach 7: höher', busAnswer('hoehe', c, k('s9')), 'hoeher');
  eq('3 nach 7: tiefer', busAnswer('hoehe', c, k('d3')), 'tiefer');
  eq('7 nach 7: gleich (Symbol egal)', busAnswer('hoehe', c, k('c7')), 'gleich');
  eq('Ass schlägt König', busAnswer('hoehe', ks('cK'), k('hA')), 'hoeher');
  eq('Bube unter Dame', busAnswer('hoehe', ks('cD'), k('hB')), 'tiefer');
  eq('10 unter Bube', busAnswer('hoehe', ks('cB'), k('h10')), 'tiefer');
  eq('Optionen mit „gleich“', busOptions('hoehe', c), ['hoeher', 'gleich', 'tiefer']);
  eq('Gegen Ass kein „höher“', busOptions('hoehe', ks('sA')), ['gleich', 'tiefer']);
  eq('Gegen 2 kein „tiefer“', busOptions('hoehe', ks('s2')), ['hoeher', 'gleich']);
  eq('Falsch = 2 Schlücke', busSips(1, 'tiefer', 'hoeher'), 2);
  eq('„Gleich“ getippt, höher gekommen = 2 Schlücke', busSips(1, 'gleich', 'hoeher'), 2);
  eq('Frage nennt die Vergleichskarte', busFrageText('hoehe', c), 'Höher oder tiefer als die 7 – oder gleich?');
  eq('… auch bei Bildern', busFrageText('hoehe', ks('cD')), 'Höher oder tiefer als die Dame – oder gleich?');
  eq('… gegen Ass nur tiefer', busFrageText('hoehe', ks('cA')), 'Tiefer als das Ass – oder gleich?');
}

// ---------------------------------------------------------------- Karte 3: Dazwischen, außerhalb, gleich
{
  console.log('\nKarte 3 – Dazwischen, außerhalb oder gleich (3 Schlücke)');
  const c = ks('h4', 'sB');
  eq('8 zwischen 4 und B', busAnswer('zwischen', c, k('d8')), 'zwischen');
  eq('2 außerhalb', busAnswer('zwischen', c, k('c2')), 'ausserhalb');
  eq('Ass außerhalb', busAnswer('zwischen', c, k('cA')), 'ausserhalb');
  eq('4 = untere Grenze: gleich', busAnswer('zwischen', c, k('c4')), 'gleich');
  eq('B = obere Grenze: gleich', busAnswer('zwischen', c, k('dB')), 'gleich');
  eq('Reihenfolge der Grenzen egal (B vor 4)', busAnswer('zwischen', ks('sB', 'h4'), k('d8')), 'zwischen');
  eq('Optionen', busOptions('zwischen', c), ['zwischen', 'gleich', 'ausserhalb']);
  eq('Falsch = 3 Schlücke', busSips(2, 'zwischen', 'gleich'), 3);
  eq('Frage nennt die Grenzen', busFrageText('zwischen', c), 'Zwischen 4 und Bube, außerhalb oder gleich?');
  // Sonderfall Karte 1 = Karte 2
  const same = ks('h9', 'c9');
  eq('Karte 1 = Karte 2: kein „dazwischen“', busOptions('zwischen', same), ['gleich', 'ausserhalb']);
  eq('… 9 ist gleich', busAnswer('zwischen', same, k('s9')), 'gleich');
  eq('… alles andere außerhalb', [busAnswer('zwischen', same, k('s2')), busAnswer('zwischen', same, k('sA'))], ['ausserhalb', 'ausserhalb']);
  eq('… Frage ohne „dazwischen“', busFrageText('zwischen', same), 'Außerhalb oder gleich (9)?');
  eq('… Hinweis „alles außer 9“', busTippHint('zwischen', 'ausserhalb', same), 'alles außer 9');
  // Nachbarn: nichts liegt dazwischen
  eq('7 und 8: kein „dazwischen“', busOptions('zwischen', ks('h7', 'c8')), ['gleich', 'ausserhalb']);
  eq('7 und 9: nur die 8 liegt dazwischen', busTippHint('zwischen', 'zwischen', ks('h7', 'c9')), 'nur 8');
  // 2 und Ass: nichts liegt außerhalb
  eq('2 und Ass: kein „außerhalb“', busOptions('zwischen', ks('h2', 'cA')), ['zwischen', 'gleich']);
  eq('… Frage ohne „außerhalb“', busFrageText('zwischen', ks('h2', 'cA')), 'Dazwischen oder gleich (2 / Ass)?');
  eq('Grenzen = Karte 1 und 2 (die letzten beiden)', busAnswer('zwischen', ks('h3', 'cD'), k('s5')), 'zwischen');
}

// ---------------------------------------------------------------- Karte 4: Symbol schon gehabt?
{
  console.log('\nKarte 4 – Symbol schon dabei? (4 Schlücke)');
  const c = ks('h4', 'sB', 'h9');
  eq('Herz lag schon: ja', busAnswer('symbol', c, k('hK')), 'ja');
  eq('Pik lag schon: ja', busAnswer('symbol', c, k('s2')), 'ja');
  eq('Karo ist neu: nein', busAnswer('symbol', c, k('d7')), 'nein');
  eq('Kreuz ist neu: nein', busAnswer('symbol', c, k('c7')), 'nein');
  eq('Optionen', busOptions('symbol', c), ['ja', 'nein']);
  eq('Falsch = 4 Schlücke', busSips(3, 'nein', 'ja'), 4);
  eq('Hinweis „ja“ zeigt die gesehenen Symbole', busTippHint('symbol', 'ja', c), '♥ ♠');
  eq('Hinweis „nein“ die fehlenden', busTippHint('symbol', 'nein', c), '♦ ♣');
}

// ---------------------------------------------------------------- Chancen und Bots
{
  console.log('\nChancen und Bots');
  const cases: [BusFrage, BusCard[]][] = [
    ['farbe', []], ['hoehe', ks('h7')], ['hoehe', ks('hA')], ['hoehe', ks('h2')], ['zwischen', ks('h4', 'sB')],
    ['zwischen', ks('h9', 'c9')], ['zwischen', ks('h7', 'c8')], ['zwischen', ks('h2', 'cA')], ['symbol', ks('h4', 'sB', 'h9')], ['symbol', ks('h4', 'h5', 'h9')],
  ];
  const bad: string[] = [];
  for (const [f, c] of cases) {
    const ch = busChancen(f, c);
    const sum = Object.values(ch).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) bad.push(`${f} ${JSON.stringify(c)}: Summe ${sum}`);
    for (const t of BUS_FRAGEN[f].tipps) {
      const offered = busOptions(f, c).includes(t);
      if (offered !== ch[t] > 0) bad.push(`${f} ${JSON.stringify(c)}: ${t} ${offered ? 'angeboten, aber unmöglich' : 'möglich, aber nicht angeboten'}`);
    }
  }
  ok('Angeboten wird genau, was möglich ist; Chancen ergeben 1', !bad.length, bad.join('; '));
  eq('Gleiche Werte: „gleich“ = 2 von 50 Karten', +busChancen('zwischen', ks('h9', 'c9')).gleich.toFixed(4), +(2 / 50).toFixed(4));
  eq('Rot/Schwarz 50:50', busChancen('farbe', []), { rot: 0.5, schwarz: 0.5 });
  let r = 0;
  const seq = [0.9, 0.1, 0.9, 0.1, 0.9, 0.1];
  const rnd = () => seq[r++ % seq.length];
  eq('Bot nimmt meist das Wahrscheinlichste (gegen 3: höher)', busBotTipp('hoehe', ks('h3'), busOptions('hoehe', ks('h3')), () => 0.9), 'hoeher');
  eq('… gegen König: tiefer', busBotTipp('hoehe', ks('hK'), busOptions('hoehe', ks('hK')), () => 0.9), 'tiefer');
  eq('… 3 bis K: dazwischen', busBotTipp('zwischen', ks('h3', 'cK'), busOptions('zwischen', ks('h3', 'cK')), () => 0.9), 'zwischen');
  eq('… 7 bis 9: außerhalb', busBotTipp('zwischen', ks('h7', 'c9'), busOptions('zwischen', ks('h7', 'c9')), () => 0.9), 'ausserhalb');
  eq('… drei Herzen: Symbol neu (nein)', busBotTipp('symbol', ks('h4', 'h5', 'h9'), ['ja', 'nein'], () => 0.9), 'nein');
  const tipps = new Set<BusTipp>();
  for (let i = 0; i < 6; i++) tipps.add(busBotTipp('hoehe', ks('h8'), busOptions('hoehe', ks('h8')), rnd));
  ok('Bot-Tipps sind immer angebotene', [...tipps].every((t) => busOptions('hoehe', ks('h8')).includes(t)), [...tipps].join(','));
}

// ---------------------------------------------------------------- Ablauf mit Schein-Spielern
function setup(n: number, deck: string[], opts: { passes?: number; online?: Set<string> } = {}) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const online = opts.online ?? new Set(ids);
  const out: { result: MiniResult | null; changes: number } = { result: null, changes: 0 };
  const ctx: MiniCtx = { onChange: () => out.changes++, finish: (r) => (out.result = r), isConnected: (id) => online.has(id), nameOf: (id) => id.toUpperCase(), mode: 'drink' };
  const g = new BusfahrerGame(ids, ctx, { passes: opts.passes, deck: () => ks(...deck) });
  const st = () => g.snapshot().state as BusState;
  const tip = (id: string, tipp: BusTipp) => g.input(id, 'guess', { round: st().round, tipp });
  return { ids, g, st, tip, out, online };
}

{
  console.log('\nAblauf (3 Spieler, Trinkrunde)');
  // Karten: ♥7, ♠9, ♦B, ♣5
  const t = setup(3, ['h7', 's9', 'dB', 'c5']);
  const { g, st, tip, out } = t;
  eq('Start: Karte 1, Tippen, keine Karte offen', [st().sub, st().step, st().round, st().rounds, st().cards.length], ['guess', 0, 1, 4, 0]);
  eq('Kein Zeitlimit (endsIn 0)', st().endsIn, 0);
  eq('Optionen Karte 1', st().options, ['rot', 'schwarz']);
  ok('Snapshot verrät keine Karte vorab', !JSON.stringify(st()).includes('"rank"'));
  tip('p0', 'rot');
  tip('p0', 'schwarz');
  eq('Tipp gilt, zweiter Tipp wird ignoriert', st().chosen, ['p0']);
  g.input('p1', 'guess', { round: st().round, tipp: 'hoeher' });
  eq('Unpassender Tipp wird ignoriert', st().chosen, ['p0']);
  g.input('p1', 'guess', { round: 99, tipp: 'rot' });
  eq('Tipp für eine andere Karte wird ignoriert', st().chosen, ['p0']);
  g.input('zz', 'guess', { round: st().round, tipp: 'rot' });
  eq('Fremde ID wird ignoriert', st().chosen, ['p0']);
  tip('p1', 'schwarz');
  eq('Noch nicht alle → noch verdeckt', st().sub, 'guess');
  ok('VIP kann aufdecken', g.skippable()?.label === 'P2s Tipp überspringen', g.skippable()?.label);
  tip('p2', 'rot');
  eq('Alle getippt → aufgedeckt', [st().sub, st().cards.length, st().answer], ['reveal', 1, 'rot']);
  eq('Falsch = 1 Schluck, richtig = 0', st().roundSips, { p0: 0, p1: 1, p2: 0 });
  eq('Tipps sichtbar nach dem Aufdecken', st().guesses, { p0: 'rot', p1: 'schwarz', p2: 'rot' });
  eq('Auflösung als Satz', st().answerText, 'Herz ist rot');
  ok('Auflösung schaltet von selbst weiter (Timer)', st().endsIn > 0);
  eq('VIP: „Nächste Karte“', g.skippable(), { label: 'Nächste Karte', info: true });
  g.skip();
  eq('Karte 2: Höher/Tiefer gegen ♥7', [st().sub, st().step, st().options], ['guess', 1, ['hoeher', 'gleich', 'tiefer']]);
  tip('p0', 'hoeher');
  tip('p1', 'gleich');
  tip('p2', 'tiefer');
  eq('♠9 ist höher: Falsche trinken 2', [st().answer, st().roundSips], ['hoeher', { p0: 0, p1: 2, p2: 2 }]);
  g.skip();
  eq('Karte 3: zwischen 7 und 9', [st().step, st().options], [2, ['zwischen', 'gleich', 'ausserhalb']]);
  tip('p0', 'zwischen');
  // p1 tippt nicht, VIP deckt auf → p1 trinkt
  tip('p2', 'ausserhalb');
  g.skip();
  eq('♦B außerhalb: Falsche + Nicht-Tipper trinken 3', [st().answer, st().roundSips], ['ausserhalb', { p0: 3, p1: 3, p2: 0 }]);
  g.skip();
  eq('Karte 4: Symbol schon dabei?', [st().step, st().options], [3, ['ja', 'nein']]);
  // p2 geht offline ohne Tipp → setzt aus, die anderen reichen zum Aufdecken
  t.online.delete('p2');
  tip('p0', 'ja');
  tip('p1', 'nein');
  eq('Offline-Spieler blockiert nicht', st().sub, 'reveal');
  eq('♣5 ist neu: „ja“ trinkt 4, Offline setzt aus', [st().answer, st().roundSips, st().out], ['nein', { p0: 4, p1: 0, p2: 0 }, ['p2']]);
  eq('Summen', st().sips, { p0: 7, p1: 6, p2: 2 });
  eq('Letzte Auflösung: „Zur Zusammenfassung“', g.skippable()?.label, 'Zur Zusammenfassung');
  g.skip();
  eq('Zusammenfassung', [st().sub, st().cards.length], ['over', 4]);
  eq('VIP: „Zum Ergebnis“', g.skippable()?.label, 'Zum Ergebnis');
  ok('Noch kein Ergebnis', out.result === null);
  g.skip();
  const r = out.result!;
  ok('Ergebnis gemeldet', !!r);
  eq('Schlücke im Ergebnis', r.sips, { p0: 7, p1: 6, p2: 2 });
  eq('Gruppen: meiste Schlücke zuerst (Raum dreht für die Wertung um)', r.groups, [['p0'], ['p1'], ['p2']]);
  eq('Details', r.details, { p0: '7 Schlücke', p1: '6 Schlücke', p2: '2 Schlücke' });
  eq('Untertitel nennt den Busfahrer', r.subtitle, 'P0 fährt den Bus (7 Schlücke).');
  g.dispose();
}

{
  console.log('\nSonderfälle');
  // Karte 1 = Karte 2: ♥9, ♣9 → Karte 3 ohne „dazwischen“
  const t = setup(2, ['h9', 'c9', 's9', 'd2']);
  const { g, st, tip } = t;
  tip('p0', 'rot');
  tip('p1', 'rot');
  g.skip();
  tip('p0', 'gleich');
  tip('p1', 'hoeher');
  eq('♣9 nach ♥9: gleich', [st().answer, st().roundSips], ['gleich', { p0: 0, p1: 2 }]);
  g.skip();
  eq('Karte 3 nach zwei Neunen: nur außerhalb/gleich', st().options, ['gleich', 'ausserhalb']);
  tip('p0', 'gleich');
  tip('p1', 'ausserhalb');
  eq('Dritte 9: gleich', [st().answer, st().roundSips], ['gleich', { p0: 0, p1: 3 }]);
  g.skip();
  tip('p0', 'ja');
  tip('p1', 'nein');
  eq('Karo nach ♥♣♠: neu', [st().answer, st().roundSips], ['nein', { p0: 4, p1: 0 }]);
  g.dispose();

  // Alle offline: nichts wird automatisch aufgedeckt, keiner trinkt ungefragt
  const t2 = setup(2, ['h9', 'c9', 's9', 'd2']);
  t2.online.clear();
  t2.g.playerDisconnected('p0');
  eq('Ohne Verbundene wird nicht von selbst aufgedeckt', t2.st().sub, 'guess');
  t2.g.skip();
  eq('VIP deckt auf: Offline ohne Tipp setzen aus', [t2.st().roundSips, t2.st().out], [{ p0: 0, p1: 0 }, ['p0', 'p1']]);
  t2.g.dispose();

  // Keiner trinkt
  const t3 = setup(2, ['h9', 'cK', 's3', 'h2']);
  for (const tipps of [['rot', 'rot'], ['hoeher', 'hoeher'], ['ausserhalb', 'ausserhalb'], ['ja', 'ja']] as BusTipp[][]) {
    t3.tip('p0', tipps[0]);
    t3.tip('p1', tipps[1]);
    t3.g.skip();
  }
  t3.g.skip();
  eq('Alle richtig: keiner trinkt', t3.out.result?.sips, { p0: 0, p1: 0 });
  eq('… Untertitel', t3.out.result?.subtitle, 'Keiner musste trinken – der Bus fährt nüchtern weiter!');
  t3.g.dispose();

  // Zwei Durchgänge: frischer Stapel, Karten von vorn
  const t4 = setup(2, ['h9', 'cK', 's3', 'h2'], { passes: 2 });
  eq('Zwei Durchgänge: 8 Karten', t4.st().rounds, 8);
  for (let i = 0; i < 4; i++) {
    t4.tip('p0', t4.st().options[0]);
    t4.tip('p1', t4.st().options[0]);
    t4.g.skip();
  }
  eq('Nach Karte 4: Durchgang 2 beginnt mit leerem Tisch', [t4.st().sub, t4.st().pass, t4.st().step, t4.st().cards.length, t4.st().round], ['guess', 2, 0, 0, 5]);
  for (let i = 0; i < 4; i++) {
    t4.tip('p0', t4.st().options[0]);
    t4.tip('p1', t4.st().options[0]);
    t4.g.skip();
  }
  eq('Danach Zusammenfassung', t4.st().sub, 'over');
  t4.g.dispose();
}

console.log(fails ? `\n${fails} Fehler` : '\nAlles ok');
process.exit(fails ? 1 : 0);
