import Phaser from 'phaser';
import type { GameState, IgelFx, IgelState, Look } from '../../shared/types';
import { IGEL, IGEL_COLORS, WEAPONS, type Mask, carve, genTerrain, seeded, surfaceY, windArrows } from '../../shared/igel';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { coconut, hedgehog, paintCrater, paintIslandSky, paintTerrain, sandcastle, swimRing, waterBomb } from '../art/igel';
import { bus, getState, playerById } from './store';
import { GOLD, background, ensureTex, ink, panel, txt } from './ui';

const TERRAIN_KEY = 'igel_terrain';
const lookKey = (l: Look) => `${l.hair}_${l.hairStyle}_${l.shirt}`;
const colorOf = (st: IgelState, id: string) => IGEL_COLORS[Math.max(0, st.teams.indexOf(id)) % IGEL_COLORS.length];
const colorNum = (s: string) => parseInt(s.slice(1), 16);

interface HogView {
  c: Phaser.GameObjects.Container;
  spr: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  state: string;
  look: Look;
}

/**
 * TV-Ansicht für Igel-Krieg. Das Terrain wird lokal aus Seed + Kraterliste nachgebaut
 * und in eine Canvas-Textur gemalt – neue Krater werden nur noch hineingestanzt.
 */
export class IgelScene extends Phaser.Scene {
  private seed = -1;
  private mask: Mask | null = null;
  private applied = 0;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private terrainImg: Phaser.GameObjects.Image | null = null;
  private hogs = new Map<number, HogView>();
  private projs = new Map<number, { img: Phaser.GameObjects.Image; x: number; y: number }>();
  private rings: { img: Phaser.GameObjects.Image; vx: number }[] = [];
  private waterG!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private activeName!: Phaser.GameObjects.Text;
  private hudKey = '';
  private lastFx = -1;
  private waterY: number = IGEL.WATER_Y;
  private latest: GameState | null = null;

  constructor() {
    super('igel');
  }

