/**
 * Werwolf mit Erzähler: Bot-Verhalten (zum Durchtesten ohne Menschen).
 * - VIP-Bot wählt nach kurzer Pause einen zufälligen Erzähler (wenn noch keiner gewählt ist)
 * - Erzähler-Bot teilt aus, schaltet Nacht/Tag, markiert pro Nacht und pro Tag einen Toten (einmal vertippt er
 *   sich und belebt wieder) und beendet das Spiel, sobald eine Seite gewonnen hat
 * - Dieb-Bot tauscht (oder behält) nach kurzem Überlegen
 * Normale Spieler-Bots tun nichts – wie Menschen, die ihr Handy weglegen.
 */
import type { GameState, PrivateState } from '../shared/types';
import { type WrState, wrTeam } from '../shared/wolfrunde';

export interface WolfrundeBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  socket: { emit(ev: string, ...args: unknown[]): unknown };
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** Pro Erzähler-Bot und Austeilen: schon einmal „vertippt“ (töten + wiederbeleben)? */
const oops = new WeakMap<WolfrundeBotHost, number>();

export function wolfrundeBot(bot: WolfrundeBotHost, st: WrState, vip: boolean) {
  const cur = () => (bot.state?.mini?.kind === 'wolfrunde' ? bot.state.mini.state : null);

  if (st.sub === 'setup') {
    if (vip && !st.narrator) {
      bot.once('wr-narrator', async () => {
        await sleep(rand(1200, 2200));
        const s = cur();
        if (s?.sub !== 'setup' || s.narrator) return;
        const ids = [bot.id, ...s.players.filter((id) => id !== bot.id)];
        bot.socket.emit('vip:mini', `narrator:${pickOne(ids)}`);
      });
    }
    if (st.narrator === bot.id) {
      bot.once('wr-deal', async () => {
        await sleep(rand(1500, 2500));
        const s = cur();
        if (s?.sub !== 'setup' || s.narrator !== bot.id) return;
        // Jede zweite Runde mit Dieb – damit auch der Tausch durchläuft
        if (!s.config.specials.includes('dieb') && Math.random() < 0.5) {
          bot.send('config', { toggle: 'dieb' });
          await sleep(500);
        }
        bot.send('deal');
      });
    }
    return;
  }
  if (st.sub !== 'play') return;
  const p = bot.priv?.kind === 'wolfrunde' ? bot.priv.state : null;
  if (!p || p.deal !== st.deal) return;

  // Dieb: zwei übrige Karten → eine nehmen oder behalten (bei zwei Werwölfen muss er)
  if (p.steal) {
    bot.once('wr-steal', async () => {
      await sleep(rand(1500, 3000));
      const must = p.steal!.every((r) => r === 'werwolf');
      bot.send('steal', { pick: must || Math.random() < 0.6 ? Math.floor(Math.random() * 2) : -1 });
    });
  }

  const book = p.book;
  if (!book || st.narrator !== bot.id) return;
  bot.once('wr-narrate', async () => {
    await sleep(rand(1800, 2800));
    const s = cur();
    if (s?.sub !== 'play' || s.narrator !== bot.id || s.deal !== st.deal) return;
    const cards = (bot.priv?.kind === 'wolfrunde' && bot.priv.state.book?.cards) || book.cards;
    const alive = s.players.filter((id) => s.alive[id]);
    const wolves = alive.filter((id) => wrTeam(cards[id] ?? 'dorf') === 'wolf');
    const others = alive.filter((id) => !wolves.includes(id));
    if (s.round > 0 && !wolves.length) return bot.send('end', { winner: 'dorf' });
    if (s.round > 0 && wolves.length >= others.length) return bot.send('end', { winner: 'wolf' });
    if (s.time !== 'night') {
      // Tag: das Dorf wirft jemanden raus (zufällig) – dann wird es Nacht
      if (s.time === 'day' && alive.length) bot.send('kill', { target: pickOne(alive), alive: false });
      return bot.send('time', { to: 'night' });
    }
    // Nacht: die Werwölfe holen jemanden aus dem Dorf
    const victim = others.length ? pickOne(others) : null;
    if (victim) {
      bot.send('kill', { target: victim, alive: false });
      if (oops.get(bot) !== s.deal) {
        // Einmal pro Spiel vertippt: wiederbeleben, kurz danach doch tot
        oops.set(bot, s.deal);
        await sleep(400);
        bot.send('kill', { target: victim, alive: true });
        await sleep(400);
        bot.send('kill', { target: victim, alive: false });
      }
    }
    bot.send('time', { to: 'day' });
  });
}
