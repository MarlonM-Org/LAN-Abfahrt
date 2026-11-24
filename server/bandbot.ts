/**
 * Strand-Band: Bot-Verhalten. Wählt meist das vorgeschlagene Instrument (manchmal ein anderes freies), drückt
 * nach ein paar Sekunden „Bereit“ und spielt dann seine Spur mit zufälliger Genauigkeit – er meldet jede Note
 * so, wie das Handy es tun würde (`hit` mit Bewertung 0–2, bei Halte-Noten danach `hold`).
 */
import type { GameState } from '../shared/types';
import { BAND_INSTS, type BandState, bandChart, bandSong } from '../shared/band';

export interface BandBotHost {
  id: string;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const memory = new WeakMap<BandBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cur = (bot: BandBotHost) => (bot.state?.mini?.kind === 'band' ? bot.state.mini.state : null);

export function bandBot(bot: BandBotHost, st: BandState) {
  const me = st.players[bot.id];
  if (!me) return;
  let mem = memory.get(bot);
  if (!mem) memory.set(bot, (mem = new Set()));

  if (st.sub === 'pick' && !me.ready && !mem.has(`pick-${st.song}-${st.order.join()}`)) {
    mem.add(`pick-${st.song}-${st.order.join()}`);
    bot.once('band-pick', async () => {
      await sleep(rand(800, 4000));
      let s = cur(bot);
      if (s?.sub !== 'pick') return;
      if (Math.random() < 0.25) {
        const free = BAND_INSTS.filter((k) => k !== s!.players[bot.id]?.inst && s!.order.filter((id) => s!.players[id].inst === k).length < s!.cap);
        if (free.length) {
          bot.send('inst', { inst: free[Math.floor(Math.random() * free.length)] });
          await sleep(rand(400, 1200));
        }
      }
      s = cur(bot);
      if (s?.sub === 'pick') bot.send('ready');
    });
  }

  if (st.sub === 'play' && st.startAt && !mem.has(`play-${st.startAt}`)) {
    mem.add(`play-${st.startAt}`);
    const song = bandSong(st.song);
    if (!song) return;
    const chart = bandChart(song, me.inst);
    // Jeder Bot spielt anders gut: 55–95 % Treffer, davon gut zwei Drittel perfekt
    const skill = rand(0.55, 0.95);
    const startAt = st.startAt;
    bot.once(`band-play-${startAt}`, async () => {
      for (let i = 0; i < chart.length; i++) {
        const n = chart[i];
        const wait = startAt + n.t - Date.now();
        if (wait > 0) await sleep(wait);
        const s = cur(bot);
        if (s?.sub !== 'play' || s.startAt !== startAt) return;
        const roll = Math.random();
        const q = roll < skill * 0.7 ? 2 : roll < skill ? 1 : 0;
        bot.send('hit', { i, q });
        if (n.len && q > 0) {
          const ok = Math.random() < skill;
          const len = n.len;
          setTimeout(() => bot.send('hold', { i, ok }), ok ? len : len * 0.4);
        }
      }
    });
  }
}
