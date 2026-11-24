/**
 * Tests ohne Browser für die Physik der Stapel- und Rempelspiele:
 * - Kofferpacken + Wackelturm: sauber abgestützte Stapel bleiben liegen (auch bei hartem Aufprall),
 *   ein hochkant stehendes Surfbrett bleibt stehen, Überhänge kippen trotzdem noch.
 * - Kofferpacken: bis unters Dach gepackt → es erscheint nichts mehr; Lücke frei → es geht weiter.
 * - Sumo-Steg: ein Rempler stößt den Gegner weit zurück.
 * Aufruf: `npm run test:physik`
 */
import Matter from 'matter-js';
import { KOFFER, KOFFER_ITEMS, kofferCellOffsets, kofferCom, kofferSnapX } from '../shared/koffer';
import { TURM, TURM_SHAPES, turmCellOffsets, turmSnapX } from '../shared/games';
import { SUMO, SUMO_CX, SUMO_CY } from '../shared/sumo';
import { KofferGame } from '../server/koffer';
import { TurmGame } from '../server/turm';
import { SumoGame } from '../server/sumo';

let failed = 0;
/** Zufallsstapel pro Fall (mehr zum Gegenprüfen: PHYSIK_SEEDS=60 npm run test:physik) */
const SEEDS = Number(process.env.PHYSIK_SEEDS) || 20;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};

const ctx = {
  onChange() {},
  finish() {},
  isConnected: () => true,
  nameOf: (id: string) => id,
  mode: 'arcade',
} as unknown as ConstructorParameters<typeof KofferGame>[1];

type Offs = { x: number; y: number }[];
type Placement = { item: number; rot: number; x: number; y: number };

/**
 * Zufälliger Stapel, in dem jede Spalte der Unterseite eines Teils aufliegt (keine Löcher, keine Überhänge) –
 * physikalisch muss so ein Stapel einfach liegen bleiben. Koordinaten: Physik (y nach unten), Boden bei y = 0.
 */
function supportedStack(seed: number, o: { kinds: number; offs: (k: number, rot: number) => Offs; snap: (k: number, rot: number, x: number) => number; x0: number; x1: number; maxH: number; max: number }) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const B = 16;
  const half = B / 2;
  const cols = Math.round((o.x1 - o.x0) / half);
  const h = new Array(cols).fill(0);
  const col = (x: number) => Math.round((x - o.x0) / half);
  const out: Placement[] = [];
  for (let n = 0; n < 500 && out.length < o.max; n++) {
    const item = Math.floor(rnd() * o.kinds);
    const rot = Math.floor(rnd() * 4);
    const offs = o.offs(item, rot).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    const minX = Math.min(...offs.map((p) => p.x)) - half;
    const maxX = Math.max(...offs.map((p) => p.x)) + half;
    const slots = Math.floor((o.x1 - o.x0 - (maxX - minX)) / B) + 1;
    if (slots < 1) continue;
    const left = o.x0 + Math.floor(rnd() * slots) * B;
    const cx = o.snap(item, rot, left - minX);
    let yUp = 0;
    for (const p of offs) for (let c = col(cx + p.x - half); c < col(cx + p.x - half) + 2; c++) yUp = Math.max(yUp, h[c] + p.y + half);
    if (yUp + Math.max(...offs.map((p) => -p.y)) + half > o.maxH) continue;
    const low = new Map<number, number>();
    for (const p of offs) for (let c = col(cx + p.x - half); c < col(cx + p.x - half) + 2; c++) low.set(c, Math.min(low.get(c) ?? Infinity, yUp - p.y - half));
    if ([...low].some(([c, b]) => Math.abs(h[c] - b) > 0.01)) continue;
    for (const p of offs) for (let c = col(cx + p.x - half); c < col(cx + p.x - half) + 2; c++) h[c] = Math.max(h[c], yUp - p.y + half);
    out.push({ item, rot, x: cx, y: -yUp });
  }
  return out;
}

/** Wie weit haben sich Körper seit `ref` bewegt? */
function drift(bodies: Matter.Body[], ref: { x: number; y: number; a: number }[]) {
  let moved = 0;
  let worst = 0;
  bodies.forEach((b, i) => {
    const d = Math.hypot(b.position.x - ref[i].x, b.position.y - ref[i].y);
    worst = Math.max(worst, d);
    if (d > 2 || Math.abs(b.angle - ref[i].a) > 0.05) moved++;
  });
  return { moved, worst };
}

// ------------------------------------------------------------------ Kofferpacken: Stapel bleiben liegen

const KB = KOFFER.BLOCK;
const KW = KOFFER.W * KB;

