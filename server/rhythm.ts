import type { MiniSnapshot, SkipInfo } from '../shared/types';
import {
  RH, RHYTHM_TOPICS, type RhMark, type RhNote, type RhythmPlayer, type RhythmState, MARK_CHARS, imTakt, kalAuswerten, kalPhase, raumVersatz, rhBeatMs, rhSong,
  rhSongMs, rhythmusNoten, rhythmusPhrasen, tippWerten, trefferQuote, verpassteNoten, wettkampfWert,
} from '../shared/rhythmus';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, phaseTimer, shuffle } from './minigame';
import { ladeVersatz, speichereVersatz } from './rhythmusVersatz';

/** Warten auf „Bereit“: `null` = kein Limit – der VIP/Laptop kann starten */
export const RHYTHM_READY_MS: number | null = null;

const leer = (n: number): RhythmPlayer => ({
  ready: false,
  kal: { n: 0, wert: null, streu: 0, stabil: false },
  perfect: 0,
  good: 0,
  miss: 0,
  fehl: 0,
  combo: 0,
  best: 0,
  marks: '.'.repeat(n),
  last: null,
});

/**
 * Das erste Gespräch: Rhythmusspiel à la Klavier-Kacheln zum Song vom TV.
 *
 * Ablauf: Soundcheck (`ready`: TV klickt, Handys tippen im Takt → Ton-Versatz des TVs, raumweit gespeichert) →
 * Song (`play`) → `over`. In der Story (Date Night) gemeinsam: abwechselnd redet einer (Melodie), der andere nickt
 * (Bassdrum), Herzen nach dem gemeinsamen Takt. Sonst Wettkampf: alle dieselbe Spur, Gewinner nach Trefferquote.
 *
 * Timing: Die Spuren rechnet jedes Gerät selbst aus dem Song aus (`shared/rhythmus.ts`). Das Handy schickt jeden
 * Tipp mit seiner Songzeit (synchronisierte Uhr − Ton-Versatz − eigener Fein-Abgleich); gewertet wird hier mit
 * derselben reinen Funktion wie am Handy – die Laufzeit Handy → Server spielt keine Rolle, nur für „verpasst“
 * wartet der Server `NET_GRACE_MS` auf späte Tipps.
 */
