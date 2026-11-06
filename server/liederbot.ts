/**
 * Guess the Song: Bot-Verhalten.
 * Wählt zufällige Genres und „erkennt“ einen Song mit ca. 60 % Wahrscheinlichkeit (dann tippt er richtig,
 * sonst rät er) – nach 1,5 bis 12 Sekunden.
 */
import type { GameState, LiederState, PrivateState } from '../shared/types';
import { shuffle } from './minigame';

export interface LiederBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const done = new WeakMap<LiederBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cur = (bot: LiederBotHost) => (bot.state?.mini?.kind === 'lieder' ? bot.state.mini.state : null);

export function liederBot(bot: LiederBotHost, st: LiederState) {
  let mem = done.get(bot);
  if (!mem) done.set(bot, (mem = new Set()));
  // Spielende: Gedächtnis leeren (sonst wählt der Bot bei „Nochmal“ keine Genres)
  if (st.sub === 'over') return mem.clear();
  if (!st.players.includes(bot.id)) return;

  if (st.sub === 'pick' && !st.picked.includes(bot.id) && !mem.has('pick')) {
    mem.add('pick');
    bot.once('lieder-pick', async () => {
      await sleep(rand(2500, 9000));
      const s = cur(bot);
      if (s?.sub !== 'pick') return;
      bot.send('genres', { genres: shuffle(s.genres.map((g) => g.id)).slice(0, s.perPlayer) });
    });
  }
  if (st.sub === 'genres') mem.delete('pick');

  const r = st.round;
  const p = bot.priv?.kind === 'lieder' && bot.priv.state.round === r ? bot.priv.state : null;
  if (st.sub === 'play' && p && p.choice === null && !mem.has(`answer-${r}`)) {
    mem.add(`answer-${r}`);
    const knows = Math.random() < 0.6;
    const n = st.options.length;
    bot.once(`lieder-answer-${r}`, async () => {
      await sleep(knows ? rand(1500, 9000) : rand(4000, 12_000));
      const s = cur(bot);
      if (s?.sub !== 'play' || s.round !== r) return;
      // Lösung erst jetzt lesen – das private Paket kann kurz nach dem Zustand ankommen
      const hint = bot.priv?.kind === 'lieder' && bot.priv.state.round === r ? bot.priv.state.botAnswer : undefined;
      bot.send('answer', { round: r, index: knows && hint !== undefined ? hint : Math.floor(Math.random() * n) });
    });
  }
}
