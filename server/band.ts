import type { MiniSnapshot, SkipInfo } from '../shared/types';
import type { Song } from '../shared/music';
import {
  BAND, BAND_INFO, BAND_SONGS, type BandInst, type BandNote, type BandState, bandAssign, bandBarMs, bandBeatMs, bandBonus, bandBonusCoins, bandCap, bandChart,
  bandMaxScore, bandSong, bandSongMs, isBandInst,
} from '../shared/band';
import { groupPlaces, placeCoins } from '../shared/games';
import { type MiniCtx, type MiniGame, Timers, asRecord, endsIn, groupByScore, phaseTimer, shuffle } from './minigame';

/** Zuletzt gespielter Song – „Nochmal“ nimmt einen anderen */
let lastSong = '';

/**
 * Strand-Band: Ein eingebauter Song läuft am TV, jedes Handy spielt ein Instrument mit eigener Notenspur.
 *
 * Synchronität: Der Server legt nur den Startzeitpunkt von Takt 1 fest (`startAt`, Server-Uhr). TV und Handys
 * rechnen ihn über den Uhrabgleich (`client/timesync.ts`) in ihre lokale Zeit um; die Noten bewertet jedes Handy
 * selbst gegen seine Uhr (Netzwerk-Laufzeiten spielen so keine Rolle) und meldet nur das Ergebnis pro Note.
 * Der TV plant den Ton auf die Ausgabezeit (`getOutputTimestamp`), die Handys gleichen den Rest (Touch-Latenz,
 * TV-Lautsprecher) mit einer kleinen Selbst-Kalibrierung aus – siehe `client/controller/screens/band.ts`.
 */
