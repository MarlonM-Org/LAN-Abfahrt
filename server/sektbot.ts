/**
 * Sektkorken: Bot-Verhalten.
 * Legt im Countdown den Daumen auf den Korken, schüttelt mit eigener (wackliger) Stärke und lässt bei einem
 * selbst gewählten Zieldruck los – meist knapp unter der roten Zone, manchmal viel zu früh, manchmal zu gierig
 * (dann platzt die Flasche, wenn die Reaktion zu langsam ist). Selten rutscht der Daumen einfach ab.
 */
import type { GameState } from '../shared/types';
import { SEKT, type SektState } from '../shared/sekt';

export interface SektBotHost {
  id: string;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
}

interface Mem {
  /** Für welchen Durchgang geplant wurde */
  round: number;
  holdAt: number;
  held: boolean;
  /** Schüttelstärke und Zieldruck (relativ zur roten Zone, negativ = gierig) */
  power: number;
  margin: number;
  /** Fester Zieldruck (Frühstarter), sonst null */
  early: number | null;
  /** Daumen rutscht zu diesem Zeitpunkt ab (oder nie) */
  slipAt: number;
  releaseAt: number;
  nextShake: number;
}

const mems = new WeakMap<SektBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function sektBot(bot: SektBotHost, st: SektState) {
  const me = st.players[bot.id];
  if (!me) return;
  const now = Date.now();
  let mem = mems.get(bot);
  if (!mem || mem.round !== st.round) {
    const roll = Math.random();
    mem = {
      round: st.round,
      holdAt: now + rand(150, 1600),
      held: false,
      power: rand(0.55, 1.25),
      // 15 % gierig (ins Rote), 15 % Angsthase, sonst knapp darunter
      margin: roll < 0.15 ? rand(-0.06, 0) : rand(0.02, 0.12),
      early: roll > 0.85 ? rand(0.25, 0.6) : null,
      slipAt: Math.random() < 0.05 ? now + SEKT.COUNT_MS + rand(800, 4500) : Infinity,
      releaseAt: Infinity,
      nextShake: 0,
    };
    mems.set(bot, mem);
  }
  if (st.sub !== 'countdown' && st.sub !== 'shake') return;

  // Daumen drauf (im Countdown oder kurz danach)
  if (me.st === 'wait' && !mem.held && now >= mem.holdAt) {
    mem.held = true;
    bot.send('cork', { down: true });
    return;
  }
  if (me.st !== 'in' || st.sub !== 'shake') return;

  // Abgerutscht – zählt trotzdem
  if (now >= mem.slipAt) {
    mem.slipAt = Infinity;
    bot.send('cork', { down: false });
    return;
  }
  const target = mem.early ?? Math.max(0.2, st.red - mem.margin);
  const reached = me.p >= target || me.danger > 0;
  if (reached && mem.releaseAt === Infinity) {
    // Reaktionszeit: im Roten mal schnell genug, mal nicht
    mem.releaseAt = now + (me.danger > 0 ? rand(120, 520) : rand(80, 450));
  }
  if (now >= mem.releaseAt) {
    mem.releaseAt = Infinity;
    bot.send('cork', { down: false });
    return;
  }
  if (now >= mem.nextShake) {
    mem.nextShake = now + 100;
    // Kurz vor dem Ziel sanfter schütteln (aber nicht zu genau)
    const close = !reached && target - me.p < 0.12;
    const s = reached ? 0 : mem.power * (close ? rand(0.3, 0.8) : rand(0.8, 1.15));
    bot.send('shake', { s: Math.round(Math.min(SEKT.S_MAX, Math.max(0, s)) * 100) / 100 });
  }
}
