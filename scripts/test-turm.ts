/**
 * Tests ohne Browser für den Wackelturm: Raster des fallenden Teils, bündiges Heranschieben an liegende
 * Teile, Entlangrutschen an Wänden, Lock-Delay und Hineinschieben unter einen Überhang („Tucking“).
 * Aufruf: `npm run test:turm`
 */
import Matter from 'matter-js';
import { TURM, TURM_SHAPES, turmCellOffsets } from '../shared/games';
import { TurmGame } from '../server/turm';

const B = TURM.BLOCK;
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};

function newGame() {
  const game = new TurmGame(['a', 'b'], {
    onChange() {},
    finish() {},
    isConnected: () => true,
    nameOf: (id) => id,
    mode: 'arcade',
  } as ConstructorParameters<typeof TurmGame>[1]);
  const t = game.testApi();
  t.begin();
  return { game, t };
}

/** Schwerpunkt so wählen, dass die Form mit linker Kante `left` und Unterkante `bottom` liegt (Physik-y nach unten) */
function comFor(shape: number, rot: number, left: number, bottom: number) {
  const offs = turmCellOffsets(shape, (rot * Math.PI) / 2);
  return { x: left - Math.min(...offs.map((o) => o.x)) + B / 2, y: bottom - Math.max(...offs.map((o) => o.y)) - B / 2 };
}

type Act = { x: number; y: number; offs: { x: number; y: number }[] };
const leftEdge = (a: Act) => a.x + Math.min(...a.offs.map((o) => o.x)) - B / 2;
const bottomEdge = (a: Act) => a.y + Math.max(...a.offs.map((o) => o.y)) + B / 2;

/** Kleinster waagerechter Abstand zwischen Zellen des Teils und Zellen eines Körpers (nur Zeilen, die sich überdecken) */
function horizGap(a: Act, body: Matter.Body) {
  let gap = Infinity;
  for (const o of a.offs) {
    const cx0 = a.x + o.x - B / 2;
    const cx1 = a.x + o.x + B / 2;
    const cy0 = a.y + o.y - B / 2;
    const cy1 = a.y + o.y + B / 2;
    for (const part of body.parts.slice(1)) {
      const xs = part.vertices.map((v) => v.x);
      const ys = part.vertices.map((v) => v.y);
      if (Math.min(cy1, Math.max(...ys)) - Math.max(cy0, Math.min(...ys)) < 2) continue;
      const g = Math.max(cx0 - Math.max(...xs), Math.min(...xs) - cx1);
      gap = Math.min(gap, g);
    }
  }
  return gap;
}

/** So oft schieben, bis sich nichts mehr bewegt */
function pushAll(t: ReturnType<TurmGame['testApi']>, dir: number, stepsBetween = 0) {
  for (let i = 0; i < 30; i++) {
    const a = t.lane(0).active;
    if (!a) return;
    const x = a.x;
    t.input('a', 'shift', { dir });
    if (stepsBetween) t.step(stepsBetween);
    if (t.lane(0).active?.x === x) return;
  }
}

// ------------------------------------------------------------------ Raster

console.log('Raster (Zellkanten auf Halbblöcken – auch bei L/J/gedrehtem T):');
{
  const { game, t } = newGame();
  let bad = 0;
  for (let shape = 0; shape < TURM_SHAPES.length; shape++) {
    for (let rot = 0; rot < 4; rot++) {
      const a = t.activate(0, shape, Math.random() * 40 - 20, -15 * B, 0);
      for (let r = 0; r < rot; r++) t.input('a', 'rotate');
      for (const dir of [1, 1, -1, -1, -1]) {
        t.input('a', 'shift', { dir });
        const e = leftEdge(t.lane(0).active!);
        if (Math.abs(e / (B / 2) - Math.round(e / (B / 2))) > 1e-3) bad++;
      }
      void a;
    }
  }
  check(bad === 0, `alle Formen/Drehungen bleiben im Raster (${bad} Abweichungen)`);
  game.dispose();
}

// ------------------------------------------------------------------ Bündig heranschieben

console.log('Bündig heranschieben:');
for (const [shapeA, rotA, shapeB, rotB, label] of [
  [3, 0, 2, 1, 'Liegestuhl (gedreht) an Koffer'],
  [4, 0, 3, 0, 'Koffer an Reisetasche'],
  [1, 0, 2, 3, 'Liegestuhl (gedreht) an Kühlbox'],
  [0, 1, 5, 0, 'Cocktailkiste an Surfbrett (hochkant)'],
] as const) {
  const { game, t } = newGame();
  const p = comFor(shapeA, rotA, -3 * B, 0);
  const body = t.place(0, shapeA, p.x, p.y, rotA, true);
  const s = comFor(shapeB, rotB, 2 * B, -B);
  t.activate(0, shapeB, s.x, s.y, rotB);
  pushAll(t, -1);
  const a = t.lane(0).active!;
  const gap = horizGap(a, body);
  check(gap <= 1 && gap >= -t.SKIN, `${label}: Abstand ${gap.toFixed(2)} (≤ 1 Einheit ≈ 0,5 px)`);
  game.dispose();
}
{
  // Liegendes Teil, das nicht im Raster liegt (Physik hat es verschoben) und leicht verdreht ist
  const { game, t } = newGame();
  const p = comFor(1, 0, -3 * B + 3.3, 0);
  const body = t.place(0, 1, p.x, p.y, 0, false);
  t.step(120);
  Matter.Body.setAngle(body, 0.012);
  const s = comFor(1, 0, 2 * B, -0.3 * B);
  t.activate(0, 1, s.x, s.y, 0);
  pushAll(t, -1);
  const a = t.lane(0).active!;
  const gap = horizGap(a, body);
  check(gap <= 1 && gap >= -t.SKIN, `Kühlbox an verschobene, leicht schräge Kühlbox: Abstand ${gap.toFixed(2)}`);
  game.dispose();
}

