import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { SUP, TIDY } from '../../shared/games';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintShore, paintTiles, paintWater, paintWoodFloor } from '../art/ground';
import { basket, buoy, clutter, jellyfish, seaRock, supBoard } from '../art/props2';
import { bus, getState, playerById } from './store';
import { figure, playAvatar } from './textures';
import { BLUE_INK, NameTags, RED_INK, background, ensureTex, ink, panel, prop, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { foam, gulls } from './ambient';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// ================================================================== SUP-Rennen

export class SupScene extends Phaser.Scene {
  private boards = new Map<number, { root: Phaser.GameObjects.Container; board: Phaser.GameObjects.Image; figs: Phaser.GameObjects.Container[]; x: number; y: number; strokes: number }>();
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
    for (let x = 60; x < W; x += 180) {
      prop(this, 'palm', () => O.palm(6), x, SUP.TOP - 6).setScale(0.7);
      prop(this, 'umbrellaB', () => O.umbrella(C.blue), x + 90, WORLD.H + 6).setDepth(300);
    }
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
      const img = this.add.image(o.x, o.y, key).setDepth(o.y);
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

export class TidyScene extends Phaser.Scene {
  private figs = new Map<string, { f: Phaser.GameObjects.Container; x: number; y: number }>();
  private items = new Map<number, Phaser.GameObjects.Image>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: GameState | null = null;
  private hudKey = '';
  private lastScore = 0;
  private builtBaskets = false;
  private tags!: NameTags;
  private names = new Map<string, { name: string; color: string }>();

  constructor() {
    super('tidy');
  }

  create() {
    this.tags = new NameTags(this, 900);
    this.names.clear();
    this.figs.clear();
    this.items.clear();
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
    const s = this.latest;
    if (s?.mini?.kind !== 'tidy') return;
    const specs: { id: string; x: number; y: number; name: string; color: string }[] = [];
    for (const [id, p] of Object.entries(s.mini.state.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      a.x += (p.x - a.x) * 0.35;
      a.y += (p.y - a.y) * 0.35;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(p.dir < 0);
      playAvatar(img, p.moving ? 'walk' : 'idle');
      a.f.setPosition(a.x, a.y + 6).setDepth(a.y + 6);
      const n = this.names.get(id);
      if (n) specs.push({ id, x: a.x, y: a.y - 30, name: n.name, color: n.color });
    }
    this.tags.update(specs);
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'tidy') return;
    const t = s.mini.state;
    if (!this.builtBaskets) {
      this.builtBaskets = true;
      for (const b of t.baskets) this.add.image(b.x, b.y, ensureTex(this, `basket_${b.team}`, () => basket(TEAM_INFO[b.team].color))).setDepth(b.y - 6);
    }
    for (const [id, p] of Object.entries(t.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y);
      this.names.set(id, { name: pl.name, color: TEAM_INFO[p.team].color });
      this.figs.set(id, { f, x: p.x, y: p.y });
    }
    const alive = new Set(t.items.map((i) => i.id));
    for (const [id, img] of this.items) {
      if (!alive.has(id)) {
        this.tweens.add({ targets: img, scale: 0, duration: 200, onComplete: () => img.destroy() });
        this.items.delete(id);
      }
    }
    for (const it of t.items) {
      let img = this.items.get(it.id);
      if (!img) {
        img = this.add.image(it.x, it.y, ensureTex(this, `clutter_${it.type}`, () => clutter(it.type))).setAngle((it.id * 37) % 360);
        this.items.set(it.id, img);
      }
      img.setPosition(it.x, it.y).setDepth(it.y);
    }
    if (t.lastScore && t.lastScore.seq !== this.lastScore) {
      this.lastScore = t.lastScore.seq;
      const b = t.baskets.find((bk) => bk.team === t.lastScore!.team);
      if (b) {
        sfx('coin', { x: b.x, vol: 0.6 });
        const plus = txt(this, b.x, b.y - 24, '+1', { color: TEAM_INFO[b.team].color }).setDepth(2000);

        this.tweens.add({ targets: plus, y: plus.y - 16, alpha: 0, duration: 700, onComplete: () => plus.destroy() });
      }
    }
    if (t.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(t.endsIn / 1000))));
    else if (t.sub === 'play') this.banner.setText('');
    else this.banner.setText('Aufgeräumt!');

    const key = JSON.stringify([Math.ceil(t.endsIn / 1000), t.score]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 120, 2, 240, 30));
    const text = t.baskets.length > 1 ? `Sonne ${t.score.A}  ·  ${Math.ceil(t.endsIn / 1000)}s  ·  ${t.score.B} Meer` : `${t.score.A} Teile  ·  ${Math.ceil(t.endsIn / 1000)}s`;
    this.hud.add(ink(this, WORLD.W / 2, 13, text, { color: t.score.A >= t.score.B ? RED_INK : BLUE_INK }));
  }
}

export const CONTROLLER_SCENES = [SupScene, TidyScene];