export class RhythmGame implements MiniGame {
  readonly kind = 'rhythm' as const;
  private state: RhythmState;
  private song = rhSong();
  private timers = new Timers();
  private charts = new Map<string, RhNote[]>();
  private marks = new Map<string, Uint8Array>();
  /** Soundcheck: Lage der letzten Tipps im Klick-Raster */
  private phasen = new Map<string, number[]>();
  /** In diesem Spiel neu gemessen (→ beim Start speichern) */
  private neuGemessen = false;
  private seq = 0;

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    const wettkampf = ctx.mode !== 'date';
    const order = [...ids];
    const stored = ladeVersatz();
    const topics = shuffle(RHYTHM_TOPICS);
    for (const id of ids) {
      const chart = rhythmusNoten(order, id, wettkampf, this.song);
      this.charts.set(id, chart);
      this.marks.set(id, new Uint8Array(chart.length));
      this.phasen.set(id, []);
    }
    this.state = {
      sub: 'ready',
      wettkampf,
      bpm: this.song.bpm,
      kalAt: Date.now() + 600,
      kalBeat: RH.KAL_BEAT_MS,
      versatz: stored?.versatz ?? 0,
      versatzQuelle: stored ? 'gespeichert' : 'keiner',
      pflicht: false,
      startAt: 0,
      duration: Math.round(rhSongMs(this.song)),
      playSeq: 0,
      order,
      players: Object.fromEntries(ids.map((id) => [id, leer(this.charts.get(id)!.length)])),
      phrases: wettkampf || ids.length < 2 ? [] : rhythmusPhrasen(order, this.song).map((p, i) => ({ ...p, topic: topics[i % topics.length] })),
      sympathy: 50,
    };
    phaseTimer(this.timers, RHYTHM_READY_MS, () => this.play());
  }

  snapshot(): MiniSnapshot {
    return { kind: 'rhythm', state: this.state };
  }

  skippable(): SkipInfo | null {
    const s = this.state;
    if (s.sub !== 'ready') return null;
    const missing = this.ids.filter((p) => this.ctx.isConnected(p) && !s.players[p].ready);
    return { label: missing.length === 1 ? 'Ohne Bereit-Knopf starten' : 'Los geht’s' };
  }

  skip() {
    if (this.state.sub === 'ready') this.play();
  }

  /** VIP: „kalibrieren“ = neu einmessen, „next“ (Laptop: Enter) = wie Überspringen */
  vipAction(action: string) {
    if (action === 'kalibrieren') this.neuEinmessen();
    else if (action === 'next') this.skip();
  }

  /** TV/Laptop: „kalibrieren“ (Taste K bzw. Knopf am TV) */
  hostInput(action: string, _payload?: unknown) {
    if (action === 'kalibrieren') this.neuEinmessen();
  }

  input(id: string, action: string, payload: unknown) {
    const s = this.state;
    const p = s.players[id];
    if (!p) return;
    const d = asRecord(payload);
    if (s.sub === 'ready') {
      if (action === 'kal') this.kalTipp(id, Number(d.at));
      else if (action === 'ready' && !p.ready) {
        p.ready = true;
        if (this.allReady()) this.play();
        else this.ctx.onChange();
      }
    } else if (s.sub === 'play' && action === 'tipp') this.tipp(id, Number(d.l), Number(d.t));
  }

  // ---------------------------------------------------------------- Soundcheck

  private kalTipp(id: string, at: number) {
    const s = this.state;
    // Bots messen nichts (sie hören den TV nicht); Zeitstempel müssen ungefähr „jetzt“ sein
    if (this.ctx.isBot?.(id) || !Number.isFinite(at) || Math.abs(at - Date.now()) > 3000) return;
    const ph = this.phasen.get(id)!;
    ph.push(kalPhase(at, s.kalAt, s.kalBeat));
    if (ph.length > RH.KAL_N) ph.shift();
    const r = kalAuswerten(ph, s.kalBeat);
    s.players[id].kal = { n: ph.length, wert: r?.wert ?? null, streu: r?.streu ?? 0, stabil: !!r?.stabil };
    const werte = this.ids.map((o) => s.players[o].kal).filter((k) => k.stabil && k.wert !== null).map((k) => k.wert!);
    const v = raumVersatz(werte);
    if (v !== null) {
      s.versatz = v;
      s.versatzQuelle = 'gemessen';
      this.neuGemessen = true;
    }
    this.ctx.onChange();
  }

  /** Neu einmessen (VIP/Laptop) – mitten im Song: Song abbrechen, zurück zum Soundcheck */
  private neuEinmessen() {
    const s = this.state;
    if (s.sub === 'over') return;
    this.timers.clear();
    if (s.sub === 'play') {
      s.sub = 'ready';
      s.startAt = 0;
      for (const id of this.ids) this.marks.get(id)!.fill(0);
      s.sympathy = 50;
    }
    for (const id of this.ids) {
      this.phasen.set(id, []);
      s.players[id] = leer(this.charts.get(id)!.length);
    }
    s.pflicht = true;
    s.kalAt = Date.now() + 300;
    phaseTimer(this.timers, RHYTHM_READY_MS, () => this.play());
    this.ctx.onChange();
  }

  private allReady() {
    const s = this.state;
    const on = this.ids.filter((id) => this.ctx.isConnected(id));
    return on.length > 0 && on.every((id) => s.players[id].ready);
  }

  // ---------------------------------------------------------------- Song

  private play() {
    const s = this.state;
    if (s.sub !== 'ready') return;
    this.timers.clear();
    if (this.neuGemessen) {
      speichereVersatz(s.versatz, this.ids.filter((id) => s.players[id].kal.stabil).length);
      this.neuGemessen = false;
    }
    s.sub = 'play';
    s.playSeq += 1;
    s.pflicht = false;
    s.startAt = Date.now() + RH.START_BUFFER_MS + RH.COUNT_IN * rhBeatMs(this.song);
    this.ctx.onChange();
    this.timers.every(100, () => this.tick());
    this.timers.later(s.startAt - Date.now() + s.duration + RH.END_MS + RH.NET_GRACE_MS, () => this.end());
  }

  /** Songzeit, wie die Handys sie sehen (Serverzeit − Start − Ton-Versatz) */
  private songNow() {
    return Date.now() - this.state.startAt - this.state.versatz;
  }

  private tipp(id: string, lane: number, t: number) {
    if (!Number.isInteger(lane) || lane < 0 || lane >= RH.LANES || !Number.isFinite(t)) return;
    const now = this.songNow();
    // Zeitstempel aus der Zukunft (über Uhr-Ungenauigkeit + Fein-Abgleich hinaus) oder uralt → verwerfen
    if (t > now + RH.FEIN_MAX + 300 || t < now - 5000) return;
    const p = this.state.players[id];
    const r = tippWerten(this.charts.get(id)!, this.marks.get(id)!, lane, t);
    if (!r) {
      p.fehl += 1;
      p.combo = 0;
    } else this.bewerte(id, r.i, r.mark);
    this.ctx.onChange();
  }

  private bewerte(id: string, i: number, mark: Exclude<RhMark, 0>) {
    const s = this.state;
    const p = s.players[id];
    this.marks.get(id)![i] = mark;
    p.marks = p.marks.slice(0, i) + MARK_CHARS[mark] + p.marks.slice(i + 1);
    if (mark === 3) p.perfect++;
    else if (mark === 2) p.good++;
    else p.miss++;
    p.combo = mark > 1 ? p.combo + 1 : 0;
    p.best = Math.max(p.best, p.combo);
    p.last = { i, m: mark, seq: ++this.seq };
    if (!s.wettkampf) {
      let pf = 0;
      let gd = 0;
      let n = 0;
      for (const o of this.ids) {
        const q = s.players[o];
        pf += q.perfect;
        gd += q.good;
        n += q.perfect + q.good + q.miss;
      }
      s.sympathy = Math.round(imTakt(pf, gd, n) * 100);
    }
  }

  /** Verpasste Noten (Fenster + Fein-Abgleich + Netz-Puffer vorbei, kein Tipp kam) */
  private tick() {
    const t = this.songNow();
    let changed = false;
    for (const id of this.ids) {
      for (const i of verpassteNoten(this.charts.get(id)!, this.marks.get(id)!, t, RH.FEIN_MAX + RH.NET_GRACE_MS)) {
        this.bewerte(id, i, 1);
        changed = true;
      }
    }
    if (changed) this.ctx.onChange();
  }

  private end() {
    const s = this.state;
    if (s.sub !== 'play') return;
    this.timers.clear();
    // Nie gemeldete Noten (Handy weg, Bildschirm aus) zählen als verpasst
    for (const id of this.ids) this.marks.get(id)!.forEach((m, i) => !m && this.bewerte(id, i, 1));
    s.sub = 'over';
    this.ctx.onChange();
    this.timers.later(2500, () => this.finish());
  }

  private finish() {
    const s = this.state;
    const total = (id: string) => this.charts.get(id)!.length;
    const quote = (id: string) => trefferQuote(s.players[id].perfect, s.players[id].good, total(id));
    if (!s.wettkampf) {
      let pf = 0;
      let gd = 0;
      let n = 0;
      for (const id of this.ids) {
        pf += s.players[id].perfect;
        gd += s.players[id].good;
        n += total(id);
      }
      const ratio = imTakt(pf, gd, n);
      const hearts = Math.max(0, Math.min(10, Math.round(ratio * 10 + 0.5)));
      this.ctx.finish({
        groups: [this.ids],
        details: Object.fromEntries(this.ids.map((id) => [id, `${Math.round(imTakt(s.players[id].perfect, s.players[id].good, total(id)) * 100)} % im Takt`])),
        subtitle: ratio > 0.75 ? 'Ihr redet, als würdet ihr euch ewig kennen.' : ratio > 0.45 ? 'Ein paar Pausen – aber das Lachen war echt.' : 'Ähm ... schönes Wetter heute, oder?',
        hearts: this.ctx.mode === 'date' ? hearts : undefined,
      });
      return;
    }
    const groups = groupByScore(this.ids, (id) => wettkampfWert(s.players[id].perfect, s.players[id].good, total(id)));
    const top = groups[0] ?? [];
    const q = top.length ? quote(top[0]) : 0;
    const flavor = q >= 90 ? 'Taktgefühl pur!' : q >= 70 ? 'Da springt der Funke über.' : q >= 45 ? 'Ein bisschen holprig – aber charmant.' : 'Ähm ... schönes Wetter heute, oder?';
    const names = top.map((id) => this.ctx.nameOf(id)).join(' & ');
    const subtitle = this.ids.length === 1 ? `${q} % Treffer – ${flavor}` : `${names} ${top.length > 1 ? 'treffen' : 'trifft'} ${q} % – ${flavor}`;
    this.ctx.finish({
      groups,
      details: Object.fromEntries(this.ids.map((id) => [id, `${quote(id)} % Treffer`])),
      subtitle,
    });
  }

  playerDisconnected() {
    // Der Letzte, auf den alle warten, ist weg → nicht ewig warten
    const s = this.state;
    if (s.sub === 'ready' && this.ids.some((id) => s.players[id].ready) && this.allReady()) this.play();
  }

  dispose() {
    this.timers.clear();
    // Abgebrochen nach dem Soundcheck: die Messung trotzdem behalten
    if (this.neuGemessen) speichereVersatz(this.state.versatz, this.ids.filter((id) => this.state.players[id].kal.stabil).length);
    this.neuGemessen = false;
  }
}
