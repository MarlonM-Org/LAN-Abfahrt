/**
 * Umzugschaos: Bot-Verhalten.
 * Leichte Sachen: nächstes freies Teil schnappen, zum Laster tragen (nah dran und freie Bahn → werfen).
 * Schweres: Wer schon ein Ende hält, bekommt Hilfe – der Bot packt das freie Ende an; beide ziehen
 * Richtung Laster (Wegfindung vom Teil aus, Türen mittig). Steht das Teil quer zur Laufrichtung,
 * schwenkt das hintere Ende hinter das vordere; klemmt es trotzdem, wird gewackelt oder losgelassen.
 */
import {
  UMZUG as U,
  UMZUG_KINDS,
  type UmzugGeo,
  type UmzugItem,
  type UmzugState,
  grabPoints,
  inRect,
  umzugGrid,
  umzugLineFree,
  umzugNextTile,
  umzugTileCh,
  umzugTileOf,
  umzugTruckZone,
  umzugWalkable,
} from '../shared/umzug';

export interface UmzugBotHost {
  id: string;
  send(action: string, payload?: unknown): void;
}

interface Mem {
  nextAt: number;
  target: number | null;
  stick: string;
  stickAt: number;
  holding: boolean;
  grabSentAt: number;
  lastX: number;
  lastY: number;
  movedAt: number;
  sideUntil: number;
  side: number;
  /** Schweres: Position des Teils zuletzt, Wackel-Phase */
  itemX: number;
  itemY: number;
  itemMovedAt: number;
  wiggleUntil: number;
  wiggleDir: number;
  heavySince: number;
  stuckSince: number;
  slop: number;
  dashAt: number;
  /** Teile, die gerade nicht angefasst werden (nach Klemmen) */
  avoid: Map<number, number>;
}

