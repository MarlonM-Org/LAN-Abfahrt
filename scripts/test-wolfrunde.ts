import type { MiniResult } from '../server/minigame';
import { WolfrundeGame } from '../server/wolfrunde';
import { WR_ROLES, type WrConfig, type WrPrivate, type WrRole, type WrState, wrDeck, wrDefaultConfig, wrFits, wrFixConfig, wrWakeOrder } from '../shared/wolfrunde';

/**
 * Tests ohne Browser für Werwolf mit Erzähler: `npm run test:wolfrunde`
 * Stapel-Regeln, Geheimhaltung (TV/Snapshot ohne Karten, jeder nur seine, Erzähler alle), Dieb, Totenkopf,
 * Neu verteilen und das Ergebnis.
 */
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ok ' : ' FEHLER'} ${name}${ok ? '' : ` – ${JSON.stringify(got)} statt ${JSON.stringify(want)}`}`);
};
const count = (deck: WrRole[], r: WrRole) => deck.filter((x) => x === r).length;

// ---------------------------------------------------------------- Stapel
eq('Vorschlag 4 Spieler: 1 Wolf, Seher, Hexe', wrDefaultConfig(4), { wolves: 1, specials: ['seher', 'hexe'] });
eq('Vorschlag 7 Spieler: 2 Wölfe + Jäger + Amor', wrDefaultConfig(7), { wolves: 2, specials: ['seher', 'hexe', 'jaeger', 'amor'] });
eq('Vorschlag 11 Spieler: 3 Wölfe + Mädchen', wrDefaultConfig(11), { wolves: 3, specials: ['seher', 'hexe', 'jaeger', 'amor', 'maedchen'] });
eq('Zu viele Wölfe werden gekappt (6 → max. 2)', wrFixConfig({ wolves: 5, specials: [] }, 6).wolves, 2);
eq('Mindestens 1 Wolf', wrFixConfig({ wolves: 0, specials: [] }, 6).wolves, 1);
eq('Zu viele Sonderrollen: hinterste (außer Dieb) fliegt raus', wrFixConfig({ wolves: 1, specials: ['seher', 'hexe', 'jaeger', 'amor', 'maedchen'] }, 4).specials, ['seher', 'hexe', 'jaeger']);
eq('Mit Dieb passen 2 Karten mehr', wrFixConfig({ wolves: 1, specials: ['seher', 'hexe', 'jaeger', 'amor', 'dieb'] }, 4).specials, ['seher', 'hexe', 'jaeger', 'amor', 'dieb']);
eq('wrFits: 5. Karte bei 4 Spielern passt nicht', wrFits({ wolves: 1, specials: ['seher', 'hexe', 'jaeger'] }, 4, { role: 'amor' }), false);
eq('wrFits: mit Dieb schon', wrFits({ wolves: 1, specials: ['seher', 'hexe', 'jaeger'] }, 4, { role: 'dieb' }), true);
const deck = wrDeck({ wolves: 2, specials: ['seher', 'dieb'] }, 6);
eq('Stapel mit Dieb: 6 + 2 Karten', deck.length, 8);
eq('Stapel: 2 Wölfe, 4 Dorfbewohner', [count(deck, 'werwolf'), count(deck, 'dorf')], [2, 4]);
eq('Weckreihenfolge 1. Nacht', wrWakeOrder({ wolves: 1, specials: ['seher', 'hexe', 'amor', 'dieb', 'maedchen'] }, true), ['Dieb', 'Amor', 'Verliebte', 'Seher', 'Werwölfe 👧', 'Hexe']);
eq('Weckreihenfolge danach', wrWakeOrder({ wolves: 1, specials: ['seher', 'hexe', 'amor', 'dieb'] }, false), ['Seher', 'Werwölfe', 'Hexe']);

// ---------------------------------------------------------------- Spiel
function setup(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const out: { result: MiniResult | null; changes: number; gone: Set<string> } = { result: null, changes: 0, gone: new Set() };
  const g = new WolfrundeGame(ids, {
    onChange: () => out.changes++,
    finish: (r) => (out.result = r),
    isConnected: () => true,
    isGone: (id) => out.gone.has(id),
    nameOf: (id) => id,
    mode: 'arcade',
  });
  const st = () => g.snapshot().state as WrState;
  const pv = (id: string) => {
    const p = g.privateFor(id);
    return p?.kind === 'wolfrunde' ? (p.state as WrPrivate) : null;
  };
  return { ids, g, st, pv, out };
}

