import { TIDY } from '../shared/games';
import type { TidyState } from '../shared/types';

/** Gedächtnis eines Aufräum-Bots zwischen zwei Entscheidungen */
export interface TidyBotMem {
  /** id der Sache, die er gerade zum Korb bringt */
  target: number | null;
}

export interface TidyBotMove {
  x: number;
  y: number;
  dash: boolean;
}

const A = TIDY.AREA;
/** Hier steht die Körpermitte, wenn die Sache genau vor der Besenkante liegt */
const FRONT = TIDY.BROOM_D + TIDY.ITEM_R;

const norm = (x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

const inside = (x: number, y: number, m: number) => x > A.x + m && x < A.x + A.w - m && y > A.y + m && y < A.y + A.h - m;

/**
 * Bot fürs Aufräumen mit dem Besen: hinter eine Sache laufen (Besen Richtung Korb, außen herum, damit er sie nicht
 * vorher wegfegt), dann mit dem Besen voran in Richtung Korb laufen – die Sache bleibt vor der Kante. Kurz vor dem
 * Korb ab und zu SPRINT: dann fliegt sie geradeaus hinein. Sachen an der falschen Wand (man kommt nicht dahinter)
 * schiebt er an der Wand entlang in die nächste Ecke – von dort rollen sie wieder ins Zimmer.
 */
export function tidyBot(st: TidyState, id: string, mem: TidyBotMem, rnd: () => number = Math.random): TidyBotMove {
  const me = st.players[id];
  const basket = st.baskets.find((b) => b.team === me?.team) ?? st.baskets[0];
  if (!me || !basket || !st.items.length) return { x: 0, y: 0, dash: false };

  /** Schieberichtung für eine Sache: zum Korb – oder, wenn man nicht dahinter kommt, an der Wand entlang zur Ecke */
  const plan = (it: { x: number; y: number }) => {
    let u = norm(basket.x - it.x, basket.y - it.y);
    let px = it.x - u.x * (FRONT + 3);
    let py = it.y - u.y * (FRONT + 3);
    let ok = inside(px, py, TIDY.PLAYER_R + 2);
    if (!ok) {
      // an der Wand: entlang der Wand zur näheren Ecke
      const atX = it.x - A.x < 16 || A.x + A.w - it.x < 16;
      u = atX ? { x: 0, y: it.y < A.y + A.h / 2 ? -1 : 1 } : { x: it.x < A.x + A.w / 2 ? -1 : 1, y: 0 };
      px = it.x - u.x * (FRONT + 3);
      py = it.y - u.y * (FRONT + 3);
    }
    return { u, px, py, ok };
  };

  const mates = Object.entries(st.players).filter(([pid, p]) => pid !== id && p.team === me.team);
  let item = st.items.find((i) => i.id === mem.target);
  if (!item) {
    let best = Infinity;
    for (const it of st.items) {
      const d = Math.hypot(it.x - me.x, it.y - me.y);
      let cost = d + Math.hypot(basket.x - it.x, basket.y - it.y) * 0.5;
      if (!plan(it).ok) cost += 120;
      // Ein Teamkollege ist näher dran → lieber eine andere nehmen
      if (mates.some(([, m]) => Math.hypot(it.x - m.x, it.y - m.y) < d)) cost += 60;
      if (cost < best) {
        best = cost;
        item = it;
      }
    }
    mem.target = item?.id ?? null;
  }
  if (!item) return { x: 0, y: 0, dash: false };

  const { u, px, py } = plan(item);
  // Wo liegt die Sache gerade vor mir (u = nach vorn, v = quer)?
  const c = Math.cos(me.a);
  const s = Math.sin(me.a);
  const rx = item.x - me.x;
  const ry = item.y - me.y;
  const lu = rx * c + ry * s;
  const lv = ry * c - rx * s;
  const facing = c * u.x + s * u.y;
  if (lu > TIDY.BROOM_D && lu < FRONT + 5 && Math.abs(lv) < TIDY.BROOM_HALF && facing > 0.6) {
    // Liegt vor dem Besen: in Schieberichtung laufen – sie wandert geradeaus mit
    const near = Math.hypot(basket.x - item.x, basket.y - item.y) < 70;
    return { x: u.x, y: u.y, dash: near && facing > 0.95 && me.dashLeft <= 0 && rnd() < 0.12 };
  }
  // Hinter die Sache laufen – außen herum, damit der Besen sie nicht vorher wegfegt:
  // b = wie weit ich hinter ihr stehe (in Schieberichtung), lat = seitlicher Abstand zur Schiebe-Linie
  const n = { x: -u.y, y: u.x };
  const b = (item.x - me.x) * u.x + (item.y - me.y) * u.y;
  const lat = (me.x - item.x) * n.x + (me.y - item.y) * n.y;
  const side = lat >= 0 ? 1 : -1;
  const clear = TIDY.BROOM_HALF + TIDY.ITEM_R + 6;
  let tx = px;
  let ty = py;
  if (Math.abs(lat) < TIDY.BROOM_HALF * 0.6 && b >= FRONT - 2) {
    // genau dahinter: Anlaufpunkt
    if (Math.hypot(px - me.x, py - me.y) < 6) {
      // erst den Besen (fast im Stand) zur Sache drehen, dann los
      const m = facing > 0.9 ? 1 : 0.25;
      return { x: u.x * m, y: u.y * m, dash: false };
    }
  } else if (b < FRONT + 4) {
    // daneben oder davor: erst seitlich weg, dann an der Seite entlang nach hinten
    const off = Math.max(Math.abs(lat), clear + 4) * side;
    const depth = Math.abs(lat) < clear ? -b : FRONT + 8;
    tx = item.x + n.x * off - u.x * depth;
    ty = item.y + n.y * off - u.y * depth;
  }
  const d = norm(tx - me.x, ty - me.y);
  return { x: d.x, y: d.y, dash: false };
}
