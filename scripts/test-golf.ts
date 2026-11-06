/**
 * Tests ohne Browser für Minigolf: Schlag-Umrechnung (Zurückziehen, Putter-Schwung) mit synthetischen
 * Eingaben, eine Physik-Probe aller Löcher (Bot-Schläge mit Streuung), Ball-gegen-Ball-Stöße und der
 * Ablauf im Server-Spiel (angestoßen einlochen/ins Wasser, VIP „Nächstes Loch“). Aufruf: `npm run test:golf`
 */
import { DRAG_DEAD, dragToPutt, swingToPutt } from '../client/controller/golfPutt';
import type { MotionSample } from '../client/controller/motion';
import {
  GOLF,
  GOLF_HOLES,
  type GolfBody,
  golfAimHit,
  golfBotPlan,
  golfFreeSpot,
  golfIdealPutt,
  golfOnTee,
  golfPowerFor,
  golfPowerToSpeed,
  golfRollDist,
  golfSkipScore,
  golfStep,
  golfWalls,
  onCourse,
} from '../shared/golf';
import { GolfGame } from '../server/golf';
import type { MiniCtx, MiniResult } from '../server/minigame';
import type { GolfState } from '../shared/types';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ Zurückziehen

console.log('Zurückziehen (Schleuder):');
{
  const max = 200;
  const r = dragToPutt(5, 3, max);
  check(!r.ok, 'Antippen (< Totzone) ist kein Schlag');
  const left = dragToPutt(-120, 0, max);
  check(left.ok && near(left.putt.angle, 0, 1e-3), 'nach links ziehen → Schlag nach rechts (0 rad)');
  const down = dragToPutt(0, 120, max);
  check(down.ok && near(down.putt.angle, -Math.PI / 2, 1e-3), 'nach unten ziehen → Schlag nach oben (−π/2)');
  const diag = dragToPutt(80, -80, max);
  check(diag.ok && near(diag.putt.angle, (3 * Math.PI) / 4, 1e-3), 'nach rechts oben ziehen → Schlag nach links unten');
  const half = dragToPutt(-(DRAG_DEAD + (max - DRAG_DEAD) / 2), 0, max);
  check(half.ok && near(half.putt.power, 0.5, 0.011), 'halber Ziehweg → 50 % Kraft');
  const full = dragToPutt(-500, 0, max);
  check(full.ok && full.putt.power === 1, 'über das Maximum → 100 % (gekappt)');
  const tiny = dragToPutt(-(DRAG_DEAD + 1), 0, max);
  check(tiny.ok && tiny.putt.power > 0 && tiny.putt.power <= 0.03, 'knapp über der Totzone → winziger Putt');
}

// ------------------------------------------------------------------ Putter-Schwung

