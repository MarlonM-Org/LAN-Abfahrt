/**
 * Tests ohne Browser für Darts: Ring-/Segmenterkennung mit bekannten Koordinaten, Landepunkt-Berechnung,
 * Determinismus des Servers und die Schnipp-Erkennung. Aufruf: `npm run test:darts`
 */
import { DARTS, DART_SEGMENTS, dartsCalm, dartsLanding, dartsScore, dartsTarget, dartsWobble } from '../shared/darts';
import { resolveDart } from '../server/darts';
import { flickToThrow } from '../client/controller/dartsThrow';
import type { MotionSample } from '../client/controller/motion';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
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

console.log('Landepunkt');
const T20 = dartsTarget(20, 'triple');
const ideal = dartsLanding(T20, DARTS.POWER_IDEAL, 0, [0, 0]);
check(ideal.x === T20.x && ideal.y === T20.y, `Idealkraft, gerade, ohne Streuung → genau aufs Fadenkreuz (${ideal.x}, ${ideal.y})`);
const weak = dartsLanding(T20, 0.3, 0, [0, 0]);
const hard = dartsLanding(T20, 0.95, 0, [0, 0]);
check(weak.y > T20.y + 20, `zu schwach (0,3) → tiefer: y ${weak.y} → ${dartsScore(weak).label}`);
check(hard.y < T20.y - 20, `zu stark (0,95) → höher: y ${hard.y} → ${dartsScore(hard).label}`);
const edge = dartsLanding(T20, DARTS.POWER_IDEAL + DARTS.POWER_TOL, 0, [0, 0]);
check(edge.y === T20.y, 'Rand des Idealbereichs → noch kein Fehler');
const right = dartsLanding(T20, DARTS.POWER_IDEAL, 1, [0, 0]);
check(Math.abs(right.x - DARTS.SIDE_MM) < 0.01, `schräg (+1) → ${DARTS.SIDE_MM} mm nach rechts (${right.x})`);
const noisy = dartsLanding(T20, DARTS.POWER_IDEAL, 0, [1, -1]);
check(Math.abs(noisy.x - DARTS.NOISE_MM) < 0.01 && Math.abs(noisy.y - (T20.y - DARTS.NOISE_MM)) < 0.01, 'Streuung 1 σ = NOISE_MM');
const wall = dartsLanding({ x: 500, y: -500 }, 0, 0, [0, 0]);
check(Math.abs(wall.x) <= DARTS.WALL && Math.abs(wall.y) <= DARTS.WALL, 'Landepunkt bleibt an der Wand');

console.log('Server: deterministisch, Mindest-Wackeln');
const thr = { n: 1, ax: 0, ay: -103, t: 1234, amp: 12, power: 0.62, side: 0.05 };
const a = resolveDart('p1', 2, 42, thr);
const b = resolveDart('p1', 2, 42, thr);
check(a.land.x === b.land.x && a.land.y === b.land.y, `gleiche Eingabe + Seed → gleicher Landepunkt (${a.land.x}, ${a.land.y}) ${a.hit.label}`);
const c = resolveDart('p1', 2, 43, thr);
check(c.land.x !== a.land.x || c.land.y !== a.land.y, 'anderer Seed → andere Streuung');
const cheat = resolveDart('p1', 2, 42, { ...thr, amp: 0 });
const minAmp = resolveDart('p1', 2, 42, { ...thr, amp: DARTS.AMP_MIN });
check(cheat.cross.x === minAmp.cross.x && cheat.cross.y === minAmp.cross.y, 'Amplitude 0 wird auf AMP_MIN angehoben');
let maxW = 0;
for (let t = 0; t < 20000; t += 7) {
  const w = dartsWobble(t, 10, 1.3);
  maxW = Math.max(maxW, Math.hypot(w.x, w.y));
}
check(maxW <= 10 * Math.SQRT2 + 1e-9 && maxW > 8, `Wackeln bleibt in der Amplitude (max ${maxW.toFixed(2)} mm bei 10 mm)`);
check(Math.abs(dartsCalm(DARTS.AMP_START, 60000) - DARTS.AMP_MIN) < 0.01, 'Ruhig halten → Wackeln sinkt auf AMP_MIN');
check(dartsCalm(DARTS.AMP_START, 1000) < DARTS.AMP_START, 'nach 1 s schon ruhiger');

console.log('Schnippen (Bewegungssensor)');
const flick = (peak: number, yawDeg = 0): MotionSample[] =>
  Array.from({ length: 30 }, (_, i) => {
    const t = i * 16;
    // Glockenkurve der Drehrate in der Mitte der Geste
    const w = peak * Math.exp(-(((t - 300) / 70) ** 2));
    return { alpha: 100 + (yawDeg * i) / 29, beta: 70, gamma: 0, ax: 0, ay: 9.81, az: 0, rotAlpha: 0, rotBeta: w, rotGamma: 0, t };
  });
const soft = flickToThrow(flick(300));
const mid = flickToThrow(flick(700));
const strong = flickToThrow(flick(1400));
const none = flickToThrow(flick(20));
check(soft.ok && soft.t.speed < DARTS.POWER_IDEAL - DARTS.POWER_TOL, `sanft (300 °/s) → zu schwach (${soft.ok ? soft.t.speed : '-'})`);
check(mid.ok && Math.abs(mid.t.speed - DARTS.POWER_IDEAL) <= DARTS.POWER_TOL, `locker (700 °/s) → ideal (${mid.ok ? mid.t.speed : '-'})`);
check(strong.ok && strong.t.speed > DARTS.POWER_IDEAL + DARTS.POWER_TOL, `hart (1400 °/s) → zu stark (${strong.ok ? strong.t.speed : '-'})`);
check(!none.ok, 'kaum Bewegung → kein Wurf');
const turned = flickToThrow(flick(700, -20));
check(turned.ok && turned.t.angle > 0.3, `nach rechts gedreht → Seite rechts (${turned.ok ? turned.t.angle : '-'})`);

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Darts-Tests ok');
process.exit(failed ? 1 : 0);
