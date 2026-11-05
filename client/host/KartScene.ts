import Phaser from 'phaser';
import type { GameState, KartState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { getTrack, wrapAngle } from '../../shared/kart';
import { SHIRTS } from '../../shared/avatar';
import { C } from '../art/palette';
import { paintKartTrack } from '../art/kart';
import { bananaPeel, coconut, itemBox, itemIcon, kartSprite, seagull } from '../art/kartsprites';
import { Mode7Renderer } from '../kart3d/render';
import { KartWorld } from '../kart3d/world';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, GOLD, background, ensureTex, panel, txt } from './ui';

interface KartView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  x: number;
  y: number;
  a: number;
  spinA: number;
  lastPuff: number;
}

/** Eine Verfolger-Ansicht auf dem geteilten TV */
interface Pane {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  renderer: Mode7Renderer;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  camA: number;
  name: Phaser.GameObjects.Text;
  place: Phaser.GameObjects.Text;
  lap: Phaser.GameObjects.Text;
  item: Phaser.GameObjects.Image;
  itemKey: string;
}

const HUD_H = 20;

/**
 * Kart-Rennen auf dem TV:
 * - Ansicht „split“: bis zu 4 Verfolger-Ansichten (Mode 7) auf dem geteilten Bildschirm, bei 3 Spielern eine Minikarte im freien Viertel
 * - Ansicht „phone“: Draufsicht auf die ganze Strecke (die Handys rendern ihre eigene Ansicht)
 */
export class KartScene extends Phaser.Scene {
  private karts = new Map<string, KartView>();
  private boxes: Phaser.GameObjects.Image[] = [];
  private hazards = new Map<number, Phaser.GameObjects.Image>();
  private gulls = new Map<number, { img: Phaser.GameObjects.Image; x: number }>();
  private topdown!: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image | null = null;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Image;
  private sub!: Phaser.GameObjects.Text;
  private ticker!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private latest: GameState | null = null;
  private hudKey = '';
  private builtTrack = -1;
  private lastEvent = 0;
  private lastSub = '';
  private tickerUntil = 0;
  private cd = new Countdown();
  // Splitscreen
  private world: KartWorld | null = null;
  private panes: Pane[] = [];
  private paneLayer!: Phaser.GameObjects.Container;
  private paneKey = '';
  private minimap: { root: Phaser.GameObjects.Container; dots: Map<string, Phaser.GameObjects.Arc>; scale: number; ox: number; oy: number } | null = null;
  private lastSnapT = 0;
  private view: KartState['view'] = 'phone';

  constructor() {
    super('kart');
  }

