/**
 * Schätzkönig: Bot-Verhalten.
 * Schätzt mit zufälligem Fehler um die richtige Antwort (Wissensfragen kennt er aus dem Pool,
 * Gruppenfragen rät er im typischen Bereich), setzt seine Chips zufällig – gern in die Mitte –
 * und löst als VIP Gruppenfragen mit einer plausiblen Zahl auf.
 */
import type { GameState, PrivateState, SchaetzState } from '../shared/types';
import { SCHAETZ, SCHAETZ_FACTS, SCHAETZ_GROUP, groupQuestion } from '../shared/schaetz';

export interface SchaetzBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  socket: { emit(ev: string, ...args: unknown[]): unknown };
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const done = new WeakMap<SchaetzBotHost, Set<string>>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Normalverteilt (Box-Muller) */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

/** Typischer Bereich einer Gruppenfrage (oder null, wenn es eine Wissensfrage ist) */
function groupRange(bot: SchaetzBotHost, st: SchaetzState) {
  if (!st.subject) return null;
  const name = bot.state?.players.find((p) => p.id === st.subject)?.name ?? '';
  const g = SCHAETZ_GROUP.find((x) => groupQuestion(x, name) === st.question);
  return g ? { lo: g.lo, hi: g.hi } : { lo: 1, hi: 100 };
}

function botGuess(bot: SchaetzBotHost, st: SchaetzState): number {
  const range = groupRange(bot, st);
  if (range) return Math.round(rand(range.lo, range.hi));
  const fact = SCHAETZ_FACTS.find((f) => f.q === st.question);
  if (!fact) return Math.round(rand(1, 1000));
  // Jahreszahlen: ein paar Jahre daneben; sonst Faktor-Fehler (manche Bots liegen weit daneben)
  if (!fact.unit) return Math.round(fact.a + gauss() * 12);
  const spread = Math.random() < 0.2 ? 1.1 : 0.4;
  return Math.max(0, Math.round(fact.a * Math.exp(gauss() * spread)));
}

export function schaetzBot(bot: SchaetzBotHost, st: SchaetzState) {
  let mem = done.get(bot);
  if (!mem) done.set(bot, (mem = new Set()));
  // Spielende: Gedächtnis leeren (sonst schätzt der Bot bei „Nochmal“ in Runde 1 nicht)
  if (st.sub === 'over') return mem.clear();
  const me = bot.state?.players.find((p) => p.id === bot.id);
  const r = st.round;

  // VIP-Bot löst Gruppenfragen auf
  if (st.sub === 'truth' && me?.isVip && !mem.has(`truth-${r}`)) {
    mem.add(`truth-${r}`);
    const range = groupRange(bot, st) ?? { lo: 1, hi: 100 };
    bot.once(`sz-truth-${r}`, async () => {
      await sleep(rand(2500, 4500));
      const cur = bot.state?.mini?.kind === 'schaetz' ? bot.state.mini.state : null;
      if (cur?.sub === 'truth' && cur.round === r) bot.socket.emit('vip:mini', `truth:${Math.round(rand(range.lo, range.hi))}`);
    });
  }
  if (!st.players.includes(bot.id)) return;

  const p = bot.priv?.kind === 'schaetz' && bot.priv.state.round === r ? bot.priv.state : null;
  if (st.sub === 'guess' && p && p.guess === null && !mem.has(`guess-${r}`)) {
    mem.add(`guess-${r}`);
    bot.once(`sz-guess-${r}`, async () => {
      await sleep(rand(2000, 11_000));
      bot.send('guess', { round: r, value: botGuess(bot, st) });
    });
  }
  if (st.sub === 'bet' && st.cards && !mem.has(`bet-${r}`)) {
    mem.add(`bet-${r}`);
    const n = st.cards.length;
    bot.once(`sz-bet-${r}`, async () => {
      for (let i = 0; i < SCHAETZ.CHIPS; i++) {
        await sleep(rand(1200, 6000));
        // Meist eine Karte nahe der Mitte, manchmal außen oder „Alle zu hoch“
        const roll = Math.random();
        const card = roll < 0.08 ? -1 : roll < 0.75 ? Math.max(0, Math.min(n - 1, Math.round((n - 1) / 2 + gauss() * (n / 5)))) : Math.floor(Math.random() * n);
        bot.send('chip', { round: r, card });
      }
    });
  }
}
