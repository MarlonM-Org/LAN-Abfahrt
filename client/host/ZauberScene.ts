import Phaser from 'phaser';
import type { GameState, ZauberFx, ZauberState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { ZAUBER, type ZauberArena, zauberArena, zauberTile, zauberTileX, zauberTileY } from '../../shared/zauber';
import { SHIRTS } from '../../shared/avatar';
import { paintZauberLava, zauberBolt, zauberGlow, zauberPuffIcon, zauberStone, zauberWizard } from '../art/zauber';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, background, ensureTex, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const T = ZAUBER.TILE;
const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Zauberer stehen über den Kacheln (Kachel-Tiefe = Reihe 0…18) */
const figDepth = (y: number) => 100 + y;
const BOLT_DEPTH = 900;

interface Fig {
  root: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  aim: Phaser.GameObjects.Graphics;
  bar: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  color: string;
  tex: string;
  ghostAt: number;
  smokeAt: number;
  barKey: string;
}

interface BoltView {
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  a: number;
  trailAt: number;
  color: number;
}

/** Zauber-Arena (TV): Steinplattform im Lavasee, die vom Rand her zerbröckelt */
export class ZauberScene extends Phaser.Scene {
  private tiles = new Map<number, Phaser.GameObjects.Image>();
  private figs = new Map<string, Fig>();
  private bolts = new Map<number, BoltView>();
  private arena: ZauberArena | null = null;
  private arenaKey = '';
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private juice!: Juice;
  private sub!: Phaser.GameObjects.Text;
  private latest: ZauberState | null = null;
  private recvAt = 0;
  private hudKey = '';
  private phaseKey = '';
  private fxSeen = 0;
  private suddenShown = false;
  private clock = new Countdown();

  constructor() {
    super('zauber');
  }

  create() {
    this.juice = new Juice(this, { depth: 1690 });
    this.tiles.clear();
    this.figs.clear();
    this.bolts.clear();
    this.arena = null;
    this.arenaKey = '';
    this.latest = null;
    this.hudKey = '';
    this.phaseKey = '';
    this.fxSeen = 0;
    this.suddenShown = false;

    background(this, 'zauber', WORLD.W, WORLD.H, (p) => paintZauberLava(p, WORLD.W, WORLD.H));
    // Lava lebt: pulsierende Glut, Blasen und aufsteigende Funken
    const glowTex = ensureTex(this, 'zb_glow_lava', () => zauberGlow('#ff8a2a', 16));
    for (let i = 0; i < 16; i++) {
      const g = this.add.image(15 + ((i * 131) % 450), 50 + ((i * 71) % 215), glowTex).setDepth(-900).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.25).setScale(1.5 + (i % 3) * 0.6);
      this.tweens.add({ targets: g, alpha: 0.6, duration: 1300 + (i % 5) * 260, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 140 });
    }
    this.time.addEvent({ delay: 170, loop: true, callback: () => this.bubble() });
    this.time.addEvent({ delay: 120, loop: true, callback: () => this.ember() });

    this.hud = this.add.container(0, 0).setDepth(2000);
    this.banner = txt(this, WORLD.W / 2, 112, '', { size: 16, color: '#ffd25e' }).setDepth(2001);
    this.sub = txt(this, WORLD.W / 2, 136, '', { size: 8 }).setDepth(2001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a || !a.alive) continue;
      const ox = a.x;
      const oy = a.y;
      a.x += (p.x - a.x) * 0.5;
      a.y += (p.y - a.y) * 0.5;
      const moving = Math.hypot(a.x - ox, a.y - oy) > 0.15;
      const ax = Math.cos((p.a * Math.PI) / 180);
      const ay = Math.sin((p.a * Math.PI) / 180);
      a.img.setFlipX(ax < -0.15);
      if (p.stun) a.img.setAngle(Math.sin(now / 35) * 16).setY(0);
      else a.img.setAngle(p.sprint ? (ax < 0 ? -10 : 10) : 0).setY(moving ? -Math.abs(Math.sin(now / 80)) * 1.5 : Math.sin(now / 400) * 0.6);
      // In der Lava: glüht rot und qualmt
      if (p.lava) a.img.setTint(Math.floor(now / 90) % 2 ? 0xff6a3a : 0xffb08a);
      else a.img.clearTint();
      a.root.setPosition(a.x, a.y).setDepth(figDepth(a.y));
      a.ring.setPosition(a.x, a.y);
      // Zielrichtung: drei Punkte vor den Füßen
      a.aim.clear();
      if (st.sub === 'play' || st.sub === 'countdown') {
        const ready = p.cdA <= 0;
        a.aim.fillStyle(hexNum(a.color), ready ? 1 : 0.4);
        for (let k = 0; k < 3; k++) {
          const d = 11 + k * 5;
          const s = k === 2 ? 3 : 2;
          a.aim.fillRect(Math.round(a.x + ax * d - s / 2), Math.round(a.y - 2 + ay * d * 0.8 - s / 2), s, s);
        }
      }
      a.aim.setDepth(figDepth(a.y) - 1);
      if (p.sprint && now - a.ghostAt > 55) {
        a.ghostAt = now;
        this.ghost(a);
      }
      if (p.lava && now - a.smokeAt > 90) {
        a.smokeAt = now;
        this.smoke(a.x + Phaser.Math.Between(-4, 4), a.y - 4);
      }
      this.drawBar(a, p.hp, p.lava);
    }
    // Feuerbälle: vom letzten Snapshot aus weiterfliegen lassen
    const dt = Math.min(0.08, (performance.now() - this.recvAt) / 1000);
    for (const b of this.bolts.values()) {
      const rad = (b.a * Math.PI) / 180;
      const tx = b.x + Math.cos(rad) * ZAUBER.BOLT_SPEED * dt;
      const ty = b.y + Math.sin(rad) * ZAUBER.BOLT_SPEED * dt;
      const ix = b.img.x + (tx - b.img.x) * 0.6;
      const iy = b.img.y + (ty - b.img.y) * 0.6;
      b.img.setPosition(ix, iy).setAngle(now / 3);
      b.glow.setPosition(ix, iy).setScale(1 + Math.sin(now / 60) * 0.12);
      if (now - b.trailAt > 30) {
        b.trailAt = now;
        this.trail(ix, iy, b.color);
      }
    }
    // Kacheln mit Rissen blinken
    const blink = Math.floor(now / 130) % 2 === 0;
    for (const img of this.tiles.values()) if (img.getData('cracked')) img.setTint(blink ? 0xff9a6a : 0xffe0c8);
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
  }

  // ---------------------------------------------------------------- Zustand

  private buildArena(st: ZauberState) {
    for (const img of this.tiles.values()) img.destroy();
    this.tiles.clear();
    this.suddenShown = false;
    const arena = zauberArena(st.seed, st.n);
    this.arena = arena;
    for (const i of arena.order) {
      const c = i % ZAUBER.COLS;
      const r = Math.floor(i / ZAUBER.COLS);
      const v = (c * 7 + r * 13 + ((c * r) % 5)) % 37 === 0 ? 5 : (c * 3 + r) % 4;
      const img = this.add.image(zauberTileX(c), zauberTileY(r), ensureTex(this, `zb_stone${v}`, () => zauberStone(v))).setOrigin(0, 0).setDepth(r);
      img.setData('v', v);
      this.tiles.set(i, img);
    }
  }

  private ensureFigs(st: ZauberState) {
    for (const [id, p] of Object.entries(st.players)) {
      let a = this.figs.get(id);
      if (!a) {
        const pl = playerById(id);
        if (!pl) continue;
        const color = SHIRTS[pl.look.shirt] ?? '#9b5fc0';
        const headKey = ensurePortrait(this, pl.look);
        const tex = ensureTex(this, `zb_wiz_${headKey}`, () => zauberWizard(color, this.textures.get(headKey).getSourceImage() as HTMLCanvasElement));
        const root = this.add.container(p.x, p.y);
        root.add(this.add.ellipse(0, 0, 14, 5, 0x000000, 0.3));
        const img = this.add.image(0, 1, tex).setOrigin(0.5, 1);
        root.add(img);
        const ring = this.add.ellipse(p.x, p.y, 16, 6).setStrokeStyle(1, hexNum(color)).setDepth(60);
        const aim = this.add.graphics();
        const bar = this.add.graphics();
        root.add(bar);
        a = { root, img, ring, aim, bar, x: p.x, y: p.y, alive: true, hp: p.hp, color, tex, ghostAt: 0, smokeAt: 0, barKey: '' };
        this.figs.set(id, a);
      }
    }
  }

  private resetRound(st: ZauberState) {
    this.buildArena(st);
    this.ensureFigs(st);
    for (const b of this.bolts.values()) (b.img.destroy(), b.glow.destroy());
    this.bolts.clear();
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      this.tweens.killTweensOf([a.root, a.img]);
      a.x = p.x;
      a.y = p.y;
      a.alive = p.alive;
      a.hp = p.hp;
      a.barKey = '';
      a.root.setVisible(p.alive).setAlpha(1).setScale(1).setPosition(p.x, p.y);
      a.img.setAngle(0).clearTint();
      a.ring.setVisible(p.alive).setPosition(p.x, p.y);
      a.aim.clear().setVisible(p.alive);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'zauber') return;
    const st = s.mini.state;
    this.latest = st;
    this.recvAt = performance.now();
    const aKey = `${st.round}-${st.seed}-${st.n}`;
    if (aKey !== this.arenaKey) {
      this.arenaKey = aKey;
      this.resetRound(st);
    }
    this.ensureFigs(st);
    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clock.set(st.endsIn);
      this.onPhase(st);
    }

    // Kacheln: Risse und Versinken
    if (this.arena) {
      for (const [i, img] of this.tiles) {
        const t = zauberTile(this.arena, i, st.cracked, st.fallen);
        const v = img.getData('v') as number;
        if (t === '!' && !img.getData('cracked')) {
          img.setData('cracked', true);
          img.setTexture(ensureTex(this, `zb_stone${v}c`, () => zauberStone(v, true)));
          const x0 = img.x;
          this.tweens.add({ targets: img, x: x0 + 1, duration: 55, yoyo: true, repeat: -1 });
        } else if (t === '.') {
          this.tiles.delete(i);
          this.tweens.killTweensOf(img);
          img.setTint(0xff7a3a);
          this.tweens.add({ targets: img, y: img.y + 5, alpha: 0, duration: 480, ease: 'Quad.in', onComplete: () => img.destroy() });
          this.sizzle(img.x + T / 2, img.y + T / 2);
          sfx('crack', { x: img.x, pitch: 0.6, vol: 0.25 });
        }
      }
    }

    // Feuerbälle
    const live = new Set(st.bolts.map((b) => b.id));
    for (const [id, b] of this.bolts) {
      if (live.has(id)) continue;
      b.img.destroy();
      b.glow.destroy();
      this.bolts.delete(id);
    }
    for (const b of st.bolts) {
      let v = this.bolts.get(b.id);
      if (!v) {
        const owner = this.figs.get(b.o);
        const color = hexNum(owner?.color ?? '#f0973a');
        const img = this.add.image(b.x, b.y, ensureTex(this, 'zb_bolt', zauberBolt)).setDepth(BOLT_DEPTH + 1);
        const glow = this.add.image(b.x, b.y, ensureTex(this, 'zb_glow_bolt', () => zauberGlow('#ff9a3a', 10))).setDepth(BOLT_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
        v = { img, glow, x: b.x, y: b.y, a: b.a, trailAt: 0, color };
        this.bolts.set(b.id, v);
        if (owner) this.castFlash(b.x, b.y, owner.color);
        sfx('shoot', { x: b.x, pitch: 0.8, vol: 0.55 });
      }
      v.x = b.x;
      v.y = b.y;
      v.a = b.a;
    }

    // Effekte (nur neue)
    for (const f of st.fx) {
      if (f.seq <= this.fxSeen) continue;
      this.fxSeen = f.seq;
      this.playFx(f, st);
    }

    // Zauberer: verpufft?
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      if (a.alive && !p.alive) {
        a.alive = false;
        a.x = p.x;
        a.y = p.y;
        this.puff(a, id);
      }
      a.hp = p.hp;
    }

    if (st.sudden && !this.suddenShown) {
      this.suddenShown = true;
      this.flash('EINSTURZ!', 'Die letzte Insel zerfällt …');
      this.juice.shake(3);
      sfx('boom', { pitch: 0.6 });
      sfx('drumroll', { delay: 0.3 });
    }
    this.drawHud(st);
  }

  private onPhase(st: ZauberState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1);
    this.sub.setAlpha(1);
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`Runde ${st.round} – schleudert alle in die Lava!\nWer zuerst ${st.winRounds} Runden gewinnt, ist Erzmagier.`);
    } else if (st.sub === 'play') {
      this.flash('LOS!', 'ANGRIFF = Zielsuch-Feuerball · EILE = Sprint');
    } else if (st.sub === 'roundOver' || st.sub === 'over') {
      sfx(st.sub === 'over' ? 'fanfare' : st.roundWinner ? 'win' : 'lose');
      if (st.roundWinner) this.juice.burst(WORLD.W / 2, 100, 'confetti', 40);
      const w = st.roundWinner ? playerById(st.roundWinner)?.name ?? '?' : null;
      this.banner.setText(w ? `${w} gewinnt!` : 'Alle verpufft!');
      this.sub.setText(st.sub === 'over' ? 'Zauber-Arena vorbei!' : w ? 'Rundensieg – als Letzte(r) übrig!' : 'Unentschieden – diese Runde zählt nicht.');
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

  private playFx(f: ZauberFx, st: ZauberState) {
    if (f.type === 'hit') {
      this.boom(f.x, f.y, 1);
      const dmg = txt(this, f.x, f.y - 16, `-${ZAUBER.BOLT_DMG}`, { color: '#ffd25e' }).setDepth(1700);
      this.tweens.add({ targets: dmg, y: dmg.y - 12, alpha: 0, duration: 700, delay: 150, onComplete: () => dmg.destroy() });
      const a = f.id ? this.figs.get(f.id) : undefined;
      if (a) {
        a.img.setTintFill(0xffffff);
        this.time.delayedCall(70, () => a.img.clearTint());
      }
      this.juice.shake(1);
      this.juice.hitStop(45);
      this.juice.burst(f.x, f.y, 'fire', 10);
      sfx('boom', { x: f.x, vol: 0.6, pitch: 1.3 });
      sfx('hit', { x: f.x, delay: 0.02 });
    } else if (f.type === 'clash') {
      this.boom(f.x, f.y, 0.8, 0xc79bff);
      this.juice.burst(f.x, f.y, 'spark', 12);
      sfx('crack', { x: f.x, pitch: 1.4 });
    } else if (f.type === 'fizzle') {
      this.smoke(f.x, f.y);
      this.smoke(f.x + 2, f.y - 1);
      sfx('pop', { x: f.x, pitch: 0.6, vol: 0.4 });

    } else if (f.type === 'puff' && f.by && st.players[f.by]) {
      const killer = playerById(f.by)?.name ?? '';
      if (killer) {
        const t = txt(this, f.x, Math.max(48, f.y - 52), `+1 K.O. für ${killer.replace(/^Bot\s+/, '').slice(0, 10)}`, { color: '#c79bff' }).setDepth(1700);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, delay: 900, duration: 700, onComplete: () => t.destroy() });
      }
    }
  }

  private boom(x: number, y: number, s: number, color = 0xffb040) {
    const ring = this.add.circle(x, y, 4 * s).setStrokeStyle(2, color, 1).setDepth(1600);
    this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
    const core = this.add.circle(x, y, 5 * s, 0xfff4b0, 1).setDepth(1601).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: core, scale: 0.2, alpha: 0, duration: 260, onComplete: () => core.destroy() });
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      const d = this.add.rectangle(x, y, 2, 2, i % 3 ? color : 0xfff4b0).setDepth(1600);
      this.tweens.add({ targets: d, x: x + Math.cos(ang) * (12 + Math.random() * 10) * s, y: y + Math.sin(ang) * (9 + Math.random() * 8) * s, alpha: 0, duration: 380, ease: 'Quad.out', onComplete: () => d.destroy() });
    }
  }

  private castFlash(x: number, y: number, color: string) {
    const r = this.add.circle(x, y, 3).setStrokeStyle(1, hexNum(color), 1).setDepth(BOLT_DEPTH + 2);
    this.tweens.add({ targets: r, scale: 2.6, alpha: 0, duration: 220, onComplete: () => r.destroy() });
  }

  private trail(x: number, y: number, color: number) {
    const d = this.add.circle(x + Phaser.Math.Between(-1, 1), y + Phaser.Math.Between(-1, 1), 2.2, Math.random() < 0.5 ? 0xf0973a : color, 0.9).setDepth(BOLT_DEPTH - 1);
    this.tweens.add({ targets: d, scale: 0.2, alpha: 0, y: y - 3, duration: 320, onComplete: () => d.destroy() });
  }

  private ghost(a: Fig) {
    const g = this.add.image(a.x, a.y + 1, a.tex).setOrigin(0.5, 1).setFlipX(a.img.flipX).setAlpha(0.5).setTintFill(hexNum(a.color)).setDepth(figDepth(a.y) - 2);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private smoke(x: number, y: number) {
    const d = this.add.circle(x, y, 2, Math.random() < 0.5 ? 0x5a4a5a : 0x7a6a72, 0.8).setDepth(1500);
    this.tweens.add({ targets: d, y: y - 10, scale: 2.2, alpha: 0, duration: 520, onComplete: () => d.destroy() });
  }

  private sizzle(x: number, y: number) {
    for (let i = 0; i < 3; i++) {
      const d = this.add.circle(x + Phaser.Math.Between(-4, 4), y + Phaser.Math.Between(-3, 3), 1.5, i ? 0xffb040 : 0xfff4b0).setDepth(55);
      this.tweens.add({ targets: d, y: d.y - 6 - i * 2, alpha: 0, duration: 420 + i * 80, onComplete: () => d.destroy() });
    }
  }

  private bubble() {
    const x = Phaser.Math.Between(8, 472);
    const y = Phaser.Math.Between(42, 266);
    // Nur dort, wo keine Kachel liegt
    if (this.arena) {
      const c = Math.floor((x - ZAUBER.OX) / T);
      const r = Math.floor((y - ZAUBER.OY) / T);
      if (c >= 0 && r >= 0 && c < ZAUBER.COLS && r < ZAUBER.ROWS && this.tiles.has(r * ZAUBER.COLS + c)) return;
    }
    const b = this.add.circle(x, y, 1.5, 0xffd25e).setDepth(-800).setStrokeStyle(1, 0xc8410f);
    this.tweens.add({
      targets: b,
      scale: 2.2,
      duration: 500,
      ease: 'Quad.out',
      onComplete: () => {
        b.destroy();
        const pop = this.add.circle(x, y, 3).setStrokeStyle(1, 0xffd25e, 0.9).setDepth(-800);
        this.tweens.add({ targets: pop, scale: 2, alpha: 0, duration: 260, onComplete: () => pop.destroy() });
      },
    });
  }

  private ember() {
    const x = Phaser.Math.Between(0, 480);
    const e = this.add.rectangle(x, 272, 1, 1, Math.random() < 0.5 ? 0xffd25e : 0xf0973a).setDepth(1400).setAlpha(0.9);
    this.tweens.add({ targets: e, y: Phaser.Math.Between(150, 230), x: x + Phaser.Math.Between(-14, 14), alpha: 0, duration: Phaser.Math.Between(1600, 2600), onComplete: () => e.destroy() });
  }

  /** „Verpufft!“ – lila Rauchwolke, Sternchen, Zauberer schrumpft weg */
  private puff(a: Fig, id: string) {
    const x = a.x;
    const y = a.y - 10;
    a.ring.setVisible(false);
    a.aim.clear().setVisible(false);
    // In die Lava geschleudert: Zischen + Puff
    sfx('ko', { x });
    sfx('splash', { x, pitch: 0.5, vol: 0.6, delay: 0.05 });
    this.juice.hitStop(80);
    this.tweens.killTweensOf([a.root, a.img]);
    this.tweens.add({ targets: a.root, scaleX: 1.3, scaleY: 0.2, alpha: 0, duration: 260, ease: 'Back.in', onComplete: () => a.root.setVisible(false).setScale(1).setAlpha(1) });
    const cols = [0x9b5fc0, 0xc79bff, 0xb9a6cf, 0x7a5a9a];
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const c = this.add.circle(x, y, 3 + (i % 3), cols[i % cols.length], 0.95).setDepth(1650);
      this.tweens.add({
        targets: c,
        x: x + Math.cos(ang) * (10 + (i % 4) * 3),
        y: y + Math.sin(ang) * 7 - 4,
        scale: 1.8,
        alpha: 0,
        duration: 600 + (i % 3) * 120,
        ease: 'Quad.out',
        onComplete: () => c.destroy(),
      });
    }
    for (let i = 0; i < 5; i++) {
      const s = this.add.star(x, y, 4, 1, 3, 0xffd25e).setDepth(1660);
      const ang = -Math.PI / 2 + (i - 2) * 0.5;
      this.tweens.add({ targets: s, x: x + Math.cos(ang) * 20, y: y + Math.sin(ang) * 18, angle: 180, alpha: 0, duration: 650, onComplete: () => s.destroy() });
    }
    const icon = this.add.image(x, y, ensureTex(this, 'zb_puff', zauberPuffIcon)).setDepth(1655).setScale(2);
    this.tweens.add({ targets: icon, y: y - 14, scale: 3, alpha: 0, duration: 800, onComplete: () => icon.destroy() });
    this.cameras.main.shake(110, 0.004);
    const name = playerById(id)?.name ?? '';
    const ty = Math.max(48, y - 30);
    const t = txt(this, x, ty, 'VERPUFFT!', { color: '#c79bff' }).setDepth(1700);
    const n = txt(this, x, ty + 10, name.slice(0, 10)).setDepth(1700);
    this.tweens.add({ targets: [t, n], y: '-=12', alpha: 0, delay: 800, duration: 900, onComplete: () => (t.destroy(), n.destroy()) });
  }

  private drawBar(a: Fig, hp: number, lava: boolean) {
    const key = `${hp}-${lava}`;
    if (key === a.barKey) return;
    a.barKey = key;
    const g = a.bar;
    g.clear();
    const w = 16;
    const f = Math.max(0, Math.min(1, hp / ZAUBER.HP));
    g.fillStyle(0x2d1b12, 1).fillRect(-w / 2 - 1, -40, w + 2, 4);
    g.fillStyle(f > 0.5 ? 0x46b04a : f > 0.25 ? 0xf2c33a : 0xe04a3f, 1).fillRect(-w / 2, -39, Math.ceil(w * f), 2);
    if (lava) g.fillStyle(0xff7a3a, 1).fillRect(-w / 2 + Math.ceil(w * f) - 1, -39, 1, 2);
  }

  private drawHud(st: ZauberState) {
    const ids = Object.keys(st.players);
    const secs = st.sub === 'play' && !st.sudden ? Math.ceil(st.endsIn / 1000) : -1;
    const key = JSON.stringify([secs, st.sub, st.round, st.sudden, ids.map((id) => [st.players[id].alive, st.players[id].wins, Math.ceil(st.players[id].hp / 10)])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 1, 476, 33, 'dark'));
    const clock = st.sudden ? 'EINSTURZ!' : secs >= 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '--';
    this.hud.add(txt(this, 10, 7, `Runde ${st.round}`, { origin: [0, 0], color: '#c79bff' }));
    this.hud.add(txt(this, 10, 20, clock, { origin: [0, 0], color: st.sudden ? '#ff7a3a' : '#fff4d6' }));
    const n = ids.length;
    const slot = Math.min(32, Math.floor(372 / Math.max(1, n)));
    const x0 = 100 + (372 - slot * n) / 2;
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const p = st.players[id];
      if (!pl) return;
      const cx = x0 + i * slot + slot / 2;
      const out = !p.alive && st.sub !== 'countdown';
      const pt = this.add.image(cx, 4, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(out ? 0.35 : 1);
      this.hud.add(pt);
      if (out) this.hud.add(this.add.image(cx, 12, ensureTex(this, 'zb_puff', zauberPuffIcon)));
      // Lebensbalken
      const f = Math.max(0, Math.min(1, p.hp / ZAUBER.HP));
      this.hud.add(this.add.rectangle(cx - 8, 20, 16, 3, 0x000000, 0.5).setOrigin(0, 0));
      if (f > 0) this.hud.add(this.add.rectangle(cx - 8, 20, Math.ceil(16 * f), 3, f > 0.5 ? 0x46b04a : f > 0.25 ? 0xf2c33a : 0xe04a3f).setOrigin(0, 0));
      for (let w = 0; w < st.winRounds; w++) {
        this.hud.add(this.add.rectangle(cx - (st.winRounds - 1) * 3 + w * 6, 28, 4, 4, w < p.wins ? 0xffd25e : 0x000000, w < p.wins ? 1 : 0.35));
      }
    });
  }
}
