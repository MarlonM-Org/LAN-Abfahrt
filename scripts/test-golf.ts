/**
 * Tests ohne Browser für Minigolf: Schlag-Umrechnung (Zurückziehen, Putter-Schwung) mit synthetischen
 * Eingaben und eine Physik-Probe aller Löcher (Bot-Schläge mit Streuung). Aufruf: `npm run test:golf`
 */
import { DRAG_DEAD, dragToPutt, swingToPutt } from '../client/controller/golfPutt';
import type { MotionSample } from '../client/controller/motion';
import { GOLF, GOLF_HOLES, type GolfBody, golfBotPlan, golfIdealPutt, golfPowerToSpeed, golfRollDist, golfStep, golfWalls } from '../shared/golf';

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

console.log(failed ? `\n${failed} Fehler` : '\nAlles ok');
process.exit(failed ? 1 : 0);
