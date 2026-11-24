import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { SUP, TIDY, tidyItemType } from '../../shared/games';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintShore, paintTiles, paintWater, paintWoodFloor } from '../art/ground';
import { basket, buoy, clutter, jellyfish, seaRock, supBoard } from '../art/props2';
import { bus, getState, playerById } from './store';
import { type Figure, figure } from './textures';
import { BLUE_INK, Countdown, NameTags, RED_INK, background, ensureTex, ink, panel, prop, tagName, txt } from './ui';
import { Pix } from '../art/pix';
import { SnapBuffer, lerpAngle, lerpJump } from './interp';
import { Juice } from './juice';
import { sfx } from './sfx';
import { daylight, foam, gulls, sway } from './ambient';
import { pcol } from './playerColor';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// ================================================================== SUP-Rennen

export class SupScene extends Phaser.Scene {
  private boards = new Map<number, { root: Phaser.GameObjects.Container; board: Phaser.GameObjects.Image; figs: Phaser.GameObjects.Container[]; x: number; y: number; strokes: number }>();
  /** Hindernis-Bilder (Index wie im State) – gerammte Bojen/Quallen verschwinden */
  private obstacleImgs: (Phaser.GameObjects.Image | null)[] = [];
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: GameState | null = null;
  private hudKey = '';
  private built = false;
  private juice!: Juice;
  private supFx = new Map<number, { fallen: boolean; finished: boolean }>();
  private finishers = 0;

  constructor() {
    super('sup');
  }

