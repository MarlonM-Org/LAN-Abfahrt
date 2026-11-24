/**
 * Tests ohne Browser für „Aufräumen!“ (Besen statt runder Schiebe-Hitbox) und die TV-Glättung:
 * - Sache vor dem Besen: geradeaus und im Bogen bleibt sie auf der Geraden vor der Kante (kaum seitliche Abweichung),
 *   auch am Besenende; sie wird nicht seitlich weggeschossen
 * - der Körper schubst nichts weg (nur sanft beiseite, ohne Schwung)
 * - der Besen dreht weich (höchstens TURN·dt pro Takt), SPRINT schießt geradeaus, Wand und Ecken, Korb zählt
 * - Bots bringen mit dem Besen Sachen in ihren Korb, Aufwärmrunde ohne Zeitlimit mit neuem Chaos
 * - Snapshot schlank (gerundet, ohne Art-Namen) mit Takt-Zeit `t`
 * - SnapBuffer (client/host/interp.ts): Verzögerung passt sich dem Takt an (30 Hz → ≈ 40 ms statt 60 ms), ohne ins Stocken zu kommen
 * Aufruf: `npm run test:aufraeumen`
 */
import { TIDY } from '../shared/games';
import type { TidyState } from '../shared/types';
import { TidyGame, tidyLocal } from '../server/controllergames';
import { tidyBot, type TidyBotMem } from '../server/tidybot';
import { SnapBuffer } from '../client/host/interp';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
const f1 = (v: number) => v.toFixed(1);

const ctx = {
  onChange() {},
  finish() {},
  isConnected: () => true,
  nameOf: (id: string) => id,
  mode: 'arcade',
} as unknown as ConstructorParameters<typeof TidyGame>[1];

const A = TIDY.AREA;
const FRONT = TIDY.BROOM_D + TIDY.ITEM_R;
const DT = TIDY.TICK_MS / 1000;
const ticks = (s: number) => Math.round(s / DT);

/** Ein Spieler „a“ (bzw. a + b), eine Sache in Spieler-Koordinaten (u nach vorn, v quer) vor ihm */
function setup(p: { x: number; y: number; a: number }, items: { u: number; v: number }[], ids = ['a']) {
  const game = new TidyGame(ids, ctx);
  const api = game.testApi();
  const c = Math.cos(p.a);
  const s = Math.sin(p.a);
  api.begin({ a: p }, items.map(({ u, v }) => ({ x: p.x + u * c - v * s, y: p.y + u * s + v * c })));
  return { game, api };
}

// ------------------------------------------------------------------ Geradeaus

console.log('Besen – geradeaus schieben:');
for (const v0 of [0, 4, -7, TIDY.BROOM_HALF, -(TIDY.BROOM_HALF + 2)]) {
  const { api, game } = setup({ x: 120, y: 150, a: 0 }, [{ u: FRONT + 0.5, v: v0 }]);
  api.stick('a', 1, 0);
  let worstV = 0;
  let worstU = 0;
  let maxSpeed = 0;
  const start = { ...api.items()[0] };
  for (let k = 0; k < ticks(1.5); k++) {
    api.step();
    const it = api.items()[0];
    const l = tidyLocal(api.player('a'), it.x, it.y);
    worstV = Math.max(worstV, Math.abs(l.v - v0));
    if (k > 2) worstU = Math.max(worstU, Math.abs(l.u - FRONT));
    maxSpeed = Math.max(maxSpeed, Math.hypot(it.vx, it.vy));
  }
  const it = api.items()[0];
  check(
    worstV < 0.6 && worstU < 1.5 && it.x - start.x > 90 && maxSpeed <= TIDY.SPEED,
    `Querlage ${f1(v0)}: ${f1(it.x - start.x)} px geschoben, seitlich höchstens ${f1(worstV)} px, vor der Kante ±${f1(worstU)} px, Tempo ≤ ${f1(maxSpeed)} px/s`,
  );
  game.dispose();
}

// ------------------------------------------------------------------ Im Bogen