const mems = new WeakMap<UmzugBotHost, Mem>();
/** Welches Teil nimmt sich welcher Bot vor? (alle Bots dieses Prozesses) */
const claims = new Map<number, { bot: string; at: number }>();
const geoCache = new Map<string, UmzugGeo>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function geoOf(h: UmzugState['houses'][number]): UmzugGeo {
  const key = `${h.layout}${h.mirror ? 'm' : ''}${h.x0}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = { x0: h.x0, layout: h.layout, mirror: h.mirror, grid: umzugGrid(h.layout, h.mirror) }));
  return g;
}

function claimed(itemId: number, me: string, now: number) {
  const c = claims.get(itemId);
  return !!c && c.bot !== me && now - c.at < 1500;
}

/** Griffpunkt eines schweren Teils in Welt-Koordinaten (ein Stück nach außen) */
function grabWorld(it: UmzugItem, i: number) {
  const gp = grabPoints(it.k)[i];
  const len = Math.hypot(gp.x, gp.y) || 1;
  const out = U.PLAYER_R + 1;
  const lx = gp.x + (gp.x / len) * out;
  const ly = gp.y + (gp.y / len) * out;
  const a = (it.a * Math.PI) / 180;
  return { x: it.x + lx * Math.cos(a) - ly * Math.sin(a), y: it.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

/** Mitte einer Türöffnung (zusammenhängende 'D'-Kacheln) */
function doorCenter(geo: UmzugGeo, c: number, r: number) {
  let c0 = c;
  let c1 = c;
  let r0 = r;
  let r1 = r;
  while (umzugTileCh(geo, c0 - 1, r) === 'D') c0--;
  while (umzugTileCh(geo, c1 + 1, r) === 'D') c1++;
  while (umzugTileCh(geo, c, r0 - 1) === 'D') r0--;
  while (umzugTileCh(geo, c, r1 + 1) === 'D') r1++;
  return { x: geo.x0 + ((c0 + c1 + 1) / 2) * U.TILE, y: U.Y0 + ((r0 + r1 + 1) / 2) * U.TILE };
}

export function umzugBot(bot: UmzugBotHost, st: UmzugState) {
  let mem = mems.get(bot);
  if (!mem) {
    mems.set(
      bot,
      (mem = {
        nextAt: 0,
        target: null,
        stick: '',
        stickAt: 0,
        holding: false,
        grabSentAt: 0,
        lastX: 0,
        lastY: 0,
        movedAt: 0,
        sideUntil: 0,
        side: 1,
        itemX: 0,
        itemY: 0,
        itemMovedAt: 0,
        wiggleUntil: 0,
        wiggleDir: 1,
        heavySince: 0,
        stuckSince: 0,
        slop: rand(0, 0.2),
        dashAt: 0,
        avoid: new Map(),
      }),
    );
  }
  const M = mem;
  const me = st.players[bot.id];
  const now = Date.now();
  const stickTo = (x: number, y: number) => {
    const key = `${x.toFixed(1)},${y.toFixed(1)}`;
    if (key === M.stick && now - M.stickAt < 400) return;
    M.stick = key;
    M.stickAt = now;
    bot.send('stick', { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  };
  const hold = (on: boolean) => {
    if (on) {
      if (!M.holding || now - M.grabSentAt > 300) {
        bot.send('grab', { down: true, again: M.holding });
        M.grabSentAt = now;
      }
      M.holding = true;
    } else if (M.holding) {
      bot.send('grab', { down: false });
      M.holding = false;
    }
  };
  if (!me || st.sub !== 'play') {
    if (M.stick !== '0.0,0.0') stickTo(0, 0);
    if (M.holding) hold(false);
    return;
  }
  if (now < M.nextAt) return;
  M.nextAt = now + rand(80, 130);

  const house = st.houses[me.k];
  const geo = geoOf(house);
  const broken = new Set(house.glass);
  const zone = umzugTruckZone(geo);
  const zc = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  const items = st.items.filter((i) => i.h === me.k);

  /** Richtung zum nächsten Wegpunkt Richtung Ziel (von `from` aus) */
  const dirTo = (from: { x: number; y: number }, goalPt: { x: number; y: number }, goalTile?: (c: number, r: number) => boolean) => {
    const d = Math.hypot(goalPt.x - from.x, goalPt.y - from.y);
    if (d < 1) return { x: 0, y: 0, d };
    const direct = d < 70 && umzugLineFree(geo, from.x, from.y, goalPt.x, goalPt.y);
    if (direct) return { x: (goalPt.x - from.x) / d, y: (goalPt.y - from.y) / d, d };
    const ft = umzugTileOf(geo, from.x, from.y);
    const gt = umzugTileOf(geo, goalPt.x, goalPt.y);
    const goal = goalTile ?? ((c: number, r: number) => c === gt.c && r === gt.r);
    const next = umzugNextTile(geo, ft, goal, broken);
    if (!next) return { x: (goalPt.x - from.x) / d, y: (goalPt.y - from.y) / d, d };
    let nx = geo.x0 + (next.c + 0.5) * U.TILE;
    let ny = U.Y0 + (next.r + 0.5) * U.TILE;
    if (umzugTileCh(geo, next.c, next.r) === 'D') {
      // Türen mittig anpeilen (zweikachlige Öffnung) – wichtig für breite Möbel
      const dc = doorCenter(geo, next.c, next.r);
      nx = dc.x;
      ny = dc.y;
    }
    const dd = Math.hypot(nx - from.x, ny - from.y) || 1;
    return { x: (nx - from.x) / dd, y: (ny - from.y) / dd, d };
  };
  const inZone = (c: number, r: number) => umzugTileCh(geo, c, r) === 'T';
  /**
   * Zugrichtung für ein schweres Teil: Türen werden nicht als Punkt-Pfad angesteuert (das Teil hat
   * Ausdehnung und bleibt sonst neben der Öffnung an der Wand hängen), sondern erst ein Anlaufpunkt
   * mittig vor der Tür, dann der Punkt dahinter.
   */
  const heavyDir = (it: UmzugItem) => {
    const from = { x: it.x, y: it.y };
    let t = umzugTileOf(geo, from.x, from.y);
    const path: { c: number; r: number }[] = [];
    for (let k = 0; k < 6; k++) {
      const n = umzugNextTile(geo, t, inZone, broken);
      if (!n || (n.c === t.c && n.r === t.r)) break;
      path.push(n);
      t = n;
    }
    const di = path.findIndex((q) => umzugTileCh(geo, q.c, q.r) === 'D');
    if (di < 0 || umzugTileCh(geo, umzugTileOf(geo, from.x, from.y).c, umzugTileOf(geo, from.x, from.y).r) === 'D') return dirTo(from, zc, inZone);
    const d = path[di];
    const dc = doorCenter(geo, d.c, d.r);
    // Türkacheln nebeneinander → Wand waagerecht → man geht senkrecht hindurch
    const horizontal = umzugTileCh(geo, d.c - 1, d.r) === 'D' || umzugTileCh(geo, d.c + 1, d.r) === 'D';
    const n = horizontal ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const side = Math.sign((from.x - dc.x) * n.x + (from.y - dc.y) * n.y) || 1;
    const along = ((from.x - dc.x) * n.x + (from.y - dc.y) * n.y) * side;
    const lateral = Math.abs((from.x - dc.x) * n.y + (from.y - dc.y) * n.x);
    const target = lateral > 5 && along > 8 ? { x: dc.x + n.x * side * 18, y: dc.y + n.y * side * 18 } : { x: dc.x - n.x * side * 24, y: dc.y - n.y * side * 24 };
    const l = Math.hypot(target.x - from.x, target.y - from.y) || 1;
    return { x: (target.x - from.x) / l, y: (target.y - from.y) / l, d: l };
  };
  const sidestep = (dir: { x: number; y: number }, stuck: boolean) => {
    if (stuck && now > M.sideUntil) {
      M.sideUntil = now + 500;
      M.side = Math.random() < 0.5 ? -1 : 1;
    }
    if (now < M.sideUntil) stickTo(-dir.y * M.side, dir.x * M.side);
    else stickTo(dir.x, dir.y);
  };

  // Festhängen erkennen (eigene Figur)
  if (Math.hypot(me.x - M.lastX, me.y - M.lastY) > 2) {
    M.lastX = me.x;
    M.lastY = me.y;
    M.movedAt = now;
  }
  const stuck = M.stick !== '0.0,0.0' && M.stick !== '' && now - M.movedAt > 1300;

  const held = me.g !== null ? items.find((i) => i.id === me.g) : undefined;

  // ------------------------------------------------------------ trägt etwas
  if (held) {
    const kind = UMZUG_KINDS[held.k];
    M.target = null;
    if (!kind.heavy) {
      // Leichtes: zum Laster – nah genug und freie Bahn → werfen (Zerbrechliches lieber tragen)
      const d = Math.hypot(zc.x - me.x, zc.y - me.y);
      const facingOk = (me.fx * (zc.x - me.x) + me.fy * (zc.y - me.y)) / (d || 1) > 0.97;
      if (!kind.fragile && d < U.THROW_RANGE * 0.9 && d > 20 && facingOk && umzugLineFree(geo, me.x, me.y, zc.x, zc.y) && Math.random() < 0.5) {
        bot.send('throw');
        hold(false);
        stickTo(0, 0);
        return;
      }
      sidestep(dirTo({ x: me.x, y: me.y }, zc, inZone), stuck);
      hold(true);
      return;
    }
    // Schweres: vom Teil aus Richtung Laster ziehen
    if (!M.heavySince) {
      M.heavySince = now;
      M.stuckSince = now;
    }
    if (Math.hypot(held.x - M.itemX, held.y - M.itemY) > 3) {
      M.itemX = held.x;
      M.itemY = held.y;
      M.itemMovedAt = now;
      M.stuckSince = now;
    }
    const partners = held.by.filter((b) => b && b !== bot.id).length;
    const lightLeft = items.some((i) => !UMZUG_KINDS[i.k].heavy && i.s === 0);
    // Allein und keiner kommt: nach einer Weile loslassen und etwas Leichtes holen
    if (!partners && now - M.heavySince > 7000 && lightLeft) {
      hold(false);
      M.heavySince = 0;
      stickTo(0, 0);
      return;
    }
    if (inRect(held.x, held.y, zone)) {
      hold(true);
      stickTo(0, 0);
      return;
    }
    // Zu lange geklemmt (auch zu zweit): loslassen, erst mal etwas anderes machen
    if (now - M.stuckSince > 9000) {
      hold(false);
      M.heavySince = 0;
      M.avoid.set(held.id, now + 6000);
      stickTo(0, 0);
      return;
    }
    const dir = heavyDir(held);
    const myIdx = Math.max(0, held.by.indexOf(bot.id));
    const myGp = grabWorld(held, myIdx);
    const otherGp = grabWorld(held, 1 - myIdx);
    const L = Math.hypot(myGp.x - otherGp.x, myGp.y - otherGp.y) || 1;
    const front = (myGp.x - held.x) * dir.x + (myGp.y - held.y) * dir.y >= 0;
    const ax = front ? { x: (myGp.x - otherGp.x) / L, y: (myGp.y - otherGp.y) / L } : { x: (otherGp.x - myGp.x) / L, y: (otherGp.y - myGp.y) / L };
    const align = ax.x * dir.x + ax.y * dir.y;
    if (now - M.itemMovedAt > 2500 && now > M.wiggleUntil) {
      // Klemmt (Türrahmen!): kurz quer ziehen, damit es sich dreht
      M.wiggleUntil = now + rand(500, 900);
      M.wiggleDir = Math.random() < 0.5 ? -1 : 1;
      M.itemMovedAt = now;
    }
    if (now < M.wiggleUntil) stickTo(-dir.y * M.wiggleDir, dir.x * M.wiggleDir);
    else if (!front && partners && now - M.itemMovedAt < 1200) {
      // Hinten: hinter das vordere Ende (in Laufrichtung) – das dreht das Teil längs und schiebt.
      // Liegt der Punkt in einer Wand (oder dahinter), einfach mitziehen statt dagegen zu drücken.
      const tx = otherGp.x - dir.x * L * (align > 0.9 ? 0.75 : 1);
      const ty = otherGp.y - dir.y * L * (align > 0.9 ? 0.75 : 1);
      const tt = umzugTileOf(geo, tx, ty);
      const dd = Math.hypot(tx - me.x, ty - me.y);
      if (!umzugWalkable(geo, tt.c, tt.r, broken) || !umzugLineFree(geo, me.x, me.y, tx, ty)) stickTo(dir.x, dir.y);
      else if (dd < 2) stickTo(0, 0);
      else stickTo((tx - me.x) / dd, (ty - me.y) / dd);
    } else if (front && partners && align < 0.75 && now - M.itemMovedAt < 1200) stickTo(dir.x * 0.15, dir.y * 0.15);
    else stickTo(dir.x + rand(-M.slop, M.slop), dir.y + rand(-M.slop, M.slop));
    hold(true);
    return;
  }
  M.heavySince = 0;

  // ------------------------------------------------------------ Ziel suchen
  let target: UmzugItem | null = null;
  let goalPt: { x: number; y: number } | null = null;
  // 1. Jemand hält ein schweres Teil allein → helfen
  for (const it of items) {
    if (!UMZUG_KINDS[it.k].heavy || it.s !== 0) continue;
    const free = it.by.findIndex((b) => !b);
    const holders = it.by.filter((b) => b).length;
    if (holders !== 1 || free < 0 || claimed(it.id, bot.id, now) || (M.avoid.get(it.id) ?? 0) > now) continue;
    target = it;
    goalPt = grabWorld(it, free);
    break;
  }
  // 2. Nächstes leichtes Teil am Boden
  if (!target) {
    let best = Infinity;
    for (const it of items) {
      if (UMZUG_KINDS[it.k].heavy || it.s !== 0 || claimed(it.id, bot.id, now)) continue;
      const t = umzugTileOf(geo, it.x, it.y);
      if (!umzugWalkable(geo, t.c, t.r, broken)) continue;
      const d = Math.hypot(it.x - me.x, it.y - me.y) + (M.target === it.id ? -30 : 0);
      if (d < best) {
        best = d;
        target = it;
        goalPt = { x: it.x, y: it.y };
      }
    }
  }
  // 3. Schweres Teil anpacken und auf Hilfe warten
  if (!target) {
    let best = Infinity;
    for (const it of items) {
      if (!UMZUG_KINDS[it.k].heavy || it.s !== 0 || it.by.some((b) => b) || claimed(it.id, bot.id, now) || (M.avoid.get(it.id) ?? 0) > now) continue;
      const d = Math.hypot(it.x - me.x, it.y - me.y);
      if (d < best) {
        best = d;
        target = it;
        // das Ende, das näher am Laster liegt, bleibt dem Helfer – der Bot nimmt das fernere
        const g0 = grabWorld(it, 0);
        const g1 = grabWorld(it, 1);
        const d0 = Math.hypot(g0.x - zc.x, g0.y - zc.y);
        const d1 = Math.hypot(g1.x - zc.x, g1.y - zc.y);
        goalPt = d0 > d1 ? g0 : g1;
      }
    }
  }
  if (!target || !goalPt) {
    hold(false);
    stickTo(0, 0);
    return;
  }
  M.target = target.id;
  claims.set(target.id, { bot: bot.id, at: now });
  const kind = UMZUG_KINDS[target.k];
  const d = Math.hypot(goalPt.x - me.x, goalPt.y - me.y);
  const reach = kind.heavy ? 9 : U.REACH + Math.max(kind.w, kind.h) / 2 - 4;
  if (d < reach) {
    // Hinschauen und zugreifen
    const td = Math.hypot(target.x - me.x, target.y - me.y) || 1;
    stickTo(((target.x - me.x) / td) * 0.2, ((target.y - me.y) / td) * 0.2);
    hold(true);
    return;
  }
  hold(false);
  sidestep(dirTo({ x: me.x, y: me.y }, goalPt), stuck);
  if (d > 60 && me.cd <= 0 && now - M.dashAt > 3000 && Math.random() < 0.08) {
    M.dashAt = now;
    bot.send('throw');
  }
}
