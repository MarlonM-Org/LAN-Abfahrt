/**
 * Grill-Chaos: Bot-Verhalten (einfaches Auftrags-System).
 * Jeder Bot schnappt sich eine offene Bestellung und arbeitet sie Schritt für Schritt ab:
 * Teller/Glas holen und abstellen → Zutaten holen → schneiden → grillen → auf den Teller → servieren.
 */
import {
  GRILL_CRATES,
  GRILL_RECIPES,
  type GrillGeo,
  type GrillItem,
  type GrillRecipeId,
  type GrillSlot,
  type GrillState,
  canChop,
  grillGrid,
  grillNextTile,
  isBurnt,
  isDone,
  isFloorCh,
  matchRecipe,
  newIng,
  nextStep,
  tileCenter,
  tileCh,
  tileOfPos,
} from '../shared/grill';

export interface GrillBotHost {
  id: string;
  send(action: string, payload?: unknown): void;
}

interface Tile {
  c: number;
  r: number;
}

interface GrillMem {
  order: number | null;
  recipe: GrillRecipeId | null;
  stash: Tile | null;
  work: Tile | null;
  cool: number;
  acting: boolean;
  lastX: number;
  lastY: number;
  checkAt: number;
  wiggleUntil: number;
  wx: number;
  wy: number;
  stick: string;
  stickAt: number;
  /** Bots sind nicht perfekt: kurze Denkpausen */
  slowUntil: number;
}

const mems = new WeakMap<GrillBotHost, GrillMem>();
/** Welche Bestellung bearbeitet welcher Bot? (gilt für alle Bots in diesem Prozess) */
const grillClaims = new Map<string, { bot: string; at: number }>();

const grillRand = (a: number, b: number) => a + Math.random() * (b - a);
const grillKey = (t: Tile) => `${t.c},${t.r}`;

function grillMem(bot: GrillBotHost): GrillMem {
  let m = mems.get(bot);
  if (!m) {
    m = { order: null, recipe: null, stash: null, work: null, cool: 0, acting: false, lastX: 0, lastY: 0, checkAt: 0, wiggleUntil: 0, wx: 0, wy: 0, stick: '', stickAt: 0, slowUntil: 0 };
    mems.set(bot, m);
  }
  return m;
}

function grillStick(bot: GrillBotHost, mem: GrillMem, x: number, y: number) {
  const key = `${x.toFixed(2)},${y.toFixed(2)}`;
  const now = Date.now();
  if (key === mem.stick && now - mem.stickAt < 400) return;
  mem.stick = key;
  mem.stickAt = now;
  bot.send('stick', { x, y });
}

function grillAct(bot: GrillBotHost, mem: GrillMem, down: boolean) {
  if (down) {
    bot.send('act', { down: true });
    mem.acting = true;
  } else if (mem.acting) {
    bot.send('act', { down: false });
    mem.acting = false;
  }
}

