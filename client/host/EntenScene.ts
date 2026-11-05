import Phaser from 'phaser';
import type { EntenKind, EntenShot, EntenState, EntenTarget, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { ENTEN } from '../../shared/games';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { LAGOON, crab, crosshair, duck, feather, flamingo, floater, gull, paintLagoon, reeds } from '../art/lagoon';
import { bus, getState, playerById } from './store';
import { GOLD, LIGHT, background, ensureTex, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { type SfxName, sfx } from './sfx';

/** Treffer-Ton je Vogeltyp: [Effekt, Tonhöhe] */
const BIRD_SFX: Record<Exclude<EntenKind, 'float'>, [SfxName, number]> = { duck: ['pop', 0.7], gull: ['jump', 1.5], flamingo: ['coin', 1] };

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const FEATHER_TINT: Record<EntenKind, number[]> = {
  duck: [0xcfcac0, 0x2f8a4a, 0x9a968c],
  gull: [0xffffff, 0xb9c2cc],
  flamingo: [0xf07aa8, 0xe05a8a],
  float: [0xffffff],
};

interface TargetView {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  t: EntenTarget;
}

interface AimView {
  root: Phaser.GameObjects.Container;
  x: number;
  y: number;
}

/** Ententeich auf dem TV: Lagune, Vögel, Fadenkreuze aller Spieler, Effekte und Rangliste */
export class EntenScene extends Phaser.Scene {
  private targets = new Map<number, TargetView>();
  private aims = new Map<string, AimView>();
  private hud!: Phaser.GameObjects.Container;
  private board!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Container;
  private crabImg!: Phaser.GameObjects.Image;
  private crabBubble!: Phaser.GameObjects.Text;
  private latest: EntenState | null = null;
  private lastShot = 0;
  private lastLaugh = 0;
  private laughUntil = 0;
  private hudKey = '';
  private boardKey = '';
  private bannerKey = '';
  private juice!: Juice;

  constructor() {
    super('enten');
  }

  create() {
    this.targets.clear();
    this.aims.clear();
    this.latest = null;
    this.lastShot = -1;
    this.lastLaugh = -1;
    this.laughUntil = 0;
    this.hudKey = '';
    this.boardKey = '';
    this.bannerKey = '';

    background(this, 'lagoon', WORLD.W, WORLD.H, (p) => paintLagoon(p, WORLD.W, WORLD.H));
    for (const k of [0, 1] as const) {
      ensureTex(this, `en_duck_${k}`, () => duck(k));
      ensureTex(this, `en_hen_${k}`, () => duck(k, true));
      ensureTex(this, `en_gull_${k}`, () => gull(k));
      ensureTex(this, `en_flamingo_${k}`, () => flamingo(k));
      ensureTex(this, `en_crab_${k}`, () => crab(k));
    }
    for (let i = 0; i < 3; i++) ensureTex(this, `en_float_${i}`, () => floater(i));
    ensureTex(this, 'en_cross', crosshair);
    ensureTex(this, 'en_feather', feather);

    // Strand-Deko
    prop(this, 'umbrellaR', () => O.umbrella(C.red), 438, 262).setDepth(5);
    prop(this, 'en_chair', () => O.deckchair(C.orange), 30, 262).setDepth(4);
    // Krabbe wartet im Sand
    this.crabImg = this.add.image(250, 268, 'en_crab_0').setOrigin(0.5, 1).setDepth(60);
    this.crabBubble = txt(this, 250, 222, '', { color: GOLD }).setDepth(61);
    // Schilf vorne (Enten starten dahinter)
    const reedXs = [22, 78, 140, 196, 262, 318, 380];
    reedXs.forEach((x, i) => prop(this, `en_reeds_${i % 4}`, () => reeds(900 + (i % 4)), x, LAGOON.SHORE + 14 + (i % 2) * 4).setDepth(50));

    this.hud = this.add.container(0, 0).setDepth(1000);
    this.board = this.add.container(0, 0).setDepth(1000);
    this.banner = this.add.container(0, 0).setDepth(1100);
    this.juice = new Juice(this, { depth: 945 });

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'enten') return;
    const st = s.mini.state;
    this.latest = st;
    this.syncTargets(st);
    this.syncAims(st);
    // Beim (Wieder-)Einstieg alte Schüsse nicht nachspielen (sonst knallt es zehnmal)
    if (this.lastShot < 0 && st.sub !== 'intro') this.lastShot = Math.max(0, ...st.shots.map((x) => x.seq));
    for (const shot of st.shots) if (shot.seq > this.lastShot) this.shotFx(shot, st);
    this.lastShot = Math.max(this.lastShot, ...st.shots.map((x) => x.seq), 0);
    if (this.lastLaugh < 0) this.lastLaugh = st.laughSeq;
    if (st.laughSeq !== this.lastLaugh) {
      this.lastLaugh = st.laughSeq;
      this.laugh();
    }
    this.drawBanner(st);
    this.drawHud(st);
    this.drawBoard(st);
  }

  private syncTargets(st: EntenState) {
    const alive = new Set(st.targets.map((t) => t.id));
    for (const [id, v] of this.targets) {
      if (alive.has(id)) continue;
      v.img.destroy();
      this.targets.delete(id);
    }
    for (const t of st.targets) {
      let v = this.targets.get(t.id);
      if (!v) {
        const key = t.kind === 'float' ? `en_float_${t.look % 3}` : t.kind === 'duck' ? `en_${t.look === 2 ? 'hen' : 'duck'}_0` : `en_${t.kind}_0`;
        const img = this.add.image(t.x, t.y, key).setDepth(t.kind === 'float' ? 20 + t.y / 100 : 30);
        v = { img, x: t.x, y: t.y, t };
        this.targets.set(t.id, v);
      }
      v.t = t;
    }
  }

  private syncAims(st: EntenState) {
    for (const [id, p] of Object.entries(st.players)) {
      if (this.aims.has(id)) continue;
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 4);
      const cross = this.add.image(0, 0, 'en_cross').setTint(p.color);
      const tag = txt(this, 0, 10, name, { color: hex(p.color) });
      const root = this.add.container(p.x, p.y, [cross, tag]).setDepth(900);
      this.aims.set(id, { root, x: p.x, y: p.y });
    }
  }

  // ---------------------------------------------------------------- Animation

  update(time: number) {
    const st = this.latest;
    if (!st) return;
    const flap = Math.floor(time / 130) % 2;
    for (const v of this.targets.values()) {
      const t = v.t;
      const k = t.st === 'down' ? 0.5 : 0.3;
      v.x += (t.x - v.x) * k;
      v.y += (t.y - v.y) * k;
      v.img.setPosition(Math.round(v.x), Math.round(v.y));
      if (t.kind === 'float') {
        v.img.setFlipX(t.vx < 0);
        v.img.setTint(t.st === 'hit' && Math.floor(time / 90) % 2 ? 0xff8a8a : 0xffffff);
        continue;
      }
      const base = t.kind === 'duck' ? (t.look === 2 ? 'en_hen' : 'en_duck') : `en_${t.kind}`;
      const f = t.st === 'down' ? 1 : t.st === 'escape' ? Math.floor(time / 70) % 2 : flap;
      v.img.setTexture(`${base}_${f}`);
      v.img.setFlipX(t.vx < 0);
      if (t.st === 'down') {
        v.img.setAngle((t.vx < 0 ? -1 : 1) * Math.min(160, (v.img.angle === 0 ? 30 : Math.abs(v.img.angle)) + 8));
      } else {
        v.img.setAngle(t.kind === 'duck' ? Phaser.Math.Clamp(t.vy / 8, -20, 20) * (t.vx < 0 ? -1 : 1) : 0);
      }
    }
    for (const [id, a] of this.aims) {
      const p = st.players[id];
      if (!p) continue;
      a.x += (p.x - a.x) * 0.45;
      a.y += (p.y - a.y) * 0.45;
      a.root.setPosition(Math.round(a.x), Math.round(a.y));
      a.root.setAlpha(p.reloading ? 0.45 : 1);
    }
    // Krabbe: lachen oder abtauchen
    const laughing = time < this.laughUntil;
    this.crabImg.setTexture(laughing ? `en_crab_${Math.floor(time / 110) % 2}` : 'en_crab_0');
    const wantY = laughing ? 258 : 282;
    this.crabImg.y += (wantY - this.crabImg.y) * 0.2;
    this.crabBubble.setVisible(laughing);
  }

  // ---------------------------------------------------------------- Effekte

  private shotFx(shot: EntenShot, st: EntenState) {
    const p = st.players[shot.pid];
    const color = p?.color ?? 0xffffff;
    const { x, y } = shot;
    // Mündungsfeuer + Ring in Spielerfarbe
    const flash = this.add.star(x, y, 6, 2, 8, 0xfff1b0).setDepth(950);
    this.tweens.add({ targets: flash, scale: 1.6, alpha: 0, angle: 30, duration: 140, onComplete: () => flash.destroy() });
    const ring = this.add.circle(x, y, 3).setStrokeStyle(1, color).setDepth(949);
    this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 200, onComplete: () => ring.destroy() });
    sfx('shoot', { x, vol: 0.6 });

    if (!shot.kind) {
      // Daneben: Wölkchen bzw. Platscher im Wasser
      if (y > LAGOON.HORIZON + 8 && y < LAGOON.SHORE) {
        const sp = this.add.ellipse(x, y + 2, 6, 2).setStrokeStyle(1, 0xeaf8ff).setDepth(25);
        this.tweens.add({ targets: sp, scaleX: 3, scaleY: 2, alpha: 0, duration: 450, onComplete: () => sp.destroy() });
        sfx('splash', { x, vol: 0.3, pitch: 1.6, delay: 0.03 });
        this.juice.burst(x, y, 'splash', 4);
      } else {
        const puff = this.add.circle(x, y, 2, 0xffffff, 0.7).setDepth(940);
        this.tweens.add({ targets: puff, scale: 3, alpha: 0, duration: 320, onComplete: () => puff.destroy() });
      }
      return;
    }
    const target = shot.tid !== null ? this.targets.get(shot.tid) : undefined;
    const fx = target ? target.x : x;
    const fy = target ? target.y : y;
    if (shot.kind === 'float') {
      const minus = txt(this, fx, fy - 18, `${shot.pts}`, { color: '#ff6a5a' }).setDepth(960);
      const hey = txt(this, fx, fy - 30, 'HEY!', { color: LIGHT }).setDepth(960);
      this.tweens.add({ targets: [minus, hey], y: '-=10', alpha: 0, delay: 350, duration: 700, onComplete: () => (minus.destroy(), hey.destroy()) });
      const sp = this.add.ellipse(fx, fy + 4, 10, 3).setStrokeStyle(1, 0xeaf8ff).setDepth(25);
      this.tweens.add({ targets: sp, scaleX: 3, scaleY: 2, alpha: 0, duration: 500, onComplete: () => sp.destroy() });
      this.cameras.main.shake(120, 0.004);
      // Fehlschuss auf den Badegast: Buzzer + Platsch
      sfx('error', { x: fx });
      sfx('bonk', { x: fx, delay: 0.03 });
      this.juice.burst(fx, fy, 'splash', 10);
      return;
    }
    // Federn
    const tints = FEATHER_TINT[shot.kind];
    for (let i = 0; i < 7; i++) {
      const f = this.add.image(fx, fy, 'en_feather').setTint(tints[i % tints.length]).setDepth(940).setAngle(Math.random() * 360);
      const ang = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 14;
      this.tweens.add({
        targets: f,
        x: fx + Math.cos(ang) * dist,
        y: fy + Math.sin(ang) * dist * 0.6 + 14,
        angle: f.angle + (Math.random() - 0.5) * 300,
        alpha: 0,
        duration: 700 + Math.random() * 400,
        ease: 'Sine.out',
        onComplete: () => f.destroy(),
      });
    }
    const [bird, bp] = BIRD_SFX[shot.kind];
    sfx('hit', { x: fx, vol: 0.7 });
    sfx(bird, { x: fx, pitch: bp, delay: 0.04 });
    this.juice.burst(fx, fy, 'puff', 4);
    if (shot.combo > 1) sfx('coin', { x: fx, pitch: 1 + Math.min(10, shot.combo) * 0.06, vol: 0.6, delay: 0.1 });
    if (shot.combo > 0 && shot.combo % 5 === 0) {
      this.juice.burst(fx, fy, 'spark', 14);
      this.juice.float(fx, fy - 40, `COMBO x${shot.combo}!`, 'gold');
    }
    const plus = txt(this, fx, fy - 16, `+${shot.pts}`, { color: hex(color) }).setDepth(960);
    this.tweens.add({ targets: plus, y: plus.y - 14, alpha: 0, delay: 250, duration: 550, onComplete: () => plus.destroy() });
    if (shot.combo > 1) {
      const c = txt(this, fx, fy - 27, `x${shot.combo}`, { color: GOLD }).setDepth(961).setScale(0.6);
      this.tweens.add({ targets: c, scale: 1, duration: 120, ease: 'Back.out' });
      this.tweens.add({ targets: c, alpha: 0, y: c.y - 14, delay: 250, duration: 550, onComplete: () => c.destroy() });
    }
  }

  private laugh() {
    const now = this.time.now;
    if (now < this.laughUntil - 600) return;
    this.laughUntil = now + 1500;
    const xs = [120, 250, 330];
    const x = xs[Math.floor(Math.random() * xs.length)];
    this.crabImg.setX(x);
    this.crabBubble.setPosition(x, 222).setText(Math.random() < 0.5 ? 'HAHAHA!' : 'HIHIHI!');
    for (let i = 0; i < 3; i++) sfx('bonk', { x, pitch: 1.7 - i * 0.12, vol: 0.45, delay: i * 0.13 });
  }

  // ---------------------------------------------------------------- HUD

  private drawBanner(st: EntenState) {
    const key = `${st.sub}-${st.wave}`;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    this.banner.removeAll(true);
    let title = '';
    let sub = '';
    if (st.sub === 'intro') {
      title = 'ENTENTEICH';
      sub = 'Zielen & abdrücken!\nNicht auf die Badegäste!';
    } else if (st.sub === 'banner') {
      title = `WELLE ${st.wave}`;
      sub = st.waveName;
    } else if (st.sub === 'over') {
      title = 'FEIERABEND!';
      sub = 'Die Vögel sind weg ...';
    }
    if (!title) return;
    if (st.sub === 'banner') sfx('select');
    else if (st.sub === 'over') sfx('win');
    const cx = ENTEN.FIELD_W / 2;
    this.banner.add(panel(this, cx - 150, 68, 300, 78, 'dark'));
    this.banner.add(txt(this, cx, 82, title, { size: 24, color: GOLD }));
    this.banner.add(txt(this, cx, 116, sub, { color: LIGHT, wrap: 280 }));
    this.banner.setAlpha(0).setY(-10);
    this.tweens.add({ targets: this.banner, alpha: 1, y: 0, duration: 250, ease: 'Back.out' });
  }

  private drawHud(st: EntenState) {
    const secs = Math.ceil(st.endsIn / 1000);
    const key = `${st.sub}-${st.wave}-${secs}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub !== 'play') return;
    const cx = ENTEN.FIELD_W / 2;
    this.hud.add(panel(this, cx - 72, 2, 144, 20));
    this.hud.add(ink(this, cx, 8, `WELLE ${st.wave}/${st.waves}  ${secs}s`, { color: secs <= 5 ? '#a8342a' : undefined }));
  }

  private drawBoard(st: EntenState) {
    const rows = Object.entries(st.players).sort((a, b) => b[1].score - a[1].score);
    const key = rows.map(([id, p]) => `${id}:${p.score}`).join();
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    const x0 = ENTEN.FIELD_W;
    const w = WORLD.W - x0;
    const h = Math.min(WORLD.H - 4, 26 + rows.length * 13);
    this.board.add(panel(this, x0, 2, w, h, 'dark'));
    this.board.add(txt(this, x0 + w / 2, 8, 'PUNKTE', { color: GOLD }));
    rows.forEach(([id, p], i) => {
      const y = 22 + i * 13;
      this.board.add(this.add.rectangle(x0 + 8, y + 1, 5, 6, p.color).setOrigin(0, 0).setStrokeStyle(1, 0x2d1b12));
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 3).toUpperCase();
      this.board.add(txt(this, x0 + 15, y, name, { color: LIGHT, origin: [0, 0] }));
      this.board.add(txt(this, x0 + w - 6, y, String(p.score), { color: i === 0 && p.score > 0 ? GOLD : LIGHT, origin: [1, 0] }));
    });
  }
}
