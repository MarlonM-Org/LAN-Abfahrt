/**
 * Tests ohne Browser für Darts (301 Single Out): Ring-/Segmenterkennung mit bekannten Koordinaten, Atmen des
 * Fadenkreuzes, Landepunkt = Fadenkreuz, Checkout-Wege, Zielen am Handy (Ziehen/Sensor) und der komplette Ablauf:
 * 301-Abzug, Überworfen, Single-Out-Finish, Gleichstand in einer Runde, Rundenlimit, automatische Würfe nur für
 * Abwesende. Aufruf: `npm run test:darts`
 */
import {
  DARTS,
  DART_SEGMENTS,
  type DartAimRing,
  type DartsState,
  dartsAimFor,
  dartsApply,
  dartsBump,
  dartsCalm,
  dartsCheckout,
  dartsCheckoutText,
  dartsCross,
  dartsPhase,
  dartsScore,
  dartsTarget,
  dartsWobble,
} from '../shared/darts';
import { DartsGame, resolveDart } from '../server/darts';
import type { MiniCtx, MiniResult } from '../server/minigame';
import { AimTrail, DARTS_AIM, dragToMm, sensorAim } from '../client/controller/dartsThrow';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Punkt in Polarkoordinaten: Winkel in Grad ab oben im Uhrzeigersinn, Radius in mm */
const polar = (deg: number, r: number) => ({ x: Math.sin((deg * Math.PI) / 180) * r, y: -Math.cos((deg * Math.PI) / 180) * r });

console.log('Wertung (bekannte Koordinaten)');
const cases: [string, { x: number; y: number }, string, number][] = [
  ['Mitte', { x: 0, y: 0 }, 'BULLSEYE', 50],
  ['Bull-Rand innen', { x: 6.3, y: 0 }, 'BULLSEYE', 50],
  ['Single Bull', { x: 0, y: -10 }, 'BULL 25', 25],
  ['Single Bull Rand', { x: 0, y: 15.9 }, 'BULL 25', 25],
  ['20 oben (innen)', { x: 0, y: -50 }, '20', 20],
  ['Triple 20', { x: 0, y: -103 }, 'TRIPLE 20', 60],
  ['Triple-Ring innen (99)', { x: 0, y: -99 }, 'TRIPLE 20', 60],
  ['knapp innerhalb Triple (98,9)', { x: 0, y: -98.9 }, '20', 20],
  ['Triple-Ring außen (107)', { x: 0, y: -107 }, 'TRIPLE 20', 60],
  ['knapp außerhalb Triple (107,1)', { x: 0, y: -107.1 }, '20', 20],
  ['Doppel 20', { x: 0, y: -166 }, 'DOPPEL 20', 40],
  ['Doppel-Rand (170)', { x: 0, y: -170 }, 'DOPPEL 20', 40],
  ['daneben (170,1)', { x: 0, y: -170.1 }, 'DANEBEN', 0],
  ['weit daneben', { x: 200, y: 200 }, 'DANEBEN', 0],
  ['Triple 6 (rechts)', { x: 103, y: 0 }, 'TRIPLE 6', 18],
  ['Triple 3 (unten)', { x: 0, y: 103 }, 'TRIPLE 3', 9],
  ['Doppel 11 (links)', { x: -166, y: 0 }, 'DOPPEL 11', 22],
  ['20/1-Grenze: 8,9°', polar(8.9, 60), '20', 20],
  ['20/1-Grenze: 9,1°', polar(9.1, 60), '1', 1],
  ['20/5-Grenze: −8,9°', polar(-8.9, 60), '20', 20],
  ['20/5-Grenze: −9,1°', polar(-9.1, 60), '5', 5],
  ['Triple 19 (unten links, 198°)', polar(198, 103), 'TRIPLE 19', 57],
  ['Single 14 (288°)', polar(288, 130), '14', 14],
];
for (const [name, p, label, points] of cases) {
  const h = dartsScore(p);
  check(h.label === label && h.points === points, `${name}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) → ${h.label} = ${h.points} (erwartet ${label} = ${points})`);
}

