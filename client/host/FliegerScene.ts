import Phaser from 'phaser';
import type { FliegerState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import { Pix } from '../art/pix';
import { paintSky, paintWater } from '../art/ground';
import { cloud, island, plane } from '../art/flieger';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { RED_INK, backPlate, ensureTex, ink, panel, txt } from './ui';

const SEA_Y = 196;
const PLANE_X = 180;
const PLANE_Y = 132;
const BAR_X = 88;
const BAR_W = 190;

/**
 * Urlaubsflieger auf dem TV: Flieger über Meer und Wolken, Strecke + Treibstoff,
 * Etappen-Route und Laufschrift. Anweisungen werden hier NIE gezeigt – die stehen nur auf den Handys.
 */
export class FliegerScene extends Phaser.Scene {
  private plane!: Phaser.GameObjects.Image;
  private sea!: Phaser.GameObjects.TileSprite;
  private clouds: { img: Phaser.GameObjects.Image; speed: number }[] = [];
  private isle!: Phaser.GameObjects.Image;
  private bars!: Phaser.GameObjects.Graphics;
  private stageText!: Phaser.GameObjects.Text;
  private progText!: Phaser.GameObjects.Text;
  private fuelText!: Phaser.GameObjects.Text;
  private destText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private ticker!: Phaser.GameObjects.Text;
  private crew!: Phaser.GameObjects.Container;
  private latest: FliegerState | null = null;
  private lastSub = '';
  private lastStage = -1;
  private tickerSeq = -1;
  private crewKey = '';
  private shown = { progress: 0, fuel: 100 };
  private crashT = 0;
  private trailT = 0;
  private shake = 0;

  constructor() {
    super('flieger');
  }

  create() {
    this.clouds = [];
    this.latest = null;
    this.lastSub = '';
    this.lastStage = -1;
    this.tickerSeq = -1;
    this.crewKey = '';
    this.shown = { progress: 0, fuel: 100 };
    this.crashT = 0;
    this.trailT = 0;
    this.shake = 0;

    this.add.image(0, 0, ensureTex(this, 'bg_flieger_sky', () => {
      const p = new Pix(WORLD.W, SEA_Y);
      paintSky(p, 0, 0, WORLD.W, SEA_Y, ['#4ea6e6', '#7cc4f0', '#b4e2f8', '#fde3b4']);
      // Ferne Sonne
      p.disc(400, 150, 18, '#ffe9a8').disc(400, 150, 14, '#ffd25e');
      return p;
    })).setOrigin(0, 0).setDepth(-100);
    ensureTex(this, 'flieger_sea', () => {
      const p = new Pix(WORLD.W, WORLD.H - SEA_Y);
      paintWater(p, 0, 0, WORLD.W, WORLD.H - SEA_Y, 91);
      p.hline(0, 0, WORLD.W, C.foam);
      return p;
    });
    this.sea = this.add.tileSprite(0, SEA_Y, WORLD.W, WORLD.H - SEA_Y, 'flieger_sea').setOrigin(0, 0).setDepth(-90);

    for (let i = 0; i < 7; i++) {
      const img = this.add.image(Math.random() * WORLD.W, 56 + Math.random() * 120, ensureTex(this, `fl_cloud_${i % 4}`, () => cloud(i % 4)));
      const near = i % 3 === 0;
      img.setDepth(near ? 20 : -50).setAlpha(near ? 0.85 : 1).setScale(near ? 1.2 : 0.8);
      this.clouds.push({ img, speed: near ? 46 : 16 + Math.random() * 10 });
    }
    this.isle = this.add.image(-200, SEA_Y + 12, ensureTex(this, 'fl_island', island)).setOrigin(0.5, 1).setDepth(-80);
    this.plane = this.add.image(PLANE_X, PLANE_Y, ensureTex(this, 'fl_plane', plane)).setDepth(10).setScale(1.5);

    // HUD
    panel(this, 4, 2, 472, 50);
    this.stageText = ink(this, 12, 8, '', { origin: [0, 0] });
    ink(this, 12, 22, 'STRECKE', { origin: [0, 0] });
    ink(this, 12, 36, 'SPRIT', { origin: [0, 0] });
    this.bars = this.add.graphics().setDepth(5);
    this.progText = ink(this, BAR_X + BAR_W + 8, 22, '', { origin: [0, 0] });
    this.fuelText = ink(this, BAR_X + BAR_W + 8, 36, '', { origin: [0, 0] });
    this.destText = ink(this, 400, 36, '', { origin: [0.5, 0] });

    this.banner = txt(this, WORLD.W / 2, 58, '', { size: 24, color: C.gold }).setDepth(50);
    this.sub = txt(this, WORLD.W / 2, 86, '', { wrap: 420 }).setDepth(50);
    // Dunkle Plakette, damit Intro-/Etappentexte über Flugzeug und Wolken lesbar bleiben
    backPlate(this, [this.banner, this.sub], 49);
    this.add.rectangle(0, WORLD.H - 16, WORLD.W, 16, 0x2d1b12, 0.75).setOrigin(0, 0).setDepth(40);
    this.ticker = txt(this, WORLD.W / 2, WORLD.H - 12, '', {}).setDepth(41);
    this.crew = this.add.container(0, 0).setDepth(30);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update(time: number, delta: number) {
    const s = this.latest;
    if (!s) return;
    const dt = delta / 1000;
    const speed = s.sub === 'fly' ? 60 : s.sub === 'intro' ? 45 : s.sub === 'crash' ? 0 : 20;
    this.sea.tilePositionX += speed * dt;
    for (const c of this.clouds) {
      c.img.x -= c.speed * dt * (speed / 60 + 0.15);
      if (c.img.x < -50) {
        c.img.x = WORLD.W + 50;
        c.img.y = 56 + Math.random() * 120;
      }
    }

    // Insel bei Zwischenlandung/Ankunft heranholen, sonst wegscrollen
    const isleTarget = s.sub === 'cleared' || s.sub === 'arrived' ? PLANE_X + 90 : -120;
    if (s.sub === 'cleared' || s.sub === 'arrived') this.isle.x += (isleTarget - this.isle.x) * Math.min(1, dt * 1.2);
    else if (this.isle.x > -120) this.isle.x -= speed * dt;

    if (s.sub === 'crash') {
      this.crashT += dt;
      this.plane.setAngle(Math.min(55, this.plane.angle + dt * 50));
      this.plane.x += dt * 30;
      this.plane.y = Math.min(SEA_Y + 6, this.plane.y + dt * (30 + this.crashT * 70));
      if (this.plane.y >= SEA_Y + 6 && this.plane.visible) {
        this.plane.setVisible(false);
        this.splash(this.plane.x, SEA_Y + 4);
      }
      if (this.plane.visible && time - this.trailT > 80) {
        this.trailT = time;
        this.puff(this.plane.x - 30, this.plane.y - 6, 0x4b4b4b);
      }
      return;
    }
    const descent = s.sub === 'cleared' || s.sub === 'arrived' ? 34 : 0;
    const targetX = s.sub === 'arrived' ? PLANE_X + 60 : PLANE_X;
    const bob = Math.sin(time / 420) * 3;
    this.plane.x += (targetX - this.plane.x) * Math.min(1, dt * 1.5);
    this.plane.y += (PLANE_Y + descent + bob - this.plane.y) * Math.min(1, dt * 3);
    this.shake = Math.max(0, this.shake - dt);
    this.plane.setAngle(Math.sin(time / 700) * 2 + (descent ? 4 : 0) + (this.shake > 0 ? Math.sin(time / 25) * 8 * this.shake : 0));
    if (time - this.trailT > 110 && s.sub !== 'arrived') {
      this.trailT = time;
      this.puff(this.plane.x - 54, this.plane.y + 4, s.fuel <= 30 ? 0x9a9a9a : 0xffffff);
    }

    // Balken weich nachziehen
    this.shown.progress += (s.progress / Math.max(1, s.target) - this.shown.progress) * Math.min(1, dt * 6);
    this.shown.fuel += (s.fuel - this.shown.fuel) * Math.min(1, dt * 6);
    this.drawBars(s, time);
  }

  private drawBars(s: FliegerState, time: number) {
    const g = this.bars.clear();
    const bar = (y: number, frac: number, color: number) => {
      g.fillStyle(0x2d1b12).fillRect(BAR_X - 2, y - 2, BAR_W + 4, 12);
      g.fillStyle(0xe6c88a).fillRect(BAR_X, y, BAR_W, 8);
      g.fillStyle(color).fillRect(BAR_X, y, Math.round(BAR_W * Math.max(0, Math.min(1, frac))), 8);
      g.fillStyle(0xffffff, 0.35).fillRect(BAR_X, y, Math.round(BAR_W * Math.max(0, Math.min(1, frac))), 2);
    };
    bar(22, this.shown.progress, 0x46b04a);
    const low = s.fuel <= 30;
    bar(36, this.shown.fuel / 100, low ? (Math.floor(time / 250) % 2 ? 0xe04a3f : 0xf0973a) : 0xf0973a);

    // Route: Punkte für alle Stopps, kleiner Flieger an der aktuellen Position
    const n = s.route.length;
    const x0 = 340;
    const x1 = 462;
    const y = 16;
    g.fillStyle(0x8d5629).fillRect(x0, y - 1, x1 - x0, 2);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / (n - 1);
      const reached = i <= s.stage || (s.sub === 'cleared' && i === s.stage + 1) || s.sub === 'arrived';
      g.fillStyle(0x2d1b12).fillRect(x - 4, y - 4, 8, 8);
      g.fillStyle(reached ? 0x46b04a : 0xfff4d6).fillRect(x - 3, y - 3, 6, 6);
    }
    const legFrac = s.sub === 'cleared' || s.sub === 'arrived' ? 1 : this.shown.progress;
    const px = x0 + ((x1 - x0) * Math.min(n - 1, s.stage + legFrac)) / (n - 1);
    g.fillStyle(0xe04a3f).fillTriangle(px - 4, y - 8, px + 5, y - 5, px - 4, y - 2);
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'flieger') return;
    const s = gs.mini.state;
    this.latest = s;
    const R = s.route;
    const legs = R.length - 1;
    // Kein toUpperCase: die Pixel-Schrift hat kein großes Ü
    this.stageText.setText(`Etappe ${Math.min(legs, s.stage + 1)}/${legs}: ${R[s.stage]} > ${R[s.stage + 1] ?? ''}`);
    this.progText.setText(`${Math.min(s.progress, s.target)}/${s.target}`);
    this.fuelText.setText(`${Math.round(s.fuel)}%`).setColor(s.fuel <= 30 ? RED_INK : '#3d2414');
    this.destText.setText(R[Math.min(R.length - 1, s.stage + 1)]);

    if (s.sub !== this.lastSub || s.stage !== this.lastStage) {
      this.lastSub = s.sub;
      this.lastStage = s.stage;
      this.onSub(s);
    }
    if (s.ticker && s.ticker.seq !== this.tickerSeq) {
      const first = this.tickerSeq === -1;
      this.tickerSeq = s.ticker.seq;
      this.ticker.setText(s.ticker.text).setColor(s.ticker.ok ? '#b9f5a0' : '#ff9a8a');
      if (!first) {
        if (s.ticker.ok) {
          const plus = txt(this, this.plane.x + 20, this.plane.y - 30, '+1', { color: '#b9f5a0' }).setDepth(60);
          this.tweens.add({ targets: plus, y: plus.y - 20, alpha: 0, duration: 900, onComplete: () => plus.destroy() });
        } else {
          this.shake = 1;
          this.cameras.main.shake(250, 0.006);
          for (let i = 0; i < 4; i++) this.puff(this.plane.x - 10 + i * 6, this.plane.y - 4, 0x3a3a3a);
        }
      }
    }
    this.drawCrew(gs, s);
  }

  private onSub(s: FliegerState) {
    const R = s.route;
    this.banner.setText('');
    this.sub.setText('');
    switch (s.sub) {
      case 'intro':
        this.plane.setVisible(true);
        if (s.stage === 0) {
          this.banner.setText('ANSCHNALLEN!');
          this.sub.setText('Jedes Handy ist ein Cockpit. Eure Anweisung betrifft meist ein ANDERES Handy – also laut rufen!');
        } else {
          this.banner.setText(`ETAPPE ${s.stage + 1}`);
          this.sub.setText(`Weiter nach ${R[s.stage + 1]}! Neue Cockpits – die Zeit wird knapper.`);
        }
        this.pulse(this.banner);
        break;
      case 'fly':
        break;
      case 'cleared':
        this.banner.setText('ETAPPE GESCHAFFT!');
        this.sub.setText(`Zwischenlandung: ${R[s.stage + 1]}  ·  +Treibstoff`);
        this.pulse(this.banner);
        this.isle.x = WORLD.W + 80;
        break;
      case 'crash':
        this.banner.setText('ABSTURZ!').setColor('#ff7a6a');
        this.sub.setText(s.stage === 0 ? 'Nicht mal Mallorca ...' : `Irgendwo zwischen ${R[s.stage]} und ${R[s.stage + 1]}.`);
        this.pulse(this.banner);
        this.crashT = 0;
        break;
      case 'arrived':
        this.banner.setText('GELANDET!');
        this.sub.setText(`Willkommen auf ${R[R.length - 1]}! Applaus für die Crew!`);
        this.pulse(this.banner);
        this.isle.x = WORLD.W + 80;
        for (let i = 0; i < 24; i++) this.time.delayedCall(i * 60, () => this.confetti());
        break;
    }
    if (s.sub !== 'crash') this.banner.setColor(C.gold);
  }

  /** Crew am unteren Rand: Gesicht + ausgeführte Anweisungen */
  private drawCrew(gs: GameState, s: FliegerState) {
    const ids = Object.keys(s.done);
    const key = JSON.stringify(ids.map((id) => s.done[id]));
    if (key === this.crewKey) return;
    this.crewKey = key;
    this.crew.removeAll(true);
    const w = Math.min(58, (WORLD.W - 16) / Math.max(1, ids.length));
    const x0 = WORLD.W / 2 - (w * ids.length) / 2;
    ids.forEach((id, i) => {
      const p = playerById(id) ?? gs.players.find((pl) => pl.id === id);
      if (!p) return;
      const x = x0 + i * w + w / 2;
      this.crew.add(this.add.rectangle(x, 236, w - 4, 16, 0x2d1b12, 0.55));
      this.crew.add(this.add.image(x - 12, 236, ensurePortrait(this, p.look)));
      this.crew.add(txt(this, x + 8, 232, String(s.done[id]), { color: s.done[id] ? '#b9f5a0' : '#fff4d6' }));
    });
  }

  private pulse(t: Phaser.GameObjects.Text) {
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 450, ease: 'Back.Out' });
  }

  private puff(x: number, y: number, color: number) {
    const c = this.add.rectangle(x, y, 4, 4, color, 0.8).setDepth(9);
    this.tweens.add({ targets: c, x: x - 40, scale: 2.5, alpha: 0, duration: 900, onComplete: () => c.destroy() });
  }

  private splash(x: number, y: number) {
    for (let i = 0; i < 14; i++) {
      const d = this.add.rectangle(x, y, 3, 3, 0xeaf8ff).setDepth(12);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const v = 30 + Math.random() * 40;
      this.tweens.add({ targets: d, x: x + Math.cos(a) * v, y: y + Math.sin(a) * v, alpha: 0, duration: 900, ease: 'Quad.Out', onComplete: () => d.destroy() });
    }
    const ring = this.add.ellipse(x, y + 2, 10, 4).setStrokeStyle(2, 0xeaf8ff).setDepth(11);
    this.tweens.add({ targets: ring, scaleX: 6, scaleY: 3, alpha: 0, duration: 1400, onComplete: () => ring.destroy() });
  }

  private confetti() {
    const colors = [0xe04a3f, 0xffd25e, 0x46b04a, 0x3f8fe0, 0xf07aa8];
    const c = this.add.rectangle(Math.random() * WORLD.W, -4, 3, 3, colors[Math.floor(Math.random() * colors.length)]).setDepth(55);
    this.tweens.add({ targets: c, y: SEA_Y, x: c.x + (Math.random() - 0.5) * 60, angle: 360, duration: 2200 + Math.random() * 800, onComplete: () => c.destroy() });
  }
}