  create() {
    this.seed = -1;
    this.mask = null;
    this.applied = 0;
    this.tex = null;
    this.terrainImg = null;
    this.hogs.clear();
    this.projs.clear();
    this.rings = [];
    this.hudKey = '';
    this.lastFx = -1;
    this.waterY = IGEL.WATER_Y;
    this.latest = null;
    background(this, 'igelsky', IGEL.W, IGEL.H, (p) => paintIslandSky(p, 9));
    this.aimG = this.add.graphics().setDepth(25);
    this.waterG = this.add.graphics().setDepth(30);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.activeName = txt(this, 0, 0, '', {}).setDepth(26);
    this.banner = txt(this, IGEL.W / 2, 92, '', { size: 24, color: GOLD }).setDepth(1001);
    this.bannerSub = txt(this, IGEL.W / 2, 124, '', { size: 8 }).setDepth(1001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Terrain

  private buildTerrain(st: IgelState) {
    this.terrainImg?.destroy();
    for (const v of this.hogs.values()) v.c.destroy();
    this.hogs.clear();
    if (this.textures.exists(TERRAIN_KEY)) this.textures.remove(TERRAIN_KEY);
    this.seed = st.seed;
    this.mask = genTerrain(st.seed);
    this.applied = 0;
    this.tex = this.textures.createCanvas(TERRAIN_KEY, IGEL.W, IGEL.H)!;
    const ctx = this.tex.getContext();
    const img = ctx.createImageData(IGEL.W, IGEL.H);
    paintTerrain(img, this.mask);
    ctx.putImageData(img, 0, 0);
    this.paintDecor(ctx, st);
    this.tex.refresh();
    this.terrainImg = this.add.image(0, 0, TERRAIN_KEY).setOrigin(0, 0).setDepth(0);
    // Effekte von vor dem Szenenstart nicht nochmal abspielen
    this.lastFx = st.fx.length ? st.fx[st.fx.length - 1].seq : 0;
  }

  /** Palmen und Sonnenschirm direkt ins Terrain malen (gehen bei Explosionen mit kaputt) */
  private paintDecor(ctx: CanvasRenderingContext2D, st: IgelState) {
    const m = this.mask!;
    const r = seeded(st.seed ^ 0x5eed);
    const used: number[] = [];
    const items = [() => O.palm(6), () => O.palm(11), () => O.umbrella(C.red), () => O.umbrella(C.blue)];
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 3; tries++) {
      const x = 30 + Math.floor(r() * (IGEL.W - 60));
      const sy = surfaceY(m, x);
      if (sy > IGEL.WATER_Y - 22 || sy < 60 || used.some((u) => Math.abs(u - x) < 70)) continue;
      if (Math.abs(surfaceY(m, x - 6) - surfaceY(m, x + 6)) > 6) continue;
      // Nur auf festem Boden (nicht auf schwebenden Felsen oder über Höhlen)
      if (![6, 14, 24, 34].every((dy) => m[(sy + dy) * IGEL.W + x] === 1)) continue;
      const pix = items[Math.floor(r() * items.length)]();
      ctx.drawImage(pix.canvas, Math.round(x - pix.w / 2), sy - pix.h + 3);
      used.push(x);
      placed++;
    }
  }

  private applyCraters(st: IgelState) {
    if (!this.mask || !this.tex || this.applied >= st.craters.length) return;
    const ctx = this.tex.getContext();
    for (; this.applied < st.craters.length; this.applied++) {
      const [cx, cy, r] = st.craters[this.applied];
      carve(this.mask, cx, cy, r);
      const x0 = Math.max(0, Math.floor(cx - r - 4));
      const y0 = Math.max(0, Math.floor(cy - r - 4));
      const x1 = Math.min(IGEL.W, Math.ceil(cx + r + 4));
      const y1 = Math.min(IGEL.H, Math.ceil(cy + r + 4));
      if (x1 <= x0 || y1 <= y0) continue;
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      paintCrater(img, x0, y0, this.mask, cx, cy, r);
      ctx.putImageData(img, x0, y0);
    }
    this.tex.refresh();
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'igel') return;
    const st = s.mini.state;
    if (st.seed !== this.seed) this.buildTerrain(st);
    this.applyCraters(st);

    // Igel anlegen / Zustand wechseln
    for (const h of st.hogs) {
      let v = this.hogs.get(h.id);
      if (!v) {
        const look = playerById(h.owner)?.look ?? { skin: 0, hair: 0, hairStyle: 0, shirt: 0, beard: 0 };
        const spr = this.add.image(0, 2, this.hogTex(look, 0)).setOrigin(0.5, 1);
        const label = txt(this, 0, -24, String(h.hp), { color: colorOf(st, h.owner) });
        const c = this.add.container(h.x, h.y, [spr, label]).setDepth(10);
        v = { c, spr, label, x: h.x, y: h.y, state: 'ok', look };
        this.hogs.set(h.id, v);
      }
      if (h.state !== v.state) {
        if (h.state === 'dead') {
          v.spr.setTexture(ensureTex(this, 'igel_castle', sandcastle)).setAngle(0).setFlipX(false);
          v.label.setVisible(false);
        } else if (h.state === 'drowned') {
          v.c.setVisible(false);
          const img = this.add.image(h.x, st.water, ensureTex(this, `igel_ring_${lookKey(v.look)}`, () => swimRing(v!.look))).setOrigin(0.5, 0.7).setDepth(31);
          this.rings.push({ img, vx: (st.wind >= 0 ? 1 : -1) * (6 + Math.random() * 6) });
        }
        v.state = h.state;
      }
      v.label.setText(String(Math.max(0, h.hp)));
    }

    // Geschosse
    const alive = new Set(st.projs.map((p) => p.id));
    for (const [id, p] of this.projs) {
      if (!alive.has(id)) {
        p.img.destroy();
        this.projs.delete(id);
      }
    }
    for (const p of st.projs) {
      if (this.projs.has(p.id)) continue;
      const key = p.type === 'bazooka' ? ensureTex(this, 'igel_coco', coconut) : ensureTex(this, 'igel_bomb', waterBomb);
      this.projs.set(p.id, { img: this.add.image(p.x, p.y, key).setDepth(20), x: p.x, y: p.y });
    }

    // Effekte
    for (const f of st.fx) {
      if (f.seq <= this.lastFx) continue;
      this.lastFx = f.seq;
      this.playFx(f);
    }

    // Banner
    if (st.sub === 'countdown') {
      this.banner.setText('IGEL-KRIEG!');
      this.bannerSub.setText(`Los geht's in ${Math.max(1, Math.ceil(st.endsIn / 1000))} ...`);
    } else if (st.sub === 'over') {
      const winners = st.teams.filter((id) => !st.out.includes(id));
      this.banner.setText(winners.length === 1 ? 'SIEG!' : winners.length === 0 ? 'ALLE NASS!' : 'ZEIT UM!');
      this.bannerSub.setText(winners.length === 1 ? `${playerById(winners[0])?.name ?? '?'} beherrscht die Insel` : '');
    } else if (!this.banner.getData('fx')) {
      this.banner.setText('');
      this.bannerSub.setText('');
    }

    this.renderHud(st);
  }