console.log('Alle Segmente: Feldmitte → richtiges Feld');
let segOk = true;
for (const seg of DART_SEGMENTS) {
  for (const ring of ['single', 'double', 'triple'] as const) {
    const h = dartsScore(dartsTarget(seg, ring));
    if (h.seg !== seg || h.ring !== ring) {
      segOk = false;
      console.log(`    ${ring} ${seg} → ${h.label}`);
    }
  }
}
check(segOk, '20 Segmente × Single/Doppel/Triple');
check(dartsScore(dartsTarget(25, 'outerbull')).points === 25 && dartsScore(dartsTarget(25, 'bull')).points === 50, 'Bull 25 und Bullseye');

console.log('Atmen');
let maxW = 0;
for (let t = 0; t < 20000; t += 7) {
  const w = dartsWobble(t, 10, 1.3);
  maxW = Math.max(maxW, Math.hypot(w.x, w.y));
}
check(maxW <= 10 * Math.SQRT2 + 1e-9 && maxW > 8, `Atmen bleibt in der Amplitude (max ${maxW.toFixed(2)} mm bei 10 mm)`);
check(Math.abs(dartsCalm(DARTS.AMP_START, 60000) - DARTS.AMP_MIN) < 0.01, 'ruhig halten → Atmen sinkt auf AMP_MIN, nie darunter');
check(dartsCalm(DARTS.AMP_START, 1000) < DARTS.AMP_START, 'nach 1 s schon ruhiger');
check(dartsBump(15, 0.3) === 15 && dartsBump(15, 40.5) === 15 + 40 * DARTS.BUMP_PER_MM && dartsBump(40, 500) === DARTS.AMP_MAX, 'Zielen macht unruhiger (kleines Zittern nicht, höchstens AMP_MAX)');
const ph = dartsPhase('p1', 2);
check(ph === dartsPhase('p1', 2) && ph !== dartsPhase('p1', 3) && ph !== dartsPhase('p2', 2), 'Phase fest pro Spieler und Runde');
let movesAlways = true;
for (let t = 0; t < 30000; t += 250) {
  const a = dartsCross({ x: 0, y: -103 }, t, DARTS.AMP_MIN, ph);
  const b = dartsCross({ x: 0, y: -103 }, t + 120, DARTS.AMP_MIN, ph);
  if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) movesAlways = false;
}
check(movesAlways, 'auch ganz ruhig atmet das Fadenkreuz die ganze Zeit (bewegt sich in jeder 120-ms-Spanne)');

console.log('Landepunkt = Fadenkreuz im Moment des Loslassens');
const t0 = 1_700_000_000_000;
const thr = { n: 1, ax: 0, ay: -103, amp: 14, at: t0 + 5234 };
const a = resolveDart('p1', 2, t0, thr);
const phoneCross = dartsCross({ x: 0, y: -103 }, 5234, 14, dartsPhase('p1', 2));
check(a.land.x === phoneCross.x && a.land.y === phoneCross.y, `Server landet genau aufs Fadenkreuz, das Handy und TV zeigen (${a.land.x}, ${a.land.y}) ${a.hit.label}`);
const b = resolveDart('p1', 2, t0, { ...thr, at: thr.at + 300 });
check(b.land.x !== a.land.x || b.land.y !== a.land.y, 'anderer Moment → andere Stelle auf der Atem-Schleife');
const cheat = resolveDart('p1', 2, t0, { ...thr, amp: 0 });
const minAmp = resolveDart('p1', 2, t0, { ...thr, amp: DARTS.AMP_MIN });
check(cheat.land.x === minAmp.land.x && cheat.land.y === minAmp.land.y, 'Amplitude 0 wird auf AMP_MIN angehoben');
const wall = resolveDart('p1', 2, t0, { ...thr, ax: 900, ay: -900 });
check(Math.abs(wall.land.x) <= DARTS.WALL && Math.abs(wall.land.y) <= DARTS.WALL && wall.hit.ring === 'miss', 'Landepunkt bleibt an der Wand');

