import Phaser from 'phaser';
import type { BowlingRoll, BowlingState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { BOWL, PIN_POS, scoreFrames } from '../../shared/bowling';
import { playerColor } from '../../shared/players';
import { bowlingBall, bowlingPin, paintBeachAlley, tikiTorch } from '../art/bowling';
import { crown } from '../art/objects';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { pcol } from './playerColor';
import { GOLD, INK, LIGHT, RED_INK, background, ensureTex, ink, panel, txt } from './ui';

// ------------------------------------------------------------------ Pseudo-3D-Projektion

/** Bahnansicht links, Anzeigetafel rechts */
const VIEW_W = 300;
const CX = VIEW_W / 2;
const HORIZON = 62;
const CAM_H = 100;
const FOCAL = 330;
const CAM_START = -170;
const CAM_END = BOWL.PIN_Y - 330;
const SIDE = BOWL.LANE_HALF + BOWL.GUTTER;
const CAP = SIDE + 22;
const WALL_Y = BOWL.PIT_END + 10;

const MARKS: Record<string, string> = { strike: 'STRIKE!', spare: 'SPARE!', gutter: 'Rinne …', miss: 'Daneben!' };
const STREAK = ['', '', 'DOPPEL-STRIKE!', 'TRUTHAHN!', 'VIERFACH!', 'FÜNFFACH!'];

interface Playback {
  roll: BowlingRoll;
  t0: number;
  bannerShown: boolean;
}

export class BowlingScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private pins: Phaser.GameObjects.Image[] = [];
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private torches: { img: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private sign!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Container;
  private rackG!: Phaser.GameObjects.Graphics;
  private board!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private intro!: Phaser.GameObjects.Container;
  private latest: GameState | null = null;
  private camZ = CAM_START;
  private play: Playback | null = null;
  private lastSeq = 0;
  private aimSeq = -1;
  private hudKey = '';
  private boardKey = '';
  private ballColor = '';
  private ballRot = 0;
  private overShown = false;

  constructor() {
    super('bowling');
  }

  create() {
    this.pins = [];
    this.torches = [];
    this.play = null;
    this.lastSeq = 0;
    this.aimSeq = -1;
    this.hudKey = '';
    this.boardKey = '';
    this.ballColor = '';
    this.camZ = CAM_START;
    this.overShown = false;

    background(this, 'bowling', WORLD.W, WORLD.H, (p) => paintBeachAlley(p, WORLD.W, WORLD.H, HORIZON));
    this.g = this.add.graphics().setDepth(-500);

    const flame0 = ensureTex(this, 'tiki0', () => tikiTorch(0));
    ensureTex(this, 'tiki1', () => tikiTorch(1));
    if (!this.anims.exists('tiki')) this.anims.create({ key: 'tiki', frames: [{ key: 'tiki0' }, { key: 'tiki1' }], frameRate: 4, repeat: -1 });
    for (let y = 150; y <= 1950; y += 300) {
      for (const side of [-1, 1]) {
        const img = this.add.sprite(0, 0, flame0).setOrigin(0.5, 1).play({ key: 'tiki', startFrame: (y / 300 + side) & 1 });
        this.torches.push({ img, x: side * (CAP + 30), y });
      }
    }

    const pinKey = ensureTex(this, 'bowlpin', bowlingPin);
    for (let i = 0; i < 10; i++) this.pins.push(this.add.image(0, 0, pinKey).setOrigin(0.5, 1));
    this.ballShadow = this.add.ellipse(0, 0, 10, 3, 0x000000, 0.25);
    this.ball = this.add.image(0, 0, ensureTex(this, 'bowlball_0', () => bowlingBall(playerColor(0).hex)));
    this.sign = txt(this, 0, 0, 'STRANDBAHN', { color: GOLD }).setOrigin(0.5, 0.5);

    // Anzeigetafel + HUD
    this.add.image(VIEW_W, 0, ensureTex(this, 'bowl_board_bg', () => {
      const c = document.createElement('canvas');
      c.width = WORLD.W - VIEW_W;
      c.height = WORLD.H;
      const g = c.getContext('2d')!;
      g.fillStyle = '#5e3518';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#8d5629';
      for (let x = 0; x < c.width; x += 10) g.fillRect(x, 0, 1, c.height);
      g.fillStyle = '#2d1b12';
      g.fillRect(0, 0, 2, c.height);
      return c;
    })).setOrigin(0, 0).setDepth(20000);
    this.board = this.add.container(0, 0).setDepth(20001);
    this.hud = this.add.container(0, 0).setDepth(20001);
    this.rackG = this.add.graphics().setDepth(20002);
    this.banner = txt(this, CX, 168, '', { size: 24, color: GOLD }).setDepth(20010);
    this.bannerSub = txt(this, CX, 198, '', { size: 8, color: LIGHT }).setDepth(20010);
    this.intro = this.add.container(0, 0).setDepth(20005);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private get st(): BowlingState | null {
    return this.latest?.mini?.kind === 'bowling' ? this.latest.mini.state : null;
  }

  private onState(s: GameState) {
    this.latest = s;
    const st = this.st;
    if (!st) return;

    if (st.sub === 'roll' && st.last?.track && st.last.seq !== this.lastSeq) {
      this.lastSeq = st.last.seq;
      this.play = { roll: st.last, t0: this.time.now, bannerShown: false };
      this.setBallColor(st.last.playerId);
      this.hideBanner();
    }
    if (st.sub === 'aim' && st.aimSeq !== this.aimSeq) {
      this.aimSeq = st.aimSeq;
      this.play = null;
      this.hideBanner();
      this.setBallColor(st.turn);
    }
    if (st.sub === 'over' && !this.overShown) {
      this.overShown = true;
      this.showBanner('ENDSTAND', `${this.leaderName(st)} gewinnt!`, GOLD);
    }

    this.renderIntro(st);
    this.renderHud(st);
    this.renderBoard(st);
  }

  private leaderName(st: BowlingState) {
    const best = [...st.order].sort((a, b) => scoreFrames(st.rolls[b], st.frames).total - scoreFrames(st.rolls[a], st.frames).total)[0];
    return playerById(best)?.name ?? '?';
  }

  private setBallColor(id: string) {
    const col = pcol(id).hex;
    if (col === this.ballColor) return;
    this.ballColor = col;
    this.ball.setTexture(ensureTex(this, `bowlball_${col}`, () => bowlingBall(col)));
  }

  // ---------------------------------------------------------------- Projektion

  private proj(x: number, y: number, h = 0) {
    const d = Math.max(1, y - this.camZ);
    const s = FOCAL / d;
    return { x: CX + x * s, y: HORIZON + (CAM_H - h) * s, s, d };
  }

  /** Fläche auf dem Boden (x1…x2, y1…y2) */
  private quad(x1: number, x2: number, y1: number, y2: number, color: number, alpha = 1) {
    const near = Math.max(y1, this.camZ + 25);
    if (y2 <= near) return;
    const a = this.proj(x1, near);
    const b = this.proj(x2, near);
    const c = this.proj(x2, y2);
    const d = this.proj(x1, y2);
    this.g.fillStyle(color, alpha).fillPoints([a, b, c, d], true);
  }

  private line(x1: number, y1: number, x2: number, y2: number, color: number, width = 1, alpha = 1) {
    const near = this.camZ + 25;
    if (y1 < near && y2 < near) return;
    if (y1 < near) {
      x1 = x1 + ((x2 - x1) * (near - y1)) / (y2 - y1);
      y1 = near;
    }
    if (y2 < near) {
      x2 = x2 + ((x1 - x2) * (near - y2)) / (y1 - y2);
      y2 = near;
    }
    const a = this.proj(x1, y1);
    const b = this.proj(x2, y2);
    this.g.lineStyle(width, color, alpha).lineBetween(a.x, a.y, b.x, b.y);
  }

  /** senkrechte Wand quer zur Bahn bei y, Höhe h1…h2 */
  private wall(x1: number, x2: number, y: number, h1: number, h2: number, color: number) {
    const a = this.proj(x1, y, h1);
    const b = this.proj(x2, y, h2);
    this.g.fillStyle(color).fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
  }

  /** Seitenwand längs der Bahn bei x, von y1 bis y2, Höhe 0…h */
  private sideWall(x: number, y1: number, y2: number, h: number, color: number) {
    const near = Math.max(y1, this.camZ + 25);
    if (y2 <= near) return;
    this.g.fillStyle(color).fillPoints([this.proj(x, near), this.proj(x, y2), this.proj(x, y2, h), this.proj(x, near, h)], true);
  }

  // ---------------------------------------------------------------- Zeichnen

  update(time: number) {
    const st = this.st;
    if (!st) return;

    // Abspielposition
    let ballPos: { x: number; y: number } | null = null;
    let frame = 0;
    const tr = this.play?.roll.track;
    if (this.play && tr) {
      const f = ((time - this.play.t0) / 1000) / tr.dt;
      frame = Math.min(tr.frames - 1, f);
      ballPos = this.sampleBall(tr.ball, frame);
      if (f >= tr.frames - 1 && !this.play.bannerShown) {
        this.play.bannerShown = true;
        this.showResult(this.play.roll);
        this.renderBoard(st);
      }
    } else if (st.sub === 'aim') {
      ballPos = { x: st.aimX * BOWL.START_X, y: 0 };
    }

    // Kamera folgt der Kugel
    const target = ballPos && this.play ? Math.max(CAM_START, Math.min(CAM_END, ballPos.y - 260)) : this.play ? this.camZ : CAM_START;
    this.camZ += (target - this.camZ) * (this.play ? 0.25 : 0.12);

    this.drawAlley();
    this.drawTorches();
    this.drawPins(st, frame);
    this.drawBall(ballPos, tr?.gutterAt ?? -1, frame);
    this.drawRack(st, frame);
  }

  private sampleBall(arr: number[], f: number) {
    const n = arr.length / 2;
    const i = Math.min(n - 1, Math.floor(f));
    const j = Math.min(n - 1, i + 1);
    const t = f - i;
    return { x: arr[i * 2] + (arr[j * 2] - arr[i * 2]) * t, y: arr[i * 2 + 1] + (arr[j * 2 + 1] - arr[i * 2 + 1]) * t };
  }

  private drawAlley() {
    const g = this.g;
    g.clear();
    const far = WALL_Y;
    // Anlauf + Holzdeck neben der Bahn
    this.quad(-CAP, CAP, -400, 0, 0xd9a868);
    this.quad(-CAP, -SIDE, 0, far, 0xa86d3a);
    this.quad(SIDE, CAP, 0, far, 0xa86d3a);
    this.line(-CAP, 0, -CAP, far, 0x5e3518);
    this.line(CAP, 0, CAP, far, 0x5e3518);
    // Rinnen
    this.quad(-SIDE, -BOWL.LANE_HALF, -10, BOWL.DECK_END, 0x8b8f99);
    this.quad(BOWL.LANE_HALF, SIDE, -10, BOWL.DECK_END, 0x8b8f99);
    this.line(-SIDE + 8, -10, -SIDE + 8, BOWL.DECK_END, 0x6c707a, 2);
    this.line(SIDE - 8, -10, SIDE - 8, BOWL.DECK_END, 0x6c707a, 2);
    // Bahn (Ahorn) mit Streifen alle 5 Bretter
    this.quad(-BOWL.LANE_HALF, BOWL.LANE_HALF, -10, BOWL.PIN_Y - 40, 0xe9b878);
    for (let k = -3; k <= 3; k += 2) this.quad(k * 13.45 - 6.7, k * 13.45 + 6.7, 0, BOWL.PIN_Y - 40, 0xdcaa69, 0.8);
    for (let k = -3; k <= 3; k++) this.line(k * 13.45, 0, k * 13.45, BOWL.PIN_Y - 40, 0xc48e52, 1, 0.7);
    // Pindeck heller
    this.quad(-BOWL.LANE_HALF, BOWL.LANE_HALF, BOWL.PIN_Y - 40, BOWL.DECK_END, 0xf3d3a0);
    // Foullinie, Punkte, Pfeile
    this.quad(-BOWL.LANE_HALF, BOWL.LANE_HALF, -2, 2, 0x2d1b12);
    const board = 105 / 39;
    for (const b of [3, 5, 8, 11, 14]) {
      for (const sgn of [-1, 1]) {
        const x = sgn * (19.5 - b) * board;
        this.quad(x - 1.5, x + 1.5, 211, 216, 0x8d5629);
      }
    }
    for (const b of [5, 10, 15, 20, 25, 30, 35]) {
      const x = (b - 19.5) * board;
      const y = 457 + Math.abs(b - 20) * 12;
      const a = this.proj(x - 2.5, y);
      if (a.d < 25) continue;
      const c = this.proj(x + 2.5, y);
      const tip = this.proj(x, y + 40);
      g.fillStyle(0x7a3b1c).fillTriangle(a.x, a.y, c.x, c.y, tip.x, tip.y);
    }
    // Pin-Markierungen
    for (const p of PIN_POS) {
      const c = this.proj(p.x, p.y);
      if (c.d > 25) g.fillStyle(0xc49a62).fillEllipse(c.x, c.y, 6 * c.s * 2, 6 * c.s * 0.8);
    }
    // Schacht + Seitenwände (Kickbacks)
    this.quad(-SIDE, SIDE, BOWL.DECK_END, far, 0x1c1430);
    this.sideWall(-SIDE, BOWL.PIN_Y - 60, far, 70, 0x6b3f1f);
    this.sideWall(SIDE, BOWL.PIN_Y - 60, far, 70, 0x6b3f1f);
    // Rückwand: dunkler Vorhang, Bambus-Blende mit Schild, Strohdach
    this.wall(-CAP, CAP, far, 0, 100, 0x231a3a);
    this.wall(-CAP, CAP, far, 100, 160, 0xc9a46a);
    const top = this.proj(0, far, 160);
    const bot = this.proj(0, far, 100);
    for (let i = 0; i < 12; i++) {
      const x = -CAP + (i * CAP * 2) / 12;
      const a = this.proj(x, far, 100);
      g.fillStyle(0xa07a44).fillRect(a.x, top.y, Math.max(1, top.s * 2), bot.y - top.y);
    }
    this.wall(-CAP - 10, CAP + 10, far, 160, 185, 0xe8c25a);
    const roofL = this.proj(-CAP - 10, far, 160);
    const roofR = this.proj(CAP + 10, far, 160);
    const step = Math.max(2, 12 * roofL.s);
    g.fillStyle(0xc99a2e);
    for (let x = roofL.x; x < roofR.x; x += step) g.fillTriangle(x, roofL.y, x + step, roofL.y, x + step / 2, roofL.y + step * 0.8);
    // Bambuspfosten
    for (const sx of [-CAP - 6, CAP + 6]) {
      const a = this.proj(sx - 5, far, 0);
      const b = this.proj(sx + 5, far, 185);
      g.fillStyle(0x8d5629).fillRect(a.x, b.y, Math.max(1, b.x - a.x), a.y - b.y);
    }
    const sc = top.s * 2.6;
    this.sign.setPosition(CX, (top.y + bot.y) / 2).setScale(Math.max(0.01, sc)).setVisible(sc > 0.7).setDepth(-400);
  }

  private drawTorches() {
    for (const t of this.torches) {
      const p = this.proj(t.x, t.y);
      const visible = p.d > 60 && p.x > -40 && p.x < VIEW_W + 40;
      t.img.setVisible(visible);
      if (!visible) continue;
      t.img.setPosition(p.x, p.y).setScale((150 * p.s) / 34).setDepth(10000 - p.d);
    }
  }

  private drawPins(st: BowlingState, frame: number) {
    const tr = this.play?.roll.track;
    for (let i = 0; i < 10; i++) {
      const img = this.pins[i];
      let x = PIN_POS[i].x;
      let y = PIN_POS[i].y;
      let angle = 0;
      let show: boolean;
      if (tr) {
        const arr = tr.pins[i];
        show = !!arr;
        if (arr) {
          if (arr.length > 2) {
            const p = this.sampleBall(arr, frame);
            x = p.x;
            y = p.y;
          } else {
            x = arr[0];
            y = arr[1];
          }
          const down = tr.downAt[i];
          if (down >= 0 && frame >= down) {
            const k = Math.min(1, (frame - down) / 4);
            angle = (x >= PIN_POS[i].x ? 1 : -1) * 88 * k;
          }
        }
        if (y > BOWL.DECK_END + 15) show = false;
      } else {
        show = st.sub === 'intro' || st.rack[i];
      }
      img.setVisible(show);
      if (!show) continue;
      const p = this.proj(x, y);
      img.setPosition(p.x, p.y).setScale((38 * p.s) / 30).setAngle(angle).setDepth(10000 - p.d);
      img.setTint(angle ? 0xd8d0c4 : 0xffffff);
    }
  }

  private drawBall(pos: { x: number; y: number } | null, gutterAt: number, frame: number) {
    const inPit = !!pos && pos.y > BOWL.DECK_END + 5;
    const show = !!pos && !inPit && (this.st?.sub === 'aim' || !!this.play);
    this.ball.setVisible(show);
    this.ballShadow.setVisible(show);
    if (!show || !pos) return;
    const sink = gutterAt >= 0 && frame >= gutterAt ? 6 : 0;
    const p = this.proj(pos.x, pos.y, BOWL.BALL_R - sink);
    const f = this.proj(pos.x, pos.y);
    const scale = (2 * BOWL.BALL_R * p.s) / 16;
    if (this.play) this.ballRot += 0.25;
    this.ball.setPosition(p.x, p.y).setScale(scale).setRotation(this.ballRot).setDepth(10000 - p.d + 0.5);
    this.ballShadow.setPosition(f.x, f.y).setSize(22 * f.s, 6 * f.s).setDepth(10000 - p.d);
  }

  /** kleine Pin-Anzeige oben rechts in der Bahnansicht */
  private drawRack(st: BowlingState, frame: number) {
    const g = this.rackG;
    g.clear();
    const tr = this.play?.roll.track;
    const ox = VIEW_W - 30;
    const oy = 34;
    g.fillStyle(0x2d1b12, 0.75).fillRoundedRect(ox - 26, oy - 30, 52, 36, 4);
    for (let i = 0; i < 10; i++) {
      const p = PIN_POS[i];
      const x = ox + (p.x / BOWL.PIN_GAP) * 10;
      const y = oy - ((p.y - BOWL.PIN_Y) / 26.4) * 8;
      let state: 'up' | 'down' | 'none';
      if (tr) state = !tr.pins[i] ? 'none' : tr.downAt[i] >= 0 && frame >= tr.downAt[i] ? 'down' : 'up';
      else state = st.rack[i] || st.sub === 'intro' ? 'up' : 'none';
      if (state === 'up') g.fillStyle(0xfdf7ea).fillCircle(x, y, 3);
      else if (state === 'down') g.fillStyle(0xe04a3f).fillCircle(x, y, 3);
      else g.lineStyle(1, 0x8d8070).strokeCircle(x, y, 2.5);
    }
  }

  // ---------------------------------------------------------------- Banner

  private showResult(roll: BowlingRoll) {
    const name = playerById(roll.playerId)?.name ?? '?';
    if (roll.mark === 'strike') {
      this.showBanner(roll.streak >= 2 ? STREAK[Math.min(roll.streak, STREAK.length - 1)] : 'STRIKE!', name, GOLD);
      this.confetti();
    } else if (roll.mark === 'spare') this.showBanner('SPARE!', `${name} räumt ab`, '#7fe0d0');
    else if (roll.mark === 'pins') this.showBanner(`${roll.knocked} ${roll.knocked === 1 ? 'Pin' : 'Pins'}`, name, LIGHT);
    else this.showBanner(MARKS[roll.mark], name, '#b8c4d6');
  }

  private showBanner(text: string, sub: string, color: string) {
    this.banner.setText(text).setColor(color).setScale(text.length > 9 ? 0.67 : 1).setAlpha(1);
    this.bannerSub.setText(sub).setAlpha(1);
    const base = this.banner.scale;
    this.banner.setScale(base * 0.3);
    this.tweens.add({ targets: this.banner, scale: base, duration: 380, ease: 'Back.Out' });
  }

  private hideBanner() {
    this.banner.setText('');
    this.bannerSub.setText('');
  }

  private confetti() {
    const cols = [0xffd25e, 0xe04a3f, 0x3f8fe0, 0x46b04a, 0xf07aa8];
    for (let i = 0; i < 36; i++) {
      const r = this.add.rectangle(CX + (Math.random() - 0.5) * 60, 110, 3, 3, cols[i % cols.length]).setDepth(20009);
      this.tweens.add({
        targets: r,
        x: r.x + (Math.random() - 0.5) * 240,
        y: 110 + (Math.random() - 0.3) * 170,
        angle: Math.random() * 360,
        alpha: 0,
        duration: 1200 + Math.random() * 600,
        ease: 'Quad.Out',
        onComplete: () => r.destroy(),
      });
    }
  }

  // ---------------------------------------------------------------- HUD + Anzeigetafel

  private renderIntro(st: BowlingState) {
    const want = st.sub === 'intro';
    if (want === this.intro.visible && this.intro.length) return;
    this.intro.removeAll(true).setVisible(want);
    if (!want) return;
    this.intro.add(panel(this, 20, 70, 260, 94));
    this.intro.add(ink(this, CX, 82, 'STRAND-BOWLING', { size: 16, color: RED_INK }));
    this.intro.add(
      ink(
        this,
        CX,
        108,
        `${st.frames} Frames pro Person.\nHandy halten, schwingen,\nloslassen – oder wischen.\nStrike: alle 10 Pins!`,
        { wrap: 240 },
      ),
    );
  }

  private renderHud(st: BowlingState) {
    const who = st.sub === 'roll' && st.last ? st.last.playerId : st.turn;
    const key = JSON.stringify([st.sub, who, st.frame, st.ball]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub === 'intro' || st.sub === 'over') return;
    const p = playerById(who);
    this.hud.add(panel(this, 3, 3, 150, 32));
    if (p) this.hud.add(this.add.rectangle(17, 28, 18, 17, pcol(who).num).setOrigin(0.5, 1));
    if (p) this.hud.add(this.add.image(17, 27, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
    this.hud.add(ink(this, 30, 9, (p?.name ?? '?').slice(0, 12), { origin: [0, 0], color: RED_INK }));
    const status = st.sub === 'aim' ? `Frame ${st.frame + 1}/${st.frames} · Wurf ${st.ball + 1}` : 'wirft …';
    this.hud.add(ink(this, 30, 21, status, { origin: [0, 0] }));
  }

  private renderBoard(st: BowlingState) {
    const active = st.sub === 'roll' && st.last ? st.last.playerId : st.turn;
    // Während die Kugel noch rollt, das Ergebnis nicht schon auf der Tafel verraten
    const rolls = { ...st.rolls };
    if (st.sub === 'roll' && st.last && this.play?.roll.seq === st.last.seq && !this.play.bannerShown) {
      rolls[st.last.playerId] = rolls[st.last.playerId].slice(0, -1);
    }
    const key = JSON.stringify([rolls, active, st.sub === 'over']);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    const x0 = VIEW_W + 4;
    const w = WORLD.W - x0 - 3;
    const n = st.order.length;
    const rowH = Math.min(26, Math.floor((WORLD.H - 22) / n));
    this.board.add(ink(this, x0 + w / 2, 5, 'ANZEIGETAFEL', { color: GOLD }));
    const nameW = 34;
    const totalW = 26;
    const lastW = 26;
    const fx0 = x0 + 20 + nameW;
    const boxW = st.frames > 1 ? Math.floor((w - 20 - nameW - totalW - lastW) / (st.frames - 1)) : 0;
    const sorted = st.sub === 'over' ? [...st.order].sort((a, b) => scoreFrames(st.rolls[b], st.frames).total - scoreFrames(st.rolls[a], st.frames).total) : st.order;
    sorted.forEach((id, i) => {
      const y = 20 + i * rowH;
      const pl = playerById(id);
      const sc = scoreFrames(rolls[id] ?? [], st.frames);
      const isActive = id === active && st.sub !== 'over';
      const bg = this.add.rectangle(x0, y, w, rowH - 2, isActive ? 0xf7e4b5 : 0xe6c88a, isActive ? 1 : 0.85).setOrigin(0, 0);
      bg.setStrokeStyle(1, 0x2d1b12);
      this.board.add(bg);
      this.board.add(this.add.rectangle(x0 + 1, y + 1, 3, rowH - 4, pcol(id).num).setOrigin(0, 0));
      if (pl) this.board.add(this.add.image(x0 + 10, y + rowH - 3, ensurePortrait(this, pl.look)).setOrigin(0.5, 1));
      const nm = (pl?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 4);
      this.board.add(ink(this, x0 + 20, y + (rowH - 2) / 2, nm, { origin: [0, 0.5], color: isActive ? RED_INK : INK }));
      sc.frames.forEach((f, k) => {
        const last = k === st.frames - 1;
        const bx = fx0 + k * boxW;
        const bw = last ? lastW : boxW;
        this.board.add(this.add.rectangle(bx, y + 2, bw - 1, rowH - 6, 0xfdf7ea, 0.7).setOrigin(0, 0));
        const m = f.marks.join('');
        if (m) {
          const t = ink(this, bx + bw / 2, y + (rowH - 2) / 2, m, { origin: [0.5, 0.5], color: m.includes('X') ? RED_INK : INK });
          if (t.width > bw - 1) t.setScale((bw - 1) / t.width, 1);
          this.board.add(t);
        }
      });
      const tot = ink(this, x0 + w - 2, y + (rowH - 2) / 2, String(sc.total), { origin: [1, 0.5], color: RED_INK });
      this.board.add(tot);
      if (st.sub === 'over' && i === 0) this.board.add(this.add.image(x0 + 10, y + 3, ensureTex(this, 'crown', crown)).setOrigin(0.5, 1));
    });
  }
}