// ------------------------------------------------------------------ An Wänden entlangrutschen

console.log('Seitlicher Kontakt ist kein Aufsetzen:');
{
  const { game, t } = newGame();
  const w = comFor(0, 1, 0, 0);
  const wall = t.place(0, 0, w.x, w.y, 1, true);
  Matter.Body.setAngle(wall, Math.PI / 2 + 0.01);
  const s = comFor(1, 0, -2.5 * B, -2.5 * B);
  t.activate(0, 1, s.x, s.y, 0);
  pushAll(t, 1);
  const id = t.lane(0).active!.id;
  const gap = horizGap(t.lane(0).active!, wall);
  let restY = NaN;
  for (let i = 0; i < 600 && t.lane(0).active?.id === id; i++) {
    t.step();
    const a = t.lane(0).active;
    if (a?.grounded && Number.isNaN(restY)) restY = bottomEdge(a);
  }
  check(gap <= 1, `Kühlbox liegt bündig an der schrägen Wand (Abstand ${gap.toFixed(2)})`);
  check(Math.abs(restY) < 1, `rutscht bis auf die Plattform statt an der Wand hängenzubleiben (Unterkante ${restY.toFixed(2)})`);
  game.dispose();
}

console.log('Schacht, genau 1 Block breit (Wände nicht im Raster):');
{
  const { game, t } = newGame();
  const off = 3;
  const l = comFor(0, 1, -B + off, 0);
  t.place(0, 0, l.x, l.y, 1, true);
  const r = comFor(0, 1, B + off, 0);
  t.place(0, 0, r.x, r.y, 1, true);
  const s = comFor(0, 1, 0, -6 * B);
  const a = t.activate(0, 0, s.x, s.y, 1);
  for (let i = 0; i < 600 && t.lane(0).active?.id === a.id; i++) t.step();
  const body = t.lane(0).bodies.at(-1)!;
  check(body.position.y > -2.5 * B && Math.abs(body.position.x - (B / 2 + off)) < 1, `Surfbrett rutscht in den Schacht (Schwerpunkt ${body.position.x.toFixed(1)}/${body.position.y.toFixed(1)})`);
  game.dispose();
}

// ------------------------------------------------------------------ Lock-Delay

console.log('Lock-Delay:');
{
  const { game, t } = newGame();
  const s = comFor(1, 0, -B, -0.3 * B);
  const a = t.activate(0, 1, s.x, s.y, 0);
  let n = 0;
  while (!t.lane(0).active?.grounded && n++ < 100) t.step();
  const steps = Math.floor((TURM.LOCK_MS - 60) / (1000 / 60));
  t.step(steps);
  check(t.lane(0).active?.id === a.id, `nach dem Aufsetzen noch ${TURM.LOCK_MS - 60} ms steuerbar`);
  const x0 = t.lane(0).active!.x;
  t.input('a', 'shift', { dir: 1 });
  check(t.lane(0).active!.x === x0 + B / 2, 'Verschieben im Liegen klappt');
  t.step(Math.ceil(TURM.LOCK_MAX_MS / (1000 / 60)));
  check(t.lane(0).active?.id !== a.id && t.lane(0).bodies.length === 1, 'danach wird es zum Physik-Körper');
  game.dispose();
}

// ------------------------------------------------------------------ Tucking

console.log('Unter einen Überhang schieben (Tucking):');
for (const [delay, label] of [[1, 'schnell getippt'], [7, 'gedrückt gehalten (110 ms)']] as const) {
  const { game, t } = newGame();
  // Boden (1 hoch) + schwebender Überhang darüber: Lücke y ∈ [−2B, −B], x ∈ [−3B, B], rechts offen
  const f = comFor(0, 0, -3 * B, 0);
  t.place(0, 0, f.x, f.y, 0, true);
  const o = comFor(0, 0, -3 * B, -2 * B);
  const over = t.place(0, 0, o.x, o.y, 0, true);
  const s = comFor(0, 0, 1.5 * B, -6 * B);
  const a = t.activate(0, 0, s.x, s.y, 0);
  // fallen lassen, bis das Teil ungefähr auf Höhe der Lücke ist (±5 Einheiten)
  let n = 0;
  while (bottomEdge(t.lane(0).active!) < -B - 5 && n++ < 400) t.step();
  const before = bottomEdge(t.lane(0).active!);
  let i = 0;
  while (leftEdge(t.lane(0).active ?? (a as Act)) > -3 * B + 0.01 && t.lane(0).active?.id === a.id && i++ < 20) {
    t.input('a', 'shift', { dir: -1 });
    t.step(delay);
  }
  const act = t.lane(0).active;
  check(act?.id === a.id && Math.abs(leftEdge(act) + 3 * B) < 0.01, `${label}: Teil (Unterkante ${before.toFixed(1)}) ganz unter den Überhang geschoben`);
  for (let k = 0; k < 200 && t.lane(0).active?.id === a.id; k++) t.step();
  const body = t.lane(0).bodies.find((b) => b !== over && Math.abs(b.position.y + 1.5 * B) < 1);
  check(!!body && Math.abs(body.position.x + B) < 1, `${label}: dort abgelegt (Schwerpunkt ${body ? `${body.position.x.toFixed(1)}/${body.position.y.toFixed(1)}` : '-'})`);
  game.dispose();
}

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(failed ? 1 : 0);
