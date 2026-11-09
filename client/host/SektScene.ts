import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { type PlayerColor, possessive } from '../../shared/players';
import { SEKT, type SektPlayer, type SektPop, type SektState, type SektSt, fmtM } from '../../shared/sekt';
import { SEKT_TV, bottlePix, corkPix, flagPix, paintSektWorld, pegPix, postPix, thumbPix } from '../art/sekt';
import * as O from '../art/objects';
import { bus, getState, playerById } from './store';
import { pcol } from './playerColor';
import { CameraRig } from './camera';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { Countdown, GOLD, LIGHT, NameTags, RED_INK, background, ensureTex, fitText, ink, panel, prop, tagName, txt } from './ui';

const { W, H, BAR_TOP, LAUNCH_X, PXM, SAND_Y } = SEKT_TV;
const C_BLUE = '#3f8fe0';
const HOME = { x: 240, y: 135 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const nameOf = (id: string) => tagName(playerById(id)?.name ?? '?');
const spoken = (m: number) => m.toFixed(1).replace('.', ',');
/** Weite an der Flasche: bei schmalen Plätzen ohne Leerzeichen („23,4m“) */
const mText = (m: number, slotW: number) => (slotW < 50 ? `${spoken(m)}m` : fmtM(m));

type Variant = 'closed' | 'open' | 'broken';

interface Bottle {
  id: string;
  x: number;
  /** Maßstab (wenige Spieler = größere Flaschen) */
  k: number;
  slotW: number;
  color: PlayerColor;
  box: Phaser.GameObjects.Container;
  glass: Phaser.GameObjects.Image;
  cork: Phaser.GameObjects.Image;
  thumb: Phaser.GameObjects.Image;
  best: Phaser.GameObjects.Text;
  bestText: string;
  label: Phaser.GameObjects.Text;
  pips: Phaser.GameObjects.Rectangle[];
  variant: Variant;
  st: SektSt;
  /** Angezeigter Druck (weich nachgezogen) */
  pv: number;
  p: SektPlayer;
}

interface Flag {
  pid: string;
  round: number;
  m: number;
  x: number;
  pole: Phaser.GameObjects.Image;
  cork: Phaser.GameObjects.Image;
}

/**
 * Sektkorken auf dem TV: links die Strandbar mit allen Flaschen nebeneinander (Etikett und Namensschild in
 * Spielerfarbe, Druckanzeige mit wandernder roter Zone), rechts dahinter der lange Strand mit Weiten-Pfosten.
 * Korken fliegen beim PLOPP aus der Flasche über den Rand und landen mit Fähnchen im Sand; nach jedem Durchgang
 * fährt die Kamera zum weitesten Korken, am Ende zum Sieger.
 */
export class SektScene extends Phaser.Scene {
  private rig!: CameraRig;
  private juice!: Juice;
  private bottles = new Map<string, Bottle>();
  private flags = new Map<string, Flag>();
  /** Korken in der Luft (für die Kamera) */
  private flying = new Map<string, Phaser.GameObjects.Image>();
  private tags!: NameTags;
  private gauges!: Phaser.GameObjects.Graphics;
  private st: SektState | null = null;
  private phaseKey = '';
  private lastSeq = 0;
  private primed = false;
  private countdown = new Countdown();
  private redShow = SEKT.RED_START;
  private lastCreak = 0;
  private burstSaid = 0;
  // HUD
  private head!: Phaser.GameObjects.Text;
  private call!: Phaser.GameObjects.Text;
  private headPlate!: Phaser.GameObjects.Rectangle;
  private big!: Phaser.GameObjects.Text;
  private bannerTxt!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private bannerPlate!: Phaser.GameObjects.Rectangle;
  private board!: Phaser.GameObjects.Container;
  private intro!: Phaser.GameObjects.Container;
  private boardKey = '';

  constructor() {
    super('sekt');
  }

  create() {
    this.bottles = new Map();
    this.flags = new Map();
    this.flying = new Map();
    this.st = null;
    this.phaseKey = '';
    this.lastSeq = 0;
    this.primed = false;
    this.countdown = new Countdown();
    this.redShow = SEKT.RED_START;
    this.lastCreak = 0;
    this.burstSaid = 0;
    this.boardKey = '';

    this.rig = new CameraRig(this, { w: W, h: H, lerp: 0.07 });
    this.rig.follow(HOME, 1, { cut: true });
    background(this, 'sekt', W, H, (p) => paintSektWorld(p));
    this.decorate();
    this.gauges = this.add.graphics().setDepth(105);
    this.tags = new NameTags(this, 70);
    this.juice = new Juice(this, { depth: 1900 });

    this.rig.hud(() => {
      this.headPlate = this.add.rectangle(240, 4, 10, 18, 0x2d1b12, 0.85).setOrigin(0.5, 0).setStrokeStyle(2, 0x8d5629).setDepth(3000);
      this.head = txt(this, 240, 9, '', { color: GOLD }).setDepth(3001);
      this.call = txt(this, 240, 27, '', { color: LIGHT }).setDepth(3001);
      this.big = txt(this, 240, 62, '', { size: 24, color: GOLD }).setOrigin(0.5).setDepth(3002);
      this.bannerPlate = this.add.rectangle(240, 96, 10, 10, 0x2d1b12, 0.85).setStrokeStyle(2, 0xffd25e, 0.9).setDepth(3009).setVisible(false);
      this.bannerTxt = txt(this, 240, 88, '', { size: 24, color: GOLD }).setOrigin(0.5).setDepth(3010);
      this.bannerSub = txt(this, 240, 106, '', { color: LIGHT }).setDepth(3010);
      this.board = this.add.container(0, 0).setDepth(3005);
      this.intro = this.add.container(0, 0).setDepth(3006);
    });

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  /** Strand: Pfosten alle 10 m, Pflöcke alle 5 m, ein paar Schirme und Palmen */
  private decorate() {
    const postKey = ensureTex(this, 'sekt_post', postPix);
    const pegKey = ensureTex(this, 'sekt_peg', pegPix);
    for (let m = 5; m <= 55; m += 5) {
      const x = LAUNCH_X + m * PXM;
      if (m % 10 === 0) {
        this.add.image(x, SAND_Y + 12, postKey).setOrigin(0.5, 1).setDepth(40);
        ink(this, x, SAND_Y - 12, `${m} m`, { color: RED_INK }).setOrigin(0.5, 0).setDepth(41).setScale(m >= 100 ? 0.6 : 0.75);
      } else this.add.image(x, SAND_Y + 6, pegKey).setOrigin(0.5, 1).setDepth(40);
    }
    // Abwurflinie: Seil vom Ende der Theke
    this.add.rectangle(LAUNCH_X, SAND_Y + 8, 2, 60, 0xfff4d6, 0.6).setOrigin(0.5, 1).setDepth(39);
    ink(this, LAUNCH_X + 3, SAND_Y + 12, '0 m', { color: RED_INK, origin: [0, 0] }).setScale(0.75).setDepth(41);
    prop(this, 'sekt_palm_a', () => O.palm(6), 520, 168).setDepth(20);
    prop(this, 'sekt_palm_b', () => O.palm(9), 1150, 160).setDepth(20);
    prop(this, 'sekt_umb_a', () => O.umbrella(), 760, 176).setDepth(21);
    prop(this, 'sekt_umb_b', () => O.umbrella(C_BLUE, '#fdf7ea'), 1020, 172).setDepth(21);
    prop(this, 'sekt_towel', () => O.towel('#e04a3f'), 790, 186).setDepth(19);
    prop(this, 'sekt_chair', () => O.deckchair('#3f8fe0'), 940, 188).setDepth(22);
    prop(this, 'sekt_palm_c', () => O.palm(3), 12, 150).setDepth(18);
    prop(this, 'sekt_palm_d', () => O.palm(4), 462, 146).setDepth(18);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'sekt') return;
    const st = s.mini.state;
    this.st = st;
    this.syncBottles(st);
    this.syncPops(st);
    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      const first = !this.phaseKey;
      this.phaseKey = key;
      this.countdown.set(st.endsIn);
      this.onPhase(st, first);
    }
    this.renderBoard(st);
  }

  private onPhase(st: SektState, first: boolean) {
    this.hideBanner();
    this.intro.removeAll(true);
    if (st.sub === 'intro') {
      this.rig.hud(() => this.buildIntro(st));
      this.rig.follow(HOME, 1, { cut: first });
    } else if (st.sub === 'countdown') {
      this.rig.follow(HOME, 1, { cut: first });
      for (const b of this.bottles.values()) this.resetBottle(b);
      // ältere Fähnchen verblassen
      for (const f of this.flags.values()) this.styleFlag(f, st);
    } else if (st.sub === 'shake') {
      this.showBanner('SCHÜTTELN!', 'Loslassen = PLOPP!  ·  Rot = PENG!', 1300);
      this.juice.shake(1);
    } else if (st.sub === 'show') {
      this.startShow(st, first);
    } else if (st.sub === 'over') {
      this.startOver(st, first);
    }
  }

  // ---------------------------------------------------------------- Flaschen

  private syncBottles(st: SektState) {
    const n = st.order.length;
    const slotW = Math.min(70, 464 / Math.max(1, n));
    const k = n <= 4 ? 2 : n <= 8 ? 1.5 : 1;
    st.order.forEach((id, i) => {
      const p = st.players[id];
      if (!p) return;
      let b = this.bottles.get(id);
      if (!b) {
        b = this.makeBottle(id, 240 + (i - (n - 1) / 2) * slotW, k, slotW, p);
        this.bottles.set(id, b);
      }
      b.p = p;
      if (p.st !== b.st) {
        b.st = p.st;
        if (p.st === 'wait' || p.st === 'in') this.setVariant(b, 'closed');
      }
      const bestText = p.best > 0 ? mText(p.best, slotW) : '–';
      if (b.bestText !== bestText) {
        b.bestText = bestText;
        fitText(b.best.setText(bestText), slotW - 5, 0.55);
      }
      b.pips.forEach((r, j) => {
        const m = p.throws[j];
        const played = j < st.round - (st.sub === 'countdown' || st.sub === 'shake' ? 1 : 0);
        const col = m > 0 ? 0xffd25e : m < 0 ? 0xe0503f : played ? 0x5a4a3a : 0xa89a7a;
        r.setFillStyle(col, played || m ? 1 : 0.45);
      });
    });
  }

  private makeBottle(id: string, x: number, k: number, slotW: number, p: SektPlayer): Bottle {
    const color = pcol(id, p.slot);
    const box = this.add.container(x, BAR_TOP).setDepth(100);
    const glass = this.add.image(0, 0, this.bottleTex(color.hex, 'closed')).setOrigin(0.5, 1).setScale(k);
    const cork = this.add.image(0, -39 * k, ensureTex(this, 'sekt_cork', corkPix)).setOrigin(0.5, 1).setScale(k);
    const thumb = this.add.image(0, -45 * k, ensureTex(this, 'sekt_thumb', thumbPix)).setOrigin(0.5, 1).setScale(k).setVisible(false);
    box.add([glass, cork, thumb]);
    // Namensschild in Spielerfarbe auf der Thekenfront
    const tw = Math.max(20, Math.floor(slotW - 4));
    this.add.rectangle(x, BAR_TOP + 7, tw, 11, color.num).setOrigin(0.5, 0).setStrokeStyle(1, 0x2d1b12).setDepth(110);
    const nm = ink(this, x, BAR_TOP + 9, nameOf(id), { color: color.ink }).setDepth(111);
    fitText(nm, tw - 3, 0.5);
    nm.setY(BAR_TOP + 9 + (8 - nm.displayHeight) / 2 + 0.5);
    const best = txt(this, x, BAR_TOP + 23, '–', { color: GOLD }).setDepth(111);
    const pips = [0, 1, 2].map((j) => this.add.rectangle(x + (j - 1) * 9, BAR_TOP + 37, 7, 4, 0xa89a7a).setStrokeStyle(1, 0x2d1b12).setDepth(111));
    const label = txt(this, x, BAR_TOP - 52 * k - 16, '', { color: GOLD }).setDepth(120);
    // Auftritt
    box.setScale(0.2).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 380, delay: p.slot * 60, ease: 'Back.Out' });
    return { id, x, k, slotW, color, box, glass, cork, thumb, best, bestText: '–', label, pips, variant: 'closed', st: p.st, pv: 0, p };
  }

  private bottleTex(hex: string, v: Variant) {
    return ensureTex(this, `sekt_bottle_${hex}_${v}`, () => bottlePix(hex, v));
  }

  private setVariant(b: Bottle, v: Variant) {
    if (b.variant === v) return;
    b.variant = v;
    b.glass.setTexture(this.bottleTex(b.color.hex, v));
    b.cork.setVisible(v === 'closed');
    b.cork.setPosition(0, -39 * b.k).setAngle(0);
  }

  private resetBottle(b: Bottle) {
    this.setVariant(b, 'closed');
    b.label.setText('').setScale(1);
    b.pv = 0;
    b.glass.clearTint();
  }

  /** Halsöffnung in Weltkoordinaten */
  private neck(b: Bottle) {
    return { x: b.box.x, y: BAR_TOP - 41 * b.k };
  }

  // ---------------------------------------------------------------- PLOPP / PENG

  private syncPops(st: SektState) {
    for (const pop of st.pops) {
      if (pop.seq <= this.lastSeq) continue;
      this.lastSeq = pop.seq;
      if (this.primed) this.onPop(pop);
      else if (!pop.burst && pop.m > 0) this.placeFlag(pop);
    }
    if (!this.primed) {
      // Szene mitten im Spiel gestartet: Flaschen dieses Durchgangs gleich richtig zeigen
      for (const b of this.bottles.values()) {
        const m = b.p.throws[st.round - 1];
        if (b.p.st === 'pop') (this.setVariant(b, 'open'), b.label.setText(m > 0 ? mText(m, b.slotW) : ''), fitText(b.label, b.slotW - 4, 0.5));
        if (b.p.st === 'burst') (this.setVariant(b, 'broken'), b.label.setText('PENG').setColor('#ff8a7a'));
      }
      for (const f of this.flags.values()) this.styleFlag(f, st);
    }
    this.primed = true;
  }

  private onPop(pop: SektPop) {
    const b = this.bottles.get(pop.pid);
    if (!b) return;
    const { x, y } = this.neck(b);
    // Viele Flaschen: keine schwebenden Texte – die Weite steht ohnehin über der Flasche
    const crowded = this.bottles.size > 8;
    b.label.setColor(GOLD);
    if (pop.burst) {
      this.setVariant(b, 'broken');
      b.glass.clearTint();
      this.juice.burst(x, y + 14 * b.k, 'foam', 30);
      this.juice.burst(x, y + 16 * b.k, 'spark', 14);
      this.juice.burst(x, y + 20 * b.k, 'puff', 8);
      this.juice.shake(2);
      this.juice.flash(0xfff4d6, 120);
      if (!crowded) this.juice.float(x, y + 2, 'PENG!', 'dmg');
      sfx('crack', { x, pitch: 0.8 });
      sfx('splash', { x, pitch: 1.3, vol: 0.8 });
      b.label.setText('PENG').setColor('#ff8a7a');
      if (this.time.now - this.burstSaid > 4000) {
        this.burstSaid = this.time.now;
        say(`Peng! ${possessive(spokenName(playerById(pop.pid)?.name))} Flasche ist geplatzt!`);
      }
      return;
    }
    if (pop.m <= 0) {
      this.setVariant(b, 'open');
      this.juice.burst(x, y, 'puff', 4);
      if (!crowded) this.juice.float(x, y + 2, 'Pfft …', 'info');
      sfx('pop', { x, pitch: 0.5, vol: 0.5 });
      b.label.setText('Pfft').setColor(LIGHT);
      return;
    }
    this.setVariant(b, 'open');
    const strong = clamp(pop.p, 0.3, 1);
    this.juice.burst(x, y, 'foam', Math.round(8 + strong * 18));
    if (pop.p > 0.7) this.juice.burst(x, y - 4, 'spark', 6);
    if (!crowded) this.juice.float(x, y + 2, 'PLOPP!', b.color.hex);
    sfx('pop', { x, pitch: 1.25 - strong * 0.5, vol: 0.6 + strong * 0.5 });
    sfx('whoosh', { x, vol: 0.4, delay: 0.05 });
    if (pop.p > 0.8) this.rig.punch(0.03, 180);
    b.label.setText(mText(pop.m, b.slotW)).setColor(GOLD);
    fitText(b.label, b.slotW - 4, 0.5);
    const full = b.label.scale;
    b.label.setScale(full * 0.4);
    this.tweens.add({ targets: b.label, scale: full, duration: 260, ease: 'Back.Out' });
    this.flyCork(pop, b);
  }

  /** Korken fliegt im hohen Bogen aus dem Bild und landet am Strand */
  private flyCork(pop: SektPop, b: Bottle) {
    const from = this.neck(b);
    const tx = LAUNCH_X + pop.m * PXM;
    const ty = SAND_Y;
    const arc = 90 + pop.m * 3.2;
    const dur = 700 + pop.m * 26;
    const key = `${pop.pid}-${pop.round}`;
    const img = this.add.image(from.x, from.y, ensureTex(this, 'sekt_cork', corkPix)).setDepth(300).setScale(b.k);
    this.flying.set(key, img);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      ease: 'Linear',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        img.setPosition(from.x + (tx - from.x) * t, from.y + (ty - from.y) * t - arc * 4 * t * (1 - t));
        img.setAngle(t * 900);
        img.setScale(b.k + (1 - b.k) * t);
      },
      onComplete: () => {
        img.destroy();
        this.flying.delete(key);
        this.juice.burst(tx, ty, 'sand', 7);
        sfx('bonk', { x: clamp(tx - this.cameras.main.scrollX, 0, 480), pitch: 1.4, vol: 0.35 });
        this.placeFlag(pop);
      },
    });
  }

  private placeFlag(pop: SektPop) {
    const key = `${pop.pid}-${pop.round}`;
    if (this.flags.has(key)) return;
    const color = pcol(pop.pid);
    const x = LAUNCH_X + pop.m * PXM;
    const pole = this.add.image(x, SAND_Y + 2, ensureTex(this, `sekt_flag_${color.hex}`, () => flagPix(color.hex))).setOrigin(1 / 9, 1).setDepth(60 + pop.m / 100);
    const cork = this.add.image(x - 3, SAND_Y + 2, ensureTex(this, 'sekt_cork', corkPix)).setOrigin(0.5, 1).setAngle(80).setDepth(61);
    const f: Flag = { pid: pop.pid, round: pop.round, m: pop.m, x, pole, cork };
    this.flags.set(key, f);
    if (this.st) this.styleFlag(f, this.st);
    pole.setScale(1, 0.2);
    this.tweens.add({ targets: pole, scaleY: 1, duration: 220, ease: 'Back.Out' });
  }

  /** Aktueller Durchgang hell, ältere blass – am Ende nur noch die Bestweiten */
  private styleFlag(f: Flag, st: SektState) {
    const best = st.players[f.pid]?.best ?? 0;
    const on = st.sub === 'over' ? f.m === best && f.m > 0 && this.isBestFlag(f) : f.round === st.round;
    const hide = st.sub === 'over' && !on;
    f.pole.setAlpha(on ? 1 : 0.35).setVisible(!hide);
    f.cork.setAlpha(on ? 1 : 0.35).setVisible(!hide);
  }

  /** Bei gleicher Bestweite in zwei Durchgängen nur das erste Fähnchen zeigen */
  private isBestFlag(f: Flag) {
    for (const g of this.flags.values()) if (g.pid === f.pid && g.m === f.m && g.round < f.round) return false;
    return true;
  }

  private labeledFlags(): Flag[] {
    const st = this.st;
    if (!st) return [];
    const list = [...this.flags.values()].filter((f) => (st.sub === 'over' ? f.pole.visible && f.pole.alpha === 1 : f.round === st.round && (st.sub === 'show' || st.sub === 'shake')));
    // Nur die Weitesten beschriften (die Tafel nennt alle) – bei 12 Fähnchen wird es sonst Kraut und Rüben
    return list.sort((a, b) => b.m - a.m).slice(0, st.sub === 'over' ? 3 : 6);
  }

  // ---------------------------------------------------------------- Weiten-Schau

  /** Weitester Korken eines Durchgangs (oder insgesamt) */
  private farthest(round: number | null): { pid: string; m: number; round: number } | null {
    const st = this.st;
    if (!st) return null;
    let best: { pid: string; m: number; round: number } | null = null;
    for (const pop of st.pops) {
      if (pop.burst || pop.m <= 0 || (round !== null && pop.round !== round)) continue;
      if (!best || pop.m > best.m) best = { pid: pop.pid, m: pop.m, round: pop.round };
    }
    return best;
  }

  /** Kamera-Ziel: fliegender Korken oder sein Fähnchen */
  private focusOn(pid: string, round: number) {
    const key = `${pid}-${round}`;
    return () => {
      const img = this.flying.get(key);
      if (img) return { x: img.x, y: Math.max(140, img.y) };
      const f = this.flags.get(key);
      return f ? { x: f.x - 40, y: 170 } : null;
    };
  }

  private startShow(st: SektState, first: boolean) {
    const top = this.farthest(st.round);
    if (!top) {
      this.showBanner(st.players && Object.values(st.players).some((p) => p.throws[st.round - 1] < 0) ? 'ALLES GEPLATZT!' : 'KEIN KORKEN …', 'Nächster Durchgang!', SEKT.SHOW_MS - 400);
      return;
    }
    const go = () => this.rig.follow(this.focusOn(top.pid, top.round), 1.25);
    if (first) this.rig.follow(this.focusOn(top.pid, top.round), 1.25, { cut: true });
    else this.time.delayedCall(350, go);
    this.time.delayedCall(first ? 200 : 1800, () => {
      if (this.st?.sub !== 'show' || this.st.round !== st.round) return;
      const c = pcol(top.pid);
      this.showBanner(fmtM(top.m), `${nameOf(top.pid)} – weitester Korken in Durchgang ${st.round}`, SEKT.SHOW_MS - 2100, c.hex);
      sfx('coin');
      say(`${spokenName(playerById(top.pid)?.name)}: ${spoken(top.m)} Meter`);
    });
  }

  private startOver(st: SektState, first: boolean) {
    for (const f of this.flags.values()) this.styleFlag(f, st);
    const top = this.farthest(null);
    if (!top) {
      this.rig.follow(HOME, 1);
      this.showBanner('KEIN SIEGER', 'Alle Flaschen geplatzt – was für eine Sauerei!', SEKT.OVER_MS);
      sfx('lose');
      return;
    }
    // Gleiche Bestweite: Fähnchen aus dem ersten Durchgang mit dieser Weite
    const firstRound = [...this.flags.values()].filter((f) => f.pid === top.pid && f.m === top.m).sort((a, b) => a.round - b.round)[0]?.round ?? top.round;
    this.rig.follow(this.focusOn(top.pid, firstRound), 1.4, { cut: first });
    this.time.delayedCall(first ? 100 : 900, () => {
      if (this.st?.sub !== 'over') return;
      const winners = Object.entries(st.players).filter(([, p]) => p.best === top.m).map(([id]) => id);
      const names = winners.map((id) => nameOf(id)).join(' & ');
      this.showBanner(winners.length > 1 ? 'GLEICHSTAND!' : `SIEG: ${names}`, `${winners.length > 1 ? `${names} – ` : 'Weitester Korken: '}${fmtM(top.m)}`, SEKT.OVER_MS, pcol(winners[0]).hex);
      sfx('fanfare');
      const f = this.flags.get(`${top.pid}-${firstRound}`);
      if (f) this.juice.burst(f.x, SAND_Y - 30, 'confetti', 50);
      say(winners.length > 1 ? `Gleichstand mit ${spoken(top.m)} Metern!` : `${spokenName(playerById(top.pid)?.name)} gewinnt mit ${spoken(top.m)} Metern!`);
    });
  }

  // ---------------------------------------------------------------- HUD

  private showBanner(text: string, sub: string, ms: number, color = GOLD) {
    this.tweens.killTweensOf([this.bannerTxt, this.bannerSub, this.bannerPlate]);
    // Weiten-Schau/Endstand: rechts steht die Tafel → Banner links daneben
    const side = this.st?.sub === 'show' || this.st?.sub === 'over';
    const cx = side ? 172 : 240;
    const maxW = side ? 316 : 440;
    this.bannerTxt.setPosition(cx, 88).setText(text).setColor(color).setAlpha(1);
    fitText(this.bannerTxt, maxW - 10, 0.4);
    const base = this.bannerTxt.scale;
    this.bannerSub.setPosition(cx, 106).setText(sub).setAlpha(1);
    fitText(this.bannerSub, maxW, 0.55);
    const w = Math.max(this.bannerTxt.displayWidth, this.bannerSub.displayWidth) + 18;
    const h = sub ? 44 : 32;
    this.bannerPlate.setPosition(cx, 74 + h / 2).setSize(w, h).setDisplaySize(w, h).setVisible(true).setAlpha(1);
    this.bannerTxt.setScale(base * 0.3);
    this.tweens.add({ targets: this.bannerTxt, scale: base, duration: 320, ease: 'Back.Out' });
    this.tweens.add({ targets: [this.bannerTxt, this.bannerSub, this.bannerPlate], alpha: 0, delay: Math.max(400, ms - 300), duration: 300 });
  }

  private hideBanner() {
    this.tweens.killTweensOf([this.bannerTxt, this.bannerSub, this.bannerPlate]);
    this.bannerPlate.setVisible(false);
    this.bannerTxt.setText('');
    this.bannerSub.setText('');
  }

  private buildIntro(st: SektState) {
    const n = st.order.length;
    this.intro.add(panel(this, 66, 36, 348, 96));
    this.intro.add(ink(this, 240, 45, 'SEKTKORKEN', { size: 16, color: RED_INK }));
    this.intro.add(ink(this, 240, 67, `Daumen auf den Korken und schütteln!\nLoslassen = PLOPP – mehr Druck = weiter.\nZu lange im Roten = PENG, 0 Meter.\n${SEKT.ROUNDS} Durchgänge – der beste Wurf zählt.`));
    this.intro.add(ink(this, 240, 119, `${n} Flaschen an der Bar`, { color: RED_INK }).setScale(0.75));
  }

  private renderBoard(st: SektState) {
    const show = st.sub === 'show' || st.sub === 'over';
    const rows = st.order.map((id) => {
      const p = st.players[id];
      const m = st.sub === 'over' ? p?.best ?? 0 : p?.throws[st.round - 1] ?? 0;
      return { id, m };
    });
    const key = show ? JSON.stringify([st.sub, st.round, rows]) : '';
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (!show) return;
    rows.sort((a, b) => b.m - a.m);
    this.rig.hud(() => {
      const w = 132;
      const x0 = 480 - w - 3;
      const rowH = rows.length > 9 ? 10 : 12;
      const top = 40;
      this.board.add(panel(this, x0, top, w, 25 + rows.length * rowH));
      this.board.add(ink(this, x0 + 7, top + 6, st.sub === 'over' ? 'BESTWEITE' : `DURCHGANG ${st.round}`, { origin: [0, 0], color: RED_INK }).setScale(0.75));
      rows.forEach((r, i) => {
        const y = top + 18 + i * rowH + rowH / 2;
        const c = pcol(r.id);
        this.board.add(this.add.rectangle(x0 + 9, y, 6, 6, c.num).setStrokeStyle(1, 0x2d1b12));
        const nm = ink(this, x0 + 15, y, nameOf(r.id), { origin: [0, 0.5] });
        fitText(nm, 62, 0.55);
        this.board.add(nm);
        const v = r.m > 0 ? fmtM(r.m) : r.m < 0 ? 'PENG' : '–';
        const t = ink(this, x0 + w - 6, y, v, { origin: [1, 0.5], color: r.m < 0 ? RED_INK : undefined });
        fitText(t, 48, 0.55);
        this.board.add(t);
      });
    });
  }

  // ---------------------------------------------------------------- Bild für Bild

  update(time: number) {
    const st = this.st;
    if (!st) return;
    // Kopfzeile + Ansage
    const sec = this.countdown.seconds;
    const round = `DURCHGANG ${Math.max(1, st.round)}/${st.rounds}`;
    const head = st.sub === 'intro' ? 'SEKTKORKEN' : st.sub === 'shake' ? `${round}  ·  ${sec} s` : st.sub === 'over' ? 'ENDSTAND' : round;
    if (this.head.text !== head) {
      this.head.setText(head);
      this.headPlate.setSize(this.head.width + 20, 18).setDisplaySize(this.head.width + 20, 18);
    }
    const waiting = st.order.filter((id) => st.players[id]?.st === 'wait').length;
    const call =
      st.sub === 'countdown' ? (waiting ? `Daumen auf den Korken! (${waiting} fehlen)` : 'Alle Daumen drauf!')
      : st.sub === 'shake' ? 'Schütteln! Loslassen = PLOPP · Rot zu lange = PENG'
      : '';
    if (this.call.text !== call) this.call.setText(call);
    this.big.setText(st.sub === 'countdown' && sec > 0 ? String(sec) : '');

    // Rote Zone weich nachziehen
    this.redShow += (st.red - this.redShow) * 0.35;
    const blink = Math.floor(time / 110) % 2 === 0;
    let creak = false;
    for (const b of this.bottles.values()) {
      const p = b.p;
      const live = p.st === 'in';
      b.pv += ((live || p.st === 'pop' || p.st === 'burst' ? p.p : 0) - b.pv) * (live ? 0.35 : 0.2);
      b.thumb.setVisible(live && (st.sub === 'countdown' || st.sub === 'shake'));
      // Wackeln beim Schütteln, Zittern im Roten
      const s = live && st.sub === 'shake' ? clamp(p.s, 0, 1.2) : 0;
      const jit = live && p.danger > 0 ? (Math.random() - 0.5) * 4 : 0;
      b.box.setAngle(Math.sin(time * 0.045 + p.slot * 1.7) * s * 8 + jit);
      b.box.setY(BAR_TOP - Math.abs(Math.sin(time * 0.045 + p.slot)) * s * 2.5);
      if (live && p.danger > 0) {
        b.glass.setTint(blink ? 0xff8f80 : 0xffffff);
        creak = true;
      } else if (b.glass.isTinted) b.glass.clearTint();
    }
    if (creak && time - this.lastCreak > 260) {
      this.lastCreak = time;
      sfx('tick', { pitch: 0.6, vol: 0.5 });
    }
    this.drawGauges(time, st);
    // Namen über den gelandeten Korken
    this.tags.update(
      this.labeledFlags().map((f) => {
        const c = pcol(f.pid);
        return { id: `${f.pid}-${f.round}`, x: f.x + 3, y: SAND_Y - 30, name: nameOf(f.pid), color: c.hex, dot: c.num };
      }),
    );
  }

  /** Druckanzeige neben jeder Flasche: Füllung, wandernde rote Zone, Markierung */
  private drawGauges(time: number, st: SektState) {
    const g = this.gauges;
    g.clear();
    const showRed = st.sub === 'countdown' || st.sub === 'shake';
    const pulse = 0.55 + 0.2 * Math.sin(time / 120);
    for (const b of this.bottles.values()) {
      const k = b.k;
      const gh = Math.round(36 * k);
      const gw = Math.round(3 * k + 2);
      const gx = Math.round(b.x + 8 * k + 3);
      const gy = BAR_TOP - 2;
      const top = gy - gh;
      g.fillStyle(0x2d1b12, 1).fillRect(gx - 1, top - 1, gw + 2, gh + 2);
      g.fillStyle(0x4a3424, 1).fillRect(gx, top, gw, gh);
      const red = showRed ? this.redShow : SEKT.RED_START;
      const ry = Math.round(gy - gh * red);
      g.fillStyle(0xc0392b, showRed ? pulse : 0.35).fillRect(gx, top, gw, ry - top);
      const done = b.p.st !== 'in';
      const pv = clamp(b.pv, 0, 1);
      const fh = Math.round(gh * pv);
      if (fh > 0) {
        const danger = b.p.danger > 0 && !done;
        const col = b.p.st === 'burst' ? 0xe0503f : danger ? (Math.floor(time / 110) % 2 ? 0xff4030 : 0xfff4d6) : pv < 0.45 ? 0x46b04a : pv < 0.7 ? 0xffd25e : 0xf0973a;
        g.fillStyle(col, done ? 0.55 : 1).fillRect(gx, gy - fh, gw, fh);
        g.fillStyle(0xffffff, done ? 0.4 : 0.9).fillRect(gx - 1, gy - fh, gw + 2, 1);
      }
      if (showRed) g.fillStyle(0xffe0d0, 1).fillRect(gx - 1, ry, gw + 2, 1);
    }
  }
}
