import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { HILL, SKI, type SkiState, distToX, hillSlope, hillY } from '../../shared/skisprung';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensureTex, panel, ink, tagName, txt, INK, RED_INK } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { type Figure, figure } from './textures';
import { SnapBuffer, lerpJump } from './interp';
import { clouds, crowd } from './ambient';
import { BalanceHud } from './balanceHud';

/**
 * Schanzen-Springen (Balance Board): Seitenansicht der Schanze, die Kamera fährt mit dem Springer mit.
 * Welt in Pixeln: 1 m = SKI.PX px. Die Schanze (Profil aus shared/skisprung.ts) wird einmal als Grafik gezeichnet.
 */
const PX = SKI.PX;
const MARGIN = 20;
const TOP = 72 * PX;
const wx = (m: number) => (m - HILL.X0) * PX + MARGIN;
const wy = (m: number) => TOP - m * PX;
const WORLD_W = wx(HILL.X1) + MARGIN;
const WORLD_H = wy(hillY(HILL.X1)) + 60;

function mountains(w: number, h: number, seed: number, c1: string, c2: string, snow: string) {
  const p = new Pix(w, h);
  let y = h * 0.5;
  let v = 0;
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let x = 0; x < w; x++) {
    v += (rnd() - 0.5) * 0.9;
    v = Math.max(-1.4, Math.min(1.4, v));
    y = Math.max(h * 0.12, Math.min(h * 0.85, y + v));
    p.vline(x, Math.round(y), h - Math.round(y), x % 7 < 3 ? c1 : c2);
    const cap = Math.round((h * 0.45 - y) * 0.5);
    if (cap > 0) p.vline(x, Math.round(y), cap, snow);
  }
  return p;
}

function pine(): Pix {
  const p = new Pix(13, 22);
  p.rect(5, 17, 3, 5, '#5e3518');
  for (let i = 0; i < 4; i++) {
    const w = 3 + i * 3;
    p.rect(6 - Math.floor(w / 2), 2 + i * 4, w, 5, i % 2 ? '#2f5d3a' : '#3a7046');
  }
  p.rect(5, 0, 3, 3, '#3a7046');
  p.px(3, 9, '#ffffff').px(9, 13, '#ffffff').px(6, 5, '#ffffff');
  p.outline('#1d2e22');
  return p;
}

interface Run {
  id: string | null;
  sub: string;
  landedSeen: boolean;
}

export class SkisprungScene extends Phaser.Scene {
  private buf = new SnapBuffer<SkiState>();
  private latest: SkiState | null = null;
  private juice!: Juice;
  private hud!: BalanceHud;
  private jumper!: Phaser.GameObjects.Container;
  private skis!: Phaser.GameObjects.Graphics;
  private fig: Figure | null = null;
  private figId: string | null = null;
  private title!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private distTxt!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private run: Run = { id: null, sub: '', landedSeen: false };
  private fans!: { cheer(): void };
  private camX = 0;
  private camY = 0;

  constructor() {
    super('skisprung');
  }

  create() {
    this.buf = new SnapBuffer();
    this.latest = null;
    this.fig = null;
    this.figId = null;
    this.boardKey = '';
    this.run = { id: null, sub: '', landedSeen: false };
    this.hintUntil = 0;
    this.juice = new Juice(this, { depth: 2500, clock: this.buf, hud: this.add.container(0, 0).setScrollFactor(0).setDepth(5000) });
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setBackgroundColor('#8fc4ec');

    // Himmel + Berge (Parallaxe)
    this.add.image(0, 0, ensureTex(this, 'ski_sky', () => {
      const p = new Pix(480, 270);
      const cols = ['#5d9fd8', '#74b0e2', '#8fc4ec', '#b3d8f3', '#d6ecfa'];
      cols.forEach((c, i) => p.rect(0, i * 54, 480, 54, c));
      return p;
    })).setOrigin(0).setScrollFactor(0).setDepth(-1000);
    this.add.image(0, 70, ensureTex(this, 'ski_mtn_far', () => mountains(900, 200, 7, '#93a8c7', '#97acca', '#f3f7fc'))).setOrigin(0).setScrollFactor(0.15).setDepth(-990);
    this.add.image(-60, 130, ensureTex(this, 'ski_mtn_near', () => mountains(1000, 200, 3, '#718aab', '#758eaf', '#e8f0fa'))).setOrigin(0).setScrollFactor(0.3).setDepth(-980);
    clouds(this, { n: 4, y: [10, 60], depth: -985, scroll: 0.1, alpha: 0.9 });

    this.drawHill();

    // Springer: Ski (Grafik) + Figur
    this.jumper = this.add.container(wx(SKI.START_X), wy(hillY(SKI.START_X))).setDepth(500);
    this.skis = this.add.graphics();
    this.jumper.add(this.skis);

    // HUD (fest auf dem Bildschirm)
    const hudPanel = this.add.rectangle(240, 13, 480, 26, 0x141c30, 0.7).setScrollFactor(0).setDepth(2900);
    void hudPanel;
    this.title = txt(this, 8, 4, '', { origin: [0, 0] }).setScrollFactor(0).setDepth(2901);
    this.info = txt(this, 472, 4, '', { origin: [1, 0], color: '#bcd3ff' }).setScrollFactor(0).setDepth(2901);
    this.hint = txt(this, 240, 34, '', { size: 16, color: '#ffd25e' }).setScrollFactor(0).setDepth(2901);
    this.distTxt = txt(this, 0, 0, '', { color: '#ffffff' }).setDepth(600);
    this.board = this.add.container(0, 0).setScrollFactor(0).setDepth(2950);
    this.hud = new BalanceHud(this, 404, 210);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
    this.camX = wx(SKI.START_X) - 200;
    this.camY = wy(hillY(SKI.START_X)) - 140;
    cam.setScroll(this.camX, this.camY);
  }