console.log('301 Single Out: Regeln und Checkout-Wege');
check(dartsApply(301, 60).rest === 241 && !dartsApply(301, 60).bust, '301 − T20 = 241');
check(dartsApply(1, 1).out && dartsApply(1, 1).rest === 0, 'Single Out: Rest 1 mit der 1 beendet');
check(dartsApply(17, 17).out, 'Single Out: jede Single beendet (17 mit der 17)');
const bust = dartsApply(40, 60);
check(bust.bust && bust.rest === 40 && !bust.out, 'unter 0 → überworfen, Stand bleibt');
const way = (r: number, d = 3) => dartsCheckout(r, d)?.map((f) => f.short).join(' ') ?? '–';
check(way(40, 1) === 'D20' && way(40) === '20 20', `40: mit 1 Dart D20, mit 3 Darts 20 · 20 (${way(40, 1)} / ${way(40)})`);
check(way(57, 1) === 'T19' && way(50, 1) === 'BULL' && way(25, 1) === '25' && way(17, 1) === '17', `ein Dart: 57 T19, 50 BULL, 25 Bull 25, 17 Single (${way(57, 1)}, ${way(50, 1)}, ${way(25, 1)}, ${way(17, 1)})`);
check(way(41, 1) === '–' && way(180) === 'T20 T20 T20' && way(181) === '–', `nicht machbar: 41 mit 1 Dart, 181; 180 = T20 T20 T20`);
let waysOk = true;
for (let r = 1; r <= 180; r++) {
  for (let d = 1; d <= 3; d++) {
    const w = dartsCheckout(r, d);
    if (w && (w.length > d || w.reduce((s, f) => s + f.points, 0) !== r)) waysOk = false;
    if (r <= 60 && d === 3 && !w) waysOk = false;
  }
}
check(waysOk, 'jeder Weg ergibt genau den Rest mit höchstens so vielen Darts; bis 60 geht es immer mit 3 Darts');
check(dartsCheckoutText(37) === '20 · 17' && dartsCheckoutText(61) === null && dartsCheckoutText(44, 1) === null, `Hinweis ab ≤ ${DARTS.HINT_FROM}: 37 → „${dartsCheckoutText(37)}“, 61 → keiner`);
const t20 = dartsTarget(20, 'triple');
const s20 = dartsTarget(20, 'single');
const aim44 = dartsAimFor(44, 1);
check(dartsAimFor(250, 3).y === t20.y && aim44.x === s20.x && aim44.y === s20.y, 'Bots: viel Rest → T20, 44 mit einem Dart → große Single 20 (Triple würde überwerfen)');

console.log('Zielen am Handy');
const slow = dragToMm(20, 0, 200);
check(slow.x / 20 < 0.6 && 8 / (slow.x / 20) >= 13, `langsam ziehen fein: ${(slow.x / 20).toFixed(2)} mm/px → Triple-Ring (8 mm) = ${Math.round(8 / (slow.x / 20))} px Fingerweg`);
const fast = dragToMm(0, 60, 16);
check(fast.y / 60 === DARTS_AIM.MAX_MM_PER_PX && 270 / DARTS_AIM.MAX_MM_PER_PX < 160, `schnell wischen weit: ${fast.y / 60} mm/px → von T20 bis D3 (270 mm) ≈ ${Math.round(270 / DARTS_AIM.MAX_MM_PER_PX)} px`);
const calib = { alpha: 350, beta: 30 };
const c0 = sensorAim({ alpha: 350, beta: 30 }, calib);
const left = sensorAim({ alpha: 0, beta: 30 }, calib); // 10° nach links (über 360/0 hinweg)
const up = sensorAim({ alpha: 350, beta: 35 }, calib);
check(c0.x === 0 && c0.y === 0, 'Sensor: kalibrierte Mitte = Bull');
check(Math.abs(left.x + 10 * DARTS_AIM.MM_PER_DEG) < 1e-9 && left.y === 0, `Sensor: 10° nach links drehen → ${left.x} mm (auch über 0°/360°)`);
check(Math.abs(up.y + 5 * DARTS_AIM.MM_PER_DEG) < 1e-9, `Sensor: Oberkante 5° heben → ${up.y} mm (nach oben)`);
check(Math.abs(sensorAim({ alpha: 290, beta: 30 }, calib).x) === DARTS_AIM.LIMIT, 'Sensor: weit gedreht → am Rand begrenzt');
const trail = new AimTrail();
trail.reset(1000, { x: 0, y: -103 });
trail.push(1050, { x: 0, y: -100 });
trail.push(1090, { x: 3, y: -95 }); // Abheben des Fingers verrutscht
check(trail.at(1115 - DARTS_AIM.RELEASE_LOOKBACK_MS)?.y === -100, 'Loslassen: es zählt die Position von kurz davor (Abheben verwackelt nicht)');
check(trail.at(500)?.y === -103, 'Verlauf kürzer als der Blick zurück → ältester Stand');

