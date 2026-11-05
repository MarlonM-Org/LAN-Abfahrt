/**
 * Zuschauer-Ebene auf dem Server: Emotes (für alle Spiele, im Raum) und Wetten auf den
 * Rundensieger (pro Elimination-Spiel ein `BetBook`).
 */
import { EMOTES, type EmoteEntry, type BetFx, SPECTATOR, type SpectatorInfo } from '../shared/spectator';
import { groupByScore } from './minigame';

/** Kurzlebige Emotes: Ringpuffer (12), Einträge leben 4 s, 2 s Abklingzeit pro Spieler. */
export class EmoteFeed {
  private list: EmoteEntry[] = [];
  private last = new Map<string, number>();
  private seq = 0;

  /** true = angenommen (Zustand hat sich geändert) */
  add(playerId: string, raw: unknown, now = Date.now()): boolean {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= EMOTES.length) return false;
    const last = this.last.get(playerId);
    if (last !== undefined && now - last < SPECTATOR.EMOTE_COOLDOWN_MS) return false;
    this.last.set(playerId, now);
    this.list.push({ seq: ++this.seq, playerId, i, at: now });
    if (this.list.length > SPECTATOR.EMOTE_MAX) this.list.shift();
    return true;
  }

  /** Für den Zustand: nur die der letzten 4 s */
  state(now = Date.now()): EmoteEntry[] {
    if (this.list.length && now - this.list[0].at > SPECTATOR.EMOTE_TTL_MS) this.list = this.list.filter((e) => now - e.at <= SPECTATOR.EMOTE_TTL_MS);
    return this.list;
  }
}

/**
 * Wetten der Ausgeschiedenen auf den Rundensieger. Pro Runde ein Tipp (nicht änderbar),
 * richtig getippt = +1 Bonuspunkt. Der Bonus geht in die Platzierung ein, hebt aber nie
 * jemanden vor die Spitze (`rank`).
 *
 * Einbau in ein Spiel (wenige Zeilen): `newRound()` am Rundenstart, `place()` bei der Action `bet`,
 * `resolve()` am Rundenende, `info()` als `spectator` im Snapshot, `rank()`/`detail()` in `finish`.
 */
export class BetBook {
  private bets = new Map<string, string>();
  private bonus = new Map<string, number>();
  private fx: BetFx[] = [];
  private seq = 0;
  /** Spiele ohne Runden (Smash) rufen newRound() nie auf: dann ist es Runde 1 */
  private round = 1;
  private resolved = false;

  /** Neue Runde: alte Tipps weg */
  newRound(round: number) {
    this.round = round;
    this.bets.clear();
    this.resolved = false;
  }

  /**
   * Tipp abgeben. `players` = alle Mitspieler des Spiels, `alive` = wer noch lebt, `open` = Runde läuft.
   * Nur wer mitspielt und schon raus ist, darf – einmal pro Runde, auf eine(n) Lebende(n).
   */
  place(id: string, payload: unknown, players: readonly string[], alive: readonly string[], open: boolean): boolean {
    if (!open || this.resolved || alive.length < 2) return false;
    if (!players.includes(id) || alive.includes(id) || this.bets.has(id)) return false;
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).on : payload;
    const on = String(raw ?? '');
    if (!alive.includes(on)) return false;
    this.bets.set(id, on);
    return true;
  }

  /** Rundenende: Treffer zählen (einmal pro Runde). Liefert, wer richtig lag. */
  resolve(winner: string | null): string[] {
    if (this.resolved) return [];
    this.resolved = true;
    if (!winner) return [];
    const ids = [...this.bets].filter(([, on]) => on === winner).map(([id]) => id);
    for (const id of ids) this.bonus.set(id, (this.bonus.get(id) ?? 0) + 1);
    if (this.bets.size) {
      this.fx.push({ seq: ++this.seq, round: this.round, winner, ids });
      if (this.fx.length > 4) this.fx.shift();
    }
    return ids;
  }

  bonusOf(id: string) {
    return this.bonus.get(id) ?? 0;
  }

  /** Text-Anhang für den Ergebnis-Screen, z. B. „ · 🎲 +2“ */
  detail(id: string) {
    const b = this.bonusOf(id);
    return b ? ` · 🎲 +${b}` : '';
  }

  /**
   * Platzierung mit Wett-Bonus: Wer nach dem eigentlichen Spielstand vorn liegt, bleibt vorn –
   * alle anderen bekommen ihren Bonus, kommen damit aber höchstens knapp hinter die Spitze.
   */
  rank(ids: readonly string[], base: (id: string) => number): string[][] {
    if (!ids.length) return [];
    const top = Math.max(...ids.map(base));
    return groupByScore([...ids], (id) => {
      const b = base(id);
      return b >= top ? b : Math.min(b + this.bonusOf(id), top - 0.5);
    });
  }

  info(alive: readonly string[], round: number, open: boolean, roundWinner?: string | null): SpectatorInfo {
    return {
      alive: [...alive],
      ...(roundWinner !== undefined ? { roundWinner } : {}),
      round,
      open: open && !this.resolved && alive.length >= 2,
      bets: Object.fromEntries(this.bets),
      bonus: Object.fromEntries(this.bonus),
      fx: this.fx,
    };
  }
}