  private drawHill() {
    const g = this.add.graphics().setDepth(100);
    const pts: Phaser.Math.Vector2[] = [];
    for (let m = HILL.X0; m <= HILL.X1; m += 1) pts.push(new Phaser.Math.Vector2(wx(m), wy(hillY(m))));
    // Gelände unter dem Anlauf (Wald) und der Hang
    const poly = [...pts, new Phaser.Math.Vector2(WORLD_W, WORLD_H), new Phaser.Math.Vector2(0, WORLD_H)];
    g.fillStyle(0xeef4fb, 1).fillPoints(poly, true);
    // Schattenstreifen + Spur in der Hangmitte
    g.lineStyle(6, 0xd2e0ef, 1).strokePoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y + 6)));
    g.lineStyle(2, 0xffffff, 1).strokePoints(pts);
    // Anlaufspur (Eisrinne)
    const inrun = pts.filter((p) => p.x <= wx(0));
    g.lineStyle(2, 0x7f9bb8, 1).strokePoints(inrun.map((p) => new Phaser.Math.Vector2(p.x, p.y - 1)));
    // Schanzentisch + Startturm
    g.fillStyle(0x5e6b7c, 1).fillRect(wx(0) - 6, wy(0), 7, PX * HILL.TABLE_DROP + 4);
    g.fillStyle(0x8d5629, 1).fillRect(wx(SKI.START_X) - 12, wy(hillY(SKI.START_X)) - 26, 16, 26);
    g.fillStyle(0xa8342a, 1).fillTriangle(wx(SKI.START_X) - 14, wy(hillY(SKI.START_X)) - 26, wx(SKI.START_X) + 6, wy(hillY(SKI.START_X)) - 26, wx(SKI.START_X) - 4, wy(hillY(SKI.START_X)) - 36);

    // Weiten-Markierungen: alle 10 m eine Linie, K-Punkt rot, Hill Size grün
    for (let d = 50; d <= 150; d += 10) {
      const x = distToX(d);
      const k = d === SKI.K;
      const color = k ? 0xe2574c : 0x5d7fa8;
      const a = hillSlope(x);
      const px = wx(x);
      const py = wy(hillY(x));
      const nx = Math.sin(a) * 9;
      const ny = Math.cos(a) * 9;
      g.lineStyle(k ? 3 : 1, color, 0.9).lineBetween(px - nx * 0.2, py - ny * 0.2, px + nx, py + ny);
      txt(this, px + 8, py + 8, `${d}`, { color: k ? '#e2574c' : '#5d7fa8', shadow: false }).setDepth(101).setScale(0.75);
    }
    const hs = distToX(SKI.HS);
    g.lineStyle(3, 0x3fbf5a, 0.95).lineBetween(wx(hs), wy(hillY(hs)) - 2, wx(hs), wy(hillY(hs)) + 12);
    txt(this, wx(hs) + 10, wy(hillY(hs)) + 14, 'HS', { color: '#2f7d32', shadow: false }).setDepth(101).setScale(0.75);
    txt(this, wx(distToX(SKI.K)) + 14, wy(hillY(distToX(SKI.K))) + 18, 'K', { color: '#e2574c', shadow: false }).setDepth(101).setScale(0.75);

    // Bäume links und rechts, Zuschauer im Auslauf
    const tree = ensureTex(this, 'ski_pine', pine);
    // Wald neben der Schanze (vor dem Hang, leicht unterhalb der Spur) und im Auslauf
    for (let m = 12; m < 170; m += 11 + ((m * 7) % 5)) this.add.image(wx(m) + 6, wy(hillY(m)) + 46, tree).setOrigin(0.5, 1).setDepth(105).setScale(0.9);
    for (let m = SKI.START_X + 8; m < -14; m += 12) this.add.image(wx(m), wy(hillY(m)) + 44, tree).setOrigin(0.5, 1).setDepth(105).setScale(0.9);
    for (let m = 236; m < HILL.X1; m += 8) this.add.image(wx(m), wy(hillY(m)) + 2, tree).setOrigin(0.5, 1).setDepth(105);
    const spots: [number, number][] = [];
    for (let m = 182; m < HILL.X1 - 6; m += 4) spots.push([wx(m), wy(hillY(m)) + 18 + (m % 8 ? 0 : 3)]);
    this.fans = crowd(this, spots, { depth: 120, scale: 0.8 });
    // Banner am Auslauf
    const bx = wx(176);
    const by = wy(hillY(176));
    this.add.rectangle(bx, by + 6, 80, 10, 0xa8342a).setOrigin(0, 0.5).setDepth(110);
    txt(this, bx + 40, by + 2, 'LAN-ABFAHRT', { shadow: false }).setDepth(111).setScale(0.75);
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'skisprung') return;
    const st = s.mini.state;
    this.latest = st;
    this.buf.push(st.t, st);
    this.cues(st);
    this.renderHud(st);
  }

  /** Phasenwechsel: Töne, Ansagen, Juice */
  private cues(st: SkiState) {
    const r = this.run;
    if (st.active !== r.id) {
      r.id = st.active;
      r.landedSeen = false;
      if (st.active) {
        const name = playerById(st.active)?.name;
        say(`${spokenName(name)} ist dran.`);
      }
    }
    if (st.sub === r.sub) return;
    const prev = r.sub;
    r.sub = st.sub;
    if (st.sub === 'inrun') sfx('whoosh', { vol: 0.6 });
    if (st.sub === 'flight' && prev === 'inrun') {
      this.buf.after(st.t, () => {
        sfx('jump', { pitch: 0.8 + (st.takeoff === null ? 0 : 0.4) });
        if (st.takeoff !== null && Math.abs(st.takeoff) < 0.12) this.flashHint('PERFEKTER ABSPRUNG!');
      });
    }
    if (st.sub === 'landed' && st.last && !r.landedSeen) {
      r.landedSeen = true;
      const j = st.last;
      this.buf.after(st.t, () => {
        const x = wx(this.latest?.px ?? 0);
        const y = wy(hillY(this.latest?.px ?? 0));
        this.juice.burst(x, y, 'puff', j.fall ? 24 : 14);
        if (j.fall) {
          sfx('crack');
          sfx('bonk', { delay: 0.1 });
          this.juice.shake(2);
          this.juice.banner('STURZ!', `${j.dist.toFixed(1)} m`);
          say(`Sturz! ${Math.round(j.dist)} Meter.`);
        } else {
          sfx('hit', { pitch: 0.7 });
          const big = j.dist >= SKI.K;
          if (big) {
            sfx('cheer');
            this.fans.cheer();
          }
          if (j.dist >= SKI.HS) sfx('fanfare', { delay: 0.3 });
          this.juice.banner(`${j.dist.toFixed(1)} m`, `${j.points.toFixed(1)} Punkte · Haltung ${j.style.toFixed(1)}`, 2600);
          say(`${Math.round(j.dist)} Meter!`);
        }
      });
    }
    if (st.sub === 'over') sfx('fanfare');
  }

  private hintUntil = 0;
  /** Kurzer Zuruf statt des normalen Hinweises */
  private flashHint(text: string) {
    this.hintUntil = this.time.now + 1200;
    this.hint.setText(text).setColor('#9ad65a');
  }

  private renderHud(st: SkiState) {
    const name = st.active ? tagName(playerById(st.active)?.name ?? '?') : '';
    const t = `🎿 ${st.rounds > 1 ? `Durchgang ${st.round}/${st.rounds} · ` : ''}${name}`;
    if (this.title.text !== t) this.title.setText(t);
    const rec = st.best ? ` · Rekord ${st.best.dist.toFixed(1)} m` : '';
    const i = `K ${SKI.K} · HS ${SKI.HS}${rec}`;
    if (this.info.text !== i) this.info.setText(i);

    let hint = '';
    if (st.sub === 'countdown') hint = 'In die Hocke!';
    else if (st.sub === 'inrun') {
      const v = Math.max(1, st.kmh / 3.6);
      const toEdge = -st.px / v;
      hint = toEdge < 0.45 && st.takeoff === null ? 'JETZT HOCH!' : 'Ruhig in der Mitte!';
    } else if (st.sub === 'flight') hint = st.q < 0.4 ? 'Gerade halten!' : 'Leicht nach vorn!';
    if (this.time.now < this.hintUntil) hint = this.hint.text;
    else if (this.hint.text !== hint) this.hint.setText(hint).setColor(hint === 'JETZT HOCH!' ? '#ff8a7a' : '#ffd25e');
    this.hud.target = st.sub === 'inrun' || st.sub === 'countdown' ? { x: 0, y: 0, r: 0.5 } : st.sub === 'flight' ? { x: 0, y: SKI.FLIGHT_Y, r: 0.55 } : null;

    // Zwischenstand (links unten) bzw. Endstand (Mitte)
    const ids = Object.keys(st.points);
    const ranked = [...ids].sort((a, b) => st.points[b] - st.points[a]);
    const over = st.sub === 'over';
    const key = JSON.stringify([over, st.points, st.round]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    const rows = over ? ranked : ranked.slice(0, 5);
    const w = over ? 300 : 150;
    const h = 22 + rows.length * 12;
    const x0 = over ? 90 : 6;
    const y0 = over ? 60 : 264 - h;
    this.board.add(panel(this, x0, y0, w, h));
    this.board.add(ink(this, x0 + w / 2, y0 + 6, over ? 'Endstand' : 'Zwischenstand', { color: RED_INK }));
    rows.forEach((id, k) => {
      const p = playerById(id);
      const best = Math.max(0, ...(st.jumps[id] ?? []).map((j) => j.dist));
      this.board.add(ink(this, x0 + 8, y0 + 20 + k * 12, `${k + 1}. ${tagName(p?.name ?? '?').slice(0, over ? 14 : 9)}`, { origin: [0, 0], color: INK }));
      this.board.add(ink(this, x0 + w - 8, y0 + 20 + k * 12, over ? `${best.toFixed(1)} m  ${st.points[id].toFixed(1)}` : st.points[id].toFixed(1), { origin: [1, 0], color: INK }));
    });
  }

  private ensureFigure(id: string | null) {
    if (id === this.figId) return;
    this.figId = id;
    this.fig?.destroy();
    this.fig = null;
    const p = id ? playerById(id) : null;
    if (!p) return;
    this.fig = figure(this, p.look, 0, -1, 0.9);
    this.jumper.add(this.fig);
  }

  update() {
    const st = this.latest;
    if (!st) return;
    this.hud.update(st);
    const smp = this.buf.sample();
    if (!smp) return;
    const a = smp.a;
    const b = smp.b;
    const live = b.active === a.active;
    const pxm = live ? lerpJump(a.px, b.px, smp.f, 25) : b.px;
    const pym = live ? lerpJump(a.py, b.py, smp.f, 25) : b.py;
    const ang = live ? a.ang + (b.ang - a.ang) * smp.f : b.ang;
    const sub = b.sub;
    this.ensureFigure(st.active);
    const x = wx(pxm);
    const y = wy(pym);
    this.jumper.setPosition(x, y).setVisible(!!st.active && sub !== 'ready' && sub !== 'over');
    const flying = sub === 'flight';
    const fallen = sub === 'landed' && !!st.last?.fall;
    this.jumper.setRotation(fallen ? 1.3 : -ang);
    // Ski: im Anlauf parallel, im Flug als V
    const sk = this.skis;
    sk.clear();
    sk.lineStyle(2, 0x2d64a8, 1);
    if (flying) {
      sk.lineBetween(-8, 0, 13, -4);
      sk.lineBetween(-8, 1, 13, 4);
    } else sk.lineBetween(-10, 0, 13, 0);
    const img = this.fig?.getData('img') as Phaser.GameObjects.Image | undefined;
    if (img) {
      // Hocke im Anlauf, gestreckt im Flug (nach vorn gelegt)
      img.setScale(0.9, sub === 'inrun' || sub === 'countdown' ? 0.68 : 0.9);
      img.setAngle(flying ? 55 : sub === 'landed' && !fallen ? 0 : 20);
    }

    // Weite neben dem Springer
    const showDist = flying || sub === 'landed';
    this.distTxt.setVisible(showDist && b.dist > 0);
    if (showDist) this.distTxt.setText(`${b.dist.toFixed(1)} m`).setPosition(x, y - 30);

    // Kamera: Springer etwas links der Mitte, nach vorn mehr Platz
    const tx = x - (flying ? 190 : 220);
    const ty = y - (flying ? 120 : 150);
    const k = sub === 'ready' ? 0.06 : 0.14;
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.cameras.main.setScroll(Math.round(this.camX), Math.round(this.camY));
  }
}
