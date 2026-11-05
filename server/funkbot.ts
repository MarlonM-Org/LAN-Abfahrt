/**
 * Funkfrequenz: Bot-Verhalten.
 * Funker-Bot tippt nach kurzem Überlegen einen Hinweis aus einer kleinen Liste („…“, „Glühwein“ …),
 * Team-Bots drehen ihren Schieber in kleinen Schritten zu einem Punkt mit kräftiger Streuung ums Ziel
 * (sie „hören“ den Hinweis ja nicht – ±25), der Kapitän-Bot macht den Tipp irgendwann fest,
 * Gegner-Bots wetten zufällig.
 */
import type { FunkState, GameState, PrivateState } from '../shared/types';
import { FUNK_BOT_CLUES, funkClamp, funkOther } from '../shared/funk';

export interface FunkBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

interface Mem {
  round: number;
  aim: number | null;
  cur: number;
  nextAt: number;
  lockAt: number;
}

const mems = new WeakMap<FunkBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function funkBot(bot: FunkBotHost, st: FunkState) {
  const p = bot.priv?.kind === 'funk' && bot.priv.state.round === st.round ? bot.priv.state : null;
  if (!p) return;
  const cur = () => (bot.state?.mini?.kind === 'funk' ? bot.state.mini.state : null);
  let mem = mems.get(bot);
  if (!mem || mem.round !== st.round) {
    mem = { round: st.round, aim: null, cur: 50, nextAt: 0, lockAt: 0 };
    mems.set(bot, mem);
  }

  // Funker: kurz überlegen, Hinweis „tippen“ (manchmal nur laut gesagt = ohne Text), los
  if (p.role === 'funker' && st.sub === 'clue') {
    bot.once(`funk-clue-${st.round}`, async () => {
      await sleep(rand(1500, 4500));
      const s2 = cur();
      if (s2?.sub !== 'clue' || s2.round !== st.round) return;
      const text = Math.random() < 0.8 ? FUNK_BOT_CLUES[Math.floor(Math.random() * FUNK_BOT_CLUES.length)] : '';
      bot.send('clue', { text, go: true });
    });
  }

  // Team: Schieber in Schritten zum eigenen (gestreuten) Ziel drehen
  if (p.role === 'team' && st.sub === 'tune' && !st.locked) {
    const now = Date.now();
    if (mem.aim === null && p.botHint !== undefined) {
      mem.aim = Math.round(funkClamp(p.botHint + rand(-25, 25)));
      mem.nextAt = now + rand(800, 2500);
      mem.lockAt = now + rand(12000, 26000);
    }
    if (mem.aim !== null && now >= mem.nextAt && Math.abs(mem.aim - mem.cur) > 0.5) {
      const step = Math.sign(mem.aim - mem.cur) * Math.min(Math.abs(mem.aim - mem.cur), rand(4, 12));
      mem.cur = Math.round(funkClamp(mem.cur + step));
      mem.nextAt = now + rand(150, 450);
      bot.send('dial', { v: mem.cur });
    }
    // Kapitän-Bot macht nur fest, wenn keine Menschen mitdrehen (die sollen in Ruhe diskutieren)
    const humans = st.teams[st.active].some((id) => id !== st.funker && bot.state?.players.some((pl) => pl.id === id && !pl.bot && pl.connected));
    if (st.captain === bot.id && mem.lockAt && now >= mem.lockAt && !humans) {
      mem.lockAt = 0;
      bot.send('lock');
    }
  }

  // Gegner: zufällig wetten
  if (p.role === 'gegner' && st.sub === 'bet' && !(bot.id in st.bets) && st.teams[funkOther(st.active)].includes(bot.id)) {
    bot.once(`funk-bet-${st.phaseNo}`, async () => {
      await sleep(rand(1200, 5000));
      const s2 = cur();
      if (s2?.sub !== 'bet' || s2.phaseNo !== st.phaseNo) return;
      bot.send('bet', { side: Math.random() < 0.5 ? 'left' : 'right' });
    });
  }
}
