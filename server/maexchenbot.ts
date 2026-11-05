/**
 * Mäxchen am Pool: Bot-Verhalten.
 * Glaubt oder deckt auf je nachdem, wie wahrscheinlich die Ansage ist, und sagt meist ehrlich an –
 * mit 30 % blufft er auch dann (etwas höher), wenn sein Wurf reicht; reicht er nicht, muss er lügen.
 */
import type { MaexState, PrivateState } from '../shared/types';
import { MAEX, MAEXCHEN, MAEX_ORDER, maexBeats, maexChanceAtLeast, maexRank } from '../shared/maexchen';

export interface MaexBotHost {
  id: string;
  priv: PrivateState;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function maexBot(bot: MaexBotHost, st: MaexState, cur: () => MaexState | null) {
  if (st.turn !== bot.id) return;
  if (st.sub === 'roll') {
    bot.once(`mx-roll-${st.phaseNo}`, async () => {
      await sleep(rand(1200, 3200));
      const now = cur();
      if (!now || now.sub !== 'roll' || now.phaseNo !== st.phaseNo) return;
      const claim = now.claim?.value;
      if (claim == null) return bot.send('roll');
      // Je unwahrscheinlicher die Ansage, desto eher aufdecken; Mäxchen meist anzweifeln
      const p = maexChanceAtLeast(claim);
      const doubt = claim === MAEXCHEN ? Math.random() < 0.6 : Math.random() < Math.min(0.85, Math.max(0.05, 0.9 - p * 1.1));
      bot.send(doubt ? 'doubt' : 'roll');
    });
  }
  if (st.sub === 'announce') {
    bot.once(`mx-ann-${st.phaseNo}`, async () => {
      // Kurz warten, bis die privaten Würfel da sind
      for (let i = 0; i < 20 && !(bot.priv?.kind === 'maexchen' && bot.priv.state.phaseNo === st.phaseNo); i++) await sleep(100);
      await sleep(rand(1200, 3000));
      const now = cur();
      if (!now || now.sub !== 'announce' || now.phaseNo !== st.phaseNo) return;
      const mine = bot.priv?.kind === 'maexchen' && bot.priv.state.phaseNo === st.phaseNo ? bot.priv.state.value : null;
      const claim = now.claim?.value;
      const base = claim == null ? -1 : maexRank(claim);
      let value: number;
      if (mine != null && maexBeats(mine, claim) && Math.random() >= MAEX.BOT_BLUFF) value = mine;
      else {
        // Bluff: ein bis drei Stufen über der Ansage bzw. dem eigenen Wurf (Mäxchen selten)
        const from = Math.max(base, mine != null && maexBeats(mine, claim) ? maexRank(mine) : base);
        const step = 1 + Math.floor(Math.random() * 3);
        let r = Math.min(MAEX_ORDER.length - 1, from + step);
        if (MAEX_ORDER[r] === MAEXCHEN && from + 1 < MAEX_ORDER.length - 1 && Math.random() < 0.7) r -= 1;
        value = MAEX_ORDER[r];
      }
      bot.send('announce', { value });
    });
  }
}
