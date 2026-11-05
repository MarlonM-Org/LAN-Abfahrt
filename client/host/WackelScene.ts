import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { WACKEL, type WackelFx, type WackelPlatform, type WackelPlayer, type WackelState, wackelStage } from '../../shared/wackel';
import { SHIRTS, SKINS } from '../../shared/avatar';
import * as A from '../art/wackel';
import { sumoRing } from '../art/sumo';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, ensureTex, ink, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

type Img = Phaser.GameObjects.Image;

interface Doll {
  id: string;
  /** Rumpf, Kopf, Arm L, Arm R, Bein L, Bein R */
  imgs: Img[];
  dizzy: Img;
  swim: Phaser.GameObjects.Container;
  /** Interpolierte Pose (18 Werte) */
  pose: number[];
  alive: boolean;
  stun: boolean;
  color: string;
}

/** Reihenfolge beim Zeichnen: hinten → vorne */
const DRAW_ORDER = [2, 4, 5, 0, 3, 1];

/** Wackel-Prügelei: labbrige Puppen auf Steg oder Kutter – wer fällt ins Meer? */
export class WackelScene extends Phaser.Scene {
  private latest: WackelState | null = null;
  private dolls = new Map<string, Doll>();
  private plats: { p: WackelPlatform; img: Img }[] = [];
  private builtStage = '';
  private bg: Img | null = null;
  private water!: Phaser.GameObjects.Rectangle;
  private foam!: Phaser.GameObjects.Rectangle;
  private wave!: Img;
  private hook!: Img;
  private rope!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private hudKey = '';
  private phaseKey = '';
  private round = 0;
  private suddenShown = false;
  private fxSeen = 0;
  private clock = new Countdown();
  private juice!: Juice;
  private cheerRound = 0;
  private waveOn = false;

  constructor() {
    super('wackel');
  }