console.log('Putter-Schwung (Sensor):');
/** Pendel: Drehrate steigt bis zur Spitze und fällt wieder, Kompass dreht linear um `yaw` Grad */
function swing(peakDegS: number, ms: number, yaw = 0, alpha0 = 100): MotionSample[] {
  const out: MotionSample[] = [];
  for (let t = 0; t <= ms; t += 16) {
    const u = t / ms;
    const w = peakDegS * Math.sin(Math.PI * u);
    out.push({ alpha: alpha0 + yaw * u, beta: 40, gamma: 0, ax: 0, ay: 9.81, az: 0, rotAlpha: 0, rotBeta: w, rotGamma: 0, t: 1000 + t });
  }
  return out;
}
{
  check(!swingToPutt(swing(10, 400), 0).ok, 'Stillhalten ist kein Schlag');
  check(!swingToPutt(swing(200, 80), 0).ok, 'zu kurzes Halten wird abgelehnt');
  const soft = swingToPutt(swing(80, 500), 0.3);
  const mid = swingToPutt(swing(220, 500), 0.3);
  const hard = swingToPutt(swing(600, 400), 0.3);
  check(soft.ok && soft.putt.power < 0.25, `sanftes Pendeln → kurzer Putt (${soft.ok ? soft.putt.power : '-'})`);
  check(mid.ok && mid.putt.power > 0.3 && mid.putt.power < 0.6, `mittlerer Schwung → mittlere Kraft (${mid.ok ? mid.putt.power : '-'})`);
  check(hard.ok && hard.putt.power === 1, 'kräftiger Schwung → volle Kraft');
  check(soft.ok && mid.ok && hard.ok && soft.putt.power < mid.putt.power && mid.putt.power < hard.putt.power, 'Kraft steigt monoton mit dem Schwung');
  check(mid.ok && near(mid.putt.angle, 0.3, 1e-3), 'ohne Drehung bleibt die Richtung des Zielpfeils');
  const turnL = swingToPutt(swing(220, 500, 10), 0.3);
  const turnR = swingToPutt(swing(220, 500, -10), 0.3);
  check(turnL.ok && turnR.ok && turnL.putt.angle < 0.3 && turnR.putt.angle > 0.3, 'Drehen nach links/rechts korrigiert die Richtung');
  const jump = swingToPutt(swing(220, 500, 170), 0.3);
  check(jump.ok && near(jump.putt.angle, 0.3, 1e-3), 'Kompass-Sprung wird ignoriert');
  const wrap = swingToPutt(swing(220, 500, 10, 355), 0.3);
  check(wrap.ok && near(wrap.putt.angle, turnL.ok ? turnL.putt.angle : 0, 1e-3), 'Kompass über 360° → gleiche Korrektur');
}

// ------------------------------------------------------------------ Physik

console.log('Physik:');
{
  check(near(golfRollDist(golfPowerToSpeed(0.5)), GOLF.MAX_DIST / 2, 0.5), 'Kraft 50 % rollt die halbe Maximalweite');
  // Flacher Putt auf Loch 1 von der Mitte: rollt (fast) die berechnete Weite
  const h = GOLF_HOLES[0];
  const walls = golfWalls(h);
  const b: GolfBody = { x: 60, y: 143, vx: golfPowerToSpeed(150 / GOLF.MAX_DIST), vy: 0, tube: 0, tubeV: 0, tubeIdx: 0, lip: 0 };
  for (let i = 0; i < 5000; i++) if (golfStep(b, h, walls, i / 120, 1 / 120).includes('stop')) break;
  check(near(b.x - 60, 150, 3), `150 px Putt rollt ${Math.round(b.x - 60)} px`);
}

/** Spielt ein Loch mit Bot-Schlägen (Streuung) durch, liefert die Schläge */
function playHole(hi: number, noise: number, seed: number): number {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const h = GOLF_HOLES[hi];
  const walls = golfWalls(h);
  const b: GolfBody = { x: h.tee.x, y: h.tee.y, vx: 0, vy: 0, tube: 0, tubeV: 0, tubeIdx: 0, lip: 0 };
  let t = 0;
  let strokes = 0;
  while (strokes < GOLF.MAX_STROKES) {
    const p = noise > 0.5 ? golfBotPlan(h, b, t) : { ...golfIdealPutt(h, b), wait: 0 };
    t += p.wait;
    const ang = p.angle + (rnd() - 0.5) * 2 * noise * 0.12;
    const pow = Math.min(1, p.power * (1 + (rnd() - 0.5) * 2 * noise * 0.12) * (rnd() < noise * 0.12 ? (rnd() < 0.5 ? 0.7 : 1.35) : 1));
    const sx = b.x;
    const sy = b.y;
    const v = golfPowerToSpeed(pow);
    b.vx = Math.cos(ang) * v;
    b.vy = Math.sin(ang) * v;
    strokes++;
    let rest = false;
    for (let i = 0; i < 120 * 20 && !rest; i++) {
      const ev = golfStep(b, h, walls, t, 1 / 120);
      t += 1 / 120;
      if (ev.includes('hole')) return strokes;
      if (ev.includes('water') || ev.includes('out')) {
        if (ev.includes('water')) strokes++;
        b.x = sx;
        b.y = sy;
        rest = true;
      }
      if (ev.includes('stop')) rest = true;
    }
    b.vx = b.vy = 0;
    t += 1.5 + rnd() * 2;
  }
  return GOLF.MAX_SCORE;
}

