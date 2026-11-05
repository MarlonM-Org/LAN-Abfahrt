/**
 * Urlaubs-Minigolf: Bot-Verhalten (in sich geschlossen, Schlüssel-Präfix `golf`).
 * Der Bot zielt aufs Loch bzw. auf einen Hilfspunkt (Knick, Brücke, Röhre), passt Leuchtturm/Surfbrett
 * per Probe-Simulation ab und schlägt dann mit Streuung – ab und zu deutlich zu fest oder zu sanft.
 */
import type { GolfState } from '../shared/types';
import { GOLF_HOLES, golfBotPlan } from '../shared/golf';

export interface GolfBotHost {
  id: string;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lochzeit schätzen: Zustände kommen nur, wenn sich etwas ändert → ab dem letzten neuen Wert weiterzählen */
const clocks = new WeakMap<GolfBotHost, { hole: number; t: number; at: number }>();
function holeTime(bot: GolfBotHost, st: GolfState): number {
  const c = clocks.get(bot);
  const now = Date.now();
  if (!c || c.hole !== st.hole || c.t !== st.t) {
    clocks.set(bot, { hole: st.hole, t: st.t, at: now });
    return st.t;
  }
  return c.t + (now - c.at) / 1000;
}

export function golfBot(bot: GolfBotHost, st: GolfState, getState: () => GolfState | null) {
  if (st.sub !== 'play') return;
  holeTime(bot, st);
  const me = st.balls[bot.id];
  if (!me || me.d || me.m) return;
  bot.once(`golf-${st.hole}-${me.s}`, async () => {
    // kurz „überlegen“ und den Zielpfeil zeigen
    await sleep(rand(700, 1600));
    let cur = getState();
    const ball = cur?.balls[bot.id];
    if (!cur || cur.sub !== 'play' || cur.hole !== st.hole || !ball || ball.d || ball.m || ball.s !== me.s) return;
    const h = GOLF_HOLES[cur.hole];
    const lead = 0.9;
    const plan = golfBotPlan(h, ball, holeTime(bot, cur) + lead);
    const fireAt = Date.now() + (lead + plan.wait) * 1000;
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      bot.send('aim', { a: plan.angle + rand(-0.15, 0.15) * (1 - i / steps), p: (plan.power * i) / steps });
      await sleep(rand(120, 220));
    }
    await sleep(Math.max(0, fireAt - Date.now()));
    cur = getState();
    if (!cur || cur.sub !== 'play' || cur.hole !== st.hole || cur.balls[bot.id]?.s !== me.s) return;
    // Streuung: meist leicht daneben, manchmal klar zu fest/zu sanft
    let power = plan.power * rand(0.9, 1.1);
    const r = Math.random();
    if (r < 0.08) power *= rand(1.25, 1.5);
    else if (r < 0.16) power *= rand(0.55, 0.75);
    const angle = plan.angle + rand(-0.05, 0.05) + (Math.random() < 0.1 ? rand(-0.15, 0.15) : 0);
    bot.send('putt', { seq: me.s, a: angle, p: Math.max(0.03, Math.min(1, power)) });
  });
}
