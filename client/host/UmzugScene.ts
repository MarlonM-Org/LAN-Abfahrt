import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import { UMZUG as U, UMZUG_KINDS, type UmzugGeo, type UmzugState, grabPoints, umzugGoals, umzugGrid, umzugTruckZone } from '../../shared/umzug';
import { C } from '../art/palette';
import { paintUmzugLot, umzugBrokenWindow, umzugHandMark, umzugItemKey, umzugItemPix, umzugLandlord, umzugShards, umzugStar } from '../art/umzug';
import { bus, getState, playerById } from './store';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say } from './speech';
import { figure } from './textures';
import { BLUE_INK, INK, background, ensureTex, ink, panel, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SUN_INK = '#b06d00';
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const T = U.TILE;

interface Fig {
  f: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  held: Phaser.GameObjects.Image;
  heldKey: number;
  x: number;
  y: number;
  no: number;
}

interface ItemView {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  x: number;
  y: number;
  a: number;
}

/** Umzugschaos: Draufsicht auf Ferienhaus, Garten und Umzugslaster */
export class UmzugScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private items = new Map<number, ItemView>();
  private glass = new Map<string, Phaser.GameObjects.Image>();
  private truckLoads: Phaser.GameObjects.Container[] = [];
  private loadKeys: string[] = [];
  private seenEvents = new Set<number>();
  private marks!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private helpBg!: Phaser.GameObjects.Image;
  private overLayer!: Phaser.GameObjects.Container;
  private geos: UmzugGeo[] = [];
  private latest: UmzugState | null = null;
  private juice!: Juice;
  private hudKey = '';
  private built = false;
  private overShown = false;

  constructor() {
    super('umzug');
  }

  create() {
    this.figs.clear();
    this.items.clear();
    this.glass.clear();
    this.truckLoads = [];
    this.loadKeys = [];
    this.seenEvents.clear();
    this.geos = [];
    this.latest = null;
    this.hudKey = '';
    this.built = false;
    this.overShown = false;

    this.marks = this.add.graphics().setDepth(950);
    this.juice = new Juice(this, { depth: 1050 });
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 104, '', { size: 24, color: C.gold }).setDepth(1101);
    this.helpBg = panel(this, 50, 92, 380, 132, 'dark').setDepth(1100).setVisible(false);
    this.help = txt(this, WORLD.W / 2, 128, '', { color: C.white, wrap: 360 }).setDepth(1101);
    this.overLayer = this.add.container(0, 0).setDepth(1200);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Aufbau

  private build(st: UmzugState) {
    this.built = true;
    this.geos = st.houses.map((h) => ({ x0: h.x0, layout: h.layout, mirror: h.mirror, grid: umzugGrid(h.layout, h.mirror) }));
    const key = `umzuglot_${st.houses.map((h) => `${h.layout}${h.mirror ? 'm' : ''}${h.x0}`).join('_')}`;
    background(this, key, WORLD.W, WORLD.H, (p) => paintUmzugLot(p, this.geos, WORLD.W, WORLD.H));
    this.geos.forEach((g, i) => {
      const z = umzugTruckZone(g);
      txt(this, z.x + z.w / 2, z.y - T + 3, 'UMZUG', { color: '#e04a3f' }).setDepth(5);
      const h = st.houses[i];
      if (h.team) txt(this, g.x0 + 120, U.Y0 + (g.grid.length - 3.2) * T, TEAM_INFO[h.team].name, { color: TEAM_INFO[h.team].color }).setDepth(5);
      this.truckLoads.push(this.add.container(0, 0).setDepth(900));
      this.loadKeys.push('');
    });
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'umzug') return;
    const st = s.mini.state;
    this.latest = st;
    if (!this.built) this.build(st);

    // Figuren
    for (const [id, p] of Object.entries(st.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      const tag = txt(this, 0, -38, pl.name.replace(/^Bot\s+/, '').slice(0, 6), { color: hex(p.c) });
      const held = this.add.image(0, -26, '__DEFAULT').setVisible(false);
      f.add([tag, held]);
      this.figs.set(id, { f, img, held, heldKey: -1, x: p.x, y: p.y, no: p.no });
    }

    // Möbel
    const alive = new Set<number>();
    for (const it of st.items) {
      alive.add(it.id);
      let v = this.items.get(it.id);
      if (!v) {
        const img = this.add.image(it.x, it.y, ensureTex(this, umzugItemKey(it.k), () => umzugItemPix(it.k)));
        const kind = UMZUG_KINDS[it.k];
        const shadow = this.add.ellipse(it.x, it.y + 2, kind.w + 2, kind.h * 0.6 + 2, 0x000000, 0.2).setVisible(false);
        v = { img, shadow, x: it.x, y: it.y, a: it.a };
        this.items.set(it.id, v);
      }
    }
    for (const [id, v] of this.items) {
      if (alive.has(id)) continue;
      v.img.destroy();
      v.shadow.destroy();
      this.items.delete(id);
    }

    // Zerbrochene Fenster
    st.houses.forEach((h, hi) => {
      const g = this.geos[hi];
      for (const key of h.glass) {
        const id = `${hi}:${key}`;
        if (this.glass.has(id)) continue;
        const [c, r] = key.split(',').map(Number);
        const vertical = (g.grid[r][c - 1] === '#' || g.grid[r][c - 1] === 'W') && (g.grid[r][c + 1] === '#' || g.grid[r][c + 1] === 'W');
        const img = this.add.image(g.x0 + c * T, U.Y0 + r * T, ensureTex(this, `um_glass_${vertical}`, () => umzugBrokenWindow(vertical))).setOrigin(0, 0).setDepth(2);
        this.glass.set(id, img);
      }
      // Ladung im Laster
      const lk = h.delivered.join(',');
      if (lk !== this.loadKeys[hi]) {
        this.loadKeys[hi] = lk;
        this.buildLoad(hi, h.delivered);
      }
    });

    // Ereignisse
    for (const e of st.events) {
      if (this.seenEvents.has(e.seq)) continue;
      this.seenEvents.add(e.seq);
      this.showEvent(e);
    }

    // Banner / Hilfe
    this.helpBg.setVisible(st.sub === 'countdown');
    if (st.sub === 'countdown') {
      this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000)))).setY(98);
      this.help.setText(
        `${st.teams ? 'Team Sonne gegen Team Meer – wer hat zuerst leer?' : 'Räumt das Ferienhaus aus, bevor der Vermieter kommt!'}\n` +
          'Joystick: laufen · GREIFEN halten: tragen\nWERFEN: werfen (auch durchs Fenster!)\n' +
          'Schweres packt ihr zu zweit an den Enden an.\nZerbrechliches lieber nicht werfen …',
      );
    } else {
      this.banner.setText('');
      this.help.setText('');
    }
    if (st.sub === 'over' && !this.overShown) this.showOver(st);

    // HUD
    const key = JSON.stringify([Math.ceil(st.endsIn / 1000), st.houses.map((h) => [h.score, h.left])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 100, 1, 280, 26));
    if (st.teams) {
      const [A, B] = st.houses;
      this.hud.add(ink(this, 112, 10, `Sonne ${A.score} (${A.left})`, { color: SUN_INK, origin: [0, 0] }));
      this.hud.add(ink(this, WORLD.W / 2, 10, mmss(st.endsIn)));
      this.hud.add(ink(this, 368, 10, `(${B.left}) ${B.score} Meer`, { color: BLUE_INK, origin: [1, 0] }));
    } else {
      const h = st.houses[0];
      const goals = umzugGoals(h.max);
      this.hud.add(ink(this, 112, 10, `${h.score} Pkt`, { origin: [0, 0] }));
      this.hud.add(ink(this, 200, 10, mmss(st.endsIn)));
      goals.forEach((g, i) => {
        const on = h.score >= g;
        this.hud.add(this.add.image(252 + i * 16, 13, ensureTex(this, `um_star_${on}`, () => umzugStar(on))));
      });
      this.hud.add(ink(this, 368, 10, `noch ${h.left}`, { color: '#7a5a3a', origin: [1, 0] }));
    }
  }

  private buildLoad(hi: number, delivered: number[]) {
    const layer = this.truckLoads[hi];
    layer.removeAll(true);
    const z = umzugTruckZone(this.geos[hi]);
    const cols = Math.max(2, Math.floor((z.w - 4) / 14));
    delivered.forEach((k, i) => {
      const kind = UMZUG_KINDS[k];
      const s = Math.min(1, 12 / Math.max(kind.w, kind.h));
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = z.x + 9 + c * 14;
      const y = z.y + 9 + r * 14;
      if (y > z.y + z.h - 4) return;
      layer.add(this.add.image(x, y, ensureTex(this, umzugItemKey(k), () => umzugItemPix(k))).setScale(s).setAlpha(0.9));
    });
  }

  private showEvent(e: UmzugState['events'][number]) {
    const J = this.juice;
    if (e.kind === 'deliver') {
      J.float(e.x, e.y - 20, `+${e.pts}`, 'gold');
      sfx('coin', { x: e.x, pitch: 1 + Math.min(0.5, (e.pts ?? 1) * 0.1) });
      if (e.k !== undefined && UMZUG_KINDS[e.k].heavy) {
        J.shake(1);
        sfx('bonk', { x: e.x, pitch: 0.7, delay: 0.05 });
      }
    } else if (e.kind === 'break') {
      J.float(e.x, e.y - 16, 'KLIRR! -1', 'dmg');
      this.add.image(e.x, e.y, ensureTex(this, `um_shards_${e.k ?? 0}`, () => umzugShards(e.k ?? 0))).setDepth(1).setAlpha(0.9);
      J.burst(e.x, e.y, 'spark', 10);
      J.burst(e.x, e.y, e.k === 4 ? 'splash' : 'wood', 6);
      J.shake(2);
      sfx('crack', { x: e.x, pitch: 1.3 });
      sfx('lose', { x: e.x, vol: 0.4, delay: 0.15 });
    } else if (e.kind === 'glass') {
      J.float(e.x, e.y - 14, 'KLIRR!', 'water');
      J.burst(e.x, e.y, 'splash', 14);
      J.burst(e.x, e.y, 'spark', 6);
      J.shake(1);
      sfx('crack', { x: e.x, pitch: 1.6 });
    } else if (e.kind === 'throw') {
      sfx('whoosh', { x: e.x, vol: 0.6 });
    } else if (e.kind === 'bonus') {
      J.float(e.x, e.y - 10, `Alles draußen! +${e.pts} Zeitbonus`, 'gold');
      J.burst(e.x, e.y, 'confetti', 30);
      sfx('fanfare', { x: e.x });
    }
  }

  private showOver(st: UmzugState) {
    this.overShown = true;
    const L = this.overLayer;
    sfx('whistle', { vol: 0.8 });
    say('Der Vermieter ist da!', { interrupt: true });
    if (!st.teams) {
      sfx(st.stars >= 2 ? 'win' : st.stars === 1 ? 'cheer' : 'lose', { delay: 0.5 });
      if (st.stars === 3) this.juice.burst(WORLD.W / 2, 120, 'confetti', 50);
    } else sfx(st.winner ? 'win' : 'cheer', { delay: 0.5 });
    L.add(panel(this, 100, 88, 280, 100));
    L.add(ink(this, WORLD.W / 2, 98, 'Der Vermieter ist da!'));
    if (!st.teams) {
      const h = st.houses[0];
      for (let i = 0; i < 3; i++) {
        const on = i < st.stars;
        const img = this.add.image(WORLD.W / 2 - 34 + i * 34, 134, ensureTex(this, `um_star_${on}`, () => umzugStar(on))).setScale(0);
        L.add(img);
        this.tweens.add({ targets: img, scale: 2, delay: 300 + i * 450, duration: 300, ease: 'Back.easeOut', onStart: () => on && sfx('powerup', { pitch: 1 + i * 0.2 }) });
      }
      const total = h.delivered.length + h.left + h.broken;
      L.add(ink(this, WORLD.W / 2, 160, `${h.delivered.length} von ${total} Sachen im Laster${h.broken ? ` · ${h.broken} kaputt` : ''}`, { color: '#7a5a3a' }));
      L.add(ink(this, WORLD.W / 2, 174, `${h.score} Punkte${h.bonus ? ` (davon ${h.bonus} Zeitbonus)` : ''}`, { color: '#7a5a3a' }));
    } else {
      const [A, B] = st.houses;
      const w = st.winner;
      L.add(ink(this, WORLD.W / 2, 118, w ? `${TEAM_INFO[w].name} gewinnt!` : 'Unentschieden!', { color: w === 'A' ? SUN_INK : w === 'B' ? BLUE_INK : INK }));
      L.add(ink(this, WORLD.W / 2, 140, `Sonne ${A.score} : ${B.score} Meer`, { size: 8 }));
      L.add(ink(this, WORLD.W / 2, 160, `${A.delivered.length} : ${B.delivered.length} Sachen im Laster`, { color: '#7a5a3a' }));
    }
    // Der Vermieter kommt die Straße entlang und bleibt vorm Haus stehen
    this.geos.forEach((g) => {
      const z = umzugTruckZone(g);
      const startX = g.mirror ? g.x0 - 10 : g.x0 + g.grid[0].length * T + 10;
      const endX = g.mirror ? z.x + z.w + 30 : z.x - 30;
      const y = U.Y0 + (g.grid.length - 1.5) * T;
      const man = this.add.image(startX, y, ensureTex(this, 'um_landlord', umzugLandlord)).setOrigin(0.5, 1).setDepth(1190).setFlipX(!!g.mirror);
      this.tweens.add({ targets: man, x: endX, duration: 2600, ease: 'Linear' });
      this.tweens.add({ targets: man, y: y - 2, duration: 160, yoyo: true, repeat: 8 });
      const bubble = txt(this, endX, y - 34, '?!', { color: C.white }).setDepth(1191).setAlpha(0);
      this.tweens.add({ targets: bubble, alpha: 1, delay: 2600, duration: 200 });
    });
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    const bob = Math.sin(now / 90) * 1.5;

    // Möbel
    const carried = new Map<string, number>();
    for (const it of st.items) {
      const v = this.items.get(it.id);
      if (!v) continue;
      if (it.s === 1) {
        if (it.by[0]) carried.set(it.by[0], it.k);
        v.img.setVisible(false);
        v.shadow.setVisible(false);
        v.x = it.x;
        v.y = it.y;
        continue;
      }
      v.img.setVisible(true);
      v.x += (it.x - v.x) * 0.5;
      v.y += (it.y - v.y) * 0.5;
      // Winkel kürzesten Weges nachführen
      let da = it.a - v.a;
      while (da > 180) da -= 360;
      while (da < -180) da += 360;
      v.a += da * 0.5;
      const z = it.s === 2 ? (it.z ?? 0) : 0;
      v.img.setPosition(v.x, v.y - z * 22).setRotation((v.a * Math.PI) / 180).setScale(1 + z * 0.5).setDepth(it.s === 2 ? 980 : v.y + UMZUG_KINDS[it.k].h / 2);
      v.shadow.setVisible(it.s === 2).setPosition(v.x, v.y + 2).setScale(1 - z * 0.3);
    }

    // Figuren
    this.marks.clear();
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      a.x += (p.x - a.x) * 0.45;
      a.y += (p.y - a.y) * 0.45;
      if (Math.abs(p.fx) > 0.2) a.img.setFlipX(p.fx < 0);
      a.img.setY(p.m ? -Math.abs(Math.sin(now / 80)) * 2 : 0);
      a.f.setPosition(a.x, a.y + 5).setDepth(a.y + 5);
      const k = carried.get(id);
      if (k !== undefined) {
        if (k !== a.heldKey) {
          a.heldKey = k;
          a.held.setTexture(ensureTex(this, umzugItemKey(k), () => umzugItemPix(k))).setVisible(true).setScale(Math.min(1, 14 / Math.max(UMZUG_KINDS[k].w, UMZUG_KINDS[k].h)));
        }
        a.held.setY(-27 + bob);
      } else if (a.heldKey >= 0) {
        a.heldKey = -1;
        a.held.setVisible(false);
      }
      if (p.no !== a.no) {
        a.no = p.no;
        this.juice.float(a.x, a.y - 44, '?', 'dmg');
        sfx('error', { x: a.x, vol: 0.4 });
      }
      // Sprint-Staub
      if (p.d && Math.random() < 0.5) {
        const dust = this.add.rectangle(a.x - 3 + Math.random() * 6, a.y + 4, 2, 2, 0xe8e2d4).setDepth(a.y);
        this.tweens.add({ targets: dust, y: dust.y - 4, alpha: 0, duration: 300, onComplete: () => dust.destroy() });
      }
      // Griff-Markierung: wer ein schweres Teil hält, hat einen Schein in seiner Farbe
      if (p.g !== null && k === undefined && st.sub === 'play') this.marks.lineStyle(1, p.c, 0.9).strokeCircle(a.x, a.y - 1, 8);
    }

    // Freies Ende eines schweren Teils, an dem schon jemand zieht: „hier anfassen“
    for (const it of st.items) {
      if (!UMZUG_KINDS[it.k].heavy || it.s !== 0) continue;
      const holders = it.by.filter((b) => b).length;
      if (holders !== 1 || st.sub !== 'play') continue;
      const v = this.items.get(it.id);
      if (!v) continue;
      const free = it.by.findIndex((b) => !b);
      const gp = grabPoints(it.k)[free];
      const rad = (v.a * Math.PI) / 180;
      const x = v.x + gp.x * Math.cos(rad) - gp.y * Math.sin(rad);
      const y = v.y + gp.x * Math.sin(rad) + gp.y * Math.cos(rad);
      const key = `mark:${it.id}`;
      let m = this.children.getByName(key) as Phaser.GameObjects.Image | null;
      if (!m) m = this.add.image(x, y, ensureTex(this, 'um_hand', umzugHandMark)).setName(key).setDepth(985);
      m.setPosition(x, y - 4 + bob).setData('seen', now);
    }
    const stale = this.children.list.filter((ch) => ch.name.startsWith('mark:') && (ch.getData('seen') as number) < now - 100);
    for (const ch of stale) ch.destroy();
  }
}
