import type { MiniSnapshot, PrivateState, VerstPrivate, VerstState, VsAvatar, VsCheck, VsObject, VsWhistle } from '../shared/types';
import {
  PROPS,
  PROP_SPOTS,
  type PropType,
  SEEKER_CORNER,
  VS,
  ZONES,
  aProp,
  baseRect,
  canStand,
  judgeSpot,
  overlap,
  pickTarget,
  zoneAt,
} from '../shared/verstecken';
import { type MiniCtx, type MiniGame, Timers, asRecord, groupByScore, shuffle } from './minigame';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface P {
  id: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  dir: 1 | -1;
  moving: boolean;
  // Verstecker
  o: number;
  disguise: { t: PropType; v: number } | null;
  flip: boolean;
  locked: boolean;
  found: boolean;
  foundBy: string | null;
  lastWhistle: number;
  nextTwitch: number;
  twitchUntil: number;
  seekStart: number;
  // Sucher
  stunUntil: number;
  nextCheck: number;
  misses: number;
  // Gesamt
  score: number;
  finds: number;
  survived: number;
  whistles: number;
  seekTurns: number;
  note: { text: string; seq: number } | null;
}

interface RealProp extends VsObject {}

/**
 * Versteckspiel mit Möbeln (à la Prop Hunt).
 *
 * Verstecken: Die Sucher machen die Augen zu, die Verstecker laufen per Joystick herum und
 * verwandeln sich in Möbel, die in der Nähe stehen. EINRASTEN = absolut stillhalten.
 * Suchen: Sucher prüfen Möbel. Richtig → gefunden (zuschauen), falsch → kurz schwindelig.
 * Pfeifen gibt Punkte, verrät aber ungefähr, in welcher Ecke man steht.
 *
 * Gefundene werden Zuschauer statt Mitsucher: Auf dem gemeinsamen TV haben alle Verstecker gesehen,
 * wo die anderen sich verwandelt haben – als Sucher würden sie die anderen sofort verraten.
 */
export class VersteckGame implements MiniGame {
  readonly kind = 'verstecken' as const;
  private ps = new Map<string, P>();
  private props: RealProp[] = [];
  private sub: VerstState['sub'] = 'intro';
  private round = 0;
  private rounds: number;
  private seekMs: number;
  private seekers: string[] = [];
  private hiders: string[] = [];
  private found: string[] = [];
  private checks: VsCheck[] = [];
  private whistles: VsWhistle[] = [];
  private seq = 0;
  private noteSeq = 0;
  private deadline = 0;
  private forcedDone = new Set<number>();
  private winner: VerstState['winner'] = null;
  private timers = new Timers();
  private last = Date.now();

  constructor(
    private ids: string[],
    private ctx: MiniCtx,
  ) {
    for (const id of ids) {
      this.ps.set(id, {
        id, x: 0, y: 0, sx: 0, sy: 0, dir: 1, moving: false,
        o: 0, disguise: null, flip: false, locked: false, found: false, foundBy: null,
        lastWhistle: 0, nextTwitch: 0, twitchUntil: 0, seekStart: 0,
        stunUntil: 0, nextCheck: 0, misses: 0,
        score: 0, finds: 0, survived: 0, whistles: 0, seekTurns: 0, note: null,
      });
    }
    const perRound = this.seekerCount();
    // Jeder sucht einmal, wenn es in 2–3 Runden passt – sonst so fair wie möglich reihum
    this.rounds = clamp(Math.ceil(ids.length / perRound), 2, 3);
    this.seekMs = this.rounds === 3 ? VS.SEEK_MS_3 : VS.SEEK_MS_2;
    this.startRound();
    this.timers.every(VS.TICK_MS, () => this.tick());
  }

  private seekerCount() {
    return Math.max(1, Math.round(this.ids.length / 4));
  }

  // ---------------------------------------------------------------- Ablauf

