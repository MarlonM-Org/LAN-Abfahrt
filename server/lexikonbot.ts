/**
 * Lügen-Lexikon: Bot-Verhalten.
 * Schreibt eine Fälschung (meist eine Haus-Lüge des Eintrags, sonst eine aus derselben Kategorie oder eine generische),
 * versucht es nach einer Abweisung noch einmal und tippt dann zufällig – mit leicht erhöhter Chance auf die Wahrheit.
 * Als VIP blättert er den Zwischenstand etwas schneller weiter.
 */
import type { GameState, PrivateState } from '../shared/types';
import { type LexState, lexKey, lexTooClose } from '../shared/lexikon';
import { LEX_ENTRIES } from './lexikonData';

export interface LexBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  socket: { emit(ev: string, ...args: unknown[]): unknown };
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const GENERIC = ['Weiß doch jeder', 'Ein alter Brauch', 'Ein Missverständnis', 'Etwas mit Käse', 'Ein Seemannsknoten', 'Die Oma von Ben'];

const done = new WeakMap<LexBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const live = (bot: LexBotHost) => (bot.state?.mini?.kind === 'lexikon' ? bot.state.mini.state : null);

function botLie(st: LexState, attempt: number): string {
  const e = LEX_ENTRIES.find((x) => x.q === st.prompt);
  const truth = e ? [e.a, ...e.alt] : [];
  const fits = (t: string) => !lexTooClose(t, truth);
  const own = e?.lies.filter(fits) ?? [];
  const same = LEX_ENTRIES.filter((x) => x.cat === st.cat && x !== e).flatMap((x) => x.lies).filter(fits);
  // Meist eine Lüge aus derselben Kategorie (sonst schreiben alle Bots dieselben drei Haus-Lügen)
  if (attempt === 0 && own.length && Math.random() < 0.25) return pick(own);
  if (attempt <= 1 && same.length) return pick(same);
  return `${pick(GENERIC.filter(fits)) ?? 'Keine Ahnung'} ${Math.floor(rand(2, 99))}`;
}

export function lexikonBot(bot: LexBotHost, st: LexState, vip: boolean) {
  let mem = done.get(bot);
  if (!mem) done.set(bot, (mem = new Set()));
  // Spielende: Gedächtnis leeren (sonst schreibt der Bot bei „Nochmal“ in Frage 1 nicht)
  if (st.sub === 'over') return mem.clear();
  const r = st.round;

  // Bot-VIP blättert den Zwischenstand schneller weiter (Timer gibt es trotzdem)
  if (vip && st.sub === 'scores' && !mem.has(`next-${r}`)) {
    mem.add(`next-${r}`);
    bot.once(`lx-next-${r}`, async () => {
      await sleep(3500);
      const cur = live(bot);
      if (cur?.sub === 'scores' && cur.round === r) bot.socket.emit('vip:mini', 'next');
    });
  }
  if (!st.players.includes(bot.id)) return;
  const p = bot.priv?.kind === 'lexikon' && bot.priv.state.round === r && bot.priv.state.sub === st.sub ? bot.priv.state : null;
  if (!p) return;

  if (st.sub === 'write' && !p.lie) {
    const attempt = p.reject?.seq ?? 0;
    const key = `w-${r}-${attempt}`;
    if (mem.has(key) || attempt > 3) return;
    mem.add(key);
    bot.once(`lx-${key}`, async () => {
      await sleep(attempt ? rand(800, 2000) : rand(2500, 9000));
      const cur = live(bot);
      if (cur?.sub === 'write' && cur.round === r) bot.send('lie', { round: r, text: botLie(cur, attempt) });
    });
  }

  if (st.sub === 'vote' && p.pick === null && st.options && !mem.has(`v-${r}`)) {
    mem.add(`v-${r}`);
    const options = st.options;
    bot.once(`lx-v-${r}`, async () => {
      await sleep(rand(1500, 6500));
      const e = LEX_ENTRIES.find((x) => x.q === st.prompt);
      const allowed = options.map((_, i) => i).filter((i) => !p.mine.includes(i));
      if (!allowed.length) return;
      const truth = e ? options.findIndex((o) => lexKey(o) === lexKey(e.a)) : -1;
      // Zufällig – mit leicht erhöhter Chance auf die Wahrheit
      const idx = truth >= 0 && Math.random() < 1 / allowed.length + 0.15 ? truth : pick(allowed);
      bot.send('pick', { round: r, idx });
    });
  }
}