// ------------------------------------------------------------------ Ablauf

console.log('Spielablauf');
const offline = new Set<string>();
let result: MiniResult | null = null;
const ctx: MiniCtx = {
  onChange: () => undefined,
  finish: (r) => (result = r),
  isConnected: (id) => !offline.has(id),
  nameOf: (id) => id,
  isBot: () => false,
  mode: 'arcade',
};
const S = (g: DartsGame) => (g.snapshot() as { state: DartsState }).state;
const P = (g: DartsGame, id: string) => S(g).players.find((p) => p.id === id)!;
/** Feld als Zielpunkt: 'T20', 'D2', '17', 'BULL', '25', '0' (daneben) */
const field = (f: string) => {
  if (f === '0') return { x: 0, y: -210 };
  if (f === 'BULL') return dartsTarget(25, 'bull');
  if (f === '25') return dartsTarget(25, 'outerbull');
  const ring: DartAimRing = f.startsWith('T') ? 'triple' : f.startsWith('D') ? 'double' : 'single';
  return dartsTarget(Number(f.replace(/^[TD]/, '')), ring);
};
/** Wirft genau aufs Feld: Zielpunkt so gewählt, dass Zielpunkt + Atmen im Wurf-Moment die Feldmitte trifft */
const hit = (g: DartsGame, id: string, f: string, n = P(g, id).thrown) => {
  const st = S(g);
  const at = Date.now();
  const w = dartsWobble(at - st.t0, DARTS.AMP_MIN, dartsPhase(id, st.round));
  const t = field(f);
  g.input(id, 'throw', { n, ax: t.x - w.x, ay: t.y - w.y, amp: DARTS.AMP_MIN, at });
};
const throwAll = (g: DartsGame, id: string, fields: string[]) => fields.forEach((f) => hit(g, id, f));
/** Runde fertig: Anzeige nach dem letzten Dart abkürzen */
const finishRound = (g: DartsGame) => {
  if (S(g).sub === 'throw') g.skip();
};