  private startRound() {
    this.round += 1;
    this.found = [];
    this.checks = [];
    this.whistles = [];
    this.forcedDone.clear();
    this.winner = null;
    // Sucher: wer am seltensten gesucht hat (verbundene bevorzugt)
    const order = shuffle(this.ids).sort((a, b) => {
      const pa = this.ps.get(a)!;
      const pb = this.ps.get(b)!;
      const ca = this.ctx.isConnected(a) ? 0 : 1;
      const cb = this.ctx.isConnected(b) ? 0 : 1;
      return pa.seekTurns - pb.seekTurns || ca - cb;
    });
    const n = this.seekerCount();
    this.seekers = order.slice(0, n);
    this.hiders = order.slice(n);
    for (const id of this.seekers) this.ps.get(id)!.seekTurns += 1;

    // Möbel aufstellen: zufällige Auswahl der Stellplätze
    const spots = shuffle(PROP_SPOTS).slice(0, Math.round(PROP_SPOTS.length * 0.85));
    const oids = shuffle(Array.from({ length: spots.length + this.hiders.length }, (_, i) => i + 1));
    this.props = spots.map(([t, x, y, v, f], i) => ({ o: oids[i], t, x, y, v, f: Math.random() < 0.25 ? !f : f }));
    // Spieler aufstellen
    this.seekers.forEach((id, i) => {
      const p = this.ps.get(id)!;
      this.resetPlayer(p);
      // hinter dem Vorhang (max. 3 Sucher bei 12 Spielern)
      p.x = SEEKER_CORNER.x + 12 + (i % 3) * 15;
      p.y = SEEKER_CORNER.y + SEEKER_CORNER.h - 6 - Math.floor(i / 3) * 4;
      p.dir = -1;
    });
    this.hiders.forEach((id, i) => {
      const p = this.ps.get(id)!;
      this.resetPlayer(p);
      p.o = oids[spots.length + i];
      p.x = 196 + (i % 5) * 22;
      p.y = 228 - Math.floor(i / 5) * 18 + (i % 2) * 6;
      p.dir = i % 2 ? -1 : 1;
    });
    this.setPhase('intro', VS.INTRO_MS);
    this.timers.later(VS.INTRO_MS, () => this.setPhase('hide', VS.HIDE_MS));
    this.timers.later(VS.INTRO_MS + VS.HIDE_MS, () => this.startSeek());
  }

  private resetPlayer(p: P) {
    Object.assign(p, {
      sx: 0, sy: 0, moving: false, disguise: null, locked: false, found: false, foundBy: null,
      lastWhistle: 0, nextTwitch: 0, twitchUntil: 0, stunUntil: 0, nextCheck: 0, misses: 0, note: null,
    });
  }

  private setPhase(sub: VerstState['sub'], ms: number) {
    this.sub = sub;
    this.deadline = Date.now() + ms;
    this.ctx.onChange();
  }

  private startSeek() {
    const now = Date.now();
    for (const id of this.hiders) {
      const p = this.ps.get(id)!;
      p.seekStart = now;
      p.nextTwitch = now + 2000 + Math.random() * 3000;
      // Wer sich nicht verwandelt hat, wird zum nächstbesten Möbel (aber nicht eingerastet)
      if (!p.disguise) {
        const near = this.nearbyLooks(p)[0] ?? { t: 'crate' as PropType, v: 0, f: false };
        p.disguise = { t: near.t, v: near.v };
        p.flip = near.f;
        this.note(p, `Zu langsam! Du bist jetzt ${aProp(near.t)}.`);
      }
    }
    this.setPhase('seek', this.seekMs);
  }

  private endRound(winner: 'seekers' | 'hiders') {
    if (this.sub !== 'seek') return;
    this.winner = winner;
    const now = Date.now();
    for (const id of this.hiders) {
      const p = this.ps.get(id)!;
      if (p.found) continue;
      const ms = now - p.seekStart;
      p.score += Math.floor(ms / 10000) * VS.POINTS.PER_10S + VS.POINTS.SURVIVE;
      p.survived += 1;
    }
    for (const p of this.ps.values()) p.sx = p.sy = 0;
    this.setPhase('reveal', VS.REVEAL_MS);
    this.timers.later(VS.REVEAL_MS, () => {
      if (this.round < this.rounds) this.startRound();
      else this.finishGame();
    });
  }

  private finishGame() {
    this.setPhase('over', VS.OVER_MS);
    const score = (id: string) => this.ps.get(id)!.score;
    const best = [...this.ids].sort((a, b) => score(b) - score(a))[0];
    const hider = [...this.ids].sort((a, b) => this.ps.get(b)!.survived - this.ps.get(a)!.survived)[0];
    const sneaky = this.ps.get(hider)!.survived > 0 ? ` Meister der Tarnung: ${this.ctx.nameOf(hider)}.` : '';
    this.timers.later(VS.OVER_MS, () =>
      this.ctx.finish({
        groups: groupByScore(this.ids, score),
        details: Object.fromEntries(
          this.ids.map((id) => {
            const p = this.ps.get(id)!;
            return [id, `${p.score} Pkt · ${p.finds} gefunden · ${p.survived}× unentdeckt`];
          }),
        ),
        subtitle: `${this.ctx.nameOf(best)} hat die meisten Punkte!${sneaky}`,
      }),
    );
  }