  create() {
    this.karts.clear();
    this.boxes = [];
    this.hazards.clear();
    this.gulls.clear();
    this.hudKey = '';
    this.builtTrack = -1;
    this.lastEvent = 0;
    this.lastSub = '';
    this.tickerUntil = 0;
    this.world = null;
    this.panes = [];
    this.paneKey = '';
    this.minimap = null;
    this.lastSnapT = 0;
    this.view = 'phone';
    this.bg = null;
    this.topdown = this.add.container(0, 0);
    this.paneLayer = this.add.container(0, 0).setDepth(500);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.bannerBg = panel(this, 80, 90, 320, 62, 'dark').setDepth(1001).setVisible(false);
    this.banner = txt(this, WORLD.W / 2, 100, '', { size: 24, color: GOLD }).setDepth(1002);
    this.sub = txt(this, WORLD.W / 2, 134, '', { size: 8 }).setDepth(1002);
    this.ticker = txt(this, WORLD.W / 2, WORLD.H - 14, '', { size: 8 }).setDepth(1002);
    this.clock = txt(this, WORLD.W - 4, 24, '', { size: 8, color: GOLD, origin: [1, 0] }).setDepth(1002);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private build(st: KartState) {
    if (this.builtTrack === st.track) return;
    this.builtTrack = st.track;
    const track = getTrack(st.track);
    this.bg = background(this, `kart_${st.track}`, WORLD.W, WORLD.H, (p) => p.draw(paintKartTrack(track, WORLD.W, WORLD.H), 0, 0));
    ensureTex(this, 'kbox0', () => itemBox(0));
    ensureTex(this, 'kbox1', () => itemBox(2));
    this.boxes = st.boxes.map((b) => this.add.image(b.x, b.y, 'kbox0').setDepth(2));
    this.topdown.add(this.boxes);
    ensureTex(this, 'kcoco', coconut);
    ensureTex(this, 'kbanana', bananaPeel);
    ensureTex(this, 'kgull0', () => seagull(0));
    ensureTex(this, 'kgull1', () => seagull(1));
    this.world = new KartWorld(st.track);
  }

  private kartView(id: string): KartView | undefined {
    const have = this.karts.get(id);
    if (have) return have;
    const pl = playerById(id);
    const car = this.latest?.mini?.kind === 'kart' ? this.latest.mini.state.karts[id] : undefined;
    if (!pl || !car) return undefined;
    const color = SHIRTS[pl.look.shirt] ?? C.red;
    const body = this.add.image(0, 0, ensureTex(this, `kart_${color}`, () => kartSprite(color)));
    const head = this.add.image(0, -3, ensurePortrait(this, pl.look)).setScale(0.62).setOrigin(0.5, 0.6);
    const shadow = this.add.ellipse(1, 3, 15, 8, 0x000000, 0.25);
    const tag = txt(this, 0, -17, '', { size: 8, color: GOLD }).setVisible(false);
    const root = this.add.container(car.x, car.y, [shadow, body, head, tag]);
    this.topdown.add(root);
    const v: KartView = { root, body, head, tag, x: car.x, y: car.y, a: car.angle, spinA: 0, lastPuff: 0 };
    this.karts.set(id, v);
    return v;
  }

  // ---------------------------------------------------------------- Splitscreen

  /** Ansichten anlegen/umbauen, wenn sich Modus oder Teilnehmer ändern */
  private layoutPanes(st: KartState) {
    const ids = st.panes.filter((id) => st.karts[id]);
    const key = st.view === 'split' ? ids.join(',') : '';
    if (key === this.paneKey) return;
    this.paneKey = key;
    this.paneLayer.removeAll(true);
    this.panes = [];
    this.minimap = null;
    if (st.view !== 'split' || !ids.length) return;
    const n = ids.length;
    const AH = WORLD.H - HUD_H;
    const cells: { x: number; y: number; w: number; h: number }[] =
      n === 1
        ? [{ x: 0, y: HUD_H, w: WORLD.W, h: AH }]
        : n === 2
          ? [
              { x: 0, y: HUD_H, w: WORLD.W, h: AH / 2 },
              { x: 0, y: HUD_H + AH / 2, w: WORLD.W, h: AH / 2 },
            ]
          : [0, 1, 2, 3].map((i) => ({ x: (i % 2) * (WORLD.W / 2), y: HUD_H + Math.floor(i / 2) * (AH / 2), w: WORLD.W / 2, h: AH / 2 }));
    this.paneLayer.add(this.add.rectangle(0, HUD_H, WORLD.W, AH, 0x2d1b12).setOrigin(0, 0));
    ids.forEach((id, i) => {
      const c = cells[i];
      const w = Math.round(c.w);
      const h = Math.round(c.h);
      const key = `kpane_${i}_${w}x${h}`;
      const tex = (this.textures.exists(key) ? this.textures.get(key) : this.textures.createCanvas(key, w, h)) as Phaser.Textures.CanvasTexture;
      const img = this.add.image(c.x, c.y, key).setOrigin(0, 0);
      this.paneLayer.add(img);
      const pl = playerById(id);
      const name = txt(this, c.x + 4, c.y + 3, (pl?.name ?? '?').toUpperCase(), { size: 8, origin: [0, 0] }).setDepth(502);
      const place = txt(this, c.x + c.w - 4, c.y + 2, '', { size: 16, color: GOLD, origin: [1, 0] }).setDepth(502);
      const lap = txt(this, c.x + 4, c.y + 14, '', { size: 8, color: '#ffd25e', origin: [0, 0] }).setDepth(502);
      const item = this.add.image(c.x + c.w - 4, c.y + c.h - 4, ensureTex(this, 'kitem_none', () => itemIcon(null))).setOrigin(1, 1).setDepth(502).setVisible(false);
      this.paneLayer.add([name, place, lap, item]);
      const car = st.karts[id];
      this.panes.push({ id, x: c.x, y: c.y, w, h, renderer: new Mode7Renderer(st.track, w, h), tex, img, camA: car.angle, name, place, lap, item, itemKey: '' });
    });
    // Rahmen zwischen den Ansichten
    if (n === 2) this.paneLayer.add(this.add.rectangle(0, HUD_H + AH / 2 - 1, WORLD.W, 2, 0x2d1b12).setOrigin(0, 0).setDepth(503));
    if (n >= 3) {
      this.paneLayer.add(this.add.rectangle(WORLD.W / 2 - 1, HUD_H, 2, AH, 0x2d1b12).setOrigin(0, 0).setDepth(503));
      this.paneLayer.add(this.add.rectangle(0, HUD_H + AH / 2 - 1, WORLD.W, 2, 0x2d1b12).setOrigin(0, 0).setDepth(503));
    }
    // Drei Spieler: freies Viertel zeigt die Strecke von oben
    if (n === 3) {
      const c = cells[3];
      const scale = Math.min(c.w / WORLD.W, c.h / WORLD.H) * 0.94;
      const ox = c.x + (c.w - WORLD.W * scale) / 2;
      const oy = c.y + (c.h - WORLD.H * scale) / 2;
      const root = this.add.container(0, 0).setDepth(502);
      root.add(this.add.image(ox, oy, `bg_kart_${st.track}`).setOrigin(0, 0).setScale(scale));
      root.add(txt(this, c.x + c.w / 2, c.y + 4, 'ÜBERSICHT', { size: 8, color: GOLD }));
      const dots = new Map<string, Phaser.GameObjects.Arc>();
      for (const id of Object.keys(st.karts)) {
        const pl = playerById(id);
        const col = Phaser.Display.Color.HexStringToColor(pl ? (SHIRTS[pl.look.shirt] ?? C.red) : C.red).color;
        const dot = this.add.circle(0, 0, 3, col).setStrokeStyle(1, 0x2d1b12);
        dots.set(id, dot);
        root.add(dot);
      }
      this.paneLayer.add(root);
      this.minimap = { root, dots, scale, ox, oy };
    }
  }

  private renderPanes(st: KartState, now: number, dms: number) {
    const world = this.world;
    if (!world || !this.panes.length) return;
    const t0 = performance.now();
    const poses = world.poses();
    const lookOf = (id: string) => playerById(id)?.look;
    for (const p of this.panes) {
      const mine = poses.find((k) => k.id === p.id);
      if (!mine) continue;
      p.camA += wrapAngle(mine.angle - p.camA) * (1 - Math.exp(-dms / 160));
      p.renderer.render(Mode7Renderer.chase(mine, p.camA), st, poses, { lookOf, now });
      p.tex.context.drawImage(p.renderer.canvas, 0, 0);
      p.tex.refresh();
      p.place.setText(`${mine.place}.`);
      p.lap.setText(mine.finished ? 'ZIEL!' : `RUNDE ${Math.max(1, mine.lap)}/${st.laps}`);
      const ik = mine.item ?? '';
      if (ik !== p.itemKey) {
        p.itemKey = ik;
        p.item.setVisible(!!mine.item);
        if (mine.item) p.item.setTexture(ensureTex(this, `kitem_${mine.item}`, () => itemIcon(mine.item)));
      }
    }
    if (this.minimap) {
      const m = this.minimap;
      for (const k of poses) m.dots.get(k.id)?.setPosition(m.ox + k.x * m.scale, m.oy + k.y * m.scale);
    }
    // Diagnose: Renderzeit aller Ansichten pro Frame (ms)
    const W = window as unknown as { __kartPaneMs?: number };
    W.__kartPaneMs = (W.__kartPaneMs ?? 0) * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ---------------------------------------------------------------- Frame

  update(_t: number, dms: number) {
    const s = this.latest;
    if (s?.mini?.kind !== 'kart') return;
    const st = s.mini.state;
    const now = this.time.now;
    if (st.sub === 'countdown') this.countdownBanner(st);
    if (st.view === 'split') {
      this.renderPanes(st, performance.now(), dms);
    } else {
      this.updateTopdown(st, now, dms);
    }
    if (this.tickerUntil && now > this.tickerUntil) {
      this.ticker.setText('');
      this.tickerUntil = 0;
    }
  }

  private updateTopdown(st: KartState, now: number, dms: number) {
    for (const [id, car] of Object.entries(st.karts)) {
      const v = this.kartView(id);
      if (!v) continue;
      v.x += (car.x - v.x) * 0.4;
      v.y += (car.y - v.y) * 0.4;
      v.a += wrapAngle(car.angle - v.a) * 0.4;
      if (car.spin > 0) v.spinA += dms * 0.018;
      else v.spinA = 0;
      const driftTilt = car.drift ? car.drift * 0.35 : 0;
      v.body.setRotation(v.a + v.spinA + driftTilt);
      v.head.setY(-3 + (car.offroad && !car.finished ? Math.sin(now / 40) * 0.8 : 0));
      v.root.setPosition(Math.round(v.x), Math.round(v.y)).setDepth(10 + v.y).setAlpha(car.finished ? 0.65 : 1);
      if (now - v.lastPuff > 70 && st.sub === 'race') {
        v.lastPuff = now;
        const bx = v.x - Math.cos(v.a) * 8;
        const by = v.y - Math.sin(v.a) * 8;
        if (car.boost) this.puff(bx, by, Math.random() < 0.5 ? 0xffd25e : 0xf0973a, 2.5, 260);
        else if (car.drift) {
          const col = car.charged ? (Math.random() < 0.5 ? 0xf0973a : 0xffd25e) : 0x93d3f3;
          for (const side of [-1, 1]) this.puff(bx - Math.sin(v.a) * side * 5, by + Math.cos(v.a) * side * 5, col, 1.5, 200);
        } else if (car.offroad && !car.finished) this.puff(bx, by, 0xdfb878, 2, 300);
      }
    }
    for (const g of this.gulls.values()) g.img.setTexture(Math.floor(now / 120) % 2 ? 'kgull1' : 'kgull0');
    this.boxes.forEach((b, i) => {
      if (!b.visible) return;
      b.setTexture(Math.floor(now / 250 + i) % 2 ? 'kbox1' : 'kbox0');
      b.setY(st.boxes[i].y + Math.sin(now / 300 + i) * 1);
    });
    for (const h of this.hazards.values()) if (h.texture.key === 'kcoco') h.rotation += dms * 0.02;
  }

  private countdownBanner(st: KartState) {
    const secs = this.cd.seconds;
    const name = getTrack(st.track).def.name;
    this.banner.setText(secs > 3 ? name.toUpperCase() : String(Math.max(1, secs)));
    this.banner.setFontSize(secs > 3 ? 16 : 24);
    const where = st.view === 'split' ? 'Splitscreen auf dem TV' : 'Jeder fährt auf seinem Handy';
    this.sub.setText(secs > 3 ? `${st.laps} Runden – ${where}${st.splitOk ? '  (VIP: Ansicht ⇄)' : ''}` : '');
    this.bannerBg.setVisible(true);
  }

  private puff(x: number, y: number, color: number, r: number, ms: number) {
    const c = this.add.circle(x, y, r, color, 0.85).setDepth(9 + y);
    this.tweens.add({ targets: c, scale: 0.2, alpha: 0, duration: ms, onComplete: () => c.destroy() });
  }

  private setView(view: KartState['view']) {
    if (view === this.view) return;
    this.view = view;
    const top = view === 'phone';
    this.topdown.setVisible(top);
    this.bg?.setVisible(top);
    for (const h of this.hazards.values()) h.setVisible(top);
    for (const g of this.gulls.values()) g.img.setVisible(top);
    this.paneLayer.setVisible(!top);
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'kart') return;
    const st = s.mini.state;
    this.build(st);
    if (st.t !== this.lastSnapT) {
      this.lastSnapT = st.t;
      this.world?.onSnapshot(st);
    }
    this.layoutPanes(st);
    this.setView(st.view);
    const top = st.view === 'phone';

    // Boxen, Hindernisse, Möwen (Draufsicht)
    st.boxes.forEach((b, i) => this.boxes[i]?.setVisible(b.on && top));
    const alive = new Set(st.hazards.map((h) => h.id));
    for (const [id, img] of this.hazards) {
      if (alive.has(id)) continue;
      this.tweens.add({ targets: img, scale: 2, alpha: 0, duration: 220, onComplete: () => img.destroy() });
      this.hazards.delete(id);
    }
    for (const h of st.hazards) {
      let img = this.hazards.get(h.id);
      if (!img) {
        img = this.add.image(h.x, h.y, h.kind === 'coconut' ? 'kcoco' : 'kbanana').setVisible(top);
        this.hazards.set(h.id, img);
      }
      img.setPosition(h.x, h.y).setDepth(5 + h.y);
    }
    const flying = new Set(st.gulls.map((g) => g.id));
    for (const [id, g] of this.gulls) {
      if (flying.has(id)) continue;
      this.tweens.add({ targets: g.img, y: g.img.y - 30, alpha: 0, duration: 500, onComplete: () => g.img.destroy() });
      this.gulls.delete(id);
    }
    for (const g of st.gulls) {
      let v = this.gulls.get(g.id);
      if (!v) {
        v = { img: this.add.image(g.x, g.y, 'kgull0').setDepth(900).setVisible(top), x: g.x };
        this.gulls.set(g.id, v);
      }
      v.img.setFlipX(g.x < v.x);
      v.x = g.x;
      v.img.setPosition(g.x, g.y - 8);
    }

    // Plätze über fertigen Karts
    for (const [id, car] of Object.entries(st.karts)) {
      const v = this.kartView(id);
      if (!v) continue;
      v.tag.setVisible(car.finished).setText(`${car.place}.`);
    }

    // Ereignisse als Laufschrift unten
    const ev = st.events[st.events.length - 1];
    if (ev && ev.seq !== this.lastEvent) {
      this.lastEvent = ev.seq;
      if (ev.kind !== 'item' || this.tickerUntil === 0) {
        this.ticker.setText(ev.text.toUpperCase());
        this.tickerUntil = this.time.now + 2600;
      }
      if ((ev.kind === 'hit' || ev.kind === 'gull') && top) {
        const v = this.karts.get(ev.who);
        if (v) {
          const t = txt(this, v.x, v.y - 18, ev.kind === 'gull' ? 'KRAH!' : 'AUA!', { color: '#ff8a7a' }).setDepth(1001);
          this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, duration: 900, onComplete: () => t.destroy() });
        }
      }
    }

