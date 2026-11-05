import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { ANGELN, type AngelCatch, type AngelLost, type AngelnState, type AngelPlayer, FISH, fmtKg, laneW, laneX } from '../../shared/angeln';
import { LAKE, baitBox, bobber, catchSprite, fishShadow, paintLake, rod, rowBoat } from '../art/angeln';
import * as O from '../art/objects';
import { reeds } from '../art/lagoon';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { pcol } from './playerColor';
import { GOLD, LIGHT, background, ensureTex, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const FEET = ANGELN.FEET_Y;
const LOST_TEXT: Record<Exclude<AngelLost, null>, string> = {
  early: 'Zu früh!',
  late: 'Zu spät!',
  snap: 'Schnur gerissen!',
  slack: 'Entwischt!',
  time: 'Feierabend!',
};

interface Angler {
  id: string;
  x: number;
  color: string;
  fig: Phaser.GameObjects.Container;
  rod: Phaser.GameObjects.Image;
  bob: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  mark: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
  /** Aktuelle Pose-Position (lokal animiert) */
  bx: number;
  by: number;
  /** Fisch beim Drill */
  sx: number;
  sy: number;
  st: AngelPlayer['st'];
  castSeq: number;
  nibbles: number;
  castT0: number;
  splashAt: number;
  p: AngelPlayer;
}

/** Angeln auf dem TV: See am Ferienhaus, alle stehen auf dem Steg */
export class AngelnScene extends Phaser.Scene {
  private anglers = new Map<string, Angler>();
  private lines!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Container;
  private juice!: Juice;
  private ticker!: Phaser.GameObjects.Text;
  private latest: AngelnState | null = null;
  private lastCatch = 0;
  private hudKey = '';
  private bannerKey = '';
  private scoreKey = '';

  constructor() {
    super('angeln');
  }

  create() {
    this.juice = new Juice(this, { depth: 1455 });
    this.anglers.clear();
    this.latest = null;
    this.lastCatch = -1;
    this.hudKey = '';
    this.bannerKey = '';
    this.scoreKey = '';

    background(this, 'angeln', WORLD.W, WORLD.H, (p) => paintLake(p, WORLD.W, WORLD.H));
    // Ferienhaus links am Ufer, Schilf, Bäume gegenüber
    prop(this, 'an_house', O.cottage, 4, 214).setDepth(210);
    prop(this, 'an_bait', baitBox, 50, 240).setDepth(250);
    const treeXs = [18, 92, 170, 262, 338, 410, 466];
    treeXs.forEach((x, i) => prop(this, `an_tree_${i % 3}`, () => O.tree(40 + (i % 3)), x, 34 + (i % 2) * 4).setDepth(5).setScale(0.8));
    [[64, 110], [448, 80], [140, 52], [372, 48]].forEach(([x, y], i) => prop(this, `an_reeds_${i % 2}`, () => reeds(950 + (i % 2)), x, y).setDepth(6).setScale(0.6));
    // Glitzern und Ruderboot
    for (let i = 0; i < 16; i++) {
      const x = 80 + ((i * 89) % 390);
      const y = 56 + ((i * 47) % 150);
      const w = this.add.rectangle(x, y, 4 + (i % 3) * 2, 1, 0xeaf8ff, 0.6).setDepth(2);
      this.tweens.add({ targets: w, x: x + 5, alpha: 0.1, duration: 1500 + (i % 4) * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 140 });
    }
    const boat = this.add.image(430, 92, ensureTex(this, 'an_boat', rowBoat)).setDepth(8);
    this.tweens.add({ targets: boat, x: 400, y: 96, angle: -4, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // Deko-Fischschatten (nur Optik)
    for (let i = 0; i < 5; i++) this.ambientFish(i);

    this.lines = this.add.graphics().setDepth(240);
    this.hud = this.add.container(0, 0).setDepth(2000);
    this.banner = this.add.container(0, 0).setDepth(2100);
    this.ticker = txt(this, WORLD.W / 2, 26, '', { color: GOLD }).setDepth(2001);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private ambientFish(i: number) {
    const len = 8 + (i % 3) * 4;
    const img = this.add.image(0, 0, ensureTex(this, `an_shadow_${len}`, () => fishShadow(len))).setDepth(3).setAlpha(0.7);
    const swim = () => {
      const y = 60 + Math.random() * 130;
      const right = Math.random() < 0.5;
      img.setPosition(right ? 70 : 490, y).setFlipX(!right);
      this.tweens.add({
        targets: img,
        x: right ? 490 : 70,
        y: y + (Math.random() - 0.5) * 40,
        duration: 14000 + Math.random() * 12000,
        delay: Math.random() * 4000,
        onComplete: swim,
      });
    };
    swim();
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'angeln') return;
    const st = s.mini.state;
    this.latest = st;
    const n = Object.keys(st.players).length;
    for (const [id, p] of Object.entries(st.players)) {
      let a = this.anglers.get(id);
      if (!a) a = this.makeAngler(id, p, n);
      if (!a) continue;
      a.p = p;
      if (p.castSeq !== a.castSeq) {
        a.castSeq = p.castSeq;
        if (p.st === 'cast' || p.st === 'wait') this.castFx(a);
      }
      if (p.nibbles > a.nibbles && p.st === 'wait') this.nibbleFx(a);
      a.nibbles = p.nibbles;
      if (p.st !== a.st) this.onSt(a, a.st, p);
      a.st = p.st;
    }
    for (const c of st.catches) if (c.seq > this.lastCatch) this.catchFx(c);
    this.lastCatch = Math.max(this.lastCatch, ...st.catches.map((c) => c.seq), 0);
    this.drawBanner(st);
    this.drawHud(st);
    this.drawScores(st);
  }

  private makeAngler(id: string, p: AngelPlayer, n: number): Angler | undefined {
    const pl = playerById(id);
    if (!pl) return undefined;
    const x = Math.round(laneX(p.lane, n));
    const color = pcol(id).hex;
    const fig = figure(this, pl.look, x, FEET).setDepth(300);
    const rodImg = this.add.image(x + 3, FEET - 9, ensureTex(this, 'an_rod', rod)).setOrigin(0, 1).setDepth(301);
    const bob = this.add.image(x, LAKE.JETTY_TOP, ensureTex(this, `an_bob_${color}`, () => bobber(color))).setOrigin(0.5, 0.8).setDepth(30).setVisible(false);
    const shadow = this.add.image(x, 0, ensureTex(this, 'an_shadow_16', () => fishShadow(16))).setDepth(20).setVisible(false);
    const bar = this.add.graphics().setDepth(320);
    const mark = txt(this, x, FEET - 46, '', { size: 16, color: '#e0503f' }).setDepth(330);
    const nm = (pl.name ?? '?').replace(/^Bot\s+/, '');
    const w = laneW(n);
    const name = txt(this, x, 251, nm.slice(0, Math.max(3, Math.floor((w - 4) / 8))).toUpperCase(), { color: LIGHT }).setDepth(310);
    const score = txt(this, x, 261, '0', { color: GOLD }).setDepth(310);
    const a: Angler = {
      id,
      x,
      color,
      fig,
      rod: rodImg,
      bob,
      shadow,
      bar,
      mark,
      name,
      score,
      bx: x,
      by: LAKE.JETTY_TOP,
      sx: x,
      sy: 0,
      st: p.st,
      castSeq: p.castSeq,
      nibbles: p.nibbles,
      castT0: 0,
      splashAt: 0,
      p,
    };
    this.anglers.set(id, a);
    if (p.st === 'wait' || p.st === 'bite') {
      a.bx = p.fx;
      a.by = p.fy;
      bob.setVisible(true);
    }
    return a;
  }

  private rodTip(a: Angler) {
    return { x: a.x + 14, y: FEET - 30 };
  }

  private onSt(a: Angler, from: AngelPlayer['st'], p: AngelPlayer) {
    if (p.st === 'bite') {
      sfx('select', { x: a.x, pitch: 1.4 });
      a.mark.setText('!').setColor('#e0503f').setScale(0.4);
      this.tweens.add({ targets: a.mark, scale: 1, duration: 160, ease: 'Back.out' });
      this.ripple(a.bx, a.by + 1, 1.4);
      this.ripple(a.bx, a.by + 1, 0.8, 150);
    } else if (p.st === 'reel') {
      a.mark.setText('');
      a.sx = a.bx;
      a.sy = a.by;
      a.bob.setVisible(false);
      a.shadow.setVisible(true).setPosition(a.bx, a.by);
      const len = 10 + p.size * 5;
      a.shadow.setTexture(ensureTex(this, `an_shadow_${len}`, () => fishShadow(len)));
      this.splash(a.bx, a.by, 0.8);
      sfx('splash', { x: a.bx, vol: 0.5, pitch: 1.3 });
    } else if (p.st === 'lost') {
      a.mark.setText('');
      if (from === 'reel') this.splash(a.sx, a.sy, 0.7);
      sfx(p.lost === 'snap' ? 'crack' : 'lose', { x: a.x, vol: 0.6 });
      a.bob.setVisible(false);
      a.shadow.setVisible(false);
      if (p.lost) this.popText(a.x, FEET - 50, LOST_TEXT[p.lost], p.lost === 'snap' ? '#e0503f' : LIGHT);
    } else if (p.st === 'caught') {
      a.mark.setText('');
      a.shadow.setVisible(false);
      a.bob.setVisible(false);
    } else if (p.st === 'idle') {
      a.mark.setText('');
      a.bob.setVisible(false);
      a.shadow.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- Animation

  update(time: number) {
    const st = this.latest;
    if (!st) return;
    const g = this.lines;
    g.clear();
    for (const a of this.anglers.values()) {
      const p = a.p;
      const tip = this.rodTip(a);
      // Rute: beim Drill gebogen und wackelnd
      const reeling = p.st === 'reel';
      a.rod.setAngle(reeling ? -8 - p.tension * 22 + (p.pull ? Math.sin(time / 40) * 3 : 0) : p.st === 'bite' ? Math.sin(time / 30) * 4 : 0);
      a.bar.clear();
      a.bob.setTint(0xffffff);
      if (p.st === 'cast') {
        const t = Math.min(1, (time - a.castT0) / ANGELN.CAST_MS);
        const x = tip.x + (p.fx - tip.x) * t;
        const y = tip.y + (p.fy - tip.y) * t - Math.sin(t * Math.PI) * 30;
        a.bx = x;
        a.by = y;
        a.bob.setVisible(true).setPosition(x, y).setAlpha(1).setScale(1);
        this.line(g, tip.x, tip.y, x, y, 0.25, 0xf4efe2);
        if (t >= 1 && a.splashAt < a.castT0) {
          a.splashAt = time;
          this.ripple(p.fx, p.fy + 1, 1);
        }
      } else if (p.st === 'wait' || p.st === 'bite') {
        a.bx += (p.fx - a.bx) * 0.3;
        a.by += (p.fy - a.by) * 0.3;
        const bite = p.st === 'bite';
        const dy = bite ? 3 + Math.sin(time / 45) : Math.sin(time / 380 + a.x) * 0.8;
        a.bob.setVisible(true).setPosition(Math.round(a.bx + (bite ? Math.sin(time / 33) : 0)), Math.round(a.by + dy)).setAlpha(bite ? 0.55 : 1);
        this.line(g, tip.x, tip.y, a.bx, a.by, 0.35, 0xf4efe2);
        if (bite && time - a.splashAt > 260) {
          a.splashAt = time;
          this.ripple(a.bx, a.by + 2, 0.8);
        }
        a.mark.setPosition(a.x, FEET - 46 + (bite ? Math.sin(time / 60) * 2 : 0));
      } else if (p.st === 'reel') {
        // Fisch kommt näher; zieht seitlich, wenn er Schub gibt
        const sx0 = p.fx;
        const sy0 = p.fy;
        const ex = a.x + 6;
        const ey = LAKE.JETTY_TOP - 6;
        const tx = ex + (sx0 - ex) * p.prog + (p.pull ? p.pull * 10 : Math.sin(time / 500 + a.x) * 3) * Math.min(1, p.prog * 3);
        const ty = ey + (sy0 - ey) * p.prog;
        a.sx += (tx - a.sx) * 0.12;
        a.sy += (ty - a.sy) * 0.12;
        a.shadow.setPosition(Math.round(a.sx), Math.round(a.sy)).setFlipX(a.sx > ex + 2 ? true : false);
        a.shadow.setAngle(Math.sin(time / (p.pull ? 60 : 160)) * (p.pull ? 14 : 6));
        const col = p.tension > ANGELN.GREEN_HI ? 0xff6a5a : p.tension < ANGELN.GREEN_LO ? 0xbfd8ea : 0xffffff;
        this.line(g, tip.x, tip.y, a.sx, a.sy, p.tension < ANGELN.SLACK ? 0.6 : 0.05, col);
        if (p.pull && time - a.splashAt > 220) {
          a.splashAt = time;
          this.splash(a.sx, a.sy, 0.45);
        }
        this.drawBar(a, p);
      }
    }
  }

  /** Angelschnur: leicht durchhängend */
  private line(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, sag: number, color: number) {
    const pts: Phaser.Math.Vector2[] = [];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new Phaser.Math.Vector2(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag * dist * 0.12));
    }
    g.lineStyle(1, color, 0.85);
    g.strokePoints(pts);
  }

  /** Spannungsbalken über dem Kopf */
  private drawBar(a: Angler, p: AngelPlayer) {
    const b = a.bar;
    const w = 22;
    const x = a.x - w / 2;
    const y = FEET - 40;
    b.fillStyle(0x2d1b12, 1).fillRect(x - 1, y - 1, w + 2, 6);
    b.fillStyle(0x6e3a2a, 1).fillRect(x, y, w, 4);
    b.fillStyle(0x2f7d32, 1).fillRect(x + w * ANGELN.GREEN_LO, y, w * (ANGELN.GREEN_HI - ANGELN.GREEN_LO), 4);
    const danger = p.tension > ANGELN.GREEN_HI || p.tension < ANGELN.GREEN_LO;
    b.fillStyle(danger ? 0xffd25e : 0xfff4d6, 1).fillRect(x + Math.round(p.tension * (w - 2)), y - 1, 2, 6);
    // Reststrecke als dünner Balken darunter
    b.fillStyle(0x93d3f3, 1).fillRect(x, y + 6, Math.round(w * (1 - p.prog)), 1);
  }

  // ---------------------------------------------------------------- Effekte

  private castFx(a: Angler) {
    a.castT0 = this.time.now;
    sfx('whoosh', { x: a.x, pitch: 1.2, vol: 0.5 });
    sfx('splash', { x: a.x, vol: 0.25, pitch: 1.6, delay: 0.35 });
    a.bob.setVisible(true);
    this.tweens.add({ targets: a.rod, angle: { from: -40, to: 12 }, duration: 220, yoyo: true, ease: 'Quad.out' });
  }

  private nibbleFx(a: Angler) {
    this.ripple(a.bx, a.by + 1, 0.5);
    sfx('tick', { x: a.bx, pitch: 1.5, vol: 0.3 });
    this.tweens.add({ targets: a.bob, y: a.bob.y + 2, duration: 80, yoyo: true });
    a.mark.setText('?').setColor(LIGHT).setScale(0.6).setAlpha(1);
    this.tweens.add({ targets: a.mark, alpha: 0, delay: 400, duration: 300, onComplete: () => a.mark.setText('').setAlpha(1) });
  }

  private ripple(x: number, y: number, s = 1, delay = 0) {
    const e = this.add.ellipse(x, y, 8 * s, 3 * s).setStrokeStyle(1, 0xeaf8ff, 0.9).setDepth(25).setAlpha(delay ? 0 : 1);
    this.tweens.add({ targets: e, scaleX: 3, scaleY: 3, alpha: { from: 1, to: 0 }, delay, duration: 700, onComplete: () => e.destroy() });
  }

  private splash(x: number, y: number, s = 1) {
    for (let i = 0; i < 7; i++) {
      const d = this.add.circle(x, y, i % 3 ? 1 : 2, i % 2 ? 0xeaf8ff : 0x93d3f3).setDepth(35);
      const ang = (i / 7) * Math.PI * 2;
      this.tweens.add({
        targets: d,
        x: x + Math.cos(ang) * 10 * s,
        y: y + Math.sin(ang) * 4 * s - 6 * s,
        alpha: 0,
        duration: 420,
        ease: 'Quad.out',
        onComplete: () => d.destroy(),
      });
    }
    this.ripple(x, y + 2, s);
  }

  private popText(x: number, y: number, text: string, color: string) {
    const t = txt(this, Phaser.Math.Clamp(x, 60, WORLD.W - 60), y, text, { color }).setDepth(1500);
    this.tweens.add({ targets: t, y: y - 12, alpha: 0, delay: 900, duration: 700, onComplete: () => t.destroy() });
  }

  /** Fang: Fisch springt aus dem Wasser zum Angler, Schild mit Name und Gewicht */
  private catchFx(c: AngelCatch) {
    const a = this.anglers.get(c.pid);
    if (!a) return;
    const f = FISH[c.kind];
    const fromX = a.sx || a.x;
    const fromY = a.sy || LAKE.JETTY_TOP - 10;
    this.splash(fromX, fromY, 1.2);
    // Fang: Platsch, Münze (seltener Fisch: Fanfare + Konfetti)
    sfx('splash', { x: fromX });
    sfx(f.junk ? 'bonk' : 'coin', { x: a.x, delay: 0.5 });
    this.juice.burst(fromX, fromY, 'splash', 14);
    const img = this.add.image(fromX, fromY, ensureTex(this, `an_fish_${c.kind}`, () => catchSprite(c.kind))).setDepth(1400);
    const toY = FEET - 50;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 650,
      ease: 'Sine.inOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        img.setPosition(fromX + (a.x - fromX) * t, fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * 26);
        img.setAngle(-30 + 60 * t);
      },
      onComplete: () => {
        img.setAngle(0);
        this.tweens.add({ targets: img, angle: { from: -8, to: 8 }, duration: 180, yoyo: true, repeat: 5 });
      },
    });
    // Schild
    const rare = !!f.rare;
    const col = f.junk ? LIGHT : rare ? GOLD : '#9be27a';
    const label = `${f.name}\n${fmtKg(c.kg)}\n+${c.pts}`;
    // Nachbarn abwechselnd höher, damit sich gleichzeitige Fänge nicht überdecken
    const ly = FEET - 92 - (a.p.lane % 2) * 30;
    const t = txt(this, Phaser.Math.Clamp(a.x, 48, WORLD.W - 48), ly, label, { color: col }).setDepth(1450).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, delay: 450, duration: 150 });
    this.time.delayedCall(ANGELN.CAUGHT_MS - 300, () => {
      this.tweens.add({ targets: [img, t], alpha: 0, y: '-=10', duration: 350, onComplete: () => (img.destroy(), t.destroy()) });
    });
    if (rare) {
      for (let i = 0; i < 10; i++) {
        const s = this.add.star(a.x, toY, 4, 1, 3, 0xffd25e).setDepth(1460);
        const ang = (i / 10) * Math.PI * 2;
        this.tweens.add({ targets: s, x: a.x + Math.cos(ang) * 22, y: toY + Math.sin(ang) * 14, alpha: 0, angle: 180, delay: 600, duration: 700, onComplete: () => s.destroy() });
      }
      this.juice.flash(0xffe68c, 150);
      this.juice.burst(a.x, toY, 'confetti', 30);
      sfx('fanfare', { delay: 0.55 });

    }
    // Ticker oben
    const who = (playerById(c.pid)?.name ?? '?').replace(/^Bot\s+/, '');
    const msg = f.junk ? `${who} angelt: ${f.name}!` : `${who}: ${f.name}, ${fmtKg(c.kg)}!`;
    this.tweens.killTweensOf(this.ticker);
    this.ticker.setText(msg).setColor(rare ? GOLD : LIGHT).setAlpha(1);
    this.tweens.add({ targets: this.ticker, alpha: 0, delay: 3000, duration: 500 });
  }

  // ---------------------------------------------------------------- HUD

  private drawBanner(st: AngelnState) {
    const key = st.sub;
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    this.banner.removeAll(true);
    let title = '';
    let sub = '';
    if (st.sub === 'intro') {
      title = 'ANGELN';
      sub = 'Auswerfen: Schwung/Wischen\nweiter = tiefer = größere Fische\nBiss? Anschlagen! Dann drillen:\nSpannung im Grünen halten!';
    } else if (st.sub === 'last') {
      title = 'ZEIT UM!';
      sub = 'Die letzten Drills laufen noch …';
    } else if (st.sub === 'over') {
      title = 'PETRI HEIL!';
      sub = st.record ? `Größter Fang: ${FISH[st.record.kind].name}, ${fmtKg(st.record.kg)}` : 'Feierabend am See.';
    }
    if (!title) return;
    const cx = WORLD.W / 2 + 20;
    const h = st.sub === 'intro' ? 104 : 64;
    this.banner.add(panel(this, cx - 150, 62, 300, h, 'dark'));
    this.banner.add(txt(this, cx, 72, title, { size: 16, color: GOLD }));
    this.banner.add(txt(this, cx, 96, sub, { color: LIGHT, wrap: 284 }));
    this.banner.setAlpha(0).setY(-8);
    this.tweens.add({ targets: this.banner, alpha: 1, y: 0, duration: 250, ease: 'Back.out' });
    if (st.sub === 'last') this.tweens.add({ targets: this.banner, alpha: 0, delay: 2500, duration: 500 });
  }

  private drawHud(st: AngelnState) {
    const secs = Math.ceil(st.endsIn / 1000);
    const rec = st.record;
    const key = `${st.sub}-${secs}-${rec?.seq ?? 0}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub === 'intro' || st.sub === 'over') return;
    const clock = st.sub === 'last' ? 'LETZTE DRILLS' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const recTxt = rec ? `REKORD ${FISH[rec.kind].name.toUpperCase()} ${fmtKg(rec.kg)} · ${(playerById(rec.pid)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 6).toUpperCase()}` : 'NOCH KEIN FISCH';
    const w = Math.max(120, 24 + (clock.length + recTxt.length + 3) * 8);
    const x0 = WORLD.W / 2 - w / 2;
    this.hud.add(panel(this, x0, 2, w, 20));
    this.hud.add(ink(this, x0 + 8, 8, clock, { origin: [0, 0], color: st.sub === 'play' && secs <= 10 ? '#a8342a' : undefined }));
    this.hud.add(ink(this, x0 + w - 8, 8, recTxt, { origin: [1, 0], color: rec ? '#2d64a8' : undefined }));
  }

  private drawScores(st: AngelnState) {
    const entries = Object.entries(st.players);
    const top = Math.max(0, ...entries.map(([, p]) => p.score));
    const key = entries.map(([id, p]) => `${id}:${p.score}`).join() + top;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    for (const [id, p] of entries) {
      const a = this.anglers.get(id);
      if (!a) continue;
      a.score.setText(String(p.score)).setColor(p.score > 0 && p.score === top ? GOLD : LIGHT);
      a.name.setColor(p.score > 0 && p.score === top ? GOLD : LIGHT);
    }
  }
}