  create() {
    this.latest = null;
    this.dolls.clear();
    this.plats = [];
    this.builtStage = '';
    this.bg = null;
    this.hudKey = '';
    this.phaseKey = '';
    this.round = 0;
    this.suddenShown = false;
    this.fxSeen = 0;
    this.cheerRound = 0;
    this.waveOn = false;
    this.juice = new Juice(this, { depth: 1650 });

    this.water = this.add.rectangle(0, WACKEL.SEA_Y, WORLD.W, WORLD.H - WACKEL.SEA_Y, 0x2b6ba6, 0.45).setOrigin(0, 0).setDepth(60);
    this.foam = this.add.rectangle(0, WACKEL.SEA_Y, WORLD.W, 2, 0xeaf8ff, 0.8).setOrigin(0, 0).setDepth(61);
    this.wave = this.add.image(-200, 0, ensureTex(this, 'wk_wave', A.wackelWavePix)).setOrigin(0.5, 1).setDepth(58).setVisible(false);
    this.hook = this.add.image(-50, -50, ensureTex(this, 'wk_hook', A.wackelHookPix)).setOrigin(0.5, 0.78).setDepth(40).setVisible(false);
    this.rope = this.add.graphics().setDepth(39);
    this.hud = this.add.container(0, 0).setDepth(2000);
    this.banner = txt(this, WORLD.W / 2, 92, '', { size: 16, color: '#ffd25e' }).setDepth(2001);
    this.sub = txt(this, WORLD.W / 2, 116, '', { size: 8, wrap: 420 }).setDepth(2001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Aufbau

  private buildStage(st: WackelState) {
    if (this.builtStage === st.stage) return;
    this.builtStage = st.stage;
    const stage = wackelStage(st.stage);
    this.bg?.destroy();
    this.bg = this.add.image(0, 0, ensureTex(this, `wk_bg_${st.stage}`, () => A.wackelBackdrop(st.stage))).setOrigin(0, 0).setDepth(-1000);
    for (const { img } of this.plats) img.destroy();
    this.plats = [];
    for (const p of stage.platforms) {
      let img: Img;
      switch (p.kind) {
        case 'deck':
          img = this.add.image(p.x, p.y, ensureTex(this, `wk_deck_${p.w}`, () => A.wackelDeckPix(p.w, p.h, WACKEL.SEA_Y + 8 - p.y - p.h))).setOrigin(0, 0).setDepth(2);
          break;
        case 'low':
          img = this.add.image(p.x, p.y, ensureTex(this, `wk_low_${p.w}`, () => A.wackelLowPix(p.w, p.h))).setOrigin(0, 0).setDepth(1);
          break;
        case 'high': {
          const below = stage.platforms.find((q) => q.kind === 'deck');
          const postsTo = below ? below.y - p.y - p.h : 30;
          img = this.add.image(p.x, p.y - 12, ensureTex(this, `wk_high_${p.w}`, () => A.wackelHighPix(p.w, p.h, postsTo))).setOrigin(0, 0).setDepth(3);
          break;
        }
        case 'boat':
          img = this.add.image(p.x + p.w / 2, p.y + p.h / 2, ensureTex(this, `wk_boat_${p.w}`, () => A.wackelBoatPix(p.w, p.h))).setOrigin(0.5, p.h / 2 / (p.h + 44)).setDepth(2);
          break;
        default: {
          const deck = stage.platforms.find((q) => q.kind === 'boat');
          const nest = deck && p.y < deck.y - 20;
          img = nest
            ? this.add.image(p.x + p.w / 2, p.y, ensureTex(this, `wk_nest_${p.w}`, () => A.wackelNestPix(p.w, p.h, deck!.y - p.y - p.h + 6))).setOrigin(0.5, 0).setDepth(1)
            : this.add.image(p.x, p.y, ensureTex(this, `wk_crate_${p.w}`, () => A.wackelCratePix(p.w, p.h))).setOrigin(0, 0).setDepth(1);
        }
      }
      this.plats.push({ p, img });
    }
    this.hook.setVisible(stage.hazard === 'hook');
    this.rope.clear();
  }

  private ensureDoll(id: string, p: WackelPlayer): Doll | null {
    let d = this.dolls.get(id);
    if (d) return d;
    const pl = playerById(id);
    if (!pl) return null;
    const shirt = SHIRTS[pl.look.shirt] ?? '#ffffff';
    const skin = SKINS[pl.look.skin] ?? SKINS[0];
    const torso = ensureTex(this, `wk_torso_${pl.look.shirt}`, () => A.wackelTorsoPix(shirt));
    const arm = ensureTex(this, `wk_arm_${pl.look.shirt}_${pl.look.skin}`, () => A.wackelArmPix(shirt, skin));
    const leg = ensureTex(this, 'wk_leg', A.wackelLegPix);
    const head = ensurePortrait(this, pl.look);
    const imgs = [
      this.add.image(0, 0, torso),
      this.add.image(0, 0, head).setOrigin(0.5, 0.62),
      this.add.image(0, 0, arm).setOrigin(0.5, 0.5),
      this.add.image(0, 0, arm).setOrigin(0.5, 0.5),
      this.add.image(0, 0, leg).setOrigin(0.5, 0.5),
      this.add.image(0, 0, leg).setOrigin(0.5, 0.5),
    ];
    const idx = this.dolls.size;
    DRAW_ORDER.forEach((part, k) => imgs[part].setDepth(10 + idx * 0.1 + k * 0.01));
    const dizzy = this.add.image(0, 0, ensureTex(this, 'wk_dizzy', A.wackelDizzyPix)).setOrigin(0.5, 0.62).setDepth(10 + idx * 0.1 + 0.06).setVisible(false);
    const swim = this.add.container(p.x, p.y).setDepth(62).setVisible(false);
    swim.add(this.add.image(0, -1, head).setOrigin(0.5, 1));
    swim.add(this.add.image(0, 3, ensureTex(this, `sumo_ring_${shirt}`, () => sumoRing(shirt))).setOrigin(0.5, 1));
    d = { id, imgs, dizzy, swim, pose: p.parts.length === 18 ? [...p.parts] : [], alive: p.alive, stun: p.stun, color: shirt };
    this.dolls.set(id, d);
    return d;
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st || this.juice.frozen) return;
    const now = this.time.now;
    for (const [id, p] of Object.entries(st.players)) {
      const d = this.dolls.get(id);
      if (!d) continue;
      if (!d.alive) {
        d.swim.setY(p.y + Math.sin(now / 320 + p.x) * 1.2);
        continue;
      }
      if (p.parts.length !== 18) continue;
      if (d.pose.length !== 18) d.pose = [...p.parts];
      for (let i = 0; i < 18; i++) {
        if (i % 3 === 2) {
          // Winkel auf kürzestem Weg
          let diff = p.parts[i] - d.pose[i];
          diff = ((((diff + 180) % 360) + 360) % 360) - 180;
          d.pose[i] += diff * 0.5;
        } else d.pose[i] += (p.parts[i] - d.pose[i]) * 0.5;
      }
      for (let k = 0; k < 6; k++) {
        const img = d.imgs[k];
        img.setPosition(d.pose[k * 3], d.pose[k * 3 + 1]).setAngle(d.pose[k * 3 + 2]);
        if (k === 1) {
          img.setFlipX(p.f < 0);
          d.dizzy.setPosition(img.x, img.y).setAngle(img.angle).setFlipX(p.f < 0).setVisible(p.stun);
        }
      }
      // Beim Festhalten leicht zittern
      if (p.held) d.imgs[1].setX(d.imgs[1].x + Math.sin(now / 30) * 0.7);
    }
    // Wasser
    const seaY = st.sea;
    this.water.setY(seaY).setSize(WORLD.W, Math.max(0, WORLD.H - seaY));
    this.foam.setY(seaY - 1 + Math.sin(now / 400));
    // Welle
    if (st.wave) {
      this.wave.setVisible(true).setPosition(st.wave[0], seaY + 4).setFlipX(st.wave[1] < 0);
      if (!this.waveOn) {
        this.waveOn = true;
        sfx('whoosh', { x: st.wave[0], vol: 0.8, pitch: 0.6 });
      }
      if (st.wave[0] > -40 && st.wave[0] < 520 && Math.random() < 0.25) this.juice.burst(st.wave[0] + st.wave[1] * 20, seaY - 14, 'splash', 2);
    } else {
      this.wave.setVisible(false);
      this.waveOn = false;
    }
    // Kutter schaukelt, Haken pendelt
    for (const { p, img } of this.plats) if (p.rock) img.setAngle(st.tilt / 10);
    if (st.hook) {
      const stage = wackelStage(st.stage);
      this.hook.setPosition(st.hook[0], st.hook[1]);
      this.rope.clear();
      if (stage.hookPivot) {
        this.rope.lineStyle(1, 0x5c6168, 1);
        this.rope.lineBetween(stage.hookPivot.x, stage.hookPivot.y, st.hook[0], st.hook[1] - 8);
      }
    }
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
  }

  // ---------------------------------------------------------------- Zustand

  private resetRound(st: WackelState) {
    this.suddenShown = false;
    for (const [id, p] of Object.entries(st.players)) {
      const d = this.ensureDoll(id, p);
      if (!d) continue;
      d.alive = p.alive;
      d.stun = false;
      d.pose = p.parts.length === 18 ? [...p.parts] : [];
      for (const img of d.imgs) img.setVisible(p.alive).setAlpha(1);
      d.dizzy.setVisible(false);
      d.swim.setVisible(false);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'wackel') return;
    const st = s.mini.state;
    this.latest = st;
    this.buildStage(st);
    if (st.round !== this.round) {
      this.round = st.round;
      this.resetRound(st);
    }
    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clock.set(st.endsIn);
      this.onPhase(st);
    }
    for (const [id, p] of Object.entries(st.players)) {
      const d = this.ensureDoll(id, p);
      if (!d) continue;
      if (d.alive && !p.alive) {
        d.alive = false;
        this.platsch(d, p);
      }
    }
    for (const f of st.fx) {
      if (f.seq <= this.fxSeen) continue;
      this.fxSeen = f.seq;
      this.effect(f);
    }
    if (st.sudden && !this.suddenShown) {
      this.suddenShown = true;
      this.flash('DAS WASSER STEIGT!', 'Hoch mit euch – oder platsch!');
      sfx('whistle', { vol: 0.8 });
      sfx('splash', { vol: 0.8, pitch: 0.6, delay: 0.15 });
      this.juice.shake(2);
      say('Das Wasser steigt!');
    }
    this.drawHud(st);
  }

