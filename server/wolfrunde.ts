import type { MiniSnapshot, PrivateState } from '../shared/types';
import {
  WR,
  WR_MIN_CARDS,
  WR_ROLES,
  WR_SPECIALS,
  WR_WINNER,
  type WrConfig,
  type WrPrivate,
  type WrRole,
  type WrState,
  type WrSub,
  type WrTime,
  type WrWinner,
  wrDeck,
  wrDefaultConfig,
  wrFits,
  wrFixConfig,
  wrTeam,
} from '../shared/wolfrunde';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, shuffle } from './minigame';

/**
 * Für „Nochmal“ bzw. die nächste Runde: zuletzt gewählter Erzähler und Stapel (der VIP kann beides ändern).
 * Den Stapel nur bei gleicher Spielerzahl übernehmen – sonst passt der Vorschlag besser.
 */
const memory: { narrator: string | null; config: WrConfig | null; n: number } = { narrator: null, config: null, n: 0 };

/**
 * Werwolf mit Erzähler – das Spiel lost nur die Karten aus, alles andere macht der Erzähler.
 *
 * `setup`: Der VIP wählt den Erzähler (Dropdown, `vipAction('narrator:<id>')`), der Erzähler stellt den Stapel
 * zusammen (Werwölfe + Sonderrollen) und teilt aus. `play`: Jeder sieht am Handy nur seine Karte, der Erzähler alle
 * und markiert Tote (💀, wiederbeleben geht auch) und schaltet Nacht/Tag (nur Stimmung am TV). Mit Dieb liegen zwei
 * Karten übrig, die der Dieb einmal tauschen darf. `over`: Der Erzähler sagt, wer gewonnen hat → kurze Ansage, Ergebnis.
 *
 * Geheimes geht nur über `privateFor()`; TV und `WrState` sehen bis zum Ende keine einzige Karte.
 */