{
  const g = new DartsGame(['A', 'B', 'C'], ctx);
  check(S(g).sub === 'intro' && S(g).players.every((p) => p.rest === DARTS.START), `alle starten bei ${DARTS.START}`);
  g.skip();
  check(S(g).sub === 'throw' && S(g).round === 1 && S(g).endsIn === 0, 'Runde 1 läuft – ohne Zeitlimit');
  g.input('A', 'aim', { x: 3, y: -100, amp: 20, on: true });
  check(P(g, 'A').aim?.x === 3 && P(g, 'A').aim?.on === true, 'Live-Ziel fürs TV im Zustand');
  // Runde 1: 301-Abzug
  throwAll(g, 'A', ['T20', 'T20', 'T20']);
  throwAll(g, 'B', ['T20', 'T20', 'T20']);
  hit(g, 'C', '20');
  hit(g, 'C', '20', 0); // doppelt gesendet
  check(P(g, 'C').thrown === 1 && P(g, 'C').rest === 281, 'doppelt gesendeter Wurf zählt nur einmal');
  throwAll(g, 'C', ['20', '20']);
  check(P(g, 'A').rest === 121 && P(g, 'A').scored === 180 && P(g, 'A').aim === null, `301 − 180 = ${P(g, 'A').rest}, Fadenkreuz weg, wenn fertig`);
  check(P(g, 'C').rest === 241, `C: 3 × 20 → ${P(g, 'C').rest}`);
  finishRound(g);
  check(S(g).sub === 'tally' && S(g).tally?.lead.join() === 'A,B' && S(g).tally?.rest === 121, 'Zwischenstand: A und B vorn mit 121');
  g.skip();
  // Runde 2: Überworfen auf dem letzten Dart, VIP beendet die Runde für C
  throwAll(g, 'A', ['T20', 'T20', '0']);
  throwAll(g, 'B', ['T20', 'T19']);
  check(P(g, 'B').rest === 4, 'B steht bei 4');
  hit(g, 'B', 'T20');
  const bB = P(g, 'B');
  check(bB.bust && bB.rest === 121 && bB.scored === 0, `B überwirft (4 − 60) → Aufnahme zählt nicht, Rest wieder ${bB.rest}`);
  check(S(g).darts.some((d) => d.owner === 'B' && d.bust && d.rest === 121), 'Dart trägt „überworfen“ für TV und Handy');
  hit(g, 'C', '20');
  check(g.skippable()?.label === 'Runde beenden' || (g.skippable()?.label ?? '').includes('überspringen'), `VIP kann die Runde beenden („${g.skippable()?.label}“)`);
  g.skip(); // fehlende Darts von C verfallen
  check(P(g, 'C').skipped && P(g, 'C').rest === 221, 'VIP beendet: Cs restliche Darts verfallen (kein Zufallswurf)');
  finishRound(g);
  check(P(g, 'A').rest === 1 && P(g, 'B').history[1] === null && P(g, 'A').history[1] === 120, 'Verlauf: A −120, B überworfen');
  g.skip();
  // Runde 3: A überwirft mit dem ersten Dart – die beiden anderen verfallen; B checkt mit einer Single aus
  hit(g, 'A', 'T20');
  hit(g, 'A', '1', 1);
  check(P(g, 'A').bust && P(g, 'A').thrown === 1 && P(g, 'A').rest === 1, 'A überwirft mit Dart 1 → Darts 2 und 3 verfallen');
  throwAll(g, 'B', ['T20', 'T19', '4']);
  check(P(g, 'B').out === 9 && P(g, 'B').rest === 0, `Single Out: B checkt mit der 4 aus (nach ${P(g, 'B').out} Darts)`);
  throwAll(g, 'C', ['20', '20', '20']);
  finishRound(g);
  check(S(g).sub === 'over' && S(g).winners.join() === 'B', 'Checkout → Spiel vorbei, B gewinnt');
  for (let t = 0; t < 80 && !result; t++) await sleep(100);
  const r = result as MiniResult | null;
  check(!!r && r.groups.map((x) => x.join('')).join('|') === 'B|A|C', `Platzierung nach Reststand: ${r?.groups.map((x) => x.join('')).join(' | ')} – „${r?.subtitle}“`);
  check(r?.details.A === 'Rest 1' && (r?.details.B ?? '').includes('9 Darts'), `Details: ${JSON.stringify(r?.details)}`);
  g.dispose();
}

/** Bringt alle auf Rest 1 (2 Runden à 3 Darts: T20 T20 T20 | T20 T20 daneben) */
const toOne = (g: DartsGame, ids: string[]) => {
  g.skip();
  for (const id of ids) throwAll(g, id, ['T20', 'T20', 'T20']);
  finishRound(g);
  g.skip();
  for (const id of ids) throwAll(g, id, ['T20', 'T20', '0']);
  finishRound(g);
  g.skip();
};

{
  result = null;
  const g = new DartsGame(['A', 'B', 'C'], ctx);
  toOne(g, ['A', 'B', 'C']);
  check(S(g).round === 3 && ['A', 'B', 'C'].every((id) => P(g, id).rest === 1), 'alle stehen bei 1');
  throwAll(g, 'A', ['0', '1']);
  throwAll(g, 'B', ['0', '0', '1']);
  check(S(g).sub === 'throw', 'A hat ausgecheckt – die Runde läuft für die anderen weiter');
  throwAll(g, 'C', ['0', '0', '0']);
  finishRound(g);
  check(S(g).winners.join() === 'A', 'beide checken in derselben Runde aus → weniger Darts gewinnt (A mit Dart 2 vor B mit Dart 3)');
  for (let t = 0; t < 80 && !result; t++) await sleep(100);
  const r = result as MiniResult | null;
  check(r?.groups.map((x) => x.join('')).join('|') === 'A|B|C', `Platzierung ${r?.groups.map((x) => x.join('')).join(' | ')} – „${r?.subtitle}“`);
  g.dispose();
}

