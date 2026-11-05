/**
 * Spion unter Gästen: Bot-Verhalten.
 * Bewegt sich wie ein NPC (schlendern, stehen, plaudern, ab und zu an einen Auftragsort) und erledigt
 * dabei seine Aufträge. Als Jäger beobachtet er nur, was auch auf dem TV zu sehen ist:
 * Wer hat kurz vor einer Fortschritts-Meldung etwas erledigt? Wer ist nach einem Fehlwurf aufgeflogen?
 */
import type { PrivateState, SpionState } from '../shared/types';
import { SP_A, STATIONS, besideSpot, guestAnim, randomSpot, stationAt, stationSpot } from '../shared/spion';

export interface SpionBotHost {
  id: string;
  priv: PrivateState;
  send(action: string, payload?: unknown): void;
}

interface Mem {
  round: number;
  nextAt: number;
  /** Eigene Bewegung */
  lastAnim: number;
  actAt: number;
  goal: number;
  chatPlan: boolean;
  /** Beobachtung aller Gäste */
  anims: number[];
  lastPos: [number, number][];
  useEnds: { g: number; t: number }[];
  visits: Map<number, Set<number>>;
  tasks: Record<string, number>;
  cand: Map<string, Set<number>>;
  handledTags: Set<string>;
  pending: { g: number; at: number } | null;
  /** Wie scharf der Bot hinschaut (0 = verpeilt, 1 = Detektiv) */
  sharp: number;
}

const mems = new WeakMap<SpionBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function spionBot(bot: SpionBotHost, st: SpionState) {
  let mem = mems.get(bot);
  if (!mem || mem.round !== st.round) {
    mem = {
      round: st.round, nextAt: 0, lastAnim: -1, actAt: 0, goal: -1, chatPlan: false,
      anims: [], lastPos: [], useEnds: [], visits: new Map(), tasks: {}, cand: new Map(), handledTags: new Set(), pending: null,
      sharp: mem?.sharp ?? rand(0.3, 0.9),
    };
    mems.set(bot, mem);
  }
  const now = Date.now();
  if (now < mem.nextAt) return;
  mem.nextAt = now + rand(120, 200);
  const p = bot.priv?.kind === 'spion' ? bot.priv.state : null;
  const me = st.players[bot.id];
  if (!p || !me || st.sub !== 'play' || me.out) return;
  observe(mem, st, now, p.g);
  hunt(bot, mem, st, now, p.g, me.balloons);
  move(bot, mem, st, now, p);
}

/** Was passiert auf dem TV? */
function observe(mem: Mem, st: SpionState, now: number, own: number) {
  st.guests.forEach((g, i) => {
    const a = guestAnim(g);
    const prev = mem.anims[i];
    if (prev === SP_A.USE && a !== SP_A.USE && a !== SP_A.WET && i !== own) {
      const [x, y] = mem.lastPos[i] ?? [g[0], g[1]];
      mem.useEnds.push({ g: i, t: now });
      const s = stationAt(x, y);
      if (s >= 0) {
        const set = mem.visits.get(i) ?? new Set<number>();
        set.add(s);
        mem.visits.set(i, set);
      }
    }
    mem.anims[i] = a;
    mem.lastPos[i] = [g[0], g[1]];
  });
  mem.useEnds = mem.useEnds.filter((u) => now - u.t < 12000);
  // Fortschritts-Meldung → wer hat kurz vorher etwas erledigt?
  for (const [id, pl] of Object.entries(st.players)) {
    const before = mem.tasks[id] ?? 0;
    mem.tasks[id] = pl.tasks;
    if (pl.tasks <= before || pl.out) continue;
    const fresh = new Set(mem.useEnds.filter((u) => now - u.t > 1500 && now - u.t < 8500).map((u) => u.g));
    // Unaufmerksame Bots verpassen manche Gäste
    for (const g of [...fresh]) if (Math.random() > 0.55 + mem.sharp * 0.45) fresh.delete(g);
    const old = mem.cand.get(id);
    const both = old ? new Set([...old].filter((g) => fresh.has(g))) : fresh;
    mem.cand.set(id, both.size ? both : fresh);
  }
}

