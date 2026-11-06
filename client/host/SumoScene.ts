import Phaser from 'phaser';
import type { GameState, SumoState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { SUMO, sumoTileX, sumoTileY } from '../../shared/sumo';
import { paintSumoSea, sumoBoat, sumoBuoy, sumoPlank, sumoPost, sumoRing } from '../art/sumo';
import { bus, getState, playerById } from './store';
import { pcol } from './playerColor';
import { ensurePortrait, figure, type Figure } from './textures';
import { Countdown, backPlate, background, ensureTex, ink, panel, txt } from './ui';
import { Juice } from './juice';
import { SnapBuffer, lerpJump } from './interp';
import { sfx } from './sfx';
import { CameraRig } from './camera';
import { cloudShadows, daylight, gulls } from './ambient';

const T = SUMO.TILE;
const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Spieler stehen über den Planken (Planken-Tiefe = Reihe 0…12) */
const figDepth = (y: number) => 100 + y;

interface Fig {
  f: Figure;
  ring: Phaser.GameObjects.Ellipse;
  swim: Phaser.GameObjects.Container;
  x: number;
  y: number;
  alive: boolean;
  dash: boolean;
  hits: number;
  dustAt: number;
  color: string;
}

/** Sumo-Steg: Holzsteg im Meer, der wegbricht – alle schubsen sich ins Wasser */
export class SumoScene extends Phaser.Scene {
  private planks = new Map<number, Phaser.GameObjects.Image>();
  private figs = new Map<string, Fig>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private latest: SumoState | null = null;
  /** Wiedergabe-Uhr (60 ms hinter dem Server), Figuren laufen dazwischen interpoliert */
  private buf = new SnapBuffer<SumoState>();
  private hudKey = '';
  private phaseKey = '';
  private round = 0;
  private suddenShown = false;
  private clock = new Countdown();
  private juice!: Juice;
  private cheerRound = 0;
  private rig!: CameraRig;
  /** Finale: die beiden letzten Spieler, auf die die Kamera zoomt */
  private duel: string[] = [];

  constructor() {
    super('sumo');
  }

  create() {
    this.planks.clear();
    this.figs.clear();
    this.latest = null;
    this.hudKey = '';
    this.phaseKey = '';
    this.round = 0;
    this.suddenShown = false;
    this.cheerRound = 0;
    this.buf = new SnapBuffer();
    this.juice = new Juice(this, { depth: 1650, clock: this.buf });

    background(this, 'sumo', WORLD.W, WORLD.H, (p) => paintSumoSea(p, WORLD.W, WORLD.H));
    // Wellen, die sanft glitzern
    for (let i = 0; i < 14; i++) {
      const x = 10 + ((i * 97) % 460);
      const y = 40 + ((i * 53) % 225);
      const w = this.add.rectangle(x, y, 6 + (i % 3) * 2, 1, 0xeaf8ff, 0.7).setDepth(-900);
      this.tweens.add({ targets: w, x: x + 6, alpha: 0.1, duration: 1400 + (i % 4) * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 120 });
    }
    // Pfähle unter dem Steg (sieht man erst, wenn die Planken weg sind)
    for (let r = 1; r < SUMO.ROWS; r += 3) {
      for (let c = (r % 2) + 1; c < SUMO.COLS; c += 4) {
        this.add.image(sumoTileX(c) + T / 2, sumoTileY(r) + T / 2 + 2, ensureTex(this, 'sumo_post', sumoPost)).setDepth(-5);
      }
    }
    // Deko: Bojen und ein Ruderboot
    const deco: [string, () => import('../art/pix').Pix, number, number][] = [
      ['sumo_buoy', sumoBuoy, 14, 60],
      ['sumo_buoy', sumoBuoy, 466, 236],
      ['sumo_buoy', sumoBuoy, 462, 70],
      ['sumo_boat', sumoBoat, 26, 246],
    ];
    deco.forEach(([key, make, x, y], i) => {
      const img = this.add.image(x, y, ensureTex(this, key, make)).setDepth(-4);
      this.tweens.add({ targets: img, y: y - 1.5, angle: i % 2 ? 3 : -3, duration: 1100 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });

    // Ambient: Möwen, Wolkenschatten auf dem Wasser, Tageszeit (nur das Meer wird eingefärbt)
    gulls(this, { n: 2, y: [40, 230], depth: 1640 });
    cloudShadows(this, { n: 3, y: [40, 240], depth: -890, alpha: 0.06 });
    daylight(this, { depth: -950, strength: 0.7 });

    // Kamera-Regie: im Finale (zwei übrig) auf die beiden zoomen – HUD und Banner bleiben auf der festen HUD-Kamera
    this.rig = new CameraRig(this, { w: WORLD.W, h: WORLD.H, lerp: 0.05 });
    this.duel = [];
    this.rig.hud(() => {
      this.hud = this.add.container(0, 0).setDepth(2000);
      this.banner = txt(this, WORLD.W / 2, 118, '', { size: 16, color: '#ffd25e' }).setDepth(2001);
      this.sub = txt(this, WORLD.W / 2, 142, '', { size: 8 }).setDepth(2001);
      // Dunkle Plakette, damit die Texte über den Figuren lesbar bleiben
      backPlate(this, [this.banner, this.sub], 2000);
    });
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.latest;
    const s = this.buf.sample();
    if (!st || !s) return;
    const now = this.time.now;
    for (const [id, p] of Object.entries(s.b.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      if (!a.alive) {
        // im Schwimmring dümpeln
        a.swim.setY(a.y + Math.sin(now / 320 + a.x) * 1.2);
        continue;
      }
      const ox = a.x;
      const oy = a.y;
      const pa = s.a.players[id] ?? p;
      a.x = lerpJump(pa.x, p.x, s.f, 40);
      a.y = lerpJump(pa.y, p.y, s.f, 40);
      const moving = Math.hypot(a.x - ox, a.y - oy) > 0.15;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(p.f < 0);
      if (p.stun) {
        img.setAngle(Math.sin(now / 40) * 14).setY(0);
        a.f.play('hit');
      } else if (p.dash) {
        img.setAngle(p.f * 14).setY(-1);
        a.f.play('walk', 2);
      } else {
        img.setAngle(0).setY(0);
        a.f.play(moving ? 'walk' : 'idle');
      }
      a.f.setPosition(a.x, a.y + 3).setDepth(figDepth(a.y)).setAlpha(p.away ? 0.4 : 1); // away = Verbindung weg (eingefroren)
      a.ring.setPosition(a.x, a.y + 2);
      // Staubspur beim Sprinten – und beim Weggeschubst-Werden (der Getroffene rutscht sichtbar über die Planken)
      if ((p.dash || p.stun) && now - a.dustAt > 45) {
        a.dustAt = now;
        this.dust(p.stun ? a.x : a.x - p.f * 5, a.y + 2);
      }
    }
    // Knackende Planken blinken rötlich
    const blink = Math.floor(now / 140) % 2 === 0;
    for (const img of this.planks.values()) if (img.getData('cracked')) img.setTint(blink ? 0xff9a80 : 0xffd2b0);
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
  }

  // ---------------------------------------------------------------- Zustand

  private resetRound(st: SumoState) {
    for (const img of this.planks.values()) img.destroy();
    this.planks.clear();
    this.suddenShown = false;
    for (let i = 0; i < st.tiles.length; i++) {
      if (st.tiles[i] === '.') continue;
      const c = i % SUMO.COLS;
      const r = Math.floor(i / SUMO.COLS);
      const v = (c * 7 + r * 3) % 4;
      const img = this.add.image(sumoTileX(c), sumoTileY(r), ensureTex(this, `sumo_plank${v}`, () => sumoPlank(v))).setOrigin(0, 0).setDepth(r);
      img.setData('v', v);
      this.planks.set(i, img);
    }
    for (const [id, p] of Object.entries(st.players)) {
      let a = this.figs.get(id);
      if (!a) {
        const pl = playerById(id);
        if (!pl) continue;
        const color = pcol(id).hex;
        const ring = this.add.ellipse(p.x, p.y + 2, 15, 6).setStrokeStyle(1, hexNum(color)).setDepth(50);
        const f = figure(this, pl.look, p.x, p.y + 3);
        const swim = this.add.container(p.x, p.y).setDepth(60);
        swim.add(this.add.image(0, -1, ensurePortrait(this, pl.look)).setOrigin(0.5, 1));
        swim.add(this.add.image(0, 3, ensureTex(this, `sumo_ring_${color}`, () => sumoRing(color))).setOrigin(0.5, 1));
        a = { f, ring, swim, x: p.x, y: p.y, alive: true, dash: false, hits: p.hits, dustAt: 0, color };
        this.figs.set(id, a);
      }
      a.x = p.x;
      a.y = p.y;
      a.alive = p.alive;
      a.hits = p.hits;
      this.tweens.killTweensOf([a.f, a.swim]);
      a.f.setVisible(p.alive).setAlpha(1).setAngle(0).setScale(1).setPosition(p.x, p.y + 3);
      a.ring.setVisible(p.alive).setPosition(p.x, p.y + 2);
      a.swim.setVisible(false);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'sumo') return;
    const st = s.mini.state;
    this.latest = st;
    this.buf.push(st.t, st);
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

    // Planken: knacken und wegbrechen
    for (const [i, img] of this.planks) {
      const t = st.tiles[i];
      const v = img.getData('v') as number;
      if (t === '!' && !img.getData('cracked')) {
        img.setData('cracked', true);
        img.setTexture(ensureTex(this, `sumo_plank${v}c`, () => sumoPlank(v, true)));
        sfx('crack', { x: img.x + T / 2, vol: 0.6 });
        const x0 = img.x;
        this.tweens.add({ targets: img, x: x0 + 1, duration: 60, yoyo: true, repeat: -1 });
      } else if (t === '.') {
        this.planks.delete(i);
        this.tweens.killTweensOf(img);
        this.tweens.add({
          targets: img,
          y: img.y + 7,
          angle: (i % 2 ? 1 : -1) * 12,
          alpha: 0,
          duration: 420,
          ease: 'Quad.in',
          onComplete: () => img.destroy(),
        });
        this.ripple(img.x + T / 2, img.y + T / 2 + 4, 0.6);
        // Planke bricht: Holzsplitter + kleiner Platscher
        this.juice.burst(img.x + T / 2, img.y + T / 2, 'wood', 7);
        this.juice.burst(img.x + T / 2, img.y + T / 2 + 4, 'splash', 4);
        sfx('crack', { x: img.x + T / 2, pitch: 0.7 });
        sfx('splash', { x: img.x + T / 2, vol: 0.35, pitch: 1.3, delay: 0.12 });
      }
    }

    // Spieler: Rempler, Treffer, Platsch
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      if (p.dash && !a.dash) {
        this.whoosh(a.x, a.y, p.f);
        sfx('whoosh', { x: a.x, vol: 0.7, pitch: 1.3 });
        this.juice.burst(a.x - p.f * 5, a.y + 2, 'sand', 5);
      }
      a.dash = p.dash;
      if (p.hits > a.hits) {
        a.hits = p.hits;
        this.bonk(a.x, a.y - 12);
        sfx('bonk', { x: a.x });
        this.juice.burst(a.x, a.y - 12, 'spark', 6);
      }
      if (!a.alive && p.alive && st.sub === 'play') {
        // Aufwärmrunde: wieder auf dem Steg (Respawn mitten in der Runde)
        a.alive = true;
        a.x = p.x;
        a.y = p.y;
        this.tweens.killTweensOf([a.f, a.swim]);
        a.swim.setVisible(false);
        a.f.setVisible(true).setAlpha(1).setAngle(0).setScale(1).setPosition(p.x, p.y + 3);
        a.ring.setVisible(true).setPosition(p.x, p.y + 2);
        this.juice.burst(p.x, p.y - 6, 'spark', 10);
        sfx('pop', { x: p.x, pitch: 1.3 });
      }
      if (a.alive && !p.alive) {
        a.alive = false;
        a.x = p.x;
        a.y = p.y;
        this.platsch(a, id);
        if (this.duel.includes(id)) {
          // Letzter Rauswurf im Finale: Zeitlupe, Zoom-Stoß, kurz auf dem Platscher bleiben, dann Übersicht
          this.juice.slowMo(0.35, 900);
          this.rig.punch(0.12, 320);
          this.rig.hold(1400);
          this.rig.overview();
          this.duel = [];
        }
      }
    }
    this.direct(st);

    if (st.sudden && !this.suddenShown) {
      this.suddenShown = true;
      this.flash('DER STEG BRICHT!', 'Jetzt zählt jede Planke …');
      sfx('crack', { vol: 1.2, pitch: 0.6 });
      sfx('strike', { vol: 0.6, pitch: 0.6, delay: 0.1 });
      this.cameras.main.shake(300, 0.004);
    }
    this.drawHud(st);
  }

  /** Kamera-Regie: sind nur noch zwei auf dem Steg, fährt die Kamera auf die beiden (Zoom nach Abstand) */
  private direct(st: SumoState) {
    const alive = Object.keys(st.players).filter((id) => st.players[id].alive);
    if (st.sub === 'play' && alive.length === 2) {
      this.duel = alive;
      const [a, b] = alive.map((id) => this.figs.get(id));
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.follow(() => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), Phaser.Math.Clamp(380 / (d + 170), 1.1, 1.6));
    } else if (this.duel.length) {
      this.duel = [];
      this.rig.overview();
    }
  }

  private onPhase(st: SumoState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1);
    this.sub.setAlpha(1);
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`Runde ${st.round} – schubst alle ins Wasser!\nWer zuerst ${st.winRounds} Runden gewinnt, ist Steg-Champion.`);
    } else if (st.sub === 'play') {
      this.flash('LOS!', 'Joystick laufen · REMPELN schubsen');
    } else if (st.sub === 'roundOver' || st.sub === 'over') {
      const w = st.roundWinner ? playerById(st.roundWinner)?.name ?? '?' : null;
      this.banner.setText(w ? `${w} gewinnt!` : 'Alle im Wasser!');
      if (this.cheerRound !== st.round) {
        this.cheerRound = st.round;
        sfx(w ? 'win' : 'lose');
        const wf = st.roundWinner ? this.figs.get(st.roundWinner) : undefined;
        if (wf) this.juice.burst(wf.x, wf.y - 14, 'confetti', 30);
      }
      this.sub.setText(st.sub === 'over' ? 'Sumo-Steg vorbei!' : w ? 'Rundensieg – als Letzte(r) auf dem Steg!' : 'Unentschieden – diese Runde zählt nicht.');
    }
  }

  private flash(text: string, sub: string) {
    this.banner.setText(text).setAlpha(1);
    this.sub.setText(sub).setAlpha(1);
    this.tweens.add({
      targets: [this.banner, this.sub],
      alpha: 0,
      delay: 1000,
      duration: 400,
      onComplete: () => {
        this.banner.setText('').setAlpha(1);
        this.sub.setText('').setAlpha(1);
      },
    });
  }

  // ---------------------------------------------------------------- Effekte

  private dust(x: number, y: number) {
    const d = this.add.circle(x, y, 2, 0xf1d49a, 0.9).setDepth(figDepth(y) - 1);
    this.tweens.add({ targets: d, y: y - 3, scale: 2, alpha: 0, duration: 300, onComplete: () => d.destroy() });
  }

  private whoosh(x: number, y: number, f: number) {
    for (let i = 0; i < 3; i++) {
      const l = this.add.rectangle(x - f * 6, y - 14 + i * 5, 7, 1, 0xffffff, 0.9).setDepth(1500);
      this.tweens.add({ targets: l, x: x - f * 18, alpha: 0, duration: 260, delay: i * 30, onComplete: () => l.destroy() });
    }
  }

  private bonk(x: number, y: number) {
    const star = this.add.star(x, y, 5, 2, 6, 0xffd25e).setStrokeStyle(1, 0x2d1b12).setDepth(1600);
    this.tweens.add({ targets: star, scale: 1.6, angle: 90, alpha: 0, duration: 380, onComplete: () => star.destroy() });
    this.cameras.main.shake(70, 0.003);
  }

  private ripple(x: number, y: number, s = 1) {
    const e = this.add.ellipse(x, y, 8 * s, 3 * s).setStrokeStyle(1, 0xeaf8ff, 0.9).setDepth(55);
    this.tweens.add({ targets: e, scaleX: 3, scaleY: 3, alpha: 0, duration: 650, onComplete: () => e.destroy() });
  }

  private platsch(a: Fig, id: string) {
    const x = a.x;
    const y = a.y;
    a.ring.setVisible(false);
    this.tweens.killTweensOf(a.f);
    // Figur kippt und taucht ein
    this.tweens.add({
      targets: a.f,
      y: a.f.y + 10,
      scaleY: 0.4,
      alpha: 0,
      duration: SUMO.FALL_MS,
      ease: 'Quad.in',
      onComplete: () => {
        a.f.setVisible(false).setScale(1);
        a.swim.setPosition(x, y).setVisible(true).setAlpha(0).setScale(0.6);
        this.tweens.add({ targets: a.swim, alpha: 1, scale: 1, duration: 300, ease: 'Back.out' });
      },
    });
    // Spritzer
    for (let i = 0; i < 12; i++) {
      const d = this.add.circle(x, y, i % 3 ? 2 : 3, i % 2 ? 0xeaf8ff : 0x93d3f3).setDepth(1600);
      const ang = (i / 12) * Math.PI * 2;
      this.tweens.add({
        targets: d,
        x: x + Math.cos(ang) * (14 + (i % 3) * 5),
        y: y + Math.sin(ang) * 6 - 14 - (i % 4) * 3,
        alpha: 0,
        duration: 520,
        ease: 'Quad.out',
        onComplete: () => d.destroy(),
      });
    }
    this.ripple(x, y + 2, 1.3);
    this.time.delayedCall(180, () => this.ripple(x, y + 2, 1));
    this.juice.burst(x, y, 'splash', 16);
    sfx('splash', { x });
    this.juice.shake(2);
    const name = playerById(id)?.name ?? '';
    const ty = Math.max(48, y - 34);
    const t = txt(this, x, ty, 'PLATSCH!', { color: '#93d3f3' }).setDepth(1700);
    const n = txt(this, x, ty + 10, name.slice(0, 10)).setDepth(1700);
    this.tweens.add({ targets: [t, n], y: '-=12', alpha: 0, delay: 700, duration: 900, onComplete: () => (t.destroy(), n.destroy()) });
  }

  private drawHud(st: SumoState) {
    const ids = Object.keys(st.players);
    const secs = st.sub === 'play' && !st.sudden ? Math.ceil(st.endsIn / 1000) : -1;
    const key = JSON.stringify([secs, st.sub, st.round, st.sudden, ids.map((id) => [st.players[id].alive, st.players[id].wins])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.rig.hud(() => this.buildHud(st, ids, secs));
  }

  private buildHud(st: SumoState, ids: string[], secs: number) {
    this.hud.add(panel(this, 2, 1, 476, 32));
    const clock = st.sudden ? 'BRUCH!' : secs >= 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '--';
    this.hud.add(ink(this, 10, 6, `Runde ${st.round}`, { origin: [0, 0] }));
    this.hud.add(ink(this, 10, 19, clock, { origin: [0, 0], color: st.sudden ? '#a8342a' : undefined }));
    const n = ids.length;
    const slot = Math.min(36, Math.floor(390 / Math.max(1, n)));
    const x0 = 84 + (390 - slot * n) / 2;
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const p = st.players[id];
      if (!pl) return;
      const cx = x0 + i * slot + slot / 2;
      this.hud.add(this.add.rectangle(cx, 4, 18, 17, pcol(id).num).setOrigin(0.5, 0).setAlpha(p.alive ? 1 : 0.35));
      this.hud.add(this.add.image(cx, 5, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(p.alive ? 1 : 0.35));
      if (!p.alive && st.sub !== 'countdown') this.hud.add(ink(this, cx, 8, 'x', { color: '#2d64a8' }));
      for (let w = 0; w < st.winRounds; w++) {
        this.hud.add(this.add.rectangle(cx - (st.winRounds - 1) * 3 + w * 6, 25, 4, 4, w < p.wins ? 0xffd25e : 0x000000, w < p.wins ? 1 : 0.2));
      }
    });
  }
}