  create() {
    this.boards.clear();
    this.obstacleImgs = [];
    this.built = false;
    this.hudKey = '';
    this.supFx.clear();
    this.finishers = 0;
    this.juice = new Juice(this, { depth: 900 });
    const W = SUP.LENGTH + 140;
    const bg = background(this, 'sea', W, WORLD.H, (p) => {
      paintWater(p, 0, 0, W, WORLD.H, 501);
      // Strände oben und unten
      paintSand(p, 0, 0, W, SUP.TOP - 12, 502);
      paintShore(p, 0, SUP.TOP - 12, W, 503);
      paintSand(p, 0, SUP.BOTTOM + 12, W, WORLD.H - SUP.BOTTOM - 12, 504);
      for (let x = 0; x < W; x++) p.vline(x, SUP.BOTTOM + 10, 2, C.foam);
      // Start- und Ziellinie
      for (let y = SUP.TOP; y < SUP.BOTTOM; y += 8) {
        p.rect(30, y, 3, 4, C.white);
        p.rect(SUP.LENGTH, y, 4, 4, (y / 8) % 2 ? C.white : C.outline).rect(SUP.LENGTH + 4, y + 4, 4, 4, (y / 8) % 2 ? C.outline : C.white);
      }
    });
    bg.setScrollFactor(1);
    const palmsL: Phaser.GameObjects.Image[] = [];
    for (let x = 60; x < W; x += 180) {
      palmsL.push(prop(this, 'palm', () => O.palm(6), x, SUP.TOP - 6).setScale(0.7));
      prop(this, 'umbrellaB', () => O.umbrella(C.blue), x + 90, WORLD.H + 6).setDepth(300);
    }
    sway(this, palmsL);
    daylight(this, { depth: -950, w: W });
    // Leeres Wasser beleben: Möwen (bildfest), Wellenschaum an beiden Stränden
    gulls(this, { n: 3, y: [SUP.TOP + 10, SUP.BOTTOM - 10], depth: 950, scroll: 0 });
    foam(this, { y: SUP.TOP - 11, x: [0, W], n: Math.round(W / 36), depth: -900, spread: 1 });
    foam(this, { y: SUP.BOTTOM + 11, x: [0, W], n: Math.round(W / 36), depth: -900, spread: 1 });
    this.cameras.main.setBounds(0, 0, W, WORLD.H);
    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 110, '', { size: 24, color: C.gold }).setScrollFactor(0).setDepth(1001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private build(s: GameState) {
    if (s.mini?.kind !== 'sup' || this.built) return;
    this.built = true;
    for (const o of s.mini.state.obstacles) {
      const key = o.type === 'buoy' ? ensureTex(this, 'buoy', buoy) : o.type === 'rock' ? ensureTex(this, 'searock', seaRock) : ensureTex(this, 'jelly', jellyfish);
      const img = this.add.image(o.x, o.y, key).setDepth(o.y).setVisible(!o.gone);
      this.obstacleImgs.push(o.gone ? null : img);
      if (o.type !== 'rock') this.tweens.add({ targets: img, y: o.y - 1.5, duration: 700 + Math.random() * 400, yoyo: true, repeat: -1 });
    }
    for (const b of s.mini.state.boards) {
      const board = this.add.image(0, 0, ensureTex(this, `sup_${b.color}`, () => supBoard(hex(b.color))));
      const root = this.add.container(b.x, b.y, [board]);
      const figs: Phaser.GameObjects.Container[] = [];
      const members = b.left === b.right ? [b.left] : [b.left, b.right];
      members.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const f = figure(this, p.look, members.length === 2 ? (i === 0 ? -7 : 7) : 0, 2);
        root.add(f);
        figs.push(f);
      });
      this.boards.set(b.id, { root, board, figs, x: b.x, y: b.y, strokes: 0 });
    }
  }

  update() {
    const s = this.latest;
    if (s?.mini?.kind !== 'sup') return;
    let lead = 0;
    for (const b of s.mini.state.boards) {
      const a = this.boards.get(b.id);
      if (!a) continue;
      a.x += (b.x - a.x) * 0.3;
      a.y += (b.y - a.y) * 0.3;
      a.root.setPosition(a.x, a.y).setDepth(a.y + 10);
      a.board.setRotation(b.heading);
      const wobble = Math.sin(this.time.now / 90) * b.balance * 6;
      for (const f of a.figs) f.setAngle(b.fallen ? 80 : wobble).setAlpha(b.fallen ? 0.5 : 1);
      lead = Math.max(lead, a.x);
    }
    const cam = this.cameras.main;
    cam.scrollX += (Math.max(0, lead - 260) - cam.scrollX) * 0.08;
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'sup') return;
    this.build(s);
    const st = s.mini.state;
    st.obstacles.forEach((o, i) => {
      const img = this.obstacleImgs[i];
      if (!o.gone || !img) return;
      // Gerammt: Platscher, Boje treibt weg bzw. Qualle taucht ab
      this.obstacleImgs[i] = null;
      this.tweens.killTweensOf(img);
      this.juice.burst(o.x, o.y, 'splash', 8);
      this.tweens.add({ targets: img, alpha: 0, scale: 0.4, y: o.y + 6, duration: 380, onComplete: () => img.destroy() });
      sfx('splash', { vol: 0.4, pitch: o.type === 'jelly' ? 1.4 : 1 });
    });
    for (const b of st.boards) {
      const a = this.boards.get(b.id);
      if (!a) continue;
      const total = b.strokes.left + b.strokes.right;
      if (total !== a.strokes) {
        a.strokes = total;
        const side = b.strokes.left >= b.strokes.right ? -1 : 1;
        const sx = a.x + Math.cos(b.heading + (side * Math.PI) / 2) * 9;
        const sy = a.y + Math.sin(b.heading + (side * Math.PI) / 2) * 9;
        const splash = this.add.circle(sx, sy, 3, 0xeaf8ff, 0.9).setDepth(a.y + 11);
        this.tweens.add({ targets: splash, scale: 2.4, alpha: 0, duration: 380, onComplete: () => splash.destroy() });
        sfx('splash', { pan: 0, vol: 0.18, pitch: 1.8 });
      }
      // Umgekippt / im Ziel
      const fx = this.supFx.get(b.id) ?? { fallen: b.fallen, finished: b.finished };
      if (b.fallen && !fx.fallen) {
        sfx('splash', { pitch: 0.7 });
        this.juice.burst(a.x, a.y, 'splash', 16);
        this.juice.shake(1);
      }
      if (b.finished && !fx.finished) {
        this.finishers += 1;
        sfx(this.finishers === 1 ? 'fanfare' : 'coin');
        this.juice.burst(a.x, a.y - 10, 'confetti', this.finishers === 1 ? 40 : 16);
      }
      this.supFx.set(b.id, { fallen: b.fallen, finished: b.finished });
    }
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000))));
    else if (st.sub === 'race') this.banner.setText('');
    else this.banner.setText('Ziel!');

    const key = JSON.stringify([Math.ceil(st.endsIn / 1000), st.boards.map((b) => [Math.round((b.x / st.length) * 120), b.fallen, b.finished])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    // Fortschrittsbalken statt Textzeile: Strecke von Start bis Ziel, pro Board ein Marker in Boardfarbe
    const n = st.boards.length;
    const lanes = n > 3 ? 2 : 1;
    const h = 30 + (lanes - 1) * 12;
    this.hud.add(panel(this, 10, 0, 460, h));
    this.hud.add(ink(this, 22, 8, `${Math.ceil(st.endsIn / 1000)}s`, { origin: [0, 0] }));
    const x0 = 64;
    const x1 = 446;
    const g = this.add.graphics();
    this.hud.add(g);
    for (let l = 0; l < lanes; l++) {
      const y = 13 + l * 12;
      g.fillStyle(0x2d1b12).fillRect(x0 - 1, y - 1, x1 - x0 + 2, 4);
      g.fillStyle(0x93d3f3).fillRect(x0, y, x1 - x0, 2);
    }
    // Ziel: Schachbrett-Fähnchen
    for (let k = 0; k < 4; k++) g.fillStyle(k % 2 ? 0xffffff : 0x2d1b12).fillRect(x1 + 2, 6 + k * 3, 3, 3).fillStyle(k % 2 ? 0x2d1b12 : 0xffffff).fillRect(x1 + 5, 6 + k * 3, 3, 3);
    st.boards.forEach((b, i) => {
      const lane = lanes > 1 ? i % 2 : 0;
      const y = 14 + lane * 12;
      const f = Math.max(0, Math.min(1, b.x / st.length));
      const x = x0 + f * (x1 - x0);
      g.fillStyle(0x2d1b12).fillRect(x - 4, y - 5, 8, 9);
      g.fillStyle(b.finished ? 0xffd25e : b.color).fillRect(x - 3, y - 4, 6, 7);
      if (b.fallen) g.fillStyle(0xeaf8ff, 0.9).fillRect(x - 3, y - 1, 6, 2);
      const short = (id: string) => tagName(playerById(id)?.name ?? '?').charAt(0).toUpperCase();
      const label = b.left === b.right ? short(b.left) : `${short(b.left)}${short(b.right)}`;
      const t = ink(this, x, y + 4, label, { color: b.fallen ? BLUE_INK : RED_INK }).setScale(0.75);
      if (lanes === 1 || lane === 1) this.hud.add(t);
      else t.destroy();
    });
  }
}