export class WolfrundeGame implements MiniGame {
  readonly kind = 'wolfrunde' as const;
  private sub: WrSub = 'setup';
  private narrator: string | null = null;
  private config: WrConfig;
  private cards = new Map<string, WrRole>();
  /** Mitspieler mit Karte (fest ab dem Austeilen) */
  private dealt: string[] = [];
  private rest: WrRole[] = [];
  private dieb: string | null = null;
  private stolen = false;
  private alive: Record<string, boolean> = {};
  private time: WrTime = 'dusk';
  private round = 0;
  private deal = 0;
  private winner: WrWinner | null = null;
  private deadline = 0;
  private finished = false;
  private timers = new Timers();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    if (memory.narrator && ids.includes(memory.narrator) && !ctx.isGone?.(memory.narrator)) this.narrator = memory.narrator;
    const n = Math.max(WR_MIN_CARDS, this.narrator ? this.cardPlayers().length : ids.length - 1);
    this.config = memory.config && memory.n === n ? wrFixConfig(memory.config, n) : wrDefaultConfig(n);
  }

  /** Wer in `setup` eine Karte bekäme: alle (nicht entfernten) außer dem Erzähler */
  private cardPlayers() {
    return this.ids.filter((id) => id !== this.narrator && !this.ctx.isGone?.(id));
  }

  snapshot(): MiniSnapshot {
    const state: WrState = {
      sub: this.sub,
      endsIn: endsIn(this.deadline),
      narrator: this.narrator,
      players: this.sub === 'setup' ? this.cardPlayers() : [...this.dealt],
      config: this.config,
      alive: this.alive,
      time: this.time,
      round: this.round,
      deal: this.deal,
      winner: this.winner,
      roles: this.sub === 'over' ? Object.fromEntries(this.cards) : null,
    };
    return { kind: 'wolfrunde', state };
  }

  privateFor(id: string): PrivateState {
    const base: WrPrivate = { deal: this.deal, card: null, steal: null, wasDieb: false, book: null };
    if (id === this.narrator) {
      if (this.sub !== 'setup') base.book = { cards: Object.fromEntries(this.cards), dieb: this.dieb, stolen: this.stolen, rest: [...this.rest] };
      return { kind: 'wolfrunde', state: base };
    }
    const card = this.sub === 'setup' ? undefined : this.cards.get(id);
    if (!card) return null;
    base.card = card;
    base.wasDieb = id === this.dieb && card !== 'dieb';
    if (id === this.dieb && !this.stolen && this.sub === 'play') base.steal = [...this.rest];
    return { kind: 'wolfrunde', state: base };
  }

  /** Nur der VIP (Raum prüft das): Erzähler wählen bzw. abwählen – nur vor dem Austeilen */
  vipAction(action: string) {
    if (this.sub !== 'setup' || !action.startsWith('narrator:')) return;
    const id = action.slice('narrator:'.length);
    if (id && (!this.ids.includes(id) || this.ctx.isGone?.(id))) return;
    this.narrator = id || null;
    this.config = wrFixConfig(this.config, Math.max(WR_MIN_CARDS, this.cardPlayers().length));
    this.ctx.onChange();
  }

  input(id: string, action: string, payload: unknown) {
    const p = asRecord(payload);
    // Der Dieb entscheidet einmal: eine der zwei übrigen Karten nehmen (0/1) oder behalten (-1)
    if (action === 'steal') return this.steal(id, Number(p.pick));
    if (id !== this.narrator) return;

    if (this.sub === 'setup') {
      if (action === 'config') this.configure(p);
      else if (action === 'deal') this.dealCards();
      return;
    }
    if (this.sub !== 'play') return;
    const target = String(p.target ?? '');
    if (action === 'kill' && this.dealt.includes(target)) {
      // Totenkopf (und zurück, falls sich der Erzähler vertippt hat)
      this.alive[target] = typeof p.alive === 'boolean' ? p.alive : !this.alive[target];
      this.ctx.onChange();
    } else if (action === 'time') {
      const to = p.to === 'night' ? 'night' : p.to === 'day' ? 'day' : null;
      if (!to || to === this.time) return;
      if (to === 'night') this.round += 1;
      else this.round = Math.max(1, this.round);
      this.time = to;
      this.ctx.onChange();
    } else if (action === 'redeal') {
      // Zurück zur Stapel-Auswahl (z. B. jemand hat eine fremde Karte gesehen) – neue Karten beim nächsten Austeilen
      this.sub = 'setup';
      this.resetCards();
      this.deal += 1;
      this.ctx.onChange();
    } else if (action === 'end') {
      const w = p.winner === 'dorf' || p.winner === 'wolf' || p.winner === 'liebe' ? p.winner : null;
      if (!w) return;
      this.winner = w;
      this.sub = 'over';
      this.deadline = Date.now() + WR.OVER_MS;
      this.timers.later(WR.OVER_MS, () => this.finish());
      this.ctx.onChange();
    }
  }

  private configure(p: Record<string, unknown>) {
    const n = Math.max(WR_MIN_CARDS, this.cardPlayers().length);
    let c = this.config;
    if (typeof p.wolves === 'number') {
      const wolves = Math.round(p.wolves);
      if (wolves > c.wolves && !wrFits(c, n, { wolf: true })) return;
      c = { ...c, wolves };
    }
    const role = String(p.toggle ?? '') as WrRole;
    if (WR_SPECIALS.includes(role)) {
      if (c.specials.includes(role)) c = { ...c, specials: c.specials.filter((r) => r !== role) };
      else if (wrFits(c, n, { role })) c = { ...c, specials: [...c.specials, role] };
      else return;
    }
    this.config = wrFixConfig(c, n);
    this.ctx.onChange();
  }

  private dealCards() {
    const players = this.cardPlayers();
    if (players.length < WR_MIN_CARDS) return;
    this.config = wrFixConfig(this.config, players.length);
    const deck = shuffle(wrDeck(this.config, players.length));
    this.resetCards();
    this.dealt = shuffle(players);
    this.dealt.forEach((id, i) => this.cards.set(id, deck[i]));
    this.rest = deck.slice(players.length);
    this.dieb = this.dealt.find((id) => this.cards.get(id) === 'dieb') ?? null;
    this.alive = Object.fromEntries(this.dealt.map((id) => [id, true]));
    this.sub = 'play';
    this.deal += 1;
    Object.assign(memory, { narrator: this.narrator, config: this.config, n: players.length });
    this.ctx.onChange();
  }

  private resetCards() {
    this.cards.clear();
    this.dealt = [];
    this.rest = [];
    this.dieb = null;
    this.stolen = false;
    this.alive = {};
    this.time = 'dusk';
    this.round = 0;
  }

  private steal(id: string, pick: number) {
    if (this.sub !== 'play' || id !== this.dieb || this.stolen || this.cards.get(id) !== 'dieb') return;
    // Liegen zwei Werwölfe übrig, muss der Dieb einen nehmen
    const mustTake = this.rest.length === 2 && this.rest.every((r) => r === 'werwolf');
    if (pick === 0 || pick === 1) {
      const taken = this.rest[pick];
      if (!taken) return;
      this.cards.set(id, taken);
      this.rest[pick] = 'dieb';
    } else if (pick !== -1 || mustTake) return;
    this.stolen = true;
    this.ctx.onChange();
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const w = this.winner ?? 'dorf';
    const team = (id: string) => wrTeam(this.cards.get(id) ?? 'dorf');
    const wins = (id: string) => (w === 'liebe' ? this.alive[id] : team(id) === w);
    const winners = this.dealt.filter(wins);
    const losers = this.dealt.filter((id) => !wins(id));
    const details: Record<string, string> = {};
    for (const id of this.dealt) {
      const card = this.cards.get(id) ?? 'dorf';
      const was = id === this.dieb && card !== 'dieb' ? ' (war Dieb)' : '';
      details[id] = `${WR_ROLES[card].name}${was}${this.alive[id] ? '' : ' · tot'}`;
    }
    this.ctx.finish({ groups: [winners, losers].filter((g) => g.length), details, subtitle: WR_WINNER[w].title });
  }

  playerDisconnected() {
    this.ctx.onChange();
  }

  dispose() {
    this.timers.clear();
  }
}