{
  result = null;
  const g = new DartsGame(['A', 'B', 'C'], ctx);
  toOne(g, ['A', 'B', 'C']);
  throwAll(g, 'A', ['0', '1']);
  throwAll(g, 'B', ['5', '1']); // 5 > 1 → überworfen, der zweite Dart verfällt
  check(P(g, 'B').bust && P(g, 'B').out === 0, 'B überwirft bei Rest 1 mit der 5');
  throwAll(g, 'C', ['0', '1']);
  finishRound(g);
  check(S(g).winners.join() === 'A,C', 'A und C checken mit gleich vielen Darts aus → gemeinsamer Sieg');
  for (let t = 0; t < 80 && !result; t++) await sleep(100);
  const r = result as MiniResult | null;
  check(r?.groups.map((x) => x.join('')).join('|') === 'AC|B' && (r?.subtitle ?? '').includes('gleichzeitig'), `Gleichstand: ${r?.groups.map((x) => x.join('')).join(' | ')} – „${r?.subtitle}“`);
  g.dispose();
}

{
  result = null;
  const g = new DartsGame(['A', 'B', 'C'], ctx);
  g.skip();
  hit(g, 'A', 'T20');
  for (let round = 1; round <= DARTS.MAX_ROUNDS; round++) {
    check(S(g).sub === 'throw' && S(g).round === round, `Runde ${round}`);
    if (round > 1) hit(g, 'B', '1');
    g.skip(); // VIP: Runde beenden
    finishRound(g);
    if (round < DARTS.MAX_ROUNDS) g.skip();
  }
  check(S(g).sub === 'over' && S(g).winners.join() === 'A', `Rundenlimit (${DARTS.MAX_ROUNDS}): niedrigster Rest gewinnt (A ${P(g, 'A').rest}, B ${P(g, 'B').rest}, C ${P(g, 'C').rest})`);
  for (let t = 0; t < 80 && !result; t++) await sleep(100);
  const r = result as MiniResult | null;
  check(r?.groups.map((x) => x.join('')).join('|') === 'A|B|C' && (r?.subtitle ?? '').includes(`${DARTS.MAX_ROUNDS} Runden`), `Platzierung ${r?.groups.map((x) => x.join('')).join(' | ')} – „${r?.subtitle}“`);
  g.dispose();
}

{
  result = null;
  const g = new DartsGame(['A'], ctx);
  toOne(g, ['A']);
  hit(g, 'A', '1');
  check(S(g).sub === 'throw', 'allein: Checkout beendet die Runde erst nach der Anzeige');
  finishRound(g);
  check(S(g).sub === 'over' && S(g).winners.join() === 'A', 'allein spielbar (z. B. Übung): Checkout nach 7 Darts');
  for (let t = 0; t < 80 && !result; t++) await sleep(100);
  check((result as MiniResult | null)?.groups.length === 1, `Ergebnis allein: „${(result as MiniResult | null)?.subtitle}“`);
  g.dispose();
}

{
  result = null;
  offline.clear();
  offline.add('C');
  const g = new DartsGame(['A', 'B', 'C'], ctx);
  g.skip();
  await sleep(DARTS.AUTO_MS * DARTS.DARTS_PER_ROUND + 400);
  const c = P(g, 'C');
  check(c.thrown === DARTS.DARTS_PER_ROUND && S(g).darts.filter((d) => d.owner === 'C').every((d) => d.auto), 'Handy weg → der Server wirft (automatisch)');
  check(P(g, 'A').thrown === 0 && P(g, 'B').thrown === 0 && S(g).sub === 'throw', 'verbundene Spieler: kein Zeitlimit, nichts wird automatisch geworfen');
  offline.clear();
  g.dispose();
}

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Darts-Tests ok');
process.exit(failed ? 1 : 0);