console.log('Besen – im Bogen laufen nimmt die Sachen auf der Geraden mit:');
for (const [w, y0] of [
  [2, 100],
  [-2, 210],
  [3.2, 110],
] as const) {
  for (const v0 of [-8, 0, 8]) {
    const { api, game } = setup({ x: 240, y: y0, a: 0 }, [{ u: FRONT + 0.3, v: v0 }]);
    let worstV = 0;
    let worstU = 0;
    let turned = 0;
    let lastA = 0;
    for (let k = 0; k < ticks(1.5); k++) {
      const ang = w * k * DT;
      api.stick('a', Math.cos(ang), Math.sin(ang));
      api.step();
      const p = api.player('a');
      turned += Math.abs(Math.atan2(Math.sin(p.a - lastA), Math.cos(p.a - lastA)));
      lastA = p.a;
      const it = api.items()[0];
      const l = tidyLocal(p, it.x, it.y);
      worstV = Math.max(worstV, Math.abs(l.v - v0));
      if (k > 3) worstU = Math.max(worstU, Math.abs(l.u - FRONT));
    }
    check(
      worstV < 1 && worstU < 1.5 && turned > 2.5,
      `Bogen ${w > 0 ? 'rechts' : 'links'}herum (${f1(Math.abs(w))} rad/s, ${Math.round((turned * 180) / Math.PI)}°), Querlage ${v0}: seitlich höchstens ${f1(worstV)} px, vor der Kante ±${f1(worstU)} px`,
    );
    game.dispose();
  }
}

// Mehrere Sachen nebeneinander auf dem Besen: alle bleiben drauf
{
  const { api, game } = setup({ x: 240, y: 100, a: 0 }, [
    { u: FRONT + 0.3, v: -9 },
    { u: FRONT + 0.3, v: 0 },
    { u: FRONT + 0.3, v: 9 },
  ]);
  for (let k = 0; k < ticks(1.5); k++) {
    const ang = 2 * k * DT;
    api.stick('a', Math.cos(ang), Math.sin(ang));
    api.step();
  }
  const p = api.player('a');
  const ls = api.items().map((it) => tidyLocal(p, it.x, it.y));
  check(
    ls.every((l) => Math.abs(l.u - FRONT) < 2 && Math.abs(l.v) < TIDY.BROOM_HALF + 3),
    `drei Sachen nebeneinander, Bogen 170°: alle noch vor der Kante (Querlagen ${ls.map((l) => f1(l.v)).join(' / ')})`,
  );
  game.dispose();
}

// ------------------------------------------------------------------ Körper

console.log('Körper – schubst nichts mehr weg:');
{
  // Sache seitlich am Körper: wird nur senkrecht hinausgeschoben, ohne Schwung
  const { api, game } = setup({ x: 200, y: 150, a: 0 }, [{ u: 1, v: 6 }]);
  const before = { ...api.items()[0] };
  api.step();
  const it = api.items()[0];
  const l = tidyLocal(api.player('a'), it.x, it.y);
  check(Math.abs(l.v - (TIDY.BODY_H + TIDY.ITEM_R)) < 0.01 && Math.abs(it.x - before.x) < 0.01 && Math.hypot(it.vx, it.vy) === 0, `Sache am Körper: senkrecht auf ${f1(l.v)} px hinaus, kein Schwung`);
  // Weiterlaufen: der Körper gleitet vorbei, die Sache bleibt fast liegen (früher: Schuss mit 86 px/s)
  api.stick('a', 1, 0);
  let maxSpeed = 0;
  for (let k = 0; k < ticks(0.6); k++) {
    api.step();
    const i2 = api.items()[0];
    maxSpeed = Math.max(maxSpeed, Math.hypot(i2.vx, i2.vy));
  }
  const i3 = api.items()[0];
  check(Math.hypot(i3.x - before.x, i3.y - before.y) < 4 && maxSpeed < 1, `vorbeilaufen: Sache bewegt sich ${f1(Math.hypot(i3.x - before.x, i3.y - before.y))} px, Tempo höchstens ${f1(maxSpeed)} px/s`);
  game.dispose();
}

// ------------------------------------------------------------------ Drehen

console.log('Drehen – weich und zügig:');
for (const target of [Math.PI / 2, Math.PI, -2.5]) {
  const { api, game } = setup({ x: 240, y: 150, a: 0 }, [{ u: 60, v: 60 }]);
  api.stick('a', Math.cos(target) * 0.2, Math.sin(target) * 0.2);
  let maxStep = 0;
  let last = 0;
  let reached = -1;
  for (let k = 0; k < 40; k++) {
    api.step();
    const a = api.player('a').a;
    maxStep = Math.max(maxStep, Math.abs(Math.atan2(Math.sin(a - last), Math.cos(a - last))));
    last = a;
    if (reached < 0 && Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target))) < 0.01) reached = k + 1;
  }
  const ms = reached * TIDY.TICK_MS;
  check(maxStep <= TIDY.TURN * DT + 1e-9 && reached > 1 && ms <= 360, `auf ${Math.round((target * 180) / Math.PI)}°: nach ${ms} ms, höchstens ${f1((maxStep * 180) / Math.PI)}° pro Takt`);
  game.dispose();
}