function hunt(bot: SpionBotHost, mem: Mem, st: SpionState, now: number, own: number, balloons: number) {
  const alive = (g: number) => !!st.guests[g] && guestAnim(st.guests[g]) !== SP_A.OUT && g !== own;
  if (mem.pending) {
    if (now >= mem.pending.at) {
      if (alive(mem.pending.g) && balloons > 0) bot.send('throw', { g: mem.pending.g });
      mem.pending = null;
    }
    return;
  }
  if (balloons <= 0) return;
  const aim = (g: number, delay: [number, number]) => (mem.pending = { g, at: now + rand(...delay) });
  // Aufgeflogener Werfer → schnell zuschlagen (nicht immer)
  for (const t of st.tags) {
    const k = `${t.g}:${t.id}`;
    if (t.why !== 'miss' || t.id === bot.id || mem.handledTags.has(k)) continue;
    mem.handledTags.add(k);
    if (alive(t.g) && Math.random() < 0.35 + mem.sharp * 0.3) return aim(t.g, [700, 2200]);
  }
  // Wenige Verdächtige für einen Spieler übrig
  for (const [id, set] of mem.cand) {
    if (id === bot.id || st.players[id]?.out) continue;
    const list = [...set].filter(alive);
    if (!list.length || list.length > 3) continue;
    const chance = list.length === 1 ? 0.04 : list.length === 2 ? 0.02 : 0.008;
    if (Math.random() < chance * (0.5 + mem.sharp)) return aim(list[Math.floor(Math.random() * list.length)], [400, 1800]);
  }
  // Gegen Ende: wer an vielen Auftragsorten war, ist verdächtig
  if (st.endsIn < 60000) {
    const sus = [...mem.visits].filter(([g, s]) => s.size >= 3 && alive(g)).map(([g]) => g);
    if (sus.length && Math.random() < 0.006 * (1 + (60000 - st.endsIn) / 30000)) aim(sus[Math.floor(Math.random() * sus.length)], [300, 1500]);
  }
}

/** Unauffällig wie ein NPC bewegen und nebenbei die Aufträge erledigen */
function move(bot: SpionBotHost, mem: Mem, st: SpionState, now: number, p: { g: number; done: boolean[]; cooldown: number; using: number }) {
  const g = st.guests[p.g];
  if (!g) return;
  const a = guestAnim(g);
  const arrived = mem.lastAnim === SP_A.WALK && a !== SP_A.WALK;
  mem.lastAnim = a;
  if (a === SP_A.WALK || a === SP_A.USE || a === SP_A.WET) return;
  if (arrived) {
    if (mem.goal >= 0 && stationAt(g[0], g[1]) === mem.goal) {
      mem.actAt = now + rand(150, 700);
      return;
    }
    mem.actAt = mem.chatPlan && Math.random() < 0.75 ? now + rand(100, 500) : now + rand(800, 4500);
    if (!mem.chatPlan) mem.goal = -1;
    return;
  }
  if (!mem.actAt) mem.actAt = now + rand(500, 4000);
  if (now < mem.actAt) return;
  // Am Auftragsort angekommen → erledigen
  if (mem.goal >= 0 && stationAt(g[0], g[1]) === mem.goal) {
    bot.send('use');
    mem.goal = -1;
    mem.actAt = now + rand(3600, 6000);
    return;
  }
  if (mem.chatPlan) {
    mem.chatPlan = false;
    if (a !== SP_A.CHAT) {
      bot.send('chat');
      mem.actAt = now + rand(3000, 9000);
      return;
    }
  }
  const r = Math.random();
  const open = STATIONS.map((_, i) => i).filter((i) => !p.done[i]);
  let target: { x: number; y: number } | null = null;
  mem.goal = -1;
  if (open.length && p.cooldown < 3000 && r < 0.42) {
    const s = open[Math.floor(Math.random() * open.length)];
    target = stationSpot(s);
    mem.goal = s;
  } else if (r < 0.5) {
    const s = Math.floor(Math.random() * STATIONS.length);
    target = stationSpot(s);
    mem.goal = s;
  } else if (r < 0.78) {
    const others = st.guests.map((o, i) => ({ o, i })).filter(({ o, i }) => i !== p.g && guestAnim(o) !== SP_A.WALK && guestAnim(o) !== SP_A.OUT && Math.hypot(o[0] - g[0], o[1] - g[1]) < 170);
    const o = others[Math.floor(Math.random() * others.length)];
    target = o ? besideSpot(o.o[0], o.o[1]) : null;
    mem.chatPlan = !!target;
  }
  if (!target) {
    for (let k = 0; k < 6 && !target; k++) {
      const s = randomSpot();
      if (Math.hypot(s.x - g[0], s.y - g[1]) < 160) target = s;
    }
  }
  if (target) bot.send('goto', { x: Math.round(target.x), y: Math.round(target.y) });
  // Falls kein Weg: später nochmal
  mem.actAt = now + rand(1500, 3000);
}