export function grillBot(bot: GrillBotHost, st: GrillState) {
  const me = st.players[bot.id];
  const mem = grillMem(bot);
  if (!me || st.sub !== 'play') {
    grillAct(bot, mem, false);
    grillStick(bot, mem, 0, 0);
    return;
  }
  const now = Date.now();
  const kit = st.kitchens[me.k];
  const geo: GrillGeo = { x0: kit.x0, y0: kit.y0, grid: grillGrid(kit.layout, kit.mirror) };
  const slots = new Map<string, GrillSlot>(kit.slots.map((s) => [`${s.c},${s.r}`, s]));
  const itemAt = (t: Tile) => slots.get(grillKey(t))?.i ?? null;
  const fireAt = (t: Tile) => !!slots.get(grillKey(t))?.f;
  const all = (pred: (ch: string) => boolean): Tile[] => {
    const out: Tile[] = [];
    geo.grid.forEach((row, r) => [...row].forEach((ch, c) => pred(ch) && out.push({ c, r })));
    return out;
  };
  const myTile = tileOfPos(geo, me.x, me.y);
  const d2 = (t: Tile) => {
    const p = tileCenter(geo, t.c, t.r);
    return Math.hypot(p.x - me.x, p.y - me.y);
  };
  const nearest = (ts: Tile[]) => ts.filter(reachable).sort((a, b) => d2(a) - d2(b))[0] ?? null;
  function reachable(t: Tile) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => isFloorCh(tileCh(geo, t.c + dc, t.r + dr)));
  }
  const held = me.h;

  // Kleine Denkpausen (wirkt menschlicher und lässt auch mal was anbrennen)
  if (now < mem.slowUntil) return grillStick(bot, mem, 0, 0);
  if (Math.random() < 0.004) mem.slowUntil = now + grillRand(600, 1600);

  /** Zur Station laufen und, wenn angekommen, NEHMEN/ABLEGEN drücken bzw. AKTION halten */
  const goUse = (t: Tile | null, what: 'grab' | 'act' | 'wait') => {
    if (!t) {
      grillAct(bot, mem, false);
      return grillStick(bot, mem, 0, 0);
    }
    const goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => ({ c: t.c + dc, r: t.r + dr })).filter((g) => isFloorCh(tileCh(geo, g.c, g.r)));
    const atGoal = goals.some((g) => g.c === myTile.c && g.r === myTile.r);
    if (!atGoal) {
      grillAct(bot, mem, false);
      const next = grillNextTile(geo, myTile, goals);
      if (!next) return grillStick(bot, mem, 0, 0);
      return steer(tileCenter(geo, next.c, next.r), 1);
    }
    // In der Kachel: erst zur Mitte, dann zur Station drehen
    const c = tileCenter(geo, myTile.c, myTile.r);
    if (Math.hypot(c.x - me.x, c.y - me.y) > 3.5) return steer(c, 0.7);
    if (me.tc !== t.c || me.tr !== t.r) {
      const sc = tileCenter(geo, t.c, t.r);
      const dx = sc.x - me.x;
      const dy = sc.y - me.y;
      const l = Math.hypot(dx, dy) || 1;
      return grillStick(bot, mem, Math.round((dx / l) * 0.22 * 100) / 100, Math.round((dy / l) * 0.22 * 100) / 100);
    }
    grillStick(bot, mem, 0, 0);
    if (what === 'act') return grillAct(bot, mem, true);
    grillAct(bot, mem, false);
    if (what === 'grab' && now > mem.cool) {
      mem.cool = now + grillRand(280, 520);
      bot.send('grab');
    }
  };

  function steer(p: { x: number; y: number }, speed: number) {
    // Festgefahren? Kurz zur Seite
    if (now > mem.checkAt) {
      if (Math.hypot(me.x - mem.lastX, me.y - mem.lastY) < 2 && me.m) {
        const a = Math.random() * Math.PI * 2;
        mem.wx = Math.cos(a);
        mem.wy = Math.sin(a);
        mem.wiggleUntil = now + 350;
      }
      mem.lastX = me.x;
      mem.lastY = me.y;
      mem.checkAt = now + 900;
    }
    if (now < mem.wiggleUntil) return grillStick(bot, mem, Math.round(mem.wx * 100) / 100, Math.round(mem.wy * 100) / 100);
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return grillStick(bot, mem, 0, 0);
    const s = Math.max(0.45, Math.min(1, l / 8)) * speed;
    grillStick(bot, mem, Math.round((dx / l) * s * 100) / 100, Math.round((dy / l) * s * 100) / 100);
  }

  const freeCounter = () => nearest(all((ch) => ch === '#' || ch === 'F').filter((t) => !itemAt(t) && !fireAt(t)));
  const crateFor = (ing: string) => nearest(all((ch) => GRILL_CRATES[ch] === ing));
  const trash = () => nearest(all((ch) => ch === 'X'));

  // ------------------------------------------------------------ Notfälle: Feuer, Verbranntes, Feuerlöscher
  const fires = kit.slots.filter((s) => s.f).map((s) => ({ c: s.c, r: s.r }));
  if (held?.x) {
    if (fires.length) return goUse(nearest(fires), 'act');
    const hook = all((ch) => ch === 'F').find((t) => !itemAt(t));
    return goUse(hook ?? freeCounter(), 'grab');
  }
  if (fires.length && !held && !Object.values(st.players).some((p) => p.k === me.k && p.h?.x)) {
    // nur der nächste Bot (ohne Ware) holt den Löscher
    const ext = kit.slots.find((s) => s.i?.x);
    if (ext) {
      const others = Object.entries(st.players).filter(([id, p]) => id !== bot.id && p.k === me.k && !p.h);
      const myD = d2(ext);
      if (!others.some(([, p]) => Math.hypot(tileCenter(geo, ext.c, ext.r).x - p.x, tileCenter(geo, ext.c, ext.r).y - p.y) < myD - 2)) {
        return goUse({ c: ext.c, r: ext.r }, 'grab');
      }
    }
  }
  if (held && isBurnt(held)) return goUse(trash(), 'grab');

  // ------------------------------------------------------------ Auftrag wählen / prüfen
  for (const [key, v] of grillClaims) if (now - v.at > 3000) grillClaims.delete(key);
  const claimKey = (id: number) => `${me.k}:${id}`;
  let order = mem.order !== null ? kit.orders.find((o) => o.id === mem.order) : undefined;
  if (!order) {
    mem.order = null;
    const free = kit.orders.filter((o) => {
      const c = grillClaims.get(claimKey(o.id));
      return !c || c.bot === bot.id;
    });
    // passt etwas zu dem, was ich schon habe?
    const have = mem.stash ? itemAt(mem.stash) : null;
    const fits = (r: GrillRecipeId) => {
      const R = GRILL_RECIPES[r];
      return !!have?.b && have.b === R.base && have.p.every((p) => R.parts.includes(p.t));
    };
    const pick = free.find((o) => fits(o.r)) ?? free.sort((a, b) => a.left - b.left)[0];
    if (pick) {
      mem.order = pick.id;
      mem.recipe = pick.r;
      order = pick;
      if (!fits(pick.r)) mem.stash = null;
    } else {
      mem.recipe = null;
    }
  }
  if (order) grillClaims.set(claimKey(order.id), { bot: bot.id, at: now });

  const recipe = mem.recipe ? GRILL_RECIPES[mem.recipe] : null;
  // Stash noch gültig?
  if (mem.stash) {
    const s = itemAt(mem.stash);
    if (!s || !recipe || s.b !== recipe.base) mem.stash = null;
  }
  const stashItem: GrillItem | null = mem.stash ? itemAt(mem.stash) : null;
  const missing = recipe ? [...recipe.parts] : [];
  for (const p of stashItem?.p ?? []) {
    const i = missing.indexOf(p.t);
    if (i >= 0) missing.splice(i, 1);
  }

  // ------------------------------------------------------------ Ohne Auftrag
  if (!recipe) {
    if (held) {
      // fertiges Gericht trotzdem ausliefern versuchen, sonst ablegen
      if (matchRecipe(held) && kit.orders.some((o) => o.r === matchRecipe(held))) return goUse(nearest(all((ch) => ch === 'S')), 'grab');
      return goUse(held.b && held.p.length ? trash() : freeCounter(), 'grab');
    }
    grillAct(bot, mem, false);
    return grillStick(bot, mem, 0, 0);
  }

  // ------------------------------------------------------------ Mit Auftrag
  if (held) {
    if (held.b) {
      if (matchRecipe(held) === mem.recipe) return goUse(nearest(all((ch) => ch === 'S')), 'grab');
      if (held.b !== recipe.base || held.p.some((p) => !recipe.parts.includes(p.t))) return goUse(trash(), 'grab');
      // Teller/Glas abstellen = Stash
      const spot = freeCounter();
      if (spot && me.tc === spot.c && me.tr === spot.r && now > mem.cool) mem.stash = spot;
      return goUse(spot, 'grab');
    }
    // lose Zutat
    const part = held.p[0];
    if (held.p.length !== 1 || !missing.includes(part.t)) return goUse(trash(), 'grab');
    const next = nextStep(part);
    if (next === 'chop') {
      const board = nearest(all((ch) => ch === 'K').filter((t) => !itemAt(t)));
      if (board && me.tc === board.c && me.tr === board.r) mem.work = board;
      return goUse(board, 'grab');
    }
    if (next === 'grill') {
      const g = nearest(all((ch) => ch === 'G').filter((t) => !itemAt(t) && !fireAt(t)));
      if (g && me.tc === g.c && me.tr === g.r) mem.work = g;
      return goUse(g, 'grab');
    }
    if (isDone(part)) {
      if (mem.stash) return goUse(mem.stash, 'grab');
      // noch kein Teller: direkt vom Stapel einen nehmen (Zutat landet drauf)
      return goUse(nearest(all((ch) => ch === (recipe.base === 'plate' ? 'P' : 'W'))), 'grab');
    }
    return goUse(trash(), 'grab');
  }

  // Hände frei: läuft gerade etwas von mir?
  if (mem.work) {
    const it = itemAt(mem.work);
    if (!it || fireAt(mem.work) || it.p.length !== 1 || !missing.includes(it.p[0].t)) mem.work = null;
    else if (canChop(it)) return goUse(mem.work, 'act');
    else if (tileCh(geo, mem.work.c, mem.work.r) === 'G' && nextStep(it.p[0]) === 'grill') return goUse(mem.work, 'wait');
    else {
      const t = mem.work;
      if (me.tc === t.c && me.tr === t.r && now > mem.cool) mem.work = null;
      return goUse(t, 'grab');
    }
  }
  if (!mem.stash) return goUse(nearest(all((ch) => ch === (recipe.base === 'plate' ? 'P' : 'W'))), 'grab');
  if (missing.length) {
    // Zutaten, die schon irgendwo fertig herumliegen? (z. B. vom Grill eines anderen) – ignorieren, einfach neu holen
    const ing = missing.find((t) => nextStep(newIng(t).p[0]) !== null) ?? missing[0];
    return goUse(crateFor(ing), 'grab');
  }
  // alles drauf → Gericht holen
  return goUse(mem.stash, 'grab');
}

/** Für Tests: Zustand vergessen */
export function grillBotReset() {
  grillClaims.clear();
}