// ================================================================== Aufräumen

/**
 * Besenkopf in Draufsicht, Kante nach rechts (= Blickrichtung): Rücken in Teamfarbe, davor die Borsten.
 * 24 px quer (= Besenbreite 2 × BROOM_HALF + 2) + 1 px Rand für die Kontur.
 */
function broomHead(team: string): Pix {
  const L = TIDY.BROOM_HALF * 2 + 2;
  const p = new Pix(9, L + 2);
  p.rect(1, 2, 3, L - 2, team);
  p.rect(2, 1 + L / 2 - 2, 2, 4, C.woodDark);
  p.rect(4, 1, 4, L, '#e8c46a');
  for (let y = 2; y < L; y += 2) p.hline(5, y, 3, '#c99a3e');
  p.vline(7, 1, L, '#f6dc8e');
  p.outline(C.outline);
  return p;
}

/** Tiefe auf dem Fußboden (Figuren, Besen, Sachen nach y sortiert) */
const tdDepth = (y: number) => 100 + y;

type TidySnap = import('../../shared/types').TidyState;
type TidyItemSnap = TidySnap['items'][number];

/** Sachen eines Standes nach id (pro Stand einmal gebaut) */
const tidyItemIndex = new WeakMap<TidySnap, Map<number, TidyItemSnap>>();
function itemsOf(s: TidySnap) {
  let m = tidyItemIndex.get(s);
  if (!m) {
    m = new Map(s.items.map((it) => [it.id, it]));
    tidyItemIndex.set(s, m);
  }
  return m;
}

interface TidyFig {
  f: Figure;
  head: Phaser.GameObjects.Image;
  stick: Phaser.GameObjects.Graphics;
  dash: boolean;
  dustAt: number;
}

/**
 * Aufräumen: Figuren mit Besen, Sachen und Körbe laufen über den SnapBuffer – 40 ms hinter dem Server zwischen
 * zwei echten Ständen interpoliert (früher: Figuren pro Bild nachgezogen, Sachen hart auf den 20-Hz-Stand gesetzt).
 */