  // ---------------------------------------------------------------- Spielschleife

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const p of this.ps.values()) {
      const seeker = this.seekers.includes(p.id);
      const canMove =
        (this.sub === 'hide' && !seeker && !p.found) ||
        (this.sub === 'seek' && !p.found && (!seeker || now >= p.stunUntil) && !(p.disguise && p.locked));
      const len = Math.hypot(p.sx, p.sy);
      p.moving = canMove && len > 0.15;
      if (!p.moving) continue;
      const speed = seeker ? VS.SEEKER_SPEED : p.disguise ? VS.PROP_SPEED : VS.HIDER_SPEED;
      const k = (speed * dt * Math.min(1, len)) / Math.max(1, len);
      const nx = p.x + p.sx * k;
      const ny = p.y + p.sy * k;
      if (canStand(nx, p.y)) p.x = nx;
      if (canStand(p.x, ny)) p.y = ny;
      if (Math.abs(p.sx) > 0.2) {
        p.dir = p.sx > 0 ? 1 : -1;
        // Unverriegelte Möbel "drehen" sich mit
        if (p.disguise) p.flip = p.sx < 0;
      }
    }
    if (this.sub === 'seek') {
      // Unverriegelte Möbel zucken ab und zu
      for (const id of this.hiders) {
        const p = this.ps.get(id)!;
        if (!p.found && p.disguise && !p.locked && !p.moving && now >= p.nextTwitch) {
          p.twitchUntil = now + 220;
          p.nextTwitch = now + 2500 + Math.random() * 2500;
        }
      }
      // Zwangspfiffe in der letzten Minute
      const left = this.deadline - now;
      for (const at of VS.FORCED_AT_MS) {
        if (left <= at && !this.forcedDone.has(at) && this.seekMs > at + 5000) {
          this.forcedDone.add(at);
          for (const id of this.hiders) {
            const p = this.ps.get(id)!;
            if (!p.found && now - p.lastWhistle > 20000) this.whistle(p, true);
          }
        }
      }
      if (this.hiders.every((id) => this.ps.get(id)!.found)) this.endRound('seekers');
      else if (now >= this.deadline) this.endRound('hiders');
    }
    this.ctx.onChange();
  }

  // ---------------------------------------------------------------- Eingaben

  input(id: string, action: string, payload: unknown) {
    const p = this.ps.get(id);
    if (!p) return;
    const seeker = this.seekers.includes(id);
    if (action === 'stick') {
      const pl = asRecord(payload);
      p.sx = clamp(Number(pl.x) || 0, -1, 1);
      p.sy = clamp(Number(pl.y) || 0, -1, 1);
      return;
    }
    if (seeker) {
      if (action === 'check') this.check(p);
      return;
    }
    if (p.found || (this.sub !== 'hide' && this.sub !== 'seek')) return;
    if (action === 'morph') this.morph(p);
    else if (action === 'lock') this.lock(p);
    else if (action === 'whistle') {
      if (this.sub !== 'seek' || !p.disguise) return;
      if (Date.now() - p.lastWhistle < VS.WHISTLE_CD_MS) return;
      this.whistle(p, false);
    }
    this.ctx.onChange();
  }

  /** Möbel-Looks in Reichweite, nach Abstand sortiert, ohne Duplikate */
  private nearbyLooks(p: P) {
    const list = this.visibleObjects()
      .filter((o) => o.o !== p.o)
      .map((o) => ({ ...o, d: Math.hypot(o.x - p.x, o.y - p.y) }))
      .filter((o) => o.d < VS.MORPH_R)
      .sort((a, b) => a.d - b.d);
    const seen = new Set<string>();
    return list.filter((o) => {
      const k = `${o.t}-${o.v}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private morph(p: P) {
    const looks = this.nearbyLooks(p);
    if (!looks.length) {
      this.note(p, 'Kein Möbelstück in der Nähe!');
      return;
    }
    const cur = p.disguise ? looks.findIndex((l) => l.t === p.disguise!.t && l.v === p.disguise!.v) : -1;
    const next = looks[(cur + 1) % looks.length];
    p.disguise = { t: next.t, v: next.v };
    p.flip = next.f;
    p.locked = false;
  }

  private lock(p: P) {
    if (!p.disguise) {
      this.note(p, 'Erst VERWANDELN!');
      return;
    }
    p.locked = !p.locked;
    if (p.locked) {
      p.sx = p.sy = 0;
      p.moving = false;
      // Auf ganze Pixel einrasten (wie die echten Möbel)
      const sx = Math.round(p.x / 2) * 2;
      const sy = Math.round(p.y / 2) * 2;
      if (canStand(sx, sy)) {
        p.x = sx;
        p.y = sy;
      } else {
        p.x = Math.round(p.x);
        p.y = Math.round(p.y);
      }
    }
  }

  private whistle(p: P, forced: boolean) {
    const now = Date.now();
    p.lastWhistle = now;
    if (!forced) {
      p.score += VS.POINTS.WHISTLE;
      p.whistles += 1;
    } else {
      this.note(p, 'Die Zeit drängt – du pfeifst automatisch!');
    }
    const zone = zoneAt(p.x, p.y);
    const z = ZONES[zone];
    const jx = clamp(p.x + (Math.random() - 0.5) * 60, z.x + 12, z.x + z.w - 12);
    const jy = clamp(p.y - 10 + (Math.random() - 0.5) * 44, z.y + 20, z.y + z.h - 6);
    this.whistles = [...this.whistles, { seq: ++this.seq, x: Math.round(jx), y: Math.round(jy), zone, forced }].slice(-8);
  }

  private check(p: P) {
    const now = Date.now();
    if (this.sub !== 'seek' || now < p.stunUntil || now < p.nextCheck) return;
    const objs = this.visibleObjects();
    const target = pickTarget(objs, p.x, p.y, p.dir);
    if (!target) {
      this.note(p, 'Hier ist nichts zum Prüfen.');
      return;
    }
    p.nextCheck = now + VS.CHECK_CD_MS;
    const hider = this.hiders.map((id) => this.ps.get(id)!).find((h) => !h.found && h.disguise && h.o === target.o);
    if (hider) {
      hider.found = true;
      hider.foundBy = p.id;
      hider.sx = hider.sy = 0;
      hider.score += Math.floor((now - hider.seekStart) / 10000) * VS.POINTS.PER_10S;
      this.found.push(hider.id);
      p.score += VS.POINTS.FIND;
      p.finds += 1;
      p.misses = 0;
      this.note(p, `Gefunden: ${this.ctx.nameOf(hider.id)}!`);
      this.note(hider, `${this.ctx.nameOf(p.id)} hat dich gefunden!`);
      this.checks = [...this.checks, { seq: ++this.seq, by: p.id, x: target.x, y: target.y, ok: true, found: hider.id }].slice(-8);
    } else {
      const stun = Math.min(VS.STUN_MAX_MS, VS.STUN_MS + p.misses * VS.STUN_STEP_MS);
      p.misses += 1;
      p.stunUntil = now + stun;
      p.nextCheck = now + stun;
      p.sx = p.sy = 0;
      this.note(p, `Nur ${aProp(target.t)}. Schwindelig ...`);
      this.checks = [...this.checks, { seq: ++this.seq, by: p.id, x: target.x, y: target.y, ok: false, found: null }].slice(-8);
    }
    this.ctx.onChange();
  }

  private note(p: P, text: string) {
    p.note = { text, seq: ++this.noteSeq };
  }

  // ---------------------------------------------------------------- Zustand

  /** Echte Möbel + verkleidete Verstecker – in einer Liste, nicht unterscheidbar. */
  private visibleObjects(): VsObject[] {
    const now = Date.now();
    const list: VsObject[] = this.props.map(({ o, t, v, x, y, f }) => ({ o, t, v, x, y, f }));
    if (this.sub !== 'intro') {
      for (const id of this.hiders) {
        const p = this.ps.get(id)!;
        if (p.found || !p.disguise) continue;
        const twitch = now < p.twitchUntil ? -1 : 0;
        list.push({ o: p.o, t: p.disguise.t, v: p.disguise.v, x: Math.round(p.x), y: Math.round(p.y) + twitch, f: p.flip });
      }
    }
    return list.sort((a, b) => a.o - b.o);
  }

  snapshot(): MiniSnapshot {
    const avatars: Record<string, VsAvatar> = {};
    const now = Date.now();
    for (const id of this.seekers) {
      const p = this.ps.get(id)!;
      avatars[id] = { x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, moving: p.moving, stunned: now < p.stunUntil };
    }
    if (this.sub === 'intro' || this.sub === 'hide') {
      for (const id of this.hiders) {
        const p = this.ps.get(id)!;
        if (!p.disguise) avatars[id] = { x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, moving: p.moving, stunned: false };
      }
    }
    const reveal =
      this.sub === 'reveal' || this.sub === 'over'
        ? this.hiders
            .map((id) => this.ps.get(id)!)
            .filter((p) => !p.found && p.disguise)
            .map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), t: p.disguise!.t }))
        : null;
    const state: VerstState = {
      sub: this.sub,
      endsIn: Math.max(0, this.deadline - now),
      round: this.round,
      rounds: this.rounds,
      seekers: this.seekers,
      hiders: this.hiders,
      found: this.found,
      objects: this.visibleObjects(),
      avatars,
      checks: this.checks,
      whistles: this.whistles,
      scores: Object.fromEntries(this.ids.map((id) => [id, this.ps.get(id)!.score])),
      reveal,
      winner: this.winner,
    };
    return { kind: 'verstecken', state };
  }

  privateFor(id: string): PrivateState {
    const p = this.ps.get(id);
    if (!p) return null;
    const now = Date.now();
    const seeker = this.seekers.includes(id);
    let hint = { text: '', level: 'ok' as 'ok' | 'warn' | 'bad' };
    if (seeker) {
      hint =
        this.sub === 'hide'
          ? { text: 'Augen zu! Nicht auf den Fernseher schauen.', level: 'warn' }
          : now < p.stunUntil
            ? { text: 'Schwindelig ... gleich geht’s weiter.', level: 'bad' }
            : { text: 'Lauf zu verdächtigen Möbeln und PRÜFE sie!', level: 'ok' };
    } else if (p.found) {
      hint = { text: 'Gefunden – zuschauen!', level: 'bad' };
    } else if (!p.disguise) {
      hint = { text: 'Lauf zu einem Möbelstück und drück VERWANDELN!', level: 'warn' };
    } else {
      const me = { t: p.disguise.t, x: Math.round(p.x), y: Math.round(p.y) };
      const others = this.visibleObjects().filter((o) => o.o !== p.o);
      hint = judgeSpot(me, others, p.moving, p.locked);
    }
    const priv: VerstPrivate = {
      role: seeker ? 'seeker' : 'hider',
      found: p.found,
      foundBy: p.foundBy,
      disguise: p.disguise,
      locked: p.locked,
      x: Math.round(p.x),
      y: Math.round(p.y),
      zone: zoneAt(p.x, p.y),
      hint: hint.text,
      hintLevel: hint.level,
      canMorph: !seeker && !p.found && this.nearbyLooks(p).length > 0,
      whistleIn: Math.max(0, VS.WHISTLE_CD_MS - (now - p.lastWhistle)),
      stunIn: Math.max(0, p.stunUntil - now),
      score: p.score,
      finds: p.finds,
      note: p.note,
    };
    return { kind: 'verstecken', state: priv };
  }

  playerDisconnected(id: string) {
    const p = this.ps.get(id);
    if (p) p.sx = p.sy = 0;
  }

  dispose() {
    this.timers.clear();
  }
}

/** Für Tests: prüft, ob die Stellplätze sinnvoll sind (wird nicht im Spiel benutzt). */
export function validateSpots() {
  const problems: string[] = [];
  PROP_SPOTS.forEach(([t, x, y], i) => {
    if (!canStand(x, y)) problems.push(`#${i} ${t} steht in Wand/Pool`);
    if (!PROPS[t].zones.includes(zoneAt(x, y))) problems.push(`#${i} ${t} im falschen Raum (${ZONES[zoneAt(x, y)].name})`);
    PROP_SPOTS.forEach(([t2, x2, y2], j) => {
      if (j <= i) return;
      if (overlap(baseRect({ t, x, y }), baseRect({ t: t2, x: x2, y: y2 })) > 6) problems.push(`#${i} ${t} überlappt #${j} ${t2}`);
      if (t === t2 && PROPS[t].single && Math.hypot(x - x2, y - y2) < VS.PAIR_R) problems.push(`#${i}/#${j} zwei ${t} nebeneinander`);
    });
  });
  return problems;
}
