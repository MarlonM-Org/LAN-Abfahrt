/**
 * Wer war's?: Bot-Verhalten. Antwortet mit Zufallssätzen aus einer kleinen Liste (ab und zu per „Zufallsantwort“),
 * rät zufällig – als Autor tippt er zum Schein mit, wie ein Mensch es tun soll. Als VIP blättert er weiter.
 */
import type { GameState, PrivateState, WerwarsState } from '../shared/types';

export interface WerwarsBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  socket: { emit(ev: string, ...args: unknown[]): unknown };
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const BOT_ANSWERS = [
  'Ich bin im Hotelpool eingeschlafen',
  'Drei Packungen Gummibärchen',
  'Die Backstreet Boys, 1999',
  'Für Döner, immer',
  'Rückwärts einparken',
  'Ich habe den Bus nach Hause verpasst',
  'Ein Foto von mir mit Schnurrbart',
  'Quallen. Nur Quallen.',
  'Pippi Langstrumpf',
  'Astronaut, was sonst',
  'Ich kann mit den Ohren wackeln',
  'Eine Kuckucksuhr aus dem Schwarzwald',
];

const done = new WeakMap<WerwarsBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function werwarsBot(bot: WerwarsBotHost, st: WerwarsState, vip: boolean) {
  if (!st.players.includes(bot.id)) return;
  let seen = done.get(bot);
  if (!seen) done.set(bot, (seen = new Set()));
  // Neues Spiel (z. B. „Nochmal“) → Merkliste leeren
  if (st.sub === 'intro') seen.clear();
  const p = bot.priv?.kind === 'werwars' && bot.priv.state.sub === st.sub && bot.priv.state.round === st.round ? bot.priv.state : null;
  const cur = () => (bot.state?.mini?.kind === 'werwars' ? bot.state.mini.state : null);

  if (st.sub === 'answer' && p?.todo.length) {
    const task = p.todo[0];
    const key = `ans-${task.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      bot.once(`ww-${key}`, async () => {
        await sleep(rand(2500, 9000));
        // Jede vierte Antwort per „Zufallsantwort“ (testet den Knopf), sonst ein eigener Satz
        if (Math.random() < 0.25) {
          bot.send('safety');
          await sleep(rand(600, 1200));
          const sug = bot.priv?.kind === 'werwars' ? bot.priv.state.suggest : null;
          if (sug) return bot.send('answer', { task: task.id, text: sug.text });
        }
        bot.send('answer', { task: task.id, text: BOT_ANSWERS[Math.floor(Math.random() * BOT_ANSWERS.length)] });
      });
    }
  }

  if (st.sub === 'guess' && p && !p.myGuess) {
    const key = `guess-${st.round}`;
    if (!seen.has(key)) {
      seen.add(key);
      bot.once(`ww-${key}`, async () => {
        await sleep(rand(1500, 6000));
        const s2 = cur();
        if (!s2 || s2.sub !== 'guess' || s2.round !== st.round) return;
        const options = st.players.filter((id) => id !== bot.id);
        bot.send('guess', { round: st.round, target: options[Math.floor(Math.random() * options.length)] });
      });
    }
  }

  // Bot-VIP blättert in Auflösung und Endstand etwas schneller weiter (Timer gibt es trotzdem)
  if (vip && (st.sub === 'reveal' || st.sub === 'scores')) {
    const key = `next-${st.sub}-${st.round}`;
    if (!seen.has(key)) {
      seen.add(key);
      bot.once(`ww-${key}`, async () => {
        await sleep(st.sub === 'scores' ? 4000 : 4500);
        const s2 = cur();
        if (s2 && s2.sub === st.sub && s2.round === st.round) bot.socket.emit('vip:mini', 'next');
      });
    }
  }
}
