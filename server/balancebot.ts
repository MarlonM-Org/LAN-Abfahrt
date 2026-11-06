import type { GameState } from '../shared/types';
import { SKI, type SkiState } from '../shared/skisprung';
import { TEP, type TepState, birdX, birdY, tepCourse } from '../shared/teppich';
import { KUG, type KugelState, kugelCourse, kugelLean, routePoint, wrapAng } from '../shared/kugel';

/**
 * Bots auf dem Balance Board: Ist der Bot dran, schickt er selbst Messwerte (Eingabe `bb`, 30 Hz) –
 * mit etwas Zittern, eigenem Können und (beim Skispringen) einem leicht verwackelten Absprung-Timing.
 */
interface BotLike {
  id: string;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
}

interface Mem {
  timer: NodeJS.Timeout | null;
  kg: number;
  skill: number;
  /** Skispringen: geplanter Absprung (s vor/nach der Kante) */
  jitter: number;
  jumpAt: number;
  turn: string;
  /** Teppich: Strecke (für die Ausweich-Logik) */
  seed: number;
  course: ReturnType<typeof tepCourse> | null;
  kseed: number;
  kcourse: ReturnType<typeof kugelCourse> | null;
}

const mems = new WeakMap<BotLike, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function balanceBot(bot: BotLike, kind: 'skisprung' | 'teppich' | 'kugel', st: SkiState | TepState | KugelState) {
  let m = mems.get(bot);
  if (!m) mems.set(bot, (m = { timer: null, kg: rand(55, 95), skill: rand(0.45, 0.95), jitter: 0, jumpAt: 0, turn: '', seed: -1, course: null, kseed: -1, kcourse: null }));
  const mine = st.active === bot.id && st.sub !== 'over';
  if (!mine) {
    if (m.timer) clearInterval(m.timer);
    m.timer = null;
    return;
  }
  if (m.timer) return;
  const mem = m;
  mem.turn = `${st.active}-${Date.now()}`;
  mem.jitter = rand(-0.25, 0.25) * (1.3 - mem.skill);
  mem.jumpAt = 0;
  const t0 = Date.now() + rand(800, 2500); // erst noch zum Board „laufen“
  mem.timer = setInterval(() => {
    const cur = bot.state?.mini;
    if (!cur || cur.kind !== kind || cur.state.active !== bot.id) {
      if (mem.timer) clearInterval(mem.timer);
      mem.timer = null;
      return;
    }
    if (Date.now() < t0) return bot.send('bb', { w: 0, x: 0, y: 0 });
    const noise = (1.2 - mem.skill) * 0.25;
    let x = rand(-noise, noise);
    let y = rand(-noise, noise);
    let w = mem.kg + rand(-0.4, 0.4);
    if (cur.kind === 'skisprung') {
      const s = cur.state;
      if (s.sub === 'flight') y += SKI.FLIGHT_Y * mem.skill + rand(-0.05, 0.05);
      if (s.sub === 'inrun') {
        const v = Math.max(1, s.kmh / 3.6);
        const toEdge = -s.px / v;
        if (!mem.jumpAt && toEdge <= -mem.jitter) mem.jumpAt = Date.now();
      }
      if (s.sub === 'flight' && !mem.jumpAt && Math.random() < 0.2) mem.jumpAt = Date.now();
      const since = Date.now() - mem.jumpAt;
      if (mem.jumpAt && since < 200) w = mem.kg * 1.32;
      else if (mem.jumpAt && since < 320) w = mem.kg * 0.8;
    } else if (cur.kind === 'kugel') {
      const s = cur.state;
      if (s.seed !== mem.kseed) {
        mem.kseed = s.seed;
        mem.kcourse = kugelCourse(s.seed);
      }
      const c = mem.kcourse;
      if (s.sub === 'roll' && c && s.fall === 0) {
        // Nächster Wegpunkt auf dem Lösungsweg: der vordere der beiden Zellen, an denen wir gerade „dran“ sind
        let near = 0;
        let nd = Infinity;
        c.route.forEach((_, i) => {
          const p = routePoint(c, i);
          const d = Math.hypot(p.x - s.x, p.y - s.y);
          if (d < nd) {
            nd = d;
            near = i;
          }
        });
        const p0 = routePoint(c, near);
        const p1 = routePoint(c, near + 1);
        const p2 = routePoint(c, near + 2);
        // Auf dem Weg bleiben: zur Pfadlinie hinziehen, dann in Laufrichtung. Vor Ecken abbremsen.
        const dir = { x: Math.sign(p1.x - p0.x), y: Math.sign(p1.y - p0.y) };
        const turn = Math.sign(p2.x - p1.x) !== dir.x || Math.sign(p2.y - p1.y) !== dir.y;
        const toNext = Math.hypot(p1.x - s.x, p1.y - s.y);
        const cruise = (turn && toNext < 34 ? 22 : 62) * (0.55 + mem.skill * 0.55);
        const wantX = dir.x * cruise + (dir.x === 0 ? (p0.x - s.x) * 3 : 0);
        const wantY = dir.y * cruise + (dir.y === 0 ? (p0.y - s.y) * 3 : 0);
        // Hoverboard-Regler: zur Wunschrichtung drehen (seitlich lehnen), Tempo über vorn/hinten – in Kurven langsam
        const err = wrapAng(Math.atan2(wantY, wantX) - s.ang);
        const steer = clamp(err * 1.6, -1, 1);
        const fwd = s.vx * Math.cos(s.ang) + s.vy * Math.sin(s.ang);
        const want = Math.min(KUG.VMAX, Math.hypot(wantX, wantY)) * (Math.abs(err) > 0.5 ? 0.15 : 1);
        const thr = clamp(((want - fwd) * 2.2) / KUG.ACCEL, -1, 1);
        x += kugelLean(steer);
        y += kugelLean(thr);
      }
    } else if (cur.kind === 'teppich') {
      const s = cur.state;
      if (s.seed !== mem.seed) {
        mem.seed = s.seed;
        mem.course = tepCourse(s.seed);
      }
      if (s.sub === 'fly' && mem.course) {
        // Ziel-Höhe: Mitte der nächsten Lücke bzw. weg vom nächsten Geier, sonst zum nächsten Juwel
        const ahead = s.x + 70 * (0.7 + mem.skill);
        let want = 135;
        for (const o of mem.course.obstacles) {
          if (o.k === 'bird') {
            const bx = birdX(o, s.ft + 0.5);
            if (bx > s.x && bx < ahead + 40) want = birdY(o, s.ft + 0.5) > 135 ? 70 : 200;
            continue;
          }
          if (o.x + o.w < s.x - 10 || o.x > ahead + 60) continue;
          const top = o.k === 'cloud' ? o.bottom : TEP.CEIL_Y;
          const next = mem.course.obstacles.find((p) => p !== o && p.k !== 'bird' && Math.abs(p.x - o.x) < 12);
          const lo = o.k === 'tower' ? o.top : next && next.k === 'tower' ? next.top : TEP.GROUND_Y;
          const hi = o.k === 'cloud' ? top : next && next.k === 'cloud' ? next.bottom : TEP.CEIL_Y;
          want = (lo + hi) / 2;
          break;
        }
        const gem = mem.course.gems.find((g, i) => !s.got.includes(i) && g.x > s.x + 10 && g.x < s.x + 90);
        if (gem && Math.random() < mem.skill) want = want * 0.6 + gem.y * 0.4;
        y += clamp((want - s.y) / 45, -1, 1) * mem.skill;
        x += 0.25 + mem.skill * 0.4;
      }
    }
    bot.send('bb', { w, x: clamp(x, -1, 1), y: clamp(y, -1, 1) });
  }, 33);
}