    // Banner
    const secs = Math.ceil(st.endsIn / 1000);
    if (st.sub === 'countdown') {
      this.cd.set(st.endsIn);
      this.countdownBanner(st);
    } else if (st.sub === 'race') {
      if (this.lastSub === 'countdown') {
        this.banner.setText('LOS!').setFontSize(24);
        this.time.delayedCall(800, () => {
          if (this.latest?.mini?.kind !== 'kart' || this.latest.mini.state.sub !== 'race') return;
          this.banner.setText('');
          this.bannerBg.setVisible(false);
        });
      }
      this.sub.setText('');
    } else {
      this.banner.setText('ZIEL!').setFontSize(24);
      this.sub.setText(st.finishOrder[0] ? `${playerById(st.finishOrder[0])?.name ?? '?'} gewinnt!` : '');
    }
    this.lastSub = st.sub;
    this.bannerBg.setVisible(this.banner.text !== '');
    this.clock.setText(st.closing && st.sub === 'race' ? `NOCH ${secs}s` : '');

    // Rangliste oben
    const order = Object.entries(st.karts).sort((a, b) => a[1].place - b[1].place);
    const leaderLap = Math.max(1, ...order.map(([, c]) => c.lap));
    const key = JSON.stringify([order.map(([id, c]) => [id, c.finished]), Math.min(leaderLap, st.laps)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 0, 0, WORLD.W, HUD_H, 'dark'));
    this.hud.add(txt(this, 6, 6, `RUNDE ${Math.min(leaderLap, st.laps)}/${st.laps}`, { origin: [0, 0], color: GOLD }));
    const slot = Math.min(30, Math.floor((WORLD.W - 104) / Math.max(1, order.length)));
    order.forEach(([id, car], i) => {
      const pl = playerById(id);
      const x = 104 + i * slot;
      this.hud.add(txt(this, x + 7, 6, String(i + 1), { size: 8, color: i === 0 ? GOLD : car.finished ? '#b9e39a' : '#fff4d6', origin: [1, 0] }));
      if (pl) this.hud.add(this.add.image(x + 9, 3, ensurePortrait(this, pl.look)).setOrigin(0, 0).setScale(0.9));
    });
  }
}

export const KART_SCENES = [KartScene];