{
  const { ids, g, st, pv } = setup(8);
  eq('Start: kein Erzähler', st().narrator, null);
  g.input('p0', 'deal', {});
  eq('Ohne Erzähler kann niemand austeilen', st().sub, 'setup');
  g.vipAction('narrator:nobody');
  eq('Unbekannte ID wird ignoriert', st().narrator, null);
  g.vipAction('narrator:p3');
  eq('VIP wählt p3', st().narrator, 'p3');
  eq('Erzähler bekommt keine Karte', st().players.includes('p3'), false);
  g.input('p1', 'config', { wolves: 3 });
  eq('Nur der Erzähler stellt den Stapel ein', st().config.wolves, wrDefaultConfig(7).wolves);
  g.input('p3', 'config', { wolves: 3 });
  g.input('p3', 'config', { toggle: 'dieb' });
  g.input('p3', 'config', { toggle: 'jaeger' });
  eq('Erzähler stellt ein (3 Wölfe, Dieb dazu, Jäger raus)', st().config, { wolves: 3, specials: ['seher', 'hexe', 'amor', 'dieb'] } satisfies WrConfig);
  g.vipAction('narrator:p3');
  g.input('p3', 'deal', {});
  const s = st();
  eq('Ausgeteilt', [s.sub, s.deal, s.players.length], ['play', 1, 7]);
  eq('TV/Snapshot ohne Karten', JSON.stringify({ ...s, config: null }).match(/werwolf|seher|hexe|amor|dieb|dorf"/g), null);
  eq('Snapshot: roles erst am Ende', s.roles, null);
  const book = pv('p3')!.book!;
  eq('Erzähler sieht alle 7 Karten', Object.keys(book.cards).length, 7);
  eq('Erzähler hat selbst keine Karte', pv('p3')!.card, null);
  const all = [...Object.values(book.cards), ...book.rest];
  eq('Karten + Rest = kompletter Stapel', [count(all, 'werwolf'), count(all, 'dieb'), all.length], [3, 1, 9]);
  for (const id of s.players) {
    const p = pv(id)!;
    if (p.card !== book.cards[id] || p.book) eq(`${id} sieht nur die eigene Karte`, [p.card, !!p.book], [book.cards[id], false]);
  }
  eq('Spieler sehen nur ihre eigene Karte', s.players.every((id) => pv(id)!.card === book.cards[id] && !pv(id)!.book), true);
  g.vipAction('narrator:p0');
  eq('Nach dem Austeilen lässt sich der Erzähler nicht mehr wechseln', st().narrator, 'p3');

  // Dieb (falls er im Spiel ist und nicht im Rest liegt)
  if (book.dieb) {
    const d = book.dieb;
    eq('Dieb sieht die zwei übrigen Karten', pv(d)!.steal, book.rest);
    const other = s.players.find((id) => id !== d)!;
    g.input(other, 'steal', { pick: 0 });
    eq('Nur der Dieb darf tauschen', pv('p3')!.book!.stolen, false);
    const take = book.rest[0];
    g.input(d, 'steal', { pick: 0 });
    eq('Dieb tauscht: neue Karte', [pv(d)!.card, pv(d)!.wasDieb, pv(d)!.steal], [take, take !== 'dieb', null]);
    eq('Im Rest liegt jetzt der Dieb', pv('p3')!.book!.rest[0], 'dieb');
    g.input(d, 'steal', { pick: 1 });
    eq('Nur ein Tausch', pv(d)!.card, take);
  } else console.log('  (Dieb liegt diesmal im Rest – Tausch-Test übersprungen)');

  // Totenkopf + Wiederbeleben
  const victim = s.players[0];
  g.input('p3', 'kill', { target: victim, alive: false });
  eq('💀 markiert tot', st().alive[victim], false);
  g.input(s.players[1], 'kill', { target: s.players[2], alive: false });
  eq('Nur der Erzähler markiert Tote', st().alive[s.players[2]], true);
  g.input('p3', 'kill', { target: victim });
  eq('Nochmal tippen = wiederbeleben', st().alive[victim], true);
  g.input('p3', 'kill', { target: 'p3', alive: false });
  eq('Erzähler selbst ist nicht in der Liste', st().alive.p3, undefined);

  // Nacht/Tag
  g.input('p3', 'time', { to: 'night' });
  eq('Nacht 1', [st().time, st().round], ['night', 1]);
  g.input('p3', 'time', { to: 'day' });
  g.input('p3', 'time', { to: 'night' });
  eq('Tag 1 → Nacht 2', [st().time, st().round], ['night', 2]);

  // Neu verteilen
  g.input('p3', 'redeal', {});
  eq('Neu verteilen → zurück zur Auswahl, Karten weg', [st().sub, pv(ids[0])], ['setup', null]);
  g.input('p3', 'deal', {});
  eq('Wieder ausgeteilt (deal 3)', [st().sub, st().deal, st().round, Object.values(st().alive).every(Boolean)], ['play', 3, 0, true]);
}

{
  // Dieb mit zwei Werwölfen im Rest muss einen nehmen – Stapel so oft mischen, bis es passt
  let tested = false;
  for (let i = 0; i < 400 && !tested; i++) {
    const { g, pv } = setup(7);
    g.vipAction('narrator:p0');
    g.input('p0', 'config', { wolves: 2 });
    g.input('p0', 'config', { toggle: 'dieb' });
    g.input('p0', 'deal', {});
    const book = pv('p0')!.book!;
    if (!book.dieb || !book.rest.every((r) => r === 'werwolf')) continue;
    tested = true;
    g.input(book.dieb, 'steal', { pick: -1 });
    eq('Zwei Werwölfe übrig: Behalten geht nicht', pv(book.dieb)!.card, 'dieb');
    g.input(book.dieb, 'steal', { pick: 1 });
    eq('… er muss einen Werwolf nehmen', pv(book.dieb)!.card, 'werwolf');
  }
  eq('Fall „zwei Werwölfe übrig“ wurde getestet', tested, true);
}

{
  // Ergebnis: Werwölfe gewinnen → Wölfe in Gruppe 1, Erzähler gar nicht
  const { g, st, pv, out } = setup(7);
  g.vipAction('narrator:p6');
  g.input('p6', 'deal', {});
  const cards = pv('p6')!.book!.cards;
  const dead = st().players.find((id) => cards[id] !== 'werwolf')!;
  g.input('p6', 'kill', { target: dead, alive: false });
  g.input('p6', 'end', { winner: 'wolf' });
  eq('Ende: Phase over, Karten jetzt öffentlich', [st().sub, Object.keys(st().roles ?? {}).length], ['over', 6]);
  (g as unknown as { finish(): void }).finish();
  const r = out.result!;
  const wolves = st().players.filter((id) => WR_ROLES[cards[id]].team === 'wolf');
  eq('Sieger = alle Werwölfe', [...r.groups[0]].sort(), [...wolves].sort());
  eq('Erzähler steht nicht im Ergebnis', r.groups.flat().includes('p6'), false);
  eq('Details: Rolle + tot', r.details[dead], `${WR_ROLES[cards[dead]].name} · tot`);
  eq('Untertitel', r.subtitle, 'Die Werwölfe gewinnen!');
  g.dispose();
}

{
  // Verliebte gewinnen = alle, die noch leben
  const { g, st, out } = setup(6);
  g.vipAction('narrator:p0');
  g.input('p0', 'deal', {});
  const players = st().players;
  for (const id of players.slice(2)) g.input('p0', 'kill', { target: id, alive: false });
  g.input('p0', 'end', { winner: 'liebe' });
  (g as unknown as { finish(): void }).finish();
  eq('Verliebte: Sieger sind die zwei Überlebenden', [...out.result!.groups[0]].sort(), [...players.slice(0, 2)].sort());
  g.dispose();
}

{
  // „Nochmal“: letzter Erzähler und Stapel sind vorausgewählt (Stapel nur bei gleicher Spielerzahl)
  const a = setup(7);
  a.g.vipAction('narrator:p2');
  a.g.input('p2', 'config', { toggle: 'dieb' });
  a.g.input('p2', 'deal', {});
  const b = setup(7);
  eq('Nochmal: letzter Erzähler + Stapel vorausgewählt', [b.st().narrator, b.st().config], ['p2', a.st().config]);
  const c = setup(10);
  eq('Andere Spielerzahl: Erzähler ja, Stapel neu vorgeschlagen', [c.st().narrator, c.st().config], ['p2', wrDefaultConfig(9)]);
}

{
  // Entfernte Spieler bekommen beim Austeilen keine Karte
  const { g, st, out } = setup(6);
  out.gone.add('p5');
  g.vipAction('narrator:p0');
  g.input('p0', 'deal', {});
  eq('Entfernter Spieler ohne Karte', st().players.includes('p5'), false);
  const few = setup(5);
  few.out.gone.add('p4');
  few.g.vipAction('narrator:p0');
  few.g.input('p0', 'deal', {});
  eq('Unter 4 Karten wird nicht ausgeteilt', few.st().sub, 'setup');
}

console.log(fails ? `\n${fails} Fehler` : '\nAlles ok');
process.exit(fails ? 1 : 0);
