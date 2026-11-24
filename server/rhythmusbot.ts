/**
 * Das erste Gespräch: Bot-Verhalten. Im Soundcheck drückt er nach kurzer Zeit „Bereit“ (er hört den TV nicht,
 * misst also nichts). Im Song tippt er jede Note seiner Spur wie ein Mensch: mit normalverteilter Zeit-Streuung,
 * einer kleinen eigenen Verzögerung, ab und zu der falschen Taste oder einem Aussetzer – in schnellen Läufen öfter.
 * Gewertet wird er vom Server wie jedes Handy (`tipp` mit Songzeit).
 */
import type { GameState } from '../shared/types';
import { type RhythmState, rhythmusNoten } from '../shared/rhythmus';

export interface RhythmusBotHost {
  id: string;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const memory = new WeakMap<RhythmusBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cur = (bot: RhythmusBotHost) => (bot.state?.mini?.kind === 'rhythm' ? bot.state.mini.state : null);
/** Standardnormalverteilt (Box-Muller) */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

/** `noise`: Bot-Stärke (0 = Profi, 0,1 = normal, 0,22 = leicht) */
export function rhythmusBot(bot: RhythmusBotHost, st: RhythmState, noise: number) {
  const me = st.players[bot.id];
  if (!me) return;
  let mem = memory.get(bot);
  if (!mem) memory.set(bot, (mem = new Set()));

  if (st.sub === 'ready' && !me.ready && !mem.has(`ready-${st.kalAt}`)) {
    mem.add(`ready-${st.kalAt}`);
    bot.once(`rh-ready-${st.kalAt}`, async () => {
      await sleep(rand(600, 2500));
      const s = cur(bot);
      if (s?.sub === 'ready' && s.kalAt === st.kalAt && !s.players[bot.id]?.ready) bot.send('ready');
    });
  }

  if (st.sub === 'play' && st.startAt && !mem.has(`play-${st.startAt}`)) {
    mem.add(`play-${st.startAt}`);
    const chart = rhythmusNoten(st.order, bot.id, st.wettkampf);
    const startAt = st.startAt;
    const V = st.versatz;
    // Persönlichkeit: Streuung (Profi ≈ 12 ms, normal ≈ 38 ms, leicht ≈ 70 ms), eigene Verzögerung, Patzer-Rate
    const sigma = (12 + noise * 260) * rand(0.8, 1.25);
    const bias = rand(-12, 28) * (noise ? 1 : 0.3);
    const slip = 0.01 + noise * 0.3;
    bot.once(`rh-play-${startAt}`, async () => {
      for (let i = 0; i < chart.length; i++) {
        const n = chart[i];
        const fast = (i > 0 && n.t - chart[i - 1].t < 200) || (i + 1 < chart.length && chart[i + 1].t - n.t < 200);
        const p = slip * (fast ? 2 : 1);
        const roll = Math.random();
        if (roll < p * 0.4) continue; // Aussetzer → verpasst
        let lane = n.lane;
        if (roll < p) lane = (lane + (Math.random() < 0.5 ? 1 : 3)) % 4; // daneben gegriffen
        const err = Math.max(-260, Math.min(260, gauss() * sigma * (fast ? 1.3 : 1) + bias));
        const wait = startAt + V + n.t + err - Date.now();
        if (wait > 0) await sleep(wait);
        const s = cur(bot);
        if (s?.sub !== 'play' || s.startAt !== startAt) return;
        bot.send('tipp', { l: lane, t: Math.round((n.t + err) * 10) / 10 });
      }
    });
  }
}
