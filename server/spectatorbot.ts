/**
 * Bots als Zuschauer: Wer raus ist, schickt ab und zu ein Emote, setzt einmal pro Runde auf einen
 * Lebenden und nutzt die Geister-Aktionen (Arena: Wasserbombe an den Rand, Sumo: Welle).
 */
import type { GameState } from '../shared/types';
import { EMOTES, type SpectatorInfo } from '../shared/spectator';

export interface SpectatorBotHost {
  id: string;
  send(action: string, payload?: unknown): void;
  socket: { emit(ev: 'emote', i: number): unknown };
}

interface Mem {
  emoteAt: number;
  betKey: string;
  betAt: number;
  ghostAt: number;
  stickAt: number;
  waveAt: number;
}

const mems = new WeakMap<SpectatorBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

export function spectatorBot(bot: SpectatorBotHost, s: GameState) {
  if (s.phase !== 'mini' || !s.mini) return;
  let mem = mems.get(bot);
  if (!mem) mems.set(bot, (mem = { emoteAt: Date.now() + rand(3000, 12000), betKey: '', betAt: 0, ghostAt: 0, stickAt: 0, waveAt: 0 }));
  const now = Date.now();
  const st = s.mini.state as unknown as { spectator?: SpectatorInfo };
  const spec = st.spectator;
  const watching = (s.inGame && !s.inGame.includes(bot.id)) || (spec ? !spec.alive.includes(bot.id) : false);

  // Emotes: nur wer zuschaut, und nur gelegentlich
  if (watching && now >= mem.emoteAt) {
    mem.emoteAt = now + rand(5000, 16000);
    bot.socket.emit('emote', Math.floor(Math.random() * EMOTES.length));
  }

  // Wetten: einmal pro Runde, mit kurzer Bedenkzeit
  if (spec?.open && watching && !spec.bets[bot.id] && spec.alive.length >= 2) {
    const key = `${s.mini.kind}-${spec.round}`;
    if (mem.betKey !== key) {
      mem.betKey = key;
      mem.betAt = now + rand(600, 3500);
    } else if (mem.betAt && now >= mem.betAt) {
      mem.betAt = 0;
      bot.send('bet', { on: pick(spec.alive) });
    }
  }

  // Geister-Aktionen
  const m = s.mini;
  if (m.kind === 'arena' && m.state.sub === 'play') {
    const g = m.state.ghosts?.[bot.id];
    if (!g) return;
    const targets = Object.values(m.state.players).filter((p) => p.alive);
    if (!targets.length) return;
    const t = targets.reduce((a, b) => (Math.hypot(a.x - g.x, a.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? a : b));
    const dx = t.x - g.x;
    const dy = t.y - g.y;
    const d = Math.hypot(dx, dy);
    if (now >= mem.stickAt) {
      mem.stickAt = now + 150;
      bot.send('ghost', d > 1 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 });
    }
    if (g.cd <= 0) {
      if (!mem.ghostAt) mem.ghostAt = now + rand(800, 3000);
      if (now >= mem.ghostAt) {
        mem.ghostAt = 0;
        bot.send('throw');
      }
    }
  } else if (m.kind === 'sumo' && m.state.sub === 'play') {
    const g = m.state.ghosts?.[bot.id];
    if (!g || g.cd > 0) return;
    if (!mem.waveAt) mem.waveAt = now + rand(500, 4000);
    if (now >= mem.waveAt) {
      mem.waveAt = 0;
      bot.send('wave');
    }
  }
}