export class BandGame implements MiniGame {
  readonly kind = 'band' as const;
  private state: BandState;
  private song: Song;
  private timers = new Timers();
  private deadline = 0;
  private seq = 0;
  /** Spur pro Spieler (steht beim Songstart fest) */
  private charts = new Map<string, BandNote[]>();
  /** Pro Note: 0 offen, 1 Kopf bewertet, 2 auch Halten bewertet */
  private judged = new Map<string, Uint8Array>();
  /** Punkte pro Note (Kopf 0–2) – für die Takt-Auswertung */
  private points = new Map<string, Uint8Array>();
  private nextBar = 0;
  /** Getroffene / bewertete Noten der ganzen Band */
  private band = { got: 0, max: 0 };

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const pool = BAND_SONGS.filter((s) => s !== lastSong && bandSong(s));
    // Zum Testen ein fester Song: BAND_SONG=western npx tsx server/index.ts
    const forced = process.env.BAND_SONG;
    const id = forced && bandSong(forced) ? forced : (pool[Math.floor(Math.random() * pool.length)] ?? BAND_SONGS[0]);
    lastSong = id;
    this.song = bandSong(id)!;
    const order = shuffle(ids);
    const assign = bandAssign(order);
    this.state = {
      sub: 'pick',
      song: id,
      title: this.song.title,
      bpm: this.song.bpm,
      startAt: 0,
      duration: Math.round(bandSongMs(this.song)),
      endsIn: 0,
      playSeq: 0,
      order,
      players: Object.fromEntries(
        order.map((p) => [p, { inst: assign[p], ready: false, score: 0, judged: 0, perfect: 0, good: 0, miss: 0, combo: 0, best: 0, form: 1, last: null }]),
      ),
      cap: bandCap(ids.length),
      groove: 0,
      bestGroove: 0,
      energy: 60,
      lastBar: null,
      bandAcc: 0,
    };
    this.deadline = phaseTimer(this.timers, BAND.PICK_MS, () => this.play());
  }

  snapshot(): MiniSnapshot {
    this.state.endsIn = this.state.sub === 'pick' ? endsIn(this.deadline) : 0;
    return { kind: 'band', state: this.state };
  }

  skippable(): SkipInfo | null {
    return this.state.sub === 'pick' ? { label: 'Song starten' } : null;
  }

  skip() {
    if (this.state.sub === 'pick') this.play();
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    const p = s.players[id];
    if (!p) return;
    const d = asRecord(payload);
    if (s.sub === 'pick') {
      if (action === 'inst' && !p.ready && isBandInst(d.inst) && d.inst !== p.inst) {
        const taken = this.ids.filter((o) => o !== id && s.players[o].inst === d.inst).length;
        if (taken >= s.cap) return;
        p.inst = d.inst;
        this.ctx.onChange();
      } else if (action === 'ready' && !p.ready) {
        p.ready = true;
        if (this.allReady()) this.play();
        else this.ctx.onChange();
      }
      return;
    }
    if (s.sub !== 'play') return;
    const chart = this.charts.get(id)!;
    const judged = this.judged.get(id)!;
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= chart.length) return;
    if (action === 'hit' && judged[i] === 0) {
      const q = Math.max(0, Math.min(2, Math.round(Number(d.q)) || 0)) as 0 | 1 | 2;
      judged[i] = 1;
      this.points.get(id)![i] = q;
      p.score += q;
      p.judged += 2;
      // Verpasster Kopf einer Halte-Note: das Halten ist auch weg
      if (chart[i].len && q === 0) {
        judged[i] = 2;
        p.judged += 1;
      }
      if (q === 2) p.perfect++;
      else if (q === 1) p.good++;
      else p.miss++;
      p.combo = q > 0 ? p.combo + 1 : 0;
      p.best = Math.max(p.best, p.combo);
      // „Gut“ ist auch ein Treffer: Form/Stimmung sinken vor allem bei Patzern
      this.feel(p, q === 2 ? 1 : q === 1 ? 0.75 : 0);
      p.last = { q, seq: ++this.seq };
      if (q > 0) this.band.got++;
      this.band.max++;
      s.bandAcc = Math.round((this.band.got / this.band.max) * 100);
      this.ctx.onChange();
    } else if (action === 'hold' && judged[i] === 1 && chart[i].len) {
      const ok = d.ok === true;
      judged[i] = 2;
      p.judged += 1;
      if (ok) {
        p.score += 1;
        p.last = { q: 3, seq: ++this.seq };
      }
      this.feel(p, ok ? 1 : 0.3);
      this.ctx.onChange();
    }
  }

  /** Form des Spielers und Stimmung am Strand folgen jeder Bewertung (gleitender Mittelwert) */
  private feel(p: BandState['players'][string], v: number) {
    const s = this.state;
    p.form = Math.round((p.form + (v - p.form) * 0.3) * 100) / 100;
    const a = Math.min(0.25, Math.max(0.05, 0.32 / Math.sqrt(this.ids.length)));
    s.energy = Math.round(s.energy + (v * 100 - s.energy) * a);
  }

  private allReady() {
    const s = this.state;
    const on = this.ids.filter((id) => this.ctx.isConnected(id));
    return on.length > 0 && on.every((id) => s.players[id].ready);
  }

  private play() {
    const s = this.state;
    if (s.sub !== 'pick') return;
    this.timers.clear();
    for (const id of this.ids) {
      const chart = bandChart(this.song, s.players[id].inst);
      this.charts.set(id, chart);
      this.judged.set(id, new Uint8Array(chart.length));
      this.points.set(id, new Uint8Array(chart.length));
    }
    s.sub = 'play';
    s.playSeq += 1;
    s.startAt = Date.now() + BAND.START_BUFFER_MS + BAND.COUNT_IN * bandBeatMs(this.song);
    this.ctx.onChange();
    this.timers.every(100, () => this.evalBars());
    this.timers.later(s.startAt - Date.now() + s.duration + BAND.END_MS, () => this.end());
  }

  /** Takte, deren Treffer sicher da sind, für den Groove der Band auswerten (Anteil getroffener Noten aller Verbundenen) */
  private evalBars(final = false) {
    const s = this.state;
    const barMs = bandBarMs(this.song);
    const now = Date.now() - s.startAt;
    let changed = false;
    while (this.nextBar < this.song.bars && (final || now >= (this.nextBar + 1) * barMs + BAND.BAR_GRACE_MS)) {
      const b = this.nextBar++;
      let got = 0;
      let max = 0;
      for (const id of this.ids) {
        if (!this.ctx.isConnected(id)) continue;
        const chart = this.charts.get(id)!;
        const pts = this.points.get(id)!;
        chart.forEach((n, i) => {
          if (n.bar !== b) return;
          if (pts[i] > 0) got++;
          max++;
        });
      }
      if (!max) continue;
      const acc = got / max;
      const ok = acc >= BAND.GROOVE_ACC;
      s.groove = ok ? s.groove + 1 : 0;
      s.bestGroove = Math.max(s.bestGroove, s.groove);
      s.lastBar = { bar: b, ok, acc: Math.round(acc * 100) };
      changed = true;
    }
    if (changed) this.ctx.onChange();
  }

  private end() {
    const s = this.state;
    if (s.sub !== 'play') return;
    this.timers.clear();
    this.evalBars(true);
    // Nie gemeldete Noten (Handy weg, Bildschirm aus) zählen als verpasst
    for (const id of this.ids) {
      const judged = this.judged.get(id)!;
      s.players[id].miss += judged.filter((j) => j === 0).length;
    }
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(2600, () => this.finish());
  }

  private finish() {
    const s = this.state;
    const pct = (id: string) => {
      const max = bandMaxScore(this.charts.get(id)!);
      return max ? Math.round((s.players[id].score / max) * 100) : 0;
    };
    const value = (id: string) => pct(id) + (pct(id) > 0 ? bandBonus(s.players[id].inst) : 0);
    const groups = groupByScore(this.ids, value);
    const bonus = bandBonusCoins(s.bestGroove);
    const ranks = groupPlaces(groups);
    const details = Object.fromEntries(
      this.ids.map((id) => {
        const inst: BandInst = s.players[id].inst;
        const b = pct(id) > 0 ? bandBonus(inst) : 0;
        return [id, `${pct(id)}%${b ? ` +${b}` : ''} ${BAND_INFO[inst].short}`];
      }),
    );
    const coinsOn = !!this.ctx.board;
    const groove = s.bestGroove === 1 ? '1 Takt' : `${s.bestGroove} Takte`;
    const flavor = s.bandAcc >= 85 ? 'Der Strand tobt – Zugabe!' : s.bandAcc >= 70 ? 'Solider Auftritt – die Möwen wippen mit.' : 'Na ja … die Möwen sind weggeflogen.';
    // Band-Bonus (Münzen gibt es nur auf dem Spielbrett – im Arcade-Modus nur die Ansage)
    const subtitle = !bonus ? flavor : coinsOn ? `${groove} im Groove – +${bonus} Münzen für alle!` : `${groove} im Groove · ${s.bandAcc} % getroffen!`;
    this.ctx.finish({
      groups,
      details,
      subtitle,
      coins: groups.map((_, gi) => placeCoins(ranks[gi], this.ids.length) + bonus),
    });
  }

  playerDisconnected() {
    // Der Letzte, auf den alle warten, ist weg → nicht bis zum Ende der Wahl warten
    if (this.state.sub === 'pick' && this.allReady()) this.play();
  }

  dispose() {
    this.timers.clear();
  }
}
