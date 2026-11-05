import Phaser from 'phaser';
import type { EveningTitle, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { MINI_INFO } from '../../shared/games';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath } from '../art/ground';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GREEN_INK, INK, PLACE_COLORS, RED_INK, background, ensureTex, ink, nameTag, panel, prop, txt } from './ui';
import { drawSessionBoard, seriesTitle } from './sessionBoard';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

/** Einzelspiel-Ergebnis: erst dieses Spiel, dann das Leaderboard des Abends – im Wechsel */
const STAGE_GAME_MS = 7000;
const STAGE_BOARD_MS = 11000;
/** „Titel des Abends“: Kacheln nacheinander, dann stehen lassen; Endstand (Podest) bleibt länger */
const STAGE_TITLES_MS = 14000;
const STAGE_FINAL_MS = 16000;
const TITLE_STEP_MS = 1500;
/** Ergebnis-Aufbau: Plätze von hinten nach vorn im Abstand von 200 ms, Sieger nach dem Trommelwirbel */
const REVEAL_START = 300;
const REVEAL_STEP = 200;
const DRUMROLL_S = 1.5;

type C = Phaser.GameObjects.Container;

export class ResultsScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private stateKey = '';
  /** Einzelspiel: 'game' = Platzierung dieses Spiels, 'board' = Leaderboard des Abends (bzw. Turnier-Zwischenstand), 'titles' = Titel des Abends */
  private stage: 'game' | 'board' | 'titles' = 'game';
  private stageTimer: Phaser.Time.TimerEvent | null = null;
  private stageFor: unknown = null;
  private juice!: Juice;
  /** Welches Ergebnis schon aufgebaut wurde (nur ein neues Ergebnis wird animiert und vertont) */
  private revealKey = '';
  private anim = false;
  private revealTimers: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('results');
  }

  create() {
    this.stateKey = '';
    this.stage = 'game';
    this.stageTimer = null;
    this.stageFor = null;
    this.revealKey = '';
    this.anim = false;
    this.revealTimers = [];
    background(this, 'results', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 61);
      paintPath(p, [{ x: 0, y: 250 }, { x: 480, y: 246 }], 18, 62);
    });
    prop(this, 'tree1', () => O.tree(1), 22, 120);
    prop(this, 'tree7', () => O.tree(7), 460, 110);
    prop(this, 'fruitTree', () => O.fruitTree(3), 34, 236);
    prop(this, 'bush4', () => O.bush(4, true), 446, 236);
    this.layer = this.add.container(0, 0).setDepth(500);
    this.juice = new Juice(this, { depth: 600 });

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  /**
   * Wechsel Spiel ↔ Leaderboard (↔ Titel des Abends) – startet für jedes neue Ergebnis wieder beim Spiel.
   * Endstand (Party, Turnier): Podest ↔ Titel des Abends, sobald es welche gibt.
   */
  private scheduleStage(s: GameState) {
    const r = s.results;
    const single = !!r && !r.final && !!r.points && !s.partyActive;
    const final = !!r?.final;
    if (!single && !final) {
      this.stageTimer?.remove();
      this.stageTimer = null;
      this.stage = 'game';
      this.stageFor = null;
      return;
    }
    if (this.stageFor === r) return;
    this.stageFor = r;
    this.stage = 'game';
    this.stageTimer?.remove();
    const order = (): ('game' | 'board' | 'titles')[] => {
      const titles = (getState()?.evening?.titles.length ?? 0) > 0;
      if (final) return titles ? ['game', 'titles'] : ['game'];
      return titles ? ['game', 'board', 'titles'] : ['game', 'board'];
    };
    const ms = (st: 'game' | 'board' | 'titles') => (st === 'titles' ? STAGE_TITLES_MS : st === 'board' ? STAGE_BOARD_MS : final ? STAGE_FINAL_MS : STAGE_GAME_MS);
    const flip = () => {
      const seq = order();
      this.stage = seq[(seq.indexOf(this.stage) + 1) % seq.length];
      const cur = getState();
      if (cur) this.render(cur);
      this.stageTimer = this.time.delayedCall(ms(this.stage), flip);
    };
    this.stageTimer = this.time.delayedCall(ms('game'), flip);
  }

  private render(s: GameState) {
    this.scheduleStage(s);
    const r = s.results;
    const single = !!r && !r.final && !!r.points && !s.partyActive;
    const key = JSON.stringify(single ? [r, s.session, s.nochmal, s.turnier, this.stage] : [r, this.stage]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.layer.removeAll(true);
    for (const t of this.revealTimers) t.remove();
    this.revealTimers = [];
    const rk = r ? JSON.stringify([r.title, r.subtitle, r.rows, r.final]) : '';
    this.anim = !!r && rk !== this.revealKey && this.stage === 'game';
    if (r) this.revealKey = rk;
    if (!r) return;
    if (this.stage === 'titles') return this.renderTitles(s);
    if (single) return this.renderSingle(s);

    this.layer.add(panel(this, 60, 2, 360, 64));
    this.layer.add(ink(this, WORLD.W / 2, 9, r.final ? '~ Endstand ~' : '~ Ergebnis ~', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, r.title.length > 20 ? 25 : 21, r.title, { size: r.title.length > 20 ? 8 : 16, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 40, r.subtitle, { wrap: 340 }));

    if (r.final) this.renderPodium(s);
    else if (r.hearts !== undefined) this.renderHearts(s);
    else this.renderList(s);

    const footer = s.drinkActive ? 'VIP: Nächste Runde oder Beenden am Handy' : s.date ? 'Am Handy auf „Weiter“ tippen' : r.final || !s.partyActive ? 'VIP: Am Handy zurück zur Lobby' : 'VIP: Am Handy weiter zum Spielbrett';
    this.layer.add(ink(this, WORLD.W / 2, 258, footer).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  /**
   * Einzelspiel (Arcade, Laptop-Auswahl, Einzelspiel aus der Lobby): abwechselnd
   * Platzierung + Punkte dieses Spiels und das Leaderboard des Abends (mit ▲▼ und Serie, z. B. Grand Prix).
   */
  private renderSingle(s: GameState) {
    const r = s.results!;
    if (s.turnier) return this.renderTurnier(s);
    const ses = s.session;
    const series = seriesTitle(ses);
    const board = this.stage === 'board';
    this.layer.add(panel(this, 60, 2, 360, 64));
    this.layer.add(ink(this, WORLD.W / 2, 9, board ? '~ Gesamtstand ~' : '~ Ergebnis ~', { color: '#7a5a3a' }));
    const title = series ?? r.title;
    this.layer.add(ink(this, WORLD.W / 2, title.length > 20 ? 25 : 21, title, { size: title.length > 20 ? 8 : 16, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 40, board ? this.boardSubtitle(s) : r.subtitle, { wrap: 340 }));

    if (board) {
      drawSessionBoard(this, this.layer, ses, { x: 60, y: 70, w: 360, maxBottom: 246 }, { animate: true, title: series ? `${ses.series!.label.toUpperCase()} · GESAMT HEUTE` : undefined });
    } else if (r.hearts !== undefined) {
      this.renderHearts(s);
    } else {
      this.renderList(s);
    }

    // Kleine Punkte-Anzeige, wann gewechselt wird
    this.layer.add(ink(this, 412, 56, board ? '○●' : '●○', { origin: [1, 0], color: '#7a5a3a' }));

    const n = s.nochmal;
    const footer = !n
      ? 'VIP: Am Handy zurück zur Lobby'
      : n.disabled
        ? `Nochmal geht nicht: ${n.disabled}`.slice(0, 56)
        : `VIP am Handy: Nochmal (${n.next}) oder anderes Spiel`;
    this.layer.add(ink(this, WORLD.W / 2, 258, footer).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  /** Turnier: Ergebnis dieses Spiels ↔ Zwischenstand der Playlist (Spiel 2/4 …) */
  private renderTurnier(s: GameState) {
    const r = s.results!;
    const t = s.turnier!;
    const board = this.stage === 'board';
    const no = `Spiel ${t.index + 1}/${t.kinds.length}`;
    this.layer.add(panel(this, 60, 2, 360, 64));
    this.layer.add(ink(this, WORLD.W / 2, 9, board ? `~ Turnier · Zwischenstand ~` : `~ Turnier · ${no} ~`, { color: '#7a5a3a' }));
    const title = board ? `${t.icon} ${t.name}` : r.title;
    this.layer.add(ink(this, WORLD.W / 2, title.length > 20 ? 25 : 21, title, { size: title.length > 20 ? 8 : 16, color: RED_INK }));
    const leader = t.table.rows[0];
    const sub = board ? (leader && leader.points > 0 ? `${leader.name} führt das Turnier mit ${leader.points} Punkten` : 'Punkte aus allen Spielen des Turniers') : r.subtitle;
    this.layer.add(ink(this, WORLD.W / 2, 40, sub, { wrap: 340 }));
    if (board) drawSessionBoard(this, this.layer, t.table, { x: 60, y: 70, w: 360, maxBottom: 246 }, { animate: true, title: `${t.name.toUpperCase()} · NACH ${t.played} VON ${t.kinds.length} SPIELEN` });
    else if (r.hearts !== undefined) this.renderHearts(s);
    else this.renderList(s);
    this.layer.add(ink(this, 412, 56, board ? '○●' : '●○', { origin: [1, 0], color: '#7a5a3a' }));
    const next = t.kinds[t.index + 1];
    const footer = next ? `VIP am Handy: Weiter – als Nächstes ${MINI_INFO[next].icon} ${MINI_INFO[next].title}`.slice(0, 58) : 'VIP am Handy: Weiter zur Siegerehrung';
    this.layer.add(ink(this, WORLD.W / 2, 258, footer).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  /** „Titel des Abends“: Kacheln nacheinander mit Trommelwirbel-Pop, Konfetti und Ansage */
  private renderTitles(s: GameState) {
    const titles = s.evening?.titles ?? [];
    this.layer.add(panel(this, 60, 2, 360, 40));
    this.layer.add(ink(this, WORLD.W / 2, 9, '~ Titel des Abends ~', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, 22, `${s.evening?.games ?? 0} Spiele heute – und das bleibt hängen:`, { wrap: 340 }));
    const rowH = titles.length > 4 ? 36 : 40;
    const top = 48;
    const x = 40, w = 400;
    const animate = this.stage === 'titles';
    titles.forEach((t, i) => {
      const y = top + i * rowH;
      const c = this.add.container(0, 0);
      this.layer.add(c);
      c.add(panel(this, x, y, w, rowH - 4));
      c.add(txt(this, x + 22, y + (rowH - 4) / 2 - 9, t.icon, { size: 16 }));
      c.add(ink(this, x + 44, y + 7, t.title.toUpperCase(), { origin: [0, 0], color: RED_INK }));
      const p = t.playerId ? playerById(t.playerId) : null;
      if (p) {
        c.add(this.add.image(x + 56, y + rowH - 6, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
        c.add(ink(this, x + 70, y + 20, p.name, { origin: [0, 0], color: INK }));
      } else if (t.kind) {
        c.add(ink(this, x + 44, y + 20, MINI_INFO[t.kind].title, { origin: [0, 0], color: INK }));
      }
      c.add(ink(this, x + w - 12, y + 20, t.text, { origin: [1, 0], color: '#7a5a3a' }));
      if (!animate) return;
      c.setAlpha(0).setX(-24);
      this.at(500 + i * TITLE_STEP_MS, () => {
        this.tweens.add({ targets: c, alpha: 1, x: 0, duration: 260, ease: 'Back.Out' });
        sfx('select', { pitch: 1 + i * 0.08 });
        sfx('coin', { delay: 0.15, pitch: 1.1 });
        this.juice.burst(x + 22, y + rowH / 2, 'confetti', 18);
        this.juice.burst(x + w - 30, y + rowH / 2, 'spark', 10);
        say(this.spokenTitle(t), { interrupt: i === 0 });
      });
    });
    if (animate && titles.length) sfx('drumroll', { delay: 0 });
    const footer = s.results?.final ? 'VIP: Am Handy zurück zur Lobby' : 'Gleich geht es weiter …';
    this.layer.add(ink(this, WORLD.W / 2, 258, footer).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  private spokenTitle(t: EveningTitle) {
    if (t.kind) return `${t.title}: ${MINI_INFO[t.kind].title}!`;
    return `${t.title}: ${spokenName(playerById(t.playerId ?? '')?.name)}!`;
  }

  private boardSubtitle(s: GameState) {
    const ser = s.session.series;
    const leader = s.session.rows[0];
    if (ser && ser.round > 1) {
      // Reihenfolge der Tabelle als Gleichstands-Regel
      const best = [...s.session.rows].sort((a, b) => (ser.totals[b.id] ?? 0) - (ser.totals[a.id] ?? 0))[0];
      return `${MINI_INFO[ser.kind].title}: ${ser.round} Spiele in Folge – ${best?.name ?? '?'} führt die Serie (${best ? (ser.totals[best.id] ?? 0) : 0} Pkt)`;
    }
    return leader && leader.points > 0 ? `${leader.name} führt mit ${leader.points} Punkten` : 'Punkte aus allen Einzelspielen des Abends';
  }

  private renderHearts(s: GameState) {
    const r = s.results!;
    const max = r.maxHearts ?? 10;
    const heart = ensureTex(this, 'heart', O.heart);
    this.layer.add(panel(this, 80, 74, 320, 44));
    for (let i = 0; i < max; i++) {
      const img = this.add.image(WORLD.W / 2 + (i - (max - 1) / 2) * 26, 96, heart).setScale(2);
      if (i >= (r.hearts ?? 0)) img.setTint(0x6e6a62).setAlpha(0.45);
      else {
        img.setScale(0);
        this.tweens.add({ targets: img, scale: 2, duration: 300, delay: 200 + i * 120, ease: 'Back.out' });
      }
      this.layer.add(img);
    }
    this.renderList(s, 126);
  }

  private renderList(s: GameState, top = 72) {
    const r = s.results!;
    const x = 60, y = top, w = 360;
    const rowH = Math.min(22, Math.floor((236 - top) / Math.max(1, r.rows.length)));
    this.layer.add(panel(this, x, y, w, rowH * r.rows.length + 16));
    const plan = this.anim ? this.revealPlan(r.rows.map((row) => row.place)) : null;
    r.rows.forEach((row, i) => {
      const rc = this.add.container(0, 0);
      this.layer.add(rc);
      const p = playerById(row.playerId);
      const ry = y + 8 + i * rowH;
      const color = r.hearts !== undefined ? '#3d2414' : PLACE_COLORS[Math.min(row.place - 1, PLACE_COLORS.length - 1)];
      if (r.hearts === undefined) rc.add(ink(this, x + 14, ry + 6, `${row.place}.`, { origin: [0, 0], color }));
      if (p) rc.add(this.add.image(x + 44, ry + rowH - 3, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      rc.add(ink(this, x + 58, ry + 6, p?.name ?? '?', { origin: [0, 0], color }));
      rc.add(ink(this, x + 156, ry + 6, row.detail.slice(0, r.hearts !== undefined ? 24 : 16), { origin: [0, 0], color: '#7a5a3a' }));
      let gain: { t: Phaser.GameObjects.Text; n: number; fmt: (v: number) => string } | null = null;
      if (s.partyActive) {
        rc.add(this.add.image(x + w - 46, ry + 9, ensureTex(this, 'coin', O.coinIcon)));
        const fmt = (v: number) => `+${v}`;
        gain = { t: ink(this, x + w - 14, ry + 6, fmt(row.coins), { origin: [1, 0] }), n: row.coins, fmt };
      } else if (r.points) {
        const fmt = (v: number) => `+${v} Pkt`;
        const n = r.points[row.playerId] ?? 0;
        gain = { t: ink(this, x + w - 14, ry + 6, fmt(n), { origin: [1, 0], color: GREEN_INK }), n, fmt };
      }
      if (gain) rc.add(gain.t);
      if (!plan) return;
      rc.setAlpha(0).setX(-14);
      if (gain) gain.t.setText(gain.fmt(0));
      this.at(plan.delays[i], () => {
        this.tweens.add({ targets: rc, alpha: 1, x: 0, duration: 220, ease: 'Back.Out' });
        if (row.place !== 1) sfx('pop', { x: x + 58, pitch: 0.8 + 0.4 / Math.max(1, row.place - 1), vol: 0.7 });
        if (gain && gain.n > 0) this.countUp(gain.t, gain.n, gain.fmt, row.place === 1);
        if (row.place === 1) {
          this.juice.burst(x + 58, ry + 6, 'confetti', 30);
          this.juice.burst(x + w - 30, ry + 6, 'confetti', 20);
        }
      });
    });
    if (plan) this.revealSound(plan, r.rows.filter((row) => row.place === 1).map((row) => row.playerId), r.hearts === undefined);
  }

  /** Verzögerung (ms) je Eintrag: höchste Plätze zuerst im 200-ms-Takt, Platz 1 nach dem Trommelwirbel */
  private revealPlan(places: number[]) {
    const order = places.map((pl, i) => ({ pl, i })).filter((e) => e.pl !== 1).sort((a, b) => b.pl - a.pl || b.i - a.i);
    const delays: number[] = places.map(() => 0);
    order.forEach((e, k) => (delays[e.i] = REVEAL_START + k * REVEAL_STEP));
    const winnerAt = Math.max(DRUMROLL_S * 1000 + 100, REVEAL_START + order.length * REVEAL_STEP + 400);
    places.forEach((pl, i) => {
      if (pl === 1) delays[i] = winnerAt;
    });
    return { delays, winnerAt, hasWinner: places.includes(1) };
  }

  /** Trommelwirbel bis zum Sieger, dann Fanfare + Ansage */
  private revealSound(plan: { winnerAt: number; hasWinner: boolean }, winners: string[], announce: boolean) {
    if (!plan.hasWinner) return;
    sfx('drumroll', { delay: Math.max(0, plan.winnerAt / 1000 - DRUMROLL_S) });
    this.at(plan.winnerAt, () => {
      sfx('fanfare');
      sfx('cheer', { vol: 0.8, delay: 0.3 });
      this.juice.flash(0xfff4d6, 220);
      const names = winners.map((id) => spokenName(playerById(id)?.name));
      if (!announce || !names.length) return;
      if (names.length === 1) say(`${names[0]} gewinnt!`);
      else if (names.length <= 3) say(`${names.slice(0, -1).join(', ')} und ${names.at(-1)} gewinnen!`);
      else say(`${names.length} Sieger!`);
    });
  }

  private at(ms: number, fn: () => void) {
    this.revealTimers.push(this.time.delayedCall(ms, fn));
  }

  /** Münzen/Punkte hochzählen */
  private countUp(t: Phaser.GameObjects.Text, n: number, fmt: (v: number) => string, big: boolean) {
    this.tweens.addCounter({
      from: 0, to: n, duration: Math.min(900, 250 + n * 40), ease: 'Quad.Out',
      onUpdate: (tw) => {
        const v = Math.round(tw.getValue() ?? n);
        if (t.active && t.text !== fmt(v)) {
          t.setText(fmt(v));
          sfx('tick', { pitch: 1.4, vol: 0.4 });
        }
      },
      onComplete: () => {
        if (!t.active) return;
        t.setText(fmt(n));
        sfx('coin', { pitch: big ? 1.2 : 1, vol: big ? 0.9 : 0.5 });
      },
    });
  }

  private renderPodium(s: GameState) {
    const r = s.results!;
    const podium = [
      { place: 2, x: 136, h: 3 },
      { place: 1, x: 240, h: 4 },
      { place: 3, x: 344, h: 2 },
    ];
    const baseY = 214;
    const crate = ensureTex(this, 'crate', O.crate);
    const units: { place: number; c: C }[] = [];
    for (const slot of podium) {
      for (let k = 0; k < slot.h; k++) {
        for (const dx of [-16, 0, 16]) this.layer.add(this.add.image(slot.x + dx, baseY - k * 16, crate).setOrigin(0.5, 1));
      }
      const top = baseY - slot.h * 16;
      this.layer.add(ink(this, slot.x, baseY - 12, String(slot.place), { size: 8, color: C.white }).setShadow(1, 1, '#2d1b12', 0, false, true));
      const row = r.rows.filter((rw) => rw.place === slot.place);
      const sc = this.add.container(0, 0);
      this.layer.add(sc);
      if (row.length) units.push({ place: slot.place, c: sc });
      row.slice(0, 3).forEach((rw, i) => {
        const p = playerById(rw.playerId);
        if (!p) return;
        const ox = (i - (Math.min(3, row.length) - 1) / 2) * 24;
        const f = figure(this, p.look, slot.x + ox, top, 2);
        sc.add(f);
        if (slot.place === 1) {
          f.play('cheer');
          this.tweens.add({ targets: f.getData('img'), y: -6, duration: 300, yoyo: true, repeat: -1 });
          sc.add(this.add.image(slot.x + ox, top - 62, ensureTex(this, 'crown', O.crown)).setScale(2));
        }
      });
      const names = row.map((rw) => playerById(rw.playerId)?.name ?? '?').join(', ');
      const detail = row[0]?.detail.replace(' Cocktails · ', ' Cockt.\n').replace(' Münzen', ' $') ?? '';
      if (row.length) {
        sc.add(nameTag(this, slot.x, baseY + 2, names.slice(0, 10)));
        sc.add(ink(this, slot.x, baseY + 16, detail, { color: '#7a5a3a' }).setBackgroundColor('#f7e4b5').setPadding(2, 1, 2, 1));
      }
    }
    const rest = r.rows.filter((rw) => rw.place > 3);
    const restC = this.add.container(0, 0);
    this.layer.add(restC);
    if (rest.length) units.push({ place: 99, c: restC });
    if (rest.length > 5) {
      // Viele Spieler (bis 12): Plätze ab 4 als zwei Listen links und rechts neben dem Podest
      const half = Math.ceil(rest.length / 2);
      rest.forEach((rw, i) => {
        const left = i < half;
        const line = `${rw.place}. ${(playerById(rw.playerId)?.name ?? '?').slice(0, 9)}`;
        const t = ink(this, left ? 6 : WORLD.W - 6, 72 + (left ? i : i - half) * 13, line, { origin: [left ? 0 : 1, 0] });
        restC.add(t.setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1));
      });
    } else if (rest.length) {
      const line = rest.map((rw) => `${rw.place}. ${playerById(rw.playerId)?.name ?? '?'}`).join('  ');
      restC.add(ink(this, WORLD.W / 2, 72, line).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1));
    }

    // Aufbau: erst die Plätze ab 4, dann 3, 2 – und nach dem Trommelwirbel der Sieger mit Konfetti
    if (!this.anim) return;
    const plan = this.revealPlan(units.map((u) => u.place));
    units.forEach((u, i) => {
      u.c.setAlpha(0).setY(u.place === 99 ? 0 : -40);
      this.at(plan.delays[i], () => {
        this.tweens.add({ targets: u.c, alpha: 1, y: 0, duration: u.place === 99 ? 250 : 420, ease: u.place === 99 ? 'Quad.Out' : 'Bounce.Out' });
        if (u.place !== 1) sfx(u.place === 99 ? 'pop' : 'select', { pitch: u.place === 2 ? 1.2 : 1 });
        else {
          this.juice.burst(240, 120, 'confetti', 60);
          this.juice.burst(136, 150, 'confetti', 25);
          this.juice.burst(344, 160, 'confetti', 25);
          this.juice.shake(1);
        }
      });
    });
    this.revealSound(plan, r.rows.filter((rw) => rw.place === 1).map((rw) => rw.playerId), true);
  }
}
