import Phaser from 'phaser';
import type { BogenFx, BogenPlayer, BogenState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { BOGEN, BOGEN_COLORS, BOGEN_POWERS, BOGEN_STAGES, bogenDx, bogenDy, bogenWrapX, bogenWrapY } from '../../shared/bogen';
import { arrowPix, bogenBackdrop, bowPix, chestPix, quiverIconPix } from '../art/bogen';
import { sumoRing } from '../art/sumo';
import { bus, getState, playerById } from './store';
import { ensureAvatar, ensurePortrait } from './textures';
import { Countdown, ensureTex, txt } from './ui';

type C = Phaser.GameObjects.Container;
const AY = BOGEN.AY;
const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Höhe des Avatar-Sprites (16 × 27) */
const SPR_H = 27;

interface Fig {
  root: C;
  img: Phaser.GameObjects.Image;
  bow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  alive: boolean;
  color: string;
  shots: number;
  shotAt: number;
  trailAt: number;
  pipKey: string;
}

/**
 * Bogen-Arena (TV): Arena mit Wrap an allen Rändern. Zusätzliche Kameras zeigen alles,
 * was über einen Rand ragt, auf der gegenüberliegenden Seite noch einmal.
 */
export class BogenScene extends Phaser.Scene {
  private latest: BogenState | null = null;
  private recvAt = 0;
  private stageShown = -1;
  private bg!: Phaser.GameObjects.Image;
  private bgL!: C;
  private itemL!: C;
  private actL!: C;
  private fxL!: C;
  private hud!: C;
  private cardsL!: C;
  private figs = new Map<string, Fig>();
  private arrowImgs = new Map<number, Phaser.GameObjects.Image>();
  private chestImg: Phaser.GameObjects.Image | null = null;
  private chestKey = '';
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private fxSeen = -1;
  private phaseKey = '';
  private hudKey = '';
  private clock = new Countdown();

  constructor() {
    super('bogen');
  }

  create() {
    this.latest = null;
    this.stageShown = -1;
    this.figs.clear();
    this.arrowImgs.clear();
    this.chestImg = null;
    this.chestKey = '';
    this.fxSeen = -1;
    this.phaseKey = '';
    this.hudKey = '';

    this.bgL = this.add.container(0, 0).setDepth(0);
    this.itemL = this.add.container(0, 0).setDepth(5);
    this.actL = this.add.container(0, 0).setDepth(10);
    this.fxL = this.add.container(0, 0).setDepth(20);
    this.hud = this.add.container(0, 0).setDepth(100);
    this.bg = this.add.image(0, 0, '__WHITE').setOrigin(0, 0);
    this.bgL.add(this.bg);

    // HUD-Leiste oben
    const bar = this.add.graphics();
    bar.fillStyle(0x2d1b12, 1).fillRect(0, 0, WORLD.W, AY);
    bar.fillStyle(0x5e3518, 1).fillRect(0, AY - 2, WORLD.W, 1);
    this.hud.add(bar);
    this.cardsL = this.add.container(0, 0);
    this.hud.add(this.cardsL);
    this.banner = txt(this, WORLD.W / 2, 92, '', { size: 24, color: '#ffd25e' });
    this.sub = txt(this, WORLD.W / 2, 124, '', { size: 8 });
    this.timer = txt(this, WORLD.W / 2, AY + 4, '', { size: 16, color: '#e04a3f' });
    this.hud.add([this.banner, this.sub, this.timer]);

    // Wrap-Kameras: Arena-Ausschnitt, verschoben um eine Arena-Breite/-Höhe
    this.cameras.main.setRoundPixels(true);
    for (const [sx, sy] of [[BOGEN.AW, AY], [-BOGEN.AW, AY], [0, AY + BOGEN.AH], [0, AY - BOGEN.AH]]) {
      const cam = this.cameras.add(0, AY, BOGEN.AW, BOGEN.AH).setScroll(sx, sy).setRoundPixels(true);
      cam.ignore([this.bgL, this.hud]);
    }

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'bogen') return;
    const st = s.mini.state;
    this.latest = st;
    this.recvAt = performance.now();
    if (st.stage !== this.stageShown) {
      this.stageShown = st.stage;
      this.bg.setTexture(ensureTex(this, `bogen_bg_${st.stage}`, () => bogenBackdrop(st.stage)));
    }
    const ids = Object.keys(st.players);
    ids.forEach((id, i) => this.ensureFig(id, i));

    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clock.set(st.endsIn);
      this.onPhase(st);
    }

    // Pfeile
    const live = new Set(st.arrows.map((a) => a.id));
    for (const [id, img] of this.arrowImgs) if (!live.has(id)) (img.destroy(), this.arrowImgs.delete(id));
    for (const a of st.arrows) {
      if (this.arrowImgs.has(a.id)) continue;
      const img = this.add.image(a.x, AY + a.y, ensureTex(this, `bogen_arrow_${a.bomb ? 'b' : 'n'}`, () => arrowPix(a.bomb))).setOrigin(1, 0.5);
      this.itemL.add(img);
      this.arrowImgs.set(a.id, img);
    }

    // Schatztruhe
    const ck = st.chest ? `${st.chest.x},${st.chest.y}` : '';
    if (ck !== this.chestKey) {
      this.chestKey = ck;
      this.chestImg?.destroy();
      this.chestImg = null;
      if (st.chest) {
        const img = this.add.image(st.chest.x, AY + st.chest.y, ensureTex(this, 'bogen_chest', chestPix)).setOrigin(0.5, 1);
        this.itemL.add(img);
        img.setScale(0.2);
        this.tweens.add({ targets: img, scale: 1, duration: 300, ease: 'Back.Out' });
        this.chestImg = img;
        this.sparkle(st.chest.x, AY + st.chest.y - 6, 0xffd25e);
      }
    }

    // Effekte
    const maxSeq = st.fx.reduce((m, f) => Math.max(m, f.seq), 0);
    if (this.fxSeen < 0) this.fxSeen = maxSeq;
    for (const fx of st.fx) if (fx.seq > this.fxSeen) this.playFx(fx);
    this.fxSeen = Math.max(this.fxSeen, maxSeq);

    // Figuren an/aus
    for (const [id, p] of Object.entries(st.players)) {
      const g = this.figs.get(id);
      if (!g) continue;
      if (p.alive && !g.alive) {
        g.x = p.x;
        g.y = p.y;
      }
      g.alive = p.alive;
      g.root.setVisible(p.alive);
    }
    this.drawHud(st);
  }

  private onPhase(st: BogenState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1).setScale(1);
    this.sub.setAlpha(1);
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`Runde ${st.round} · ${BOGEN_STAGES[st.stage].name}\nEin Treffer – und du bist raus!`);
    } else if (st.sub === 'play') {
      this.pop('LOS!', 'Pfeile einsammeln nicht vergessen!');
    } else if (st.sub === 'roundOver') {
      const w = st.roundWinner ? (playerById(st.roundWinner)?.name ?? '?') : null;
      this.banner.setText(w ? `${w}\ngewinnt!` : 'Unentschieden!').setScale(w && w.length > 10 ? 0.67 : 1);
      this.sub.setY(w ? 148 : 124).setText(w ? 'Letzte(r) im Spiel – Rundensieg!' : 'Keiner übrig – diese Runde zählt nicht.');
      if (st.roundWinner) {
        const g = this.figs.get(st.roundWinner);
        if (g) this.sparkle(g.x, AY + g.y - 14, 0xffd25e);
      }
    } else if (st.sub === 'over') {
      this.banner.setText('SPIEL!').setScale(1);
      this.sub.setY(124).setText('Bogen-Arena vorbei!');
    }
    if (st.sub !== 'roundOver') this.sub.setY(124);
  }

  private pop(text: string, sub: string) {
    this.banner.setText(text).setAlpha(1).setScale(1.5);
    this.sub.setText(sub).setAlpha(1);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 250, ease: 'Back.Out' });
    this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, delay: 900, duration: 300 });
  }

  private ensureFig(id: string, idx: number) {
    let g = this.figs.get(id);
    if (g) return g;
    const pl = playerById(id);
    const color = BOGEN_COLORS[idx % BOGEN_COLORS.length];
    const root = this.add.container(0, 0).setVisible(false);
    const img = this.add.image(0, 0, pl ? ensureAvatar(this, pl.look) : '__WHITE').setOrigin(0.5, 1);
    const ring = this.add.image(0, -8, ensureTex(this, 'bogen_ring', () => sumoRing('#e0503f'))).setVisible(false);
    const bow = this.add.image(0, -12, ensureTex(this, 'bogen_bow', bowPix)).setOrigin(0.5, 0.5);
    const pips = this.add.graphics();
    root.add([img, bow, ring, pips]);
    this.actL.add(root);
    g = { root, img, bow, ring, pips, x: 0, y: 0, alive: false, color, shots: 0, shotAt: 0, trailAt: 0, pipKey: '' };
    this.figs.set(id, g);
    return g;
  }

  // ---------------------------------------------------------------- Bild für Bild

  update(time: number) {
    const st = this.latest;
    if (!st) return;
    const age = st.sub === 'play' ? Math.min(0.06, (performance.now() - this.recvAt) / 1000) : 0;
    for (const [id, p] of Object.entries(st.players)) this.updateFig(id, p, age, time);
    for (const a of st.arrows) {
      const img = this.arrowImgs.get(a.id);
      if (!img) continue;
      if (a.s === 0) {
        img.setPosition(bogenWrapX(a.x + a.vx * age), AY + bogenWrapY(a.y + a.vy * age)).setRotation(Math.atan2(a.vy, a.vx));
      } else if (a.s === 2 && (a.vx || a.vy)) {
        img.setPosition(a.x + a.vx * age, AY + a.y + a.vy * age).setAngle(img.angle + 14);
      } else {
        img.setPosition(a.x, AY + a.y).setAngle(a.a);
        // liegende Pfeile: Spitze leicht über dem Boden
        if (a.s === 2) img.setPosition(a.x + (a.a === 180 ? -7 : 7), AY + a.y);
      }
    }
    if (this.chestImg) this.chestImg.setY(AY + (st.chest?.y ?? 0) + Math.round(Math.sin(time / 260)) * 1);
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
    const secs = Math.ceil(this.clock.remaining / 1000);
    this.timer.setText(st.sub === 'play' && secs <= 10 ? String(secs) : '');
  }

  private updateFig(id: string, p: BogenPlayer, age: number, time: number) {
    const g = this.figs.get(id);
    if (!g || !p.alive) return;
    const tx = bogenWrapX(p.x + p.vx * age);
    const ty = bogenWrapY(p.y + (p.ground ? 0 : p.vy * age));
    const dx = bogenDx(g.x, tx);
    const dy = bogenDy(g.y, ty);
    if (Math.hypot(dx, dy) > 40) {
      g.x = tx;
      g.y = ty;
    } else {
      g.x = bogenWrapX(g.x + dx * 0.55);
      g.y = bogenWrapY(g.y + dy * 0.55);
    }
    g.root.setPosition(Math.round(g.x), Math.round(AY + g.y));

    const img = g.img;
    img.setFlipX(p.f < 0).setAngle(0).setScale(1).setY(0).setX(0);
    g.root.setAlpha(p.inv ? (Math.floor(time / 70) % 2 ? 0.35 : 0.9) : 1);
    if (p.dash) {
      g.root.setAlpha(0.75);
      if (time - g.trailAt > 30) {
        g.trailAt = time;
        const ghost = this.add.image(g.root.x, g.root.y, img.texture.key).setOrigin(0.5, 1).setFlipX(p.f < 0).setTintFill(0xffffff).setAlpha(0.6);
        this.fxL.add(ghost);
        this.tweens.add({ targets: ghost, alpha: 0, duration: 220, onComplete: () => ghost.destroy() });
      }
    } else if (p.wall) {
      img.setAngle(-p.wall * 8).setX(p.wall * 1);
    } else if (!p.ground) {
      img.setScale(p.vy < 0 ? 0.92 : 1.04, p.vy < 0 ? 1.08 : 0.96);
    } else if (Math.abs(p.vx) > 20) {
      img.setY(-Math.abs(Math.sin(time / 65)) * 2).setAngle(p.f * 5);
    }

    // Bogen in Zielrichtung
    const deg = p.aim >= 0 ? p.aim * 45 : p.f > 0 ? 0 : 180;
    const rad = Phaser.Math.DegToRad(deg);
    if (p.shots !== g.shots) {
      if (g.shots) g.shotAt = time;
      g.shots = p.shots;
    }
    const recoil = time - g.shotAt < 120 ? -2 : 0;
    g.bow.setPosition(Math.round(Math.cos(rad) * (6 + recoil)), Math.round(-12 + Math.sin(rad) * (6 + recoil))).setRotation(rad);
    g.ring.setVisible(p.shield).setY(-8 + Math.round(Math.sin(time / 200)));

    // Pfeile über dem Kopf
    const pipKey = `${p.arrows}-${p.bombs}-${p.double}`;
    if (pipKey !== g.pipKey) {
      g.pipKey = pipKey;
      const gr = g.pips;
      gr.clear();
      const n = p.arrows;
      const x0 = -Math.round((n * 3 - 1) / 2);
      const y0 = -SPR_H - 8;
      for (let i = 0; i < n; i++) {
        gr.fillStyle(0x2d1b12, 1).fillRect(x0 + i * 3 - 1, y0 - 1, 3, 7);
        const c = i < p.bombs ? 0x3f8fe0 : hexNum(g.color);
        gr.fillStyle(c, 1).fillRect(x0 + i * 3, y0, 1, 5);
      }
      if (!n) {
        // leerer Köcher: kleines Kreuz
        gr.lineStyle(1, 0xa7a39a, 1).lineBetween(-2, y0, 2, y0 + 4).lineBetween(2, y0, -2, y0 + 4);
      }
      if (p.double > 0) {
        gr.fillStyle(0xffd25e, 1).fillRect(x0 + n * 3 + 1, y0, 2, 2).fillRect(x0 + n * 3 + 1, y0 + 3, 2, 2);
      }
    }
  }

  // ---------------------------------------------------------------- HUD

  private drawHud(st: BogenState) {
    const ids = Object.keys(st.players);
    const key = JSON.stringify(ids.map((id) => {
      const p = st.players[id];
      return [p.alive, p.arrows, p.bombs, p.shield, p.wins];
    })) + st.sub;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.cardsL.removeAll(true);
    const n = ids.length;
    const cw = Math.min(120, Math.floor(WORLD.W / Math.max(1, n)));
    const x0 = Math.floor((WORLD.W - n * cw) / 2);
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const p = st.players[id];
      const color = hexNum(BOGEN_COLORS[i % BOGEN_COLORS.length]);
      const x = x0 + i * cw;
      const out = !p.alive && st.sub !== 'countdown';
      const card = this.add.container(x, 0).setAlpha(out ? 0.45 : 1);
      const bg = this.add.graphics();
      bg.fillStyle(0x3d2414, 1).fillRect(1, 1, cw - 2, AY - 4);
      bg.fillStyle(color, 1).fillRect(1, 1, 2, AY - 4);
      card.add(bg);
      if (pl) {
        const pt = this.add.image(5, 2, ensurePortrait(this, pl.look)).setOrigin(0, 0);
        if (out) pt.setTint(0x6e6a62);
        card.add(pt);
      }
      if (p.shield) card.add(this.add.image(13, 14, ensureTex(this, 'bogen_ring', () => sumoRing('#e0503f'))).setScale(0.6));
      if (out) {
        const xg = this.add.graphics();
        xg.lineStyle(2, 0xe04a3f, 1).lineBetween(5, 3, 21, 17).lineBetween(21, 3, 5, 17);
        card.add(xg);
      }
      // Köcher
      card.add(this.add.image(24, 4, ensureTex(this, `bogen_q_${p.bombs > 0 ? 'b' : 'n'}`, () => quiverIconPix(p.bombs > 0))).setOrigin(0, 0));
      card.add(txt(this, 30, 6, String(p.arrows), { origin: [0, 0], color: p.arrows ? '#fff4d6' : '#a7a39a' }));
      // Rundensiege
      const pipX = cw - 4 - st.winRounds * 5;
      for (let w = 0; w < st.winRounds; w++) {
        const r = this.add.rectangle(pipX + w * 5, 7, 4, 4, w < p.wins ? 0xffd25e : 0x000000, w < p.wins ? 1 : 0.35).setOrigin(0, 0);
        card.add(r);
      }
      // Name (nur bei breiten Karten)
      if (cw >= 90 && pl) card.add(txt(this, 40, 6, pl.name.replace(/^Bot\s+/, '').slice(0, Math.floor((pipX - 44) / 8)), { origin: [0, 0], color: BOGEN_COLORS[i % BOGEN_COLORS.length] }));
      this.cardsL.add(card);
    });
  }

  // ---------------------------------------------------------------- Effekte

  private playFx(fx: BogenFx) {
    const x = fx.x;
    const y = AY + fx.y;
    const name = fx.id ? (playerById(fx.id)?.name ?? '') : '';
    switch (fx.type) {
      case 'hit':
      case 'stomp': {
        this.puff(x, y);
        const label = fx.type === 'stomp' ? 'Kopftreffer!' : fx.by === fx.id ? 'Eigentor!' : 'getroffen!';
        this.floatText(x, y - 22, label, '#ffd25e');
        if (name) this.floatText(x, y - 12, name.replace(/^Bot\s+/, 'Bot ').slice(0, 10), '#fff4d6');
        this.cameras.main.shake(120, 0.005);
        break;
      }
      case 'boom': {
        const c = this.add.circle(x, y, 8, 0x7fd4ff, 0.8);
        this.fxL.add(c);
        this.tweens.add({ targets: c, scale: BOGEN.BOMB_R / 8, alpha: 0, duration: 320, onComplete: () => c.destroy() });
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const d = this.add.rectangle(x, y, 3, 3, i % 2 ? 0x3f8fe0 : 0xbfe6f7);
          this.fxL.add(d);
          this.tweens.add({ targets: d, x: x + Math.cos(a) * BOGEN.BOMB_R, y: y + Math.sin(a) * BOGEN.BOMB_R * 0.8 + 6, alpha: 0, duration: 460, onComplete: () => d.destroy() });
        }
        this.floatText(x, y - 16, 'PLATSCH!', '#7fd4ff');
        this.cameras.main.shake(180, 0.008);
        break;
      }
      case 'catch':
        this.floatText(x, y - 20, 'Gefangen!', '#9ad65a');
        this.sparkle(x, y, 0x9ad65a);
        break;
      case 'shield': {
        const r = this.add.circle(x, y, 10, 0xffffff, 0).setStrokeStyle(2, 0xe0503f, 1);
        this.fxL.add(r);
        this.tweens.add({ targets: r, scale: 2, alpha: 0, duration: 300, onComplete: () => r.destroy() });
        this.floatText(x, y - 20, 'Schild!', '#f08a7e');
        break;
      }
      case 'chest': {
        const power = fx.power ? BOGEN_POWERS[fx.power].name : '';
        this.sparkle(x, y - 6, 0xffd25e);
        this.floatText(x, y - 26, power, '#ffd25e');
        break;
      }
      case 'pickup': {
        const t = txt(this, x, y - 10, '+1', { color: '#fff4d6' });
        this.fxL.add(t);
        this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 500, onComplete: () => t.destroy() });
        break;
      }
    }
  }

  /** Comic-Wölkchen beim Treffer (kein Blut – nur Puff!) */
  private puff(x: number, y: number) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const c = this.add.circle(x, y, 3 + (i % 3), 0xf4efe2, 1).setStrokeStyle(1, 0x2d1b12, 0.6);
      this.fxL.add(c);
      this.tweens.add({ targets: c, x: x + Math.cos(a) * 12, y: y + Math.sin(a) * 9, scale: 1.8, alpha: 0, duration: 420, ease: 'Quad.Out', onComplete: () => c.destroy() });
    }
    const star = this.add.star(x, y, 6, 3, 8, 0xffd25e).setStrokeStyle(1, 0x2d1b12);
    this.fxL.add(star);
    this.tweens.add({ targets: star, scale: 1.6, angle: 90, alpha: 0, duration: 380, onComplete: () => star.destroy() });
  }

  private sparkle(x: number, y: number, color: number) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = this.add.rectangle(x, y, 2, 2, color);
      this.fxL.add(d);
      this.tweens.add({ targets: d, x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 10, alpha: 0, duration: 450, onComplete: () => d.destroy() });
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = txt(this, Phaser.Math.Clamp(x, 36, WORLD.W - 36), Math.max(AY + 2, y), text, { color });
    this.fxL.add(t);
    this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, delay: 500, duration: 600, onComplete: () => t.destroy() });
  }
}