console.log(`Kofferpacken – abgestützte Stapel bleiben liegen (je ${SEEDS} Zufallsstapel):`);
for (const [vy, label] of [[0, 'sanft abgelegt'], [3, 'harter Aufprall (≈ 11 Blöcke/s)']] as const) {
  let moved = 0;
  let total = 0;
  let worst = 0;
  let bad = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const game = new KofferGame(['a'], ctx);
    const t = game.testApi();
    t.begin();
    const plan = supportedStack(seed * 104729, { kinds: KOFFER_ITEMS.length, offs: (k, r) => kofferCellOffsets(k, (r * Math.PI) / 2), snap: kofferSnapX, x0: 0, x1: KW, maxH: KOFFER.ROOF * KB, max: 30 });
    const bodies: Matter.Body[] = [];
    for (const p of plan) {
      bodies.push(t.place(0, p.item, p.x, p.y, p.rot, vy));
      t.step(90);
    }
    t.step(1200);
    const r = drift(bodies, plan.map((p) => ({ x: p.x, y: p.y, a: (p.rot * Math.PI) / 2 })));
    moved += r.moved;
    total += bodies.length;
    worst = Math.max(worst, r.worst);
    if (r.moved) bad++;
    game.dispose();
  }
  check(moved === 0, `${label}: ${moved}/${total} Teile verrutscht, in ${bad}/${SEEDS} Stapeln (größter Weg ${worst.toFixed(1)} Einheiten, 16 = 1 Block)`);
}

console.log('Kofferpacken – Einzelfälle:');
{
  const game = new KofferGame(['a'], ctx);
  const t = game.testApi();
  t.begin();
  // Surfbrett hochkant (1 × 5) auf dem Boden
  const surf = 2;
  const com = kofferCom(surf);
  const offs = kofferCellOffsets(surf, Math.PI / 2);
  const x = kofferSnapX(surf, 1, 5 * KB);
  const y = -(Math.max(...offs.map((p) => p.y)) + KB / 2);
  const b = t.place(0, surf, x, y, 1);
  t.step(1200);
  check(Math.abs(b.angle - Math.PI / 2) < 0.05 && Math.abs(b.position.x - x) < 2, `Surfbrett hochkant bleibt stehen (Winkel ${(((b.angle - Math.PI / 2) * 180) / Math.PI).toFixed(1)}°, x ${(b.position.x - x).toFixed(1)})`);
  void com;
  game.dispose();
}
{
  const game = new KofferGame(['a'], ctx);
  const t = game.testApi();
  t.begin();
  // Surfbrett liegt auf der Ladekante, Schwerpunkt draußen → muss rauskippen
  const surf = 2;
  const left = KW - 1.5 * KB;
  const x = left + 2.5 * KB;
  const y = -(KOFFER.LIP * KB + KB / 2);
  t.place(0, surf, x, y, 0);
  t.step(600);
  check(t.car(0).lost === 1 && t.car(0).bodies.length === 0, `Surfbrett, das über die Ladekante hängt, fällt raus (rausgefallen: ${t.car(0).lost})`);
  game.dispose();
}

// ------------------------------------------------------------------ Kofferpacken: bis unters Dach → nichts mehr

console.log('Kofferpacken – bis unters Dach gepackt:');
/** Vier Lagen Koffer/Kühlbox (je 2 hoch, versetzt) + eine Reihe Schuhkartons = genau bis zur Dachlinie */
function packFull(t: ReturnType<KofferGame['testApi']>, skipLast = 0) {
  const KOF = 0;
  const KUEHL = 1;
  const SCHUH = 8;
  const plan: [number, number][] = [];
  for (let layer = 0; layer < 4; layer++) {
    const row = layer % 2 ? [[KUEHL, 0], [KOF, 2], [KOF, 5], [KOF, 8], [KOF, 11]] : [[KOF, 0], [KOF, 3], [KOF, 6], [KOF, 9], [KUEHL, 12]];
    for (const [it, c] of row) plan.push([it, c]);
  }
  for (let c = 0; c < 14; c += 2) plan.push([SCHUH, c]);
  for (const [item, c] of plan.slice(0, plan.length - skipLast)) {
    const com = kofferCom(item);
    t.drop(0, item, kofferSnapX(item, 0, c * KB + com.x * KB), 0);
  }
}
{
  const game = new KofferGame(['a'], ctx);
  const t = game.testApi();
  t.begin();
  packFull(t);
  t.step(120);
  const placed = t.car(0).bodies.length;
  check(placed === 27 && t.car(0).lost === 0, `27 Teile per ▼ an ihren Platz gelegt (${placed} im Auto, ${t.car(0).lost} rausgefallen)`);
  t.autoSpawn(0);
  t.step(240);
  check(!t.car(0).active && t.car(0).bodies.length === 27 && t.car(0).full, `danach erscheint 4 s lang kein neues Teil, das Auto ist VOLL (aktiv: ${!!t.car(0).active}, Teile: ${t.car(0).bodies.length}, voll: ${t.car(0).full}, Stand: ${t.dachStand(0)})`);
  check(t.car(0).pct === 100, `Füllstand 100 % (${t.car(0).pct} %)`);
  game.dispose();
}
{
  const game = new KofferGame(['a'], ctx);
  const t = game.testApi();
  t.begin();
  packFull(t, 2);
  t.step(120);
  t.autoSpawn(0);
  t.step(20);
  check(!!t.car(0).active && !t.car(0).full, `oben noch Platz für zwei Schuhkartons → es kommt weiter ein Teil (aktiv: ${!!t.car(0).active}, Stand: ${t.dachStand(0)})`);
  game.dispose();
}