// ------------------------------------------------------------------ Sprint

console.log('Sprint – Sachen fliegen geradeaus:');
{
  const { api, game } = setup({ x: 150, y: 150, a: 0.4 }, [{ u: FRONT + 0.3, v: 5 }]);
  api.dash('a');
  api.step(ticks(0.8));
  const p = api.player('a');
  const it = api.items()[0];
  const l = tidyLocal({ x: 150, y: 150, a: 0.4 }, it.x, it.y);
  const ahead = tidyLocal(p, it.x, it.y).u - FRONT;
  check(Math.abs(l.v - 5) < 1 && ahead > 15, `Sprint aus dem Stand: Sache ${f1(ahead)} px vor dem Besen, seitlich ${f1(Math.abs(l.v - 5))} px von der Linie`);
  game.dispose();
}

// ------------------------------------------------------------------ Wand, Ecke, Korb

console.log('Zimmer – Wand, Ecke, Korb:');
{
  const { api, game } = setup({ x: A.x + 60, y: 120, a: Math.PI }, [{ u: 200, v: 50 }]);
  api.stick('a', -1, 0.05);
  let minEdge = Infinity;
  for (let k = 0; k < ticks(2); k++) {
    api.step();
    const p = api.player('a');
    minEdge = Math.min(minEdge, p.x + Math.cos(p.a) * TIDY.BROOM_D - A.x);
  }
  check(minEdge >= 2 * TIDY.ITEM_R - 0.5, `gegen die Wand: Besenkante bleibt ${f1(minEdge)} px davor (Platz für eine Sache)`);
  game.dispose();
}
{
  const { api, game } = setup({ x: 300, y: 150, a: 0 }, []);
  api.begin({}, [{ x: A.x + TIDY.ITEM_R, y: A.y + TIDY.ITEM_R }]);
  api.step(ticks(2.5));
  const it = api.items()[0];
  check(it.x - A.x >= 18 && it.y - A.y >= 18, `Sache in der Ecke rollt heraus: nach 2,5 s bei (${f1(it.x - A.x)}, ${f1(it.y - A.y)}) px von den Wänden`);
  game.dispose();
}
{
  const by = A.y + A.h / 2;
  const { api, game } = setup({ x: A.x + 95, y: by + 3, a: Math.PI }, [{ u: FRONT + 0.3, v: 2 }]);
  api.stick('a', -1, 0);
  api.step(ticks(1.5));
  check(api.score().A === 1 && api.items().length === 0 && api.over(), `Solo: Sache in den Korb geschoben → ${api.score().A} Punkt, Spiel vorbei`);
  game.dispose();
}

// ------------------------------------------------------------------ Bots

console.log('Bots – mit dem Besen voran zum Korb:');
{
  // fester Zufall, damit der Test reproduzierbar ist
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const orig = Math.random;
  Math.random = rnd;
  for (const ids of [['a'], ['a', 'b'], ['a', 'b', 'c', 'd']]) {
    const game = new TidyGame(ids, ctx);
    const api = game.testApi();
    api.begin({}, null);
    const mem: Record<string, TidyBotMem> = Object.fromEntries(ids.map((id) => [id, { target: null }]));
    const secs = 60;
    for (let k = 0; k < ticks(secs) && !api.over(); k++) {
      // Bots entscheiden etwa alle 100 ms (wie über das Netz)
      if (k % 6 === 0) {
        const st = api.state()!;
        for (const id of ids) {
          const mv = tidyBot(st, id, mem[id], rnd);
          api.stick(id, mv.x, mv.y);
          if (mv.dash) api.dash(id);
        }
      }
      api.step();
    }
    const sc = api.score();
    const per = ids.length === 1 ? sc.A : Math.min(sc.A, sc.B);
    const need = ids.length === 1 ? 8 : 5;
    check(per >= need, `${ids.length} Bot(s), ${secs} s: Sonne ${sc.A}${ids.length > 1 ? ` · Meer ${sc.B}` : ''} Teile (mindestens ${need} pro Team)`);
    game.dispose();
  }
  Math.random = orig;
}

// ------------------------------------------------------------------ Aufwärmrunde