export class TidyScene extends Phaser.Scene {
  private figs = new Map<string, TidyFig>();
  private items = new Map<number, Phaser.GameObjects.Image>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: TidySnap | null = null;
  private buf = new SnapBuffer<TidySnap>();
  private clock = new Countdown();
  private phase = '';
  private hudKey = '';
  private lastScore = 0;
  private builtBaskets = false;
  private tags!: NameTags;
  private juice!: Juice;
  private names = new Map<string, { name: string; color: string }>();

  constructor() {
    super('tidy');
  }

  create() {
    this.tags = new NameTags(this, 900);
    this.names.clear();
    this.figs.clear();
    this.items.clear();
    this.latest = null;
    this.buf = new SnapBuffer();
    this.juice = new Juice(this, { depth: 950, clock: this.buf });
    this.clock = new Countdown();
    this.phase = '';
    this.hudKey = '';
    this.lastScore = 0;
    this.builtBaskets = false;
    const A = TIDY.AREA;
    background(this, 'tidyroom', WORLD.W, WORLD.H, (p) => {
      p.rect(0, 0, WORLD.W, WORLD.H, C.woodDarker);
      // Tapete
      p.rect(0, 0, WORLD.W, A.y, '#d9c7a0');
      for (let x = 0; x < WORLD.W; x += 12) p.vline(x, 0, A.y, '#cbb78e');
      for (const wx of [120, 300]) {
        p.rect(wx, 6, 60, 26, C.woodDarker);
        p.rect(wx + 2, 8, 56, 22, '#9fd8f5');
        p.rect(wx + 2, 8, 56, 8, '#c8ecfb');
        p.vline(wx + 30, 8, 22, C.woodDarker);
      }
      paintWoodFloor(p, A.x, A.y, A.w, A.h, 601);
      paintTiles(p, A.x + A.w / 2 - 70, A.y + A.h / 2 - 40, 140, 80, '#c25f52', '#d97a66', 10);
      p.rect(A.x - 4, A.y - 4, A.w + 8, 4, C.woodDark);
    });
    prop(this, 'plant', O.plant, A.x + 8, A.y + 14).setDepth(5);
    prop(this, 'plant', O.plant, A.x + A.w - 8, A.y + 14).setDepth(5);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 120, '', { size: 24, color: C.gold }).setDepth(1001);
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
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
    const now = this.time.now;
    const specs: { id: string; x: number; y: number; name: string; color: string; dot?: number }[] = [];
    for (const [id, p] of Object.entries(s.b.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      const pa = s.a.players[id] ?? p;
      const x = lerpJump(pa.x, p.x, s.f, 30);
      const y = lerpJump(pa.y, p.y, s.f, 30);
      const ang = lerpAngle(pa.a, p.a, Math.min(1, s.f));
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(p.dir < 0);
      a.f.play(p.moving || p.dash ? 'walk' : 'idle', p.dash ? 2 : 1);
      // Füße (Schatten) genau auf der Physik-Position – Besen und Sachen liegen auf derselben Ebene
      const d = tdDepth(y);
      a.f.setPosition(x, y + 1).setDepth(d);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const front = sn > -0.2;
      const hx = x + c * (TIDY.BROOM_D + 0.5);
      const hy = y + sn * (TIDY.BROOM_D + 0.5);
      a.head.setPosition(hx, hy).setRotation(ang).setDepth(d + (front ? 0.6 : -0.6));
      // Stiel: vom Besenrücken schräg hoch zu den Händen
      const bx = x + c * (TIDY.BROOM_D - 6);
      const by = y + sn * (TIDY.BROOM_D - 6);
      const handX = x + c * 3;
      const handY = y - 10 + sn * 2;
      a.stick.clear().lineStyle(3, 0x2d1b12).lineBetween(bx, by, handX, handY).lineStyle(1, 0xc08a4a).lineBetween(bx, by, handX, handY);
      a.stick.setDepth(d + (front ? 0.5 : -0.7));
      if (p.dash && !a.dash) {
        sfx('whoosh', { x, vol: 0.5 });
        this.juice.burst(x - c * 4, y - sn * 4, 'puff', 6);
      }
      if (p.dash && now - a.dustAt > 60) {
        a.dustAt = now;
        this.juice.burst(x - c * 5, y + 1 - sn * 5, 'puff', 1);
      }
      a.dash = !!p.dash;
      const n = this.names.get(id);
      if (n) specs.push({ id, x, y: y - 35, name: n.name, color: pcol(id).hex, dot: TEAM_INFO[p.team].colorNum });
    }
    this.tags.update(specs);
    // Sachen: zwischen den Ständen gleiten; was im gezeigten Stand fehlt, ist im Korb gelandet
    const ia = itemsOf(s.a);
    const ib = itemsOf(s.b);
    for (const [id, it] of ib) {
      const prev = ia.get(id) ?? it;
      const x = lerpJump(prev.x, it.x, s.f, 30);
      const y = lerpJump(prev.y, it.y, s.f, 30);
      let img = this.items.get(id);
      if (!img) {
        const type = tidyItemType(id);
        img = this.add.image(x, y, ensureTex(this, `clutter_${type}`, () => clutter(type))).setAngle((id * 37) % 360);
        this.items.set(id, img);
      }
      img.setPosition(x, y).setDepth(tdDepth(y) - 0.2);
    }
    for (const [id, img] of this.items) {
      if (ib.has(id)) continue;
      this.items.delete(id);
      const bk = st.baskets.reduce((best, b) => (Math.hypot(b.x - img.x, b.y - img.y) < Math.hypot(best.x - img.x, best.y - img.y) ? b : best), st.baskets[0]);
      this.tweens.add({ targets: img, x: bk?.x ?? img.x, y: (bk?.y ?? img.y) - 2, scale: 0, duration: 220, ease: 'Quad.in', onComplete: () => img.destroy() });
    }
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'tidy') return;
    const t = gs.mini.state;
    this.latest = t;
    this.buf.push(t.t, t);
    if (t.sub !== this.phase) {
      this.phase = t.sub;
      this.clock.set(t.endsIn);
    }
    if (!this.builtBaskets) {
      this.builtBaskets = true;
      for (const b of t.baskets) this.add.image(b.x, b.y, ensureTex(this, `basket_${b.team}`, () => basket(TEAM_INFO[b.team].color))).setDepth(tdDepth(b.y) - 6);
    }
    for (const [id, p] of Object.entries(t.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y + 1);
      const head = this.add.image(p.x, p.y, ensureTex(this, `tidy_broom_${p.team}`, () => broomHead(TEAM_INFO[p.team].color))).setOrigin(1, 0.5);
      const stick = this.add.graphics();
      this.names.set(id, { name: pl.name, color: TEAM_INFO[p.team].color });
      this.figs.set(id, { f, head, stick, dash: false, dustAt: 0 });
    }
    if (t.lastScore && t.lastScore.seq !== this.lastScore) {
      this.lastScore = t.lastScore.seq;
      const team = t.lastScore.team;
      const b = t.baskets.find((bk) => bk.team === team);
      // Jubel, wenn die Wiedergabe den Stand erreicht (gleichzeitig mit dem Verschwinden der Sache)
      if (b)
        this.buf.after(t.t, () => {
          sfx('coin', { x: b.x, vol: 0.6 });
          this.juice.burst(b.x, b.y - 8, 'confetti', 8);
          const plus = txt(this, b.x, b.y - 24, '+1', { color: TEAM_INFO[team].color }).setDepth(2000);
          this.tweens.add({ targets: plus, y: plus.y - 16, alpha: 0, duration: 700, onComplete: () => plus.destroy() });
        });
    }
    if (t.sub === 'play') this.banner.setText('');
    else if (t.sub === 'over') this.banner.setText('Aufgeräumt!');

    // Aufwärmrunde: kein Zeitlimit → keine Sekunden
    const secs = t.sub === 'play' && t.endsIn > 0 ? Math.ceil(t.endsIn / 1000) : -1;
    const key = JSON.stringify([secs, t.score]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 120, 2, 240, 30));
    const time = secs >= 0 ? `  ·  ${secs}s  ·  ` : '  ·  ';
    const text = t.baskets.length > 1 ? `Sonne ${t.score.A}${time}${t.score.B} Meer` : `${t.score.A} Teile${secs >= 0 ? `  ·  ${secs}s` : ''}`;
    this.hud.add(ink(this, WORLD.W / 2, 13, text, { color: t.score.A >= t.score.B ? RED_INK : BLUE_INK }));
  }
}

export const CONTROLLER_SCENES = [SupScene, TidyScene];
