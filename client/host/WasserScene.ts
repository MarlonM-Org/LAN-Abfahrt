import Phaser from 'phaser';
import type { GameState, Team } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import { WASSER as W, WASSER_BASE, WASSER_COVER, WASSER_HOSE, WASSER_HOSE_REEL, WASSER_POOL, type WasserBalloon, type WasserState } from '../../shared/wasser';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { bucket, hedge, hoseReel, nozzle, paintGarden, waterBalloon, waterPistol } from '../art/garden';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { BLUE_INK, background, ensureTex, ink, panel, prop, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SUN_INK = '#b06d00';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Fig {
  f: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  gun: Phaser.GameObjects.Image;
  x: number;
  y: number;
  barKey: string;
  dripAt: number;
}

export class WasserScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private balloons = new Map<number, { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; b: WasserBalloon; recv: number }>();
  private seenSplash = new Set<number>();
  private aimG!: Phaser.GameObjects.Graphics;
  private pistol!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private helpBg!: Phaser.GameObjects.Image;
  private feed!: Phaser.GameObjects.Text;
  private latest: WasserState | null = null;
  private hudKey = '';
  private lastSoak = 0;

  constructor() {
    super('wasser');
  }

  create() {
    this.figs.clear();
    this.balloons.clear();
    this.seenSplash.clear();
    this.latest = null;
    this.hudKey = '';
    this.lastSoak = 0;

    background(this, 'wassergarden', WORLD.W, WORLD.H, (p) => paintGarden(p, W.AREA, WASSER_POOL, WASSER_HOSE));

    // Deko am Rand (außerhalb der Laufwege)
    prop(this, 'w_tree1', () => O.tree(5), 8, W.AREA.y + 34).setDepth(W.AREA.y + 34);
    prop(this, 'w_tree2', () => O.fruitTree(9), 472, W.AREA.y + 34).setDepth(W.AREA.y + 34);
    prop(this, 'w_bush', () => O.bush(12, true), 70, WORLD.H + 4).setDepth(400);
    prop(this, 'w_bush2', () => O.bush(13), 410, WORLD.H + 4).setDepth(400);

    // Hecken + Liegen
    for (const r of WASSER_COVER) {
      if (r.kind === 'hedge') {
        this.add.image(r.x - 1, r.y - 7, ensureTex(this, `w_hedge_${r.w}_${r.h}`, () => hedge(r.w, r.h, 21 + r.w))).setOrigin(0, 0).setDepth(r.y + r.h);
      } else {
        const right = r.x > 240;
        const fabric = right ? TEAM_INFO.B.color : C.orange;
        this.add
          .image(r.x + r.w / 2, r.y + r.h + 4, ensureTex(this, `w_lounger_${right ? 'b' : 'a'}`, () => O.deckchair(fabric)))
          .setOrigin(0.5, 1)
          .setFlipX(right)
          .setDepth(r.y + r.h);
      }
    }
    prop(this, 'w_umbrella', () => O.umbrella(C.blue), WASSER_POOL.x - 14, WASSER_POOL.y + 28).setScale(0.8);
    prop(this, 'w_umbrella2', () => O.umbrella(C.orange), WASSER_POOL.x + WASSER_POOL.w + 14, WASSER_POOL.y + 28).setScale(0.8);

    // Lager: Handtuch + Eimer
    for (const t of ['A', 'B'] as Team[]) {
      const b = WASSER_BASE[t];
      const col = TEAM_INFO[t].color;
      this.add.image(b.towel.x, b.towel.y, ensureTex(this, `w_towel_${t}`, () => O.towel(col))).setDepth(b.towel.y - 20);
      this.add.ellipse(b.towel.x, b.towel.y, W.TOWEL_R * 2 + 6, W.TOWEL_R + 8, TEAM_INFO[t].colorNum, 0.15).setDepth(b.towel.y - 21);
      this.add.ellipse(b.bucket.x, b.bucket.y + 2, W.REFILL_R * 2, W.REFILL_R, 0x93d3f3, 0.25).setDepth(b.bucket.y - 21);
      this.add.image(b.bucket.x, b.bucket.y + 4, ensureTex(this, `w_bucket_${t}`, () => bucket(col))).setOrigin(0.5, 1).setDepth(b.bucket.y);
    }
    // Gartenschlauch in der Mitte
    this.add.image(WASSER_HOSE.x, WASSER_HOSE_REEL.y + WASSER_HOSE_REEL.h + 1, ensureTex(this, 'w_hose', hoseReel)).setOrigin(0.5, 1).setDepth(WASSER_HOSE_REEL.y + WASSER_HOSE_REEL.h);
    const noz = this.add.image(WASSER_HOSE.x + 14, WASSER_HOSE.y + 2, ensureTex(this, 'w_nozzle', nozzle)).setDepth(WASSER_HOSE.y + 2);
    this.time.addEvent({
      delay: 260,
      loop: true,
      callback: () => {
        const d = this.add.circle(noz.x + 6, noz.y, 1, 0xeaf8ff).setDepth(noz.y + 1);
        this.tweens.add({ targets: d, x: d.x + 4 + Math.random() * 6, y: d.y - 4 + Math.random() * 6, alpha: 0, duration: 380, onComplete: () => d.destroy() });
      },
    });

    this.pistol = this.add.image(0, 0, ensureTex(this, 'w_pistol', waterPistol)).setVisible(false);
    this.tweens.add({ targets: this.pistol, scale: 1.25, duration: 400, yoyo: true, repeat: -1 });

    this.aimG = this.add.graphics().setDepth(900);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 104, '', { size: 24, color: C.gold }).setDepth(1001);
    this.helpBg = panel(this, 70, 96, 340, 104, 'dark').setDepth(1000).setVisible(false);
    this.help = txt(this, WORLD.W / 2, 136, '', { color: C.white, wrap: 330 }).setDepth(1001);
    this.feed = txt(this, WORLD.W / 2, 88, '', { color: C.white }).setDepth(1001);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'wasser') return;
    const st = s.mini.state;
    this.latest = st;
    const now = this.time.now;

    // Figuren
    for (const [id, p] of Object.entries(st.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      const tag = txt(this, 0, -38, pl.name.replace(/^Bot\s+/, '').slice(0, 6), { color: hex(p.c) });
      const bar = this.add.graphics();
      const gun = this.add.image(7, -9, ensureTex(this, 'w_pistol', waterPistol)).setScale(0.75).setVisible(false);
      f.add([bar, tag, gun]);
      this.figs.set(id, { f, img, bar, gun, x: p.x, y: p.y, barKey: '', dripAt: 0 });
    }

    // Wasserbomben in der Luft
    const alive = new Set(st.balloons.map((b) => b.id));
    for (const [id, a] of this.balloons) {
      if (alive.has(id)) continue;
      a.img.destroy();
      a.shadow.destroy();
      this.balloons.delete(id);
    }
    for (const b of st.balloons) {
      const a = this.balloons.get(b.id);
      if (a) {
        a.b = b;
        a.recv = now;
        continue;
      }
      const img = this.add.image(b.fx, b.fy, ensureTex(this, `w_balloon_${b.c}`, () => waterBalloon(hex(b.c)))).setDepth(950);
      const shadow = this.add.ellipse(b.fx, b.fy + 8, 6, 2, 0x000000, 0.25).setDepth(5);
      this.balloons.set(b.id, { img, shadow, b, recv: now });
    }

    // Platscher
    for (const sp of st.splashes) {
      if (this.seenSplash.has(sp.id)) continue;
      this.seenSplash.add(sp.id);
      this.splash(sp.x, sp.y, sp.big, sp.cover, sp.c);
    }
    if (this.seenSplash.size > 400) this.seenSplash = new Set([...this.seenSplash].slice(-100));

    // Wasserpistole
    this.pistol.setVisible(!!st.pistol);
    if (st.pistol) this.pistol.setPosition(st.pistol.x, st.pistol.y).setDepth(st.pistol.y);

    // Klatschnass-Meldung
    if (st.lastSoak && st.lastSoak.seq !== this.lastSoak) {
      this.lastSoak = st.lastSoak.seq;
      const v = st.players[st.lastSoak.victim];
      const name = playerById(st.lastSoak.victim)?.name ?? '?';
      const by = st.lastSoak.by ? playerById(st.lastSoak.by)?.name : null;
      this.feed.setText(`${name} ist klatschnass!${by ? ` (${by})` : ''}`).setAlpha(1);
      this.tweens.killTweensOf(this.feed);
      this.tweens.add({ targets: this.feed, alpha: 0, delay: 2200, duration: 500 });
      if (v) {
        const t = txt(this, v.x, v.y - 48, 'PLATSCH!', { color: '#9fe0ff' }).setDepth(2000);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
      }
    }

    // Banner
    this.helpBg.setVisible(st.sub === 'countdown');
    if (st.sub === 'countdown') {
      this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000))));
      this.help.setText(
        `${st.ffa ? 'Jeder gegen jeden!' : 'Team Sonne gegen Team Meer!'}\nLinker Stick: laufen\nRechter Stick: zielen + loslassen = werfen\nKlatschnass? Zurück zum Handtuch!`,
      );
    } else if (st.sub === 'play') {
      this.banner.setText('');
      this.help.setText('');
    } else {
      this.banner.setText('Zeit um!');
      this.help.setText('');
    }

    // HUD
    const key = JSON.stringify([Math.ceil(st.endsIn / 1000), st.score, st.ffa ? Object.values(st.players).map((p) => p.k) : 0]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 120, 1, 240, 26));
    if (st.ffa) {
      Object.entries(st.players).forEach(([id, p], i) => {
        const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 4);
        this.hud.add(ink(this, 130 + i * 62, 10, `${name} ${p.k}`, { color: hex(p.c), origin: [0, 0] }));
      });
      this.hud.add(ink(this, 350, 10, mmss(st.endsIn), { origin: [1, 0] }));
    } else {
      this.hud.add(ink(this, 132, 10, `Sonne ${st.score.A}`, { color: SUN_INK, origin: [0, 0] }));
      this.hud.add(ink(this, WORLD.W / 2, 10, mmss(st.endsIn)));
      this.hud.add(ink(this, 348, 10, `${st.score.B} Meer`, { color: BLUE_INK, origin: [1, 0] }));
    }
  }

  private splash(x: number, y: number, big: boolean, cover: boolean, color: number) {
    const ring = this.add.ellipse(x, y, 6, 3, 0x93d3f3, 0.9).setDepth(y + 1);
    const R = big ? W.SPLASH_R * 2 : W.SPLASH_R * 1.6;
    this.tweens.add({ targets: ring, displayWidth: R, displayHeight: R * 0.55, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
    const puddle = this.add.ellipse(x, y, R * 0.7, R * 0.35, 0x3784c2, 0.35).setDepth(1);
    this.tweens.add({ targets: puddle, alpha: 0, delay: 1500, duration: 1500, onComplete: () => puddle.destroy() });
    const n = big ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = this.add.rectangle(x, y - 2, 2, 2, i % 3 === 0 ? color : 0xeaf8ff).setDepth(y + 2);
      const dist = (big ? 16 : 11) * (0.6 + Math.random() * 0.6);
      this.tweens.add({
        targets: d,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist * 0.55 - 6,
        alpha: 0,
        duration: 380 + Math.random() * 200,
        ease: 'Quad.easeOut',
        onComplete: () => d.destroy(),
      });
    }
    // Ballonfetzen
    const scrap = this.add.rectangle(x + 2, y, 3, 2, color).setDepth(y);
    this.tweens.add({ targets: scrap, alpha: 0, delay: 600, duration: 500, onComplete: () => scrap.destroy() });
    if (big) {
      const t = txt(this, x, y - 30, 'Volltreffer!', { color: '#ffd25e' }).setDepth(2000).setScale(0.75);
      this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 800, onComplete: () => t.destroy() });
    } else if (cover) {
      const t = txt(this, x, y - 14, 'Deckung!', { color: '#c8f0c0' }).setDepth(2000).setScale(0.5);
      this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    }
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    const g = this.aimG;
    g.clear();

    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      a.x += (p.x - a.x) * 0.35;
      a.y += (p.y - a.y) * 0.35;
      a.img.setFlipX(p.d < 0);
      a.img.setY(p.m ? -Math.abs(Math.sin(now / 80)) * 2 : 0);
      a.f.setPosition(a.x, a.y + 4).setDepth(a.y + 4);
      // Nass = bläulich, Abtrocknen = gelblich
      if (p.s === 'soaked') a.img.setTint(0x8fc4ff);
      else if (p.s === 'drying') a.img.setTint(0xfff0b0);
      else if (p.w > 60) a.img.setTint(0xc8e2ff);
      else a.img.clearTint();
      a.f.setAlpha(p.s === 'ok' || Math.floor(now / 200) % 2 ? 1 : 0.75);
      a.gun.setVisible(p.pi > 0).setFlipX(p.d < 0).setX(p.d < 0 ? -7 : 7);

      // Nässe-Balken + Munition
      const barKey = `${p.s}-${p.w}-${p.a}-${p.dp}`;
      if (barKey !== a.barKey) {
        a.barKey = barKey;
        const bar = a.bar;
        bar.clear();
        bar.fillStyle(0x2d1b12, 1).fillRect(-8, 2, 16, 4);
        if (p.s === 'drying') bar.fillStyle(0xffd25e, 1).fillRect(-7, 3, Math.round(14 * p.dp), 2);
        else bar.fillStyle(p.w >= 100 ? 0x2b6ba6 : p.w > 70 ? 0x3f8fe0 : 0x93d3f3, 1).fillRect(-7, 3, Math.round((14 * p.w) / 100), 2);
        for (let i = 0; i < W.MAX_AMMO; i++) {
          bar.fillStyle(0x2d1b12, 1).fillRect(-7 + i * 5, -31, 4, 4);
          bar.fillStyle(i < p.a ? p.c : 0x7a5a3a, 1).fillRect(-6 + i * 5, -30, 2, 2);
        }
      }
      // Tropfen bei Klatschnassen
      if (p.s === 'soaked' && now > a.dripAt) {
        a.dripAt = now + 140;
        const d = this.add.rectangle(a.x - 5 + Math.random() * 10, a.y - 16 + Math.random() * 10, 1, 2, 0x93d3f3).setDepth(a.y + 6);
        this.tweens.add({ targets: d, y: d.y + 10, alpha: 0, duration: 400, onComplete: () => d.destroy() });
      }

      // Zielvorschau
      const len = Math.hypot(p.ax, p.ay);
      if (p.s !== 'ok' || len < 0.15) continue;
      const fx = a.x;
      const fy = a.y - 8;
      if (p.pi > 0) {
        const ux = p.ax / len;
        const uy = p.ay / len;
        const L = W.PISTOL_RANGE;
        g.lineStyle(3, 0x93d3f3, 0.85).lineBetween(fx, fy, fx + ux * L, fy + 6 + uy * L);
        g.lineStyle(1, 0xeaf8ff, 1).lineBetween(fx, fy, fx + ux * L, fy + 6 + uy * L);
        for (let i = 0; i < 4; i++) {
          const t = ((now / 300 + i / 4) % 1) * 1.05;
          g.fillStyle(0xeaf8ff, 1).fillRect(fx + ux * L * t - 1 + Math.sin(i * 7 + now / 50), fy + (6 + uy * L) * t + Math.cos(i * 5 + now / 60), 2, 2);
        }
        continue;
      }
      const tx = clamp(p.x + p.ax * W.RANGE, W.AREA.x + 2, W.AREA.x + W.AREA.w - 2);
      const ty = clamp(p.y + p.ay * W.RANGE, W.AREA.y + 2, W.AREA.y + W.AREA.h - 2);
      const dist = Math.hypot(tx - p.x, ty - p.y);
      const h = 10 + dist * 0.3;
      const col = p.a > 0 ? p.c : 0x7a5a3a;
      const steps = Math.max(6, Math.round(dist / 7));
      const shift = (now / 90) % 1;
      for (let i = 0; i < steps; i++) {
        const t = (i + shift) / steps;
        if (t <= 0.04) continue;
        const x = Math.round(fx + (tx - fx) * t);
        const y = Math.round(fy + (ty - fy) * t - Math.sin(Math.PI * t) * h);
        g.fillStyle(0x2d1b12, 0.85).fillRect(x - 2, y - 2, 4, 4);
        g.fillStyle(col, 1).fillRect(x - 1, y - 1, 2, 2);
      }
      g.lineStyle(1, col, 0.9).strokeEllipse(tx, ty, W.SPLASH_R * 2, W.SPLASH_R);
      g.fillStyle(col, 0.18).fillEllipse(tx, ty, W.SPLASH_R * 2, W.SPLASH_R);
      g.lineStyle(1, 0x2d1b12, 0.8).strokeEllipse(tx, ty, W.DIRECT_R * 2, W.DIRECT_R);
    }

    // Wasserbomben fliegen (lokal weitergerechnet)
    for (const a of this.balloons.values()) {
      const b = a.b;
      const t = clamp((b.age + (now - a.recv)) / b.dur, 0, 1);
      const dist = Math.hypot(b.tx - b.fx, b.ty - (b.fy + 8));
      const h = 10 + dist * 0.3;
      const gx = b.fx + (b.tx - b.fx) * t;
      const gy = b.fy + 8 + (b.ty - b.fy - 8) * t;
      a.shadow.setPosition(gx, gy).setScale(0.6 + 0.4 * (1 - Math.sin(Math.PI * t)));
      a.img.setPosition(b.fx + (b.tx - b.fx) * t, b.fy + (b.ty - b.fy) * t - Math.sin(Math.PI * t) * h).setRotation(t * 6);
    }
  }
}