console.log('Aufwärmrunde:');
{
  const game = new TidyGame(['a'], { ...ctx, practice: true } as typeof ctx);
  (game as unknown as { start(): void }).start();
  const st = game.snapshot().state as TidyState;
  check(st.endsIn === 0, 'kein Zeitlimit (endsIn 0)');
  game.dispose();
  const g2 = new TidyGame(['a'], { ...ctx, practice: true } as typeof ctx);
  const api = g2.testApi();
  const b = { x: A.x + 24, y: A.y + A.h / 2 };
  api.begin({ a: { x: 300, y: 100, a: 0 } }, [b, { x: b.x + 1, y: b.y + 1 }]);
  api.step();
  check(!api.over() && api.items().length === TIDY.ITEMS && api.items()[0].id >= 2, `alles aufgeräumt → neues Chaos (${api.items().length} Sachen, neue ids), Spiel läuft weiter`);
  g2.dispose();
}

// ------------------------------------------------------------------ Snapshot

console.log('Snapshot:');
{
  const ids = ['3f2b1c0a-1111-4222-8333-944455556666', '3f2b1c0a-1111-4222-8333-944455556667', '3f2b1c0a-1111-4222-8333-944455556668', '3f2b1c0a-1111-4222-8333-944455556669'];
  const game = new TidyGame(ids, ctx);
  const api = game.testApi();
  api.begin({}, null);
  for (const id of ids) api.stick(id, 0.7, 0.3);
  api.step(30);
  const st = api.state()!;
  const json = JSON.stringify({ kind: 'tidy', state: st });
  const dec = (v: number) => (String(v).split('.')[1] ?? '').length;
  const rounded = Object.values(st.players).every((p) => dec(p.x) <= 1 && dec(p.y) <= 1 && dec(p.a) <= 2) && st.items.every((i) => dec(i.x) <= 1 && dec(i.y) <= 1);
  check(json.length < 1700 && st.t > 0 && rounded && !json.includes('"type":"shirt"'), `4 Spieler, ${st.items.length} Sachen: ${json.length} Bytes (vorher ≈ 2520), mit Takt-Zeit t, Werte gerundet`);
  game.dispose();
}

// ------------------------------------------------------------------ SnapBuffer

console.log('TV-Glättung (SnapBuffer):');
{
  // performance.now() von außen steuern: Pakete alle 33 ms (Server-Zeit) mit wenig Jitter wie im Heimnetz
  let now = 1000;
  Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
  const run = (gapMs: number, jitter: number, secs: number, drop = 0) => {
    const buf = new SnapBuffer<{ x: number }>();
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const packets: { at: number; t: number }[] = [];
    for (let t = 0; t < secs * 1000; t += gapMs) if (rnd() >= drop) packets.push({ t: 50_000 + t, at: 1000 + t + rnd() * jitter });
    packets.sort((a, b) => a.at - b.at);
    let pi = 0;
    let extra = 0;
    let frames = 0;
    let lagSum = 0;
    let lastX: number | null = null;
    let worstJump = 0;
    for (let frame = 1000; frame < 1000 + secs * 1000; frame += 1000 / 60) {
      // Pakete kommen zwischen den Bildern an (eigene Ereignisse im Browser) – mit ihrer echten Ankunftszeit
      while (pi < packets.length && packets[pi].at <= frame) {
        now = packets[pi].at;
        buf.push(packets[pi].t, { x: (packets[pi].t - 50_000) * 0.078 });
        pi++;
      }
      now = frame;
      const s = buf.sample();
      if (!s || now < 1500) continue;
      frames++;
      if (s.f > 1) extra++;
      lagSum += buf.latestT - s.t;
      const x = s.a.x + (s.b.x - s.a.x) * s.f;
      if (lastX !== null) worstJump = Math.max(worstJump, Math.abs(x - lastX - 78 / 60));
      lastX = x;
    }
    return { lag: lagSum / frames, extra: extra / frames, worstJump, delay: buf.lag };
  };
  const lan = run(33, 4, 6);
  check(lan.delay < 48 && lan.extra < 0.02 && lan.worstJump < 0.3, `30 Hz, 4 ms Jitter: Verzögerung ${f1(lan.delay)} ms (vorher fest 60), ${f1(lan.extra * 100)} % Bilder hochgerechnet, Ruckler ≤ ${f1(lan.worstJump)} px`);
  const slow = run(50, 4, 6);
  check(slow.delay <= 60 && slow.extra < 0.03, `20 Hz: Verzögerung ${f1(slow.delay)} ms (höchstens die alten 60), ${f1(slow.extra * 100)} % hochgerechnet`);
  const rough = run(33, 40, 6);
  check(rough.delay <= 60 + 1e-9, `30 Hz, 40 ms Jitter: Verzögerung ${f1(rough.delay)} ms – nie mehr als vorher (60), ${f1(rough.extra * 100)} % hochgerechnet`);
}

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests ok');
process.exit(failed ? 1 : 0);