// ------------------------------------------------------------------ Wackelturm

const TB = TURM.BLOCK;
const half = (TURM.PLATFORM_W / 2) * TB;
const turmCtx = ctx as unknown as ConstructorParameters<typeof TurmGame>[1];

console.log(`Wackelturm – abgestützte Türme bleiben stehen (je ${SEEDS} Zufallstürme):`);
for (const [vy, label] of [[0, 'sanft abgelegt'], [3, 'mit ▼ aufgeschlagen (≈ 11 Blöcke/s)']] as const) {
  let moved = 0;
  let total = 0;
  let worst = 0;
  let bad = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const game = new TurmGame(['a'], turmCtx);
    const t = game.testApi();
    t.begin();
    const plan = supportedStack(seed * 7919, { kinds: TURM_SHAPES.length, offs: (k, r) => turmCellOffsets(k, (r * Math.PI) / 2), snap: turmSnapX, x0: -half, x1: half, maxH: 10 * TB, max: 18 });
    const bodies: Matter.Body[] = [];
    for (const p of plan) {
      bodies.push(t.place(0, p.item, p.x, p.y, p.rot, false, vy));
      t.step(90);
    }
    t.step(1200);
    const r = drift(bodies, plan.map((p) => ({ x: p.x, y: p.y, a: (p.rot * Math.PI) / 2 })));
    moved += r.moved;
    total += bodies.length;
    worst = Math.max(worst, r.worst);
    if (r.moved) bad++;
    game.dispose();
  }
  check(moved === 0, `${label}: ${moved}/${total} Teile verrutscht, in ${bad}/${SEEDS} Türmen (größter Weg ${worst.toFixed(1)})`);
}

console.log('Wackelturm – Einzelfälle:');
{
  const game = new TurmGame(['a'], turmCtx);
  const t = game.testApi();
  t.begin();
  const offs = turmCellOffsets(0, Math.PI / 2);
  const x = turmSnapX(0, 1, 0);
  const y = -(Math.max(...offs.map((p) => p.y)) + TB / 2);
  const b = t.place(0, 0, x, y, 1, false);
  t.step(1200);
  check(Math.abs(b.angle - Math.PI / 2) < 0.05 && Math.abs(b.position.x - x) < 2, `Surfbrett hochkant bleibt stehen (Winkel ${(((b.angle - Math.PI / 2) * 180) / Math.PI).toFixed(1)}°)`);
  game.dispose();
}
{
  const game = new TurmGame(['a'], turmCtx);
  const t = game.testApi();
  t.begin();
  // Surfbrett (4 × 1) ragt 2,5 Blöcke über den Plattformrand → Schwerpunkt draußen → ins Meer
  const x = half + 0.5 * TB;
  t.place(0, 0, x, -TB / 2, 0, false);
  t.step(600);
  check(t.lane(0).bodies.length === 0, `Surfbrett mit Schwerpunkt über dem Rand kippt ins Meer (${t.lane(0).bodies.length} Teile auf der Plattform)`);
  game.dispose();
}

// ------------------------------------------------------------------ Sumo-Steg

console.log('Sumo-Steg – Rempler:');
{
  const sumoCtx = { ...ctx, practice: true } as unknown as ConstructorParameters<typeof SumoGame>[1];
  const knock = (bDash: boolean) => {
    const game = new SumoGame(['a', 'b'], sumoCtx);
    const t = game.testApi();
    const x0 = SUMO_CX - 60;
    t.begin({ a: { x: x0, y: SUMO_CY }, b: { x: x0 + 30, y: SUMO_CY } });
    t.dash('a', 1, 0);
    if (bDash) t.dash('b', -1, 0);
    const who = bDash ? 'a' : 'b';
    let hitX = NaN;
    let far = NaN;
    let aAfter = NaN;
    for (let i = 0; i < 90; i++) {
      t.step();
      const p = t.player(who);
      if (p.stunUntil && Number.isNaN(hitX)) {
        hitX = p.x;
        aAfter = t.player('a').x;
      }
      if (!Number.isNaN(hitX)) far = Number.isNaN(far) ? p.x : bDash ? Math.min(far, p.x) : Math.max(far, p.x);
    }
    const rest = Math.abs(t.player('a').x - aAfter);
    game.dispose();
    return { d: Math.abs(far - hitX), rest };
  };
  const plain = knock(false);
  const front = knock(true);
  check(plain.d >= 85, `Gegner fliegt nach einem Rempler ${plain.d.toFixed(0)} px weit (≥ 85 px ≈ 5 Planken; früher ≈ 55)`);
  check(plain.rest <= 25, `Rempler selbst bleibt fast stehen (${plain.rest.toFixed(0)} px nach dem Treffer)`);
  check(front.d >= 95, `Frontalzusammenstoß: ${front.d.toFixed(0)} px (≥ 95 px)`);
  void SUMO;
}

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(failed ? 1 : 0);