  private hogTex(look: Look, frame: number) {
    return ensureTex(this, `igel_hog_${lookKey(look)}_${frame}`, () => hedgehog(look, frame));
  }

  private renderHud(st: IgelState) {
    const secs = st.sub === 'aim' || st.sub === 'retreat' ? Math.ceil(st.endsIn / 1000) : null;
    const flood = st.suddenDeath ? 'FLUT!' : `Flut ${Math.floor(st.suddenIn / 60000)}:${String(Math.floor(st.suddenIn / 1000) % 60).padStart(2, '0')}`;
    const hpOf = (id: string) => st.hogs.filter((h) => h.owner === id && h.state === 'ok').reduce((a, h) => a + h.hp, 0);
    const key = JSON.stringify([st.active, secs, st.sub, st.weapon, st.wind, flood, st.teams.map(hpOf)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 2, 476, 20));
    if (st.active) {
      const name = (playerById(st.active)?.name ?? '?').slice(0, 10);
      const who = st.sub === 'retreat' ? `${name}: weg da!` : `${name}${secs !== null ? ` ${secs}s` : ''}`;
      this.hud.add(ink(this, 10, 8, who, { origin: [0, 0], color: colorOf(st, st.active) === '#fdf7ea' ? '#3d2414' : colorOf(st, st.active) }));
      this.hud.add(ink(this, 240, 8, WEAPONS[st.weapon].short, { origin: [0.5, 0] }));
    } else {
      this.hud.add(ink(this, 10, 8, st.sub === 'countdown' ? 'Igel auf Position ...' : '...', { origin: [0, 0] }));
    }
    const wind = Math.abs(st.wind) < 0.17 ? 'Wind -' : `Wind ${windArrows(st.wind)}`;
    this.hud.add(ink(this, 470, 8, `${wind}  ${flood}`, { origin: [1, 0], color: st.suddenDeath ? '#a8342a' : undefined }));

    // Team-Übersicht unten (über dem Wasser)
    const n = st.teams.length;
    const perRow = Math.min(n, 6);
    const rows = Math.ceil(n / perRow);
    const cw = 476 / perRow;
    st.teams.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const x = 4 + col * cw;
      const y = IGEL.H - 12 - (rows - 1 - row) * 11;
      const hp = hpOf(id);
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, perRow > 4 ? 4 : 7);
      this.hud.add(this.add.rectangle(x + 4, y + 4, 7, 7, colorNum(colorOf(st, id))).setStrokeStyle(1, 0x2d1b12).setAlpha(hp > 0 ? 1 : 0.4));
      this.hud.add(txt(this, x + 11, y, `${name} ${hp}`, { origin: [0, 0], color: hp > 0 ? (id === st.active ? GOLD : '#fff4d6') : '#9fb6c4' }));
    });
  }

  // ---------------------------------------------------------------- Effekte

  private playFx(f: IgelFx) {
    switch (f.type) {
      case 'boom': {
        const r = f.r ?? 20;
        const flash = this.add.circle(f.x, f.y, r * 0.6, 0xfff3c4, 1).setDepth(40);
        const fire = this.add.circle(f.x, f.y, r * 0.5, 0xf0973a, 0.95).setDepth(39);
        this.tweens.add({ targets: flash, scale: 1.7, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
        this.tweens.add({ targets: fire, scale: 2.2, alpha: 0, duration: 480, onComplete: () => fire.destroy() });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const puff = this.add.circle(f.x + Math.cos(a) * r * 0.5, f.y + Math.sin(a) * r * 0.5, 5, 0xf5fbff, 0.9).setDepth(41);
          this.tweens.add({ targets: puff, x: puff.x + Math.cos(a) * 12, y: puff.y - 10, scale: 1.8, alpha: 0, duration: 700, onComplete: () => puff.destroy() });
        }
        for (let i = 0; i < 10; i++) {
          const bit = this.add.rectangle(f.x, f.y, 2, 2, i % 3 ? 0xa97a43 : 0x5fa437).setDepth(41);
          const vx = (Math.random() - 0.5) * 90;
          this.tweens.add({ targets: bit, x: f.x + vx, y: f.y - 20 - Math.random() * 25, duration: 260, ease: 'Quad.out', yoyo: false, onComplete: () => this.tweens.add({ targets: bit, y: bit.y + 50, alpha: 0, duration: 420, ease: 'Quad.in', onComplete: () => bit.destroy() }) });
        }
        const word = txt(this, f.x, f.y - r - 6, Math.random() < 0.5 ? 'BUMM!' : 'KRAWUMM!', { color: GOLD }).setDepth(42);
        this.tweens.add({ targets: word, y: word.y - 12, alpha: 0, duration: 800, delay: 150, onComplete: () => word.destroy() });
        this.cameras.main.shake(160, 0.006);
        break;
      }
      case 'dmg': {
        const t = txt(this, f.x, f.y - 8, f.text ?? '', { color: '#ff6b5a' }).setDepth(43);
        this.tweens.add({ targets: t, y: t.y - 18, duration: 1100, ease: 'Quad.out' });
        this.tweens.add({ targets: t, alpha: 0, duration: 400, delay: 900, onComplete: () => t.destroy() });
        break;
      }
      case 'splash': {
        for (let i = 0; i < 7; i++) {
          const drop = this.add.circle(f.x, f.y, 2, 0xbfe9ff).setDepth(41);
          this.tweens.add({ targets: drop, x: f.x + (i - 3) * 5, y: f.y - 14 - Math.random() * 10, duration: 220, ease: 'Quad.out', onComplete: () => this.tweens.add({ targets: drop, y: f.y + 4, alpha: 0, duration: 280, ease: 'Quad.in', onComplete: () => drop.destroy() }) });
        }
        if (f.text) {
          const t = txt(this, f.x, f.y - 26, f.text, { color: '#bfe9ff' }).setDepth(42);
          this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 1200, delay: 300, onComplete: () => t.destroy() });
        }
        break;
      }
      case 'pow': {
        const t = txt(this, f.x, f.y - 8, f.text ?? 'POW!', { color: GOLD }).setDepth(42).setScale(0.4);
        this.tweens.add({ targets: t, scale: 1.2, duration: 160, yoyo: true, hold: 300, onComplete: () => t.destroy() });
        break;
      }
      case 'tele': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const sp = this.add.rectangle(f.x, f.y, 2, 2, i % 2 ? 0xf07aa8 : 0xfff3c4).setDepth(41);
          this.tweens.add({ targets: sp, x: f.x + Math.cos(a) * 14, y: f.y + Math.sin(a) * 14, alpha: 0, duration: 500, onComplete: () => sp.destroy() });
        }
        break;
      }
      case 'ko': {
        const t = txt(this, f.x, f.y - 6, f.text ?? 'K.O.', { color: '#fff4d6' }).setDepth(42);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1500, onComplete: () => t.destroy() });
        break;
      }
      case 'water': {
        this.banner.setText(f.text ?? 'FLUT!').setData('fx', true);
        this.bannerSub.setText('');
        this.time.delayedCall(1800, () => {
          this.banner.setData('fx', false);
          this.banner.setText('');
        });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- Frame

  update(time: number) {
    const s = this.latest;
    if (s?.mini?.kind !== 'igel') return;
    const st = s.mini.state;

    // Igel
    for (const h of st.hogs) {
      const v = this.hogs.get(h.id);
      if (!v || h.state === 'drowned') continue;
      const k = h.flying ? 0.55 : 0.35;
      v.x += (h.x - v.x) * k;
      v.y += (h.y - v.y) * k;
      v.c.setPosition(Math.round(v.x), Math.round(v.y));
      if (h.state === 'ok') {
        const frame = h.walking ? Math.floor(time / 130) % 2 : 0;
        v.spr.setTexture(this.hogTex(v.look, frame)).setFlipX(h.dir < 0);
        v.spr.setAngle(h.flying ? Math.sin(time / 60) * 12 : 0);
        v.spr.setY(h.walking ? 2 - (Math.floor(time / 130) % 2) : 2);
      }
      v.c.setDepth(h.id === st.activeHog ? 12 : 10);
    }

    // Aktiver Igel: Pfeil + Name
    this.aimG.clear();
    const ah = st.activeHog !== null ? this.hogs.get(st.activeHog) : undefined;
    const ahs = st.activeHog !== null ? st.hogs[st.activeHog] : undefined;
    if (ah && ahs && ahs.state === 'ok' && st.sub !== 'over' && st.sub !== 'settle') {
      const bob = Math.sin(time / 160) * 2;
      const col = colorNum(colorOf(st, ahs.owner));
      const ty = ah.y - 34 + bob;
      this.aimG.fillStyle(0x2d1b12).fillTriangle(ah.x - 5, ty - 1, ah.x + 5, ty - 1, ah.x, ty + 6);
      this.aimG.fillStyle(col).fillTriangle(ah.x - 3, ty, ah.x + 3, ty, ah.x, ty + 4);
      this.activeName.setText(playerById(ahs.owner)?.name ?? '').setPosition(Math.round(ah.x), Math.round(ty - 12)).setColor(colorOf(st, ahs.owner)).setVisible(true);
      // Ziellinie
      if (st.sub === 'aim' && st.aim) {
        const cx = ah.x;
        const cy = ah.y - 4;
        const a = st.aim.angle;
        const p = st.aim.power;
        if (st.weapon === 'teleport') {
          const tx = cx + Math.cos(a) * p * IGEL.TELE_RANGE;
          const tyy = cy + Math.sin(a) * p * IGEL.TELE_RANGE;
          for (let d = 8; d < p * IGEL.TELE_RANGE; d += 7) this.aimG.fillStyle(0xf07aa8, 0.8).fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2);
          this.aimG.lineStyle(1, 0xf07aa8).strokeCircle(tx, tyy, 6 + Math.sin(time / 100));
        } else {
          const len = st.weapon === 'punch' ? 14 : 12 + p * 60;
          for (let d = 8; d < len; d += 5) {
            const t = (d - 8) / Math.max(1, len - 8);
            this.aimG.fillStyle(t > 0.66 ? 0xe0503f : t > 0.33 ? 0xf2c33a : 0xfdf7ea, 1).fillRect(Math.round(cx + Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d) - 1, 2, 2);
          }
          const ex = cx + Math.cos(a) * (len + 3);
          const ey = cy + Math.sin(a) * (len + 3);
          this.aimG.lineStyle(1, 0x2d1b12).strokeCircle(ex, ey, 3);
        }
      }
    } else this.activeName.setVisible(false);

    // Geschosse
    for (const p of st.projs) {
      const v = this.projs.get(p.id);
      if (!v) continue;
      v.x += (p.x - v.x) * 0.6;
      v.y += (p.y - v.y) * 0.6;
      v.img.setPosition(Math.round(v.x), Math.round(v.y));
      if (p.type === 'bazooka') v.img.setAngle(time * 0.8);
    }

    // Wasser (steigt im Sudden Death)
    this.waterY += (st.water - this.waterY) * 0.05;
    const wy = this.waterY;
    const g = this.waterG;
    g.clear();
    g.fillStyle(0x3784c2, 0.82).fillRect(0, wy + 2, IGEL.W, IGEL.H - wy);
    g.fillStyle(0x2b6ba6, 0.5).fillRect(0, wy + 12, IGEL.W, IGEL.H - wy);
    for (let x = 0; x < IGEL.W; x += 3) {
      const off = Math.round(Math.sin(x / 11 + time / 400) * 1.5 + Math.sin(x / 5 + time / 260) * 0.7);
      g.fillStyle(0x4aa2dc, 0.9).fillRect(x, wy + off, 3, 3);
      g.fillStyle(0xeaf8ff, 0.95).fillRect(x, wy + off - 1, 3, 1);
    }
    for (const r of this.rings) {
      r.img.x += r.vx * (1 / 60);
      r.img.y = wy + Math.sin(time / 300 + r.img.x / 20) * 1.5;
      if (r.img.x < -20 || r.img.x > IGEL.W + 20) r.img.setVisible(false);
    }
  }
}
