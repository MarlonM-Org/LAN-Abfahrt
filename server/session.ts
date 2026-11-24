import type { Look, MiniKind, SessionRow, SessionSeries, SessionState } from '../shared/types';
import { seriesLabel } from '../shared/games';

interface Entry {
  id: string;
  name: string;
  look: Look;
  points: number;
  games: number;
  wins: number;
  bot: boolean;
}

/** Wer gerade im Raum ist (für Name/Aussehen/Status im Leaderboard) */
export interface Present {
  id: string;
  name: string;
  look: Look;
  connected: boolean;
  removed?: boolean;
  isBot?: boolean;
}

/**
 * Leaderboard des Abends: Punkte pro Spieler-ID über alle Einzelspiele (Arcade, Laptop-Auswahl,
 * Einzelspiel aus der Lobby). Lebt nur im Speicher – bis der VIP/Laptop zurücksetzt oder der Server neu startet
 * (die ewige Tabelle über alle Abende speichert server/leaderboard.ts in data/arcade.json).
 * Die Tabelle zeigt nur, wer gerade in der Runde ist (online oder kurz offline). Wer ganz weg ist (entfernt bzw.
 * nach der Offline-Frist raus), verschwindet aus der Tabelle – seine Punkte bleiben aber gespeichert und sind wieder
 * da, wenn er mit demselben Handy zurückkommt. Wer neu dazukommt, startet bei 0.
 */
export class SessionBoard {
  private entries = new Map<string, Entry>();
  /** Platz vor dem zuletzt gewerteten Spiel */
  private prevRank = new Map<string, number>();
  /** Punkte aus dem zuletzt gewerteten Spiel */
  private lastGain = new Map<string, number>();
  private games = 0;
  private series: { kind: MiniKind; round: number; totals: Map<string, number> } | null = null;

  /** Ein Einzelspiel werten. `points`: Spieler-ID → Punkte, `winners`: wer gewonnen hat. */
  score(kind: MiniKind, points: Record<string, number>, winners: Set<string>, present: Present[]) {
    const byId = new Map(present.map((p) => [p.id, p]));
    // Plätze vorher merken (für ▲▼). Beim ersten Spiel des Abends gibt es noch keine Bewegung.
    this.prevRank.clear();
    if (this.games > 0) for (const r of this.rows(present)) this.prevRank.set(r.id, r.rank);
    this.lastGain.clear();
    for (const [id, pts] of Object.entries(points)) {
      const p = byId.get(id);
      const e = this.entries.get(id) ?? { id, name: p?.name ?? '?', look: p?.look ?? { skin: 0, hair: 0, hairStyle: 0, shirt: 0, beard: 0 }, points: 0, games: 0, wins: 0, bot: !!p?.isBot };
      if (p) ((e.name = p.name), (e.look = p.look));
      e.points += pts;
      e.games += 1;
      if (winners.has(id)) e.wins += 1;
      this.entries.set(id, e);
      this.lastGain.set(id, pts);
    }
    this.games += 1;
    // Serie: gleiches Spiel direkt hintereinander → Zwischenstand weiterzählen (z. B. Grand Prix)
    if (this.series?.kind !== kind) this.series = { kind, round: 0, totals: new Map() };
    this.series.round += 1;
    for (const [id, pts] of Object.entries(points)) this.series.totals.set(id, (this.series.totals.get(id) ?? 0) + pts);
  }

  /** Serie beenden (z. B. Party, Trinkspiel oder Date Night dazwischen) */
  endSeries() {
    this.series = null;
  }

  reset() {
    this.entries.clear();
    this.prevRank.clear();
    this.lastGain.clear();
    this.games = 0;
    this.series = null;
  }

  /** Nummer des nächsten Spiels einer Serie mit diesem Spiel */
  nextRound(kind: MiniKind) {
    return this.series?.kind === kind ? this.series.round + 1 : 1;
  }

  /** Tabelle: alle, die gerade da sind (mit ihren Punkten bzw. 0) – Plätze nur unter ihnen */
  rows(present: Present[]): SessionRow[] {
    const list: Omit<SessionRow, 'rank'>[] = [];
    for (const p of present) {
      if (p.removed) continue;
      const e = this.entries.get(p.id);
      list.push({
        id: p.id,
        name: p.name,
        look: p.look,
        points: e?.points ?? 0,
        games: e?.games ?? 0,
        wins: e?.wins ?? 0,
        prevRank: this.prevRank.get(p.id) ?? null,
        last: this.lastGain.get(p.id) ?? null,
        status: p.connected ? 'online' : 'offline',
        ...(e?.bot || p.isBot ? { bot: true } : {}),
      });
    }
    list.sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
    let rank = 0;
    return list.map((r, i) => {
      const prev = list[i - 1];
      if (!prev || prev.points !== r.points || prev.wins !== r.wins) rank = i + 1;
      return { ...r, rank };
    });
  }

  state(present: Present[]): SessionState {
    const s = this.series;
    const series: SessionSeries | null = s ? { kind: s.kind, round: s.round, label: seriesLabel(s.kind, s.round), totals: Object.fromEntries(s.totals) } : null;
    return { rows: this.rows(present), games: this.games, series };
  }
}