for (let hi = 0; hi < GOLF_HOLES.length; hi++) {
  const h = GOLF_HOLES[hi];
  const runs = 60;
  const res = { exact: [] as number[], bot: [] as number[] };
  for (let k = 0; k < runs; k++) {
    res.exact.push(playHole(hi, 0.05, 1000 + k * 7919));
    res.bot.push(playHole(hi, 1, 5000 + k * 104729));
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const capped = res.bot.filter((n) => n >= GOLF.MAX_SCORE).length;
  console.log(`  Loch ${hi + 1} ${h.name.padEnd(16)} Par ${h.par}: genau Ø ${avg(res.exact).toFixed(2)} · Bot Ø ${avg(res.bot).toFixed(2)} (Max ${capped}/${runs}, Asse ${res.bot.filter((n) => n === 1).length})`);
  check(avg(res.exact) <= h.par + 1.5, `Loch ${hi + 1}: gut gezielte Schläge schaffen es um Par`);
  check(capped <= runs * 0.25, `Loch ${hi + 1}: Bots bleiben selten am Schlag-Limit hängen`);
}

// ------------------------------------------------------------------ Ball gegen Ball

console.log('Ball gegen Ball:');
const body = (x: number, y: number, vx = 0, vy = 0): GolfBody => ({ x, y, vx, vy, tube: 0, tubeV: 0, tubeIdx: 0, lip: 0 });
{
  const h = GOLF_HOLES[0];
  const walls = golfWalls(h);
  // Gerader Stoß: A rollt mit 300 px/s auf den liegenden B
  const a = body(100, 143, 300, 0);
  const b = body(130, 143);
  let hits = 0;
  let minGap = Infinity;
  for (let i = 0; i < 40; i++) {
    golfStep(a, h, walls, i / 120, 1 / 120, [b], () => hits++);
    minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check(hits >= 1, 'A trifft den liegenden Ball B');
  check(b.vx > 200 && Math.abs(b.vy) < 1, `B rollt geradeaus weiter (${Math.round(b.vx)} px/s)`);
  check(Math.abs(a.vx) < 0.25 * b.vx, `A bleibt fast stehen (${Math.round(a.vx)} px/s)`);
  check(minGap >= 2 * GOLF.BALL_R - 1e-6, `Bälle überlappen nie (min. Abstand ${minGap.toFixed(2)} px)`);
  const e0 = 300 * 300;
  const e1 = a.vx * a.vx + a.vy * a.vy + b.vx * b.vx + b.vy * b.vy;
  check(e1 < e0 && e1 > e0 * 0.6, `etwas Energie geht verloren (${Math.round((e1 / e0) * 100)} %)`);
  // Schräger Stoß: B weicht zur Seite aus
  const c = body(100, 145, 300, 0);
  const d = body(130, 141);
  for (let i = 0; i < 40; i++) golfStep(c, h, walls, i / 120, 1 / 120, [d]);
  check(d.vy < -20 && c.vy > 20, 'schräg getroffen: beide Bälle gehen auseinander');
  // Ball an der Bande: der Stoß schiebt nie in die Wand
  const e = body(120, 101, 0, -250);
  const f = body(120, 99.5);
  for (let i = 0; i < 30; i++) golfStep(e, h, walls, i / 120, 1 / 120, [f]);
  check(onCourse(h, e.x, e.y) && e.y >= 96 + GOLF.BALL_R - 0.01, 'Ball an der Bande bleibt auf der Bahn');
  // Zielhilfe
  const hit = golfAimHit({ x: 100, y: 143 }, 0, 100, [{ x: 140, y: 143 }]);
  check(!!hit && near(hit.d, 40 - 2 * GOLF.BALL_R, 1e-6) && near(hit.nx, 1, 1e-6), 'Zielhilfe: gerade Linie trifft 6 px vor dem Ball');
  check(golfAimHit({ x: 100, y: 143 }, 0, 100, [{ x: 140, y: 150 }]) === null, 'Zielhilfe: knapp vorbei = kein Treffer');
  check(golfAimHit({ x: 100, y: 143 }, 0, 20, [{ x: 140, y: 143 }]) === null, 'Zielhilfe: zu kurz = kein Treffer');
  // Freie Stelle
  const spot = golfFreeSpot(h, 150, 143, [{ x: 150, y: 143 }]);
  check(Math.hypot(spot.x - 150, spot.y - 143) >= 2 * GOLF.BALL_R && onCourse(h, spot.x, spot.y), 'belegte Stelle → nächste freie daneben');
  check(golfOnTee(h, h.tee) && !golfOnTee(h, { x: h.tee.x + 2, y: h.tee.y }), 'auf dem Abschlag = Geist, daneben nicht');
  // Wertung bei „Nächstes Loch“
  check(golfSkipScore(0, 3) === 4 && golfSkipScore(2, 3) === 4 && golfSkipScore(3, 3) === 5 && golfSkipScore(6, 3) === GOLF.MAX_SCORE && golfSkipScore(0, 2) === 3, 'Abbruch-Wertung: Schläge + 2, mind. Par + 1, max. 7');
}

// ------------------------------------------------------------------ Server-Spiel

console.log('Server-Spiel:');
interface TestGame {
  timers: { clear(): void };
  startHole(i: number): void;
  step(now: number): boolean;
  endHole(): void;
  sub: string;
  hole: number;
  balls: Record<string, GolfBody & { strokes: number; done: number; moving: boolean; wait: number }>;
}
function makeGame(mode: 'arcade' | 'party' = 'arcade', offline: Record<string, number> = {}) {
  let finished: MiniResult | null = null;
  const ctx: MiniCtx = {
    onChange: () => {},
    finish: (r) => (finished = r),
    isConnected: (id) => !(id in offline),
    offlineMs: (id) => offline[id] ?? 0,
    nameOf: (id) => id,
    mode,
  };
  const g = new GolfGame(['A', 'B', 'C'], ctx);
  const t = g as unknown as TestGame;
  t.timers.clear();
  return { g, t, finished: () => finished };
}
/** Loch starten, sofort spielen (ohne Timer), Bälle hinlegen */
function setup(t: TestGame, hole: number, at: Record<string, [number, number, number]>) {
  t.startHole(hole);
  t.timers.clear();
  t.sub = 'play';
  for (const [id, [x, y, s]] of Object.entries(at)) Object.assign(t.balls[id], { x, y, sx: x, sy: y, strokes: s });
}
const run = (t: TestGame, ticks: number) => {
  for (let i = 0; i < ticks; i++) t.step(Date.now());
};
const snap = (g: GolfGame) => g.snapshot().state as GolfState;
{
  // Angestoßen eingelocht: zählt für den Besitzer, ohne Zusatzschlag
  const { g, t } = makeGame();
  const h = GOLF_HOLES[0];
  setup(t, 0, { A: [h.cup.x - 24, h.cup.y, 1], B: [h.cup.x - 14, h.cup.y, 1] });
  g.input('A', 'putt', { seq: 1, a: 0, p: golfPowerFor(golfRollDist(95)) });
  run(t, 120);
  const st = snap(g);
  check(st.balls.B.d === 1 && st.scores.B[0] === 1, `B angestoßen eingelocht → zählt mit 1 Schlag (d=${st.balls.B.d}, Karte ${st.scores.B[0]})`);
  check(st.balls.A.s === 2, 'A hat einen Schlag mehr');
  check(st.fx.some((f) => f.k === 'knock') && st.fx.some((f) => f.k === 'lucky'), 'TV bekommt „knock“ und „lucky“');
  g.dispose();
}
{
  // Angestoßen ins Wasser: straffrei zurück an die alte Stelle
  const { g, t } = makeGame();
  setup(t, 3, { A: [240, 152, 1], B: [240, 138, 1] });
  g.input('A', 'putt', { seq: 1, a: -Math.PI / 2, p: 0.25 });
  let wet = false;
  for (let i = 0; i < 200; i++) {
    t.step(Date.now());
    if (t.balls.B.wait > 0) wet = true;
  }
  const st = snap(g);
  check(wet, 'B wurde ins Wasser gestoßen');
  // alte Stelle – oder direkt daneben, falls A inzwischen dort liegt
  check(st.balls.B.s === 1 && Math.hypot(st.balls.B.x - 240, st.balls.B.y - 138) < 2.5, `B straffrei zurück (Schläge ${st.balls.B.s}, ${st.balls.B.x}/${st.balls.B.y})`);
  const ab = Math.hypot(st.balls.A.x - st.balls.B.x, st.balls.A.y - st.balls.B.y);
  check(ab >= 2 * GOLF.BALL_R - 0.05, `danach liegt kein Ball auf dem anderen (${ab.toFixed(1)} px)`);
  g.dispose();
}
{
  // Auf dem Abschlag stören sich die Bälle nicht
  const { g, t } = makeGame();
  setup(t, 0, {});
  g.input('A', 'putt', { seq: 0, a: 0, p: 0.3 });
  run(t, 90);
  const st = snap(g);
  check(st.balls.B.x === GOLF_HOLES[0].tee.x && !st.balls.B.m && st.balls.A.x > 100, 'Abschlag: A rollt durch B und C hindurch');
  g.dispose();
}
{
  // VIP „Nächstes Loch“: Rest wird gewertet, kurze Scorekarte, dann weiter
  const { g, t } = makeGame();
  const h = GOLF_HOLES[0];
  setup(t, 0, { A: [300, 120, 1], B: [250, 160, 1] });
  t.balls.A.done = 1;
  const sk = g.skippable();
  check(!!sk && !sk.info, `im Spiel überspringbar („${sk?.label}“)`);
  g.vipAction('next');
  const st = snap(g);
  check(st.scores.B[0] === golfSkipScore(1, h.par) && st.scores.C[0] === golfSkipScore(0, h.par), `Wertung: B ${st.scores.B[0]}, C ${st.scores.C[0]} (Par ${h.par})`);
  check(st.ended === true && st.balls.B.d === 2, 'Loch als vorzeitig beendet markiert');
  t.endHole();
  check(snap(g).sub === 'card' && snap(g).endsIn <= GOLF.SKIP_CARD_MS && snap(g).endsIn > 0, 'kurze Scorekarte');
  g.vipAction('next');
  check(snap(g).sub === 'tee' && snap(g).hole === 1 && !snap(g).ended, 'VIP-Knopf auf der Scorekarte → Loch 2');
  g.dispose();
}
{
  // Party-Modus (5 Löcher): nach dem letzten Loch geht’s zum Endstand, nicht zu Loch 6
  const { g, t } = makeGame('party');
  setup(t, 4, {});
  t.endHole();
  check(g.skippable()?.label === 'Zum Endstand', 'Party: letzte Scorekarte → „Zum Endstand“');
  g.vipAction('next');
  check(snap(g).sub === 'over', 'Party: Überspringen beendet das Spiel nach Loch 5');
  g.dispose();
}

{
  // Handy kurz weg (Bildschirm aus): der Computer puttet NICHT gleich für dich – erst nach AUTO_OFFLINE_MS
  const off: Record<string, number> = { B: 5000, C: GOLF.AUTO_OFFLINE_MS + 1000 };
  const { g, t } = makeGame('arcade', off);
  setup(t, 0, {});
  for (const b of Object.values(t.balls) as unknown as { restSince: number }[]) b.restSince = Date.now() - GOLF.AUTO_MS - 100;
  run(t, 2);
  const st = snap(g);
  check(st.balls.B.s === 0 && !st.balls.B.auto, 'kurz offline (5 s): kein Auto-Schlag');
  check(st.balls.C.s === 1 && st.balls.C.auto === 1, 'lange offline: Auto-Schlag (und das Handy erfährt es)');
  g.dispose();
}

console.log(failed ? `\n${failed} Fehler` : '\nAlles ok');
process.exit(failed ? 1 : 0);