  private onPhase(st: WackelState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1);
    this.sub.setAlpha(1);
    const stage = wackelStage(st.stage);
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`Runde ${st.round} – ${stage.name}\nSchubst, haut, werft die anderen ins Meer! ${st.winRounds} Rundensiege gewinnen.`);
    } else if (st.sub === 'play') {
      this.flash('LOS!', 'Joystick torkeln · HAUEN · GREIFEN halten & werfen');
    } else if (st.sub === 'roundOver' || st.sub === 'over') {
      const w = st.roundWinner ? playerById(st.roundWinner)?.name ?? '?' : null;
      this.banner.setText(w ? `${w} gewinnt!` : 'Alle im Wasser!');
      if (this.cheerRound !== st.round) {
        this.cheerRound = st.round;
        sfx(w ? 'win' : 'lose');
        const wd = st.roundWinner ? this.dolls.get(st.roundWinner) : undefined;
        if (wd && wd.pose.length === 18) this.juice.burst(wd.pose[0], wd.pose[1] - 14, 'confetti', 30);
        if (w) say(`${spokenName(w)} gewinnt die Runde!`);
      }
      this.sub.setText(st.sub === 'over' ? 'Wackel-Prügelei vorbei!' : w ? 'Rundensieg – als Letzte(r) noch trocken!' : 'Unentschieden – diese Runde zählt nicht.');
    }
  }

  private flash(text: string, sub: string) {
    this.banner.setText(text).setAlpha(1);
    this.sub.setText(sub).setAlpha(1);
    this.tweens.add({
      targets: [this.banner, this.sub],
      alpha: 0,
      delay: 1100,
      duration: 400,
      onComplete: () => {
        this.banner.setText('').setAlpha(1);
        this.sub.setText('').setAlpha(1);
      },
    });
  }

  // ---------------------------------------------------------------- Effekte

  private effect(f: WackelFx) {
    switch (f.type) {
      case 'hit':
        this.stars(f.x, f.y, 3);
        this.juice.burst(f.x, f.y, 'spark', 5);
        this.juice.shake(1);
        sfx('hit', { x: f.x });
        break;
      case 'hook':
        this.stars(f.x, f.y, 4);
        this.juice.burst(f.x, f.y, 'spark', 8);
        this.juice.shake(2);
        sfx('hitHard', { x: f.x, pitch: 0.8 });
        break;
      case 'head': {
        this.stars(f.x, f.y, 6);
        this.juice.burst(f.x, f.y, 'spark', 10);
        this.juice.shake(2);
        this.juice.hitStop(60);
        sfx('bonk', { x: f.x });
        this.juice.float(f.x, f.y - 14, 'BONK!', 'gold');
        break;
      }
      case 'grab': {
        const ring = this.add.circle(f.x, f.y, 3, 0xffffff, 0).setStrokeStyle(1, 0xfff4d6).setDepth(1600);
        this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
        sfx('catch', { x: f.x, vol: 0.5 });
        break;
      }
      case 'throw':
        for (let i = 0; i < 3; i++) {
          const l = this.add.rectangle(f.x, f.y - 6 + i * 5, 8, 1, 0xffffff, 0.9).setDepth(1500);
          this.tweens.add({ targets: l, x: f.x - 16, alpha: 0, duration: 280, delay: i * 30, onComplete: () => l.destroy() });
        }
        this.juice.burst(f.x, f.y, 'puff', 6);
        sfx('throw', { x: f.x });
        break;
      case 'platsch':
        break;
    }
  }

  private stars(x: number, y: number, n: number) {
    const key = ensureTex(this, 'wk_star', () => A.wackelStarPix());
    for (let i = 0; i < n; i++) {
      const s = this.add.image(x, y, key).setDepth(1600);
      const a = (i / n) * Math.PI * 2 + Math.random();
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 10 - 6, angle: 180, alpha: 0, duration: 420, onComplete: () => s.destroy() });
    }
  }

  private ripple(x: number, y: number, s = 1) {
    const e = this.add.ellipse(x, y, 8 * s, 3 * s).setStrokeStyle(1, 0xeaf8ff, 0.9).setDepth(63);
    this.tweens.add({ targets: e, scaleX: 3, scaleY: 3, alpha: 0, duration: 650, onComplete: () => e.destroy() });
  }

  private platsch(d: Doll, p: WackelPlayer) {
    const x = p.x;
    const y = p.y;
    for (const img of d.imgs) img.setVisible(false);
    d.dizzy.setVisible(false);
    d.swim.setPosition(x, y).setVisible(true).setAlpha(0).setScale(0.6);
    this.tweens.add({ targets: d.swim, alpha: 1, scale: 1, duration: 320, delay: 250, ease: 'Back.out' });
    for (let i = 0; i < 12; i++) {
      const dot = this.add.circle(x, y, i % 3 ? 2 : 3, i % 2 ? 0xeaf8ff : 0x93d3f3).setDepth(1600);
      const ang = (i / 12) * Math.PI * 2;
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(ang) * (14 + (i % 3) * 5),
        y: y + Math.sin(ang) * 6 - 16 - (i % 4) * 3,
        alpha: 0,
        duration: 520,
        ease: 'Quad.out',
        onComplete: () => dot.destroy(),
      });
    }
    this.ripple(x, y + 2, 1.3);
    this.time.delayedCall(180, () => this.ripple(x, y + 2, 1));
    this.juice.burst(x, y, 'splash', 16);
    this.juice.shake(2);
    sfx('splash', { x });
    const name = playerById(d.id)?.name ?? '';
    const ty = Math.max(48, y - 40);
    const t = txt(this, x, ty, 'PLATSCH!', { color: '#93d3f3' }).setDepth(1700);
    const n = txt(this, x, ty + 10, name.slice(0, 10)).setDepth(1700);
    this.tweens.add({ targets: [t, n], y: '-=12', alpha: 0, delay: 700, duration: 900, onComplete: () => (t.destroy(), n.destroy()) });
  }

  private drawHud(st: WackelState) {
    const ids = Object.keys(st.players);
    const secs = st.sub === 'play' ? Math.ceil(st.endsIn / 1000) : -1;
    const key = JSON.stringify([secs, st.sub, st.round, st.sudden, ids.map((id) => [st.players[id].alive, st.players[id].wins, st.players[id].outs])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 1, 476, 32));
    const clock = secs >= 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '--';
    this.hud.add(ink(this, 10, 6, `Runde ${st.round}`, { origin: [0, 0] }));
    this.hud.add(ink(this, 10, 19, st.sudden ? `FLUT ${clock}` : clock, { origin: [0, 0], color: st.sudden ? '#a8342a' : undefined }));
    const n = ids.length;
    const slot = Math.min(44, Math.floor(360 / Math.max(1, n)));
    const x0 = 110 + (360 - slot * n) / 2;
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const p = st.players[id];
      if (!pl) return;
      const cx = x0 + i * slot + slot / 2;
      this.hud.add(this.add.image(cx, 4, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(p.alive ? 1 : 0.35));
      if (!p.alive && st.sub !== 'countdown') this.hud.add(ink(this, cx, 7, 'x', { color: '#2d64a8' }));
      for (let w = 0; w < st.winRounds; w++) {
        this.hud.add(this.add.rectangle(cx - (st.winRounds - 1) * 3 + w * 6, 24, 4, 4, w < p.wins ? 0xffd25e : 0x000000, w < p.wins ? 1 : 0.2));
      }
      if (p.outs) this.hud.add(ink(this, cx + 10, 18, `${p.outs}`, { color: '#a8342a' }));
    });
  }
}
