import Phaser from 'phaser';
import type { GameState, IgelFx, IgelState, Look } from '../../shared/types';
import { IGEL, IGEL_COLORS, WEAPONS, type Mask, carve, genTerrain, seeded, surfaceY } from '../../shared/igel';
import { C } from '../art/palette';
import { cloud } from '../art/flieger';
import * as O from '../art/objects';
import { coconut, hedgehog, paintCrater, paintIslandSky, paintTerrain, sandcastle, swimRing, waterBomb } from '../art/igel';
import { bus, getState, playerById } from './store';
import { GOLD, background, ensureTex, ink, panel, txt } from './ui';
import type { IgelAim, IgelObj, IgelProjType, IgelWeapon } from '../../shared/types';
import { aimPath, applyOp, isThrown, squadOf } from '../../shared/igel';
import { Pix } from '../art/pix';
import { Juice } from './juice';
import { sfx } from './sfx';

const TERRAIN_KEY = 'igel_terrain';
const lookKey = (l: Look) => `${l.hair}_${l.hairStyle}_${l.shirt}`;
const colorOf = (st: IgelState, id: string) => IGEL_COLORS[Math.max(0, st.teams.indexOf(id)) % IGEL_COLORS.length];
const colorNum = (s: string) => parseInt(s.slice(1), 16);
/** Kamera: Zoom auf den aktiven Igel / das Geschoss, Überblick in der Settle-Phase */
const ZOOM_NEAR = 1.5;
const CAM_PAN_MS = 600;
/** So lange bleibt die Kamera nach dem Einschlag auf dem Krater stehen */
const CAM_HOLD_MS = 300;
/** Wolken ziehen mit wind × 40 px/s */
const CLOUD_SPEED = 40;

type CamMode = 'overview' | 'hog' | 'proj' | 'hold';

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
  /** Eigene HUD-Kamera: HUD und Banner bleiben fix, während die Hauptkamera zoomt und schwenkt */
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private hudBuilding = false;
  private camMode: CamMode = 'overview';
  private camTurn = -1;
  private camHoldUntil = 0;
  private followProj = -1;
  private clouds!: Phaser.GameObjects.TileSprite;
  private specks: { r: Phaser.GameObjects.Rectangle; x: number; y: number; ph: number }[] = [];
  private bubbles: { t: Phaser.GameObjects.Text; hog: number; until: number }[] = [];
  private windG!: Phaser.GameObjects.Graphics;
  private juice!: Juice;
  private objViews = new Map<number, { img: Phaser.GameObjects.Image; chute: Phaser.GameObjects.Image | null; x: number; y: number; type: IgelObj['type'] }>();
  /** Zielhilfe-Cache pro Igel (Flugbahn nur neu rechnen, wenn sich etwas ändert) */
  private aimCache = new Map<number, { key: string; pts: { x: number; y: number }[] }>();
  private lastSub = '';
  private shownSum = -1;
  private lastTick = 0;

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
    this.camMode = 'overview';
    this.camTurn = -1;
    this.camHoldUntil = 0;
    this.followProj = -1;
    this.specks = [];
    this.bubbles = [];
    this.hudBuilding = false;
    this.objViews.clear();
    this.aimCache.clear();
    this.lastSub = '';
    this.shownSum = -1;
    this.lastTick = 0;

    // Kameras: Hauptkamera für die Welt (Zoom/Schwenk), HUD-Kamera fix darüber.
    // Alles, was neu in die Szene kommt, sieht die HUD-Kamera nicht – außer beim HUD-Aufbau.
    const main = this.cameras.main;
    main.setBounds(0, 0, IGEL.W, IGEL.H).setZoom(1).centerOn(IGEL.W / 2, IGEL.H / 2);
    this.hudCam = this.cameras.add(0, 0, IGEL.W, IGEL.H);
    const onAdded = (go: Phaser.GameObjects.GameObject) => {
      if (!this.hudBuilding) this.hudCam.ignore(go);
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);

    background(this, 'igelsky', IGEL.W, IGEL.H, (p) => paintIslandSky(p, 9));
    this.clouds = this.add.tileSprite(0, 6, IGEL.W, 96, ensureTex(this, 'igel_clouds', () => this.cloudStrip())).setOrigin(0, 0).setDepth(-900).setAlpha(0.85);
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * IGEL.W;
      const y = 30 + Math.random() * 170;
      const r = this.add.rectangle(x, y, i % 3 ? 2 : 3, 1, i % 3 ? 0xf3e2b0 : 0x7cc46a).setDepth(5).setAlpha(0);
      this.specks.push({ r, x, y, ph: Math.random() * Math.PI * 2 });
    }
    this.aimG = this.add.graphics().setDepth(25);
    this.waterG = this.add.graphics().setDepth(30);
    this.activeName = txt(this, 0, 0, '', {}).setDepth(26);
    this.hudBuilding = true;
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, IGEL.W / 2, 92, '', { size: 24, color: GOLD }).setDepth(1001);
    this.bannerSub = txt(this, IGEL.W / 2, 124, '', { size: 8 }).setDepth(1001);
    this.windG = this.add.graphics().setDepth(1002);
    this.hudBuilding = false;
    main.ignore([this.hud, this.banner, this.bannerSub, this.windG]);
    // Partikel/Töne aus dem gemeinsamen Baukasten (Emitter landen nur in der Welt-Kamera)
    this.juice = new Juice(this, { depth: 41 });

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', fn);
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    });
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Terrain

  private buildTerrain(st: IgelState) {
    this.terrainImg?.destroy();
    for (const v of this.hogs.values()) v.c.destroy();
    this.hogs.clear();
    for (const v of this.objViews.values()) (v.img.destroy(), v.chute?.destroy());
    this.objViews.clear();
    this.aimCache.clear();
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

  /** Neue Terrain-Operationen einarbeiten: Krater stanzen bzw. Surfbrett-Pixel aufmalen */
  private applyCraters(st: IgelState) {
    if (!this.mask || !this.tex || this.applied >= st.ops.length) return;
    const ctx = this.tex.getContext();
    for (; this.applied < st.ops.length; this.applied++) {
      const op = st.ops[this.applied];
      const [cx, cy, r, kind] = op;
      applyOp(this.mask, op);
      const pad = kind === 'add' ? 1 : 4;
      const x0 = Math.max(0, Math.floor(cx - r - pad));
      const y0 = Math.max(0, Math.floor(cy - r - pad));
      const x1 = Math.min(IGEL.W, Math.ceil(cx + r + pad));
      const y1 = Math.min(IGEL.H, Math.ceil(cy + r + pad));
      if (x1 <= x0 || y1 <= y0) continue;
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
      if (kind === 'add') this.paintPlank(img, x0, y0, cx, cy, r);
      else paintCrater(img, x0, y0, this.mask, cx, cy, r);
      ctx.putImageData(img, x0, y0);
    }
    this.tex.refresh();
  }

  /** Surfbrett: neue feste Pixel in Brettfarben (gelb mit rotem Streifen, dunkler Rand unten) */
  private paintPlank(img: ImageData, ox: number, oy: number, cx: number, cy: number, r: number) {
    const d = img.data;
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const x = ox + i;
        const y = oy + j;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 0.01 || !this.mask![y * IGEL.W + x]) continue;
        const k = (j * img.width + i) * 4;
        if (d[k + 3] > 0 && !(d[k] === 0xff && d[k + 1] === 0xd2) && !(d[k] === 0xe0 && d[k + 1] === 0x50) && !(d[k] === 0xa8 && d[k + 1] === 0x34)) continue;
        const dy = y + 0.5 - cy;
        const [rr, gg, bb] = dy > r * 0.45 ? [0xa8, 0x34, 0x2a] : Math.abs(dy) < 0.6 ? [0xe0, 0x50, 0x3f] : [0xff, 0xd2, 0x5e];
        d[k] = rr;
        d[k + 1] = gg;
        d[k + 2] = bb;
        d[k + 3] = 255;
      }
    }
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
        // Spieler-Teams: kleines Fähnchen in Teamfarbe links neben der HP-Zahl
        const sq = squadOf(st, h.owner);
        if (sq >= 0) c.add(this.add.rectangle(-17, -24, 4, 6, colorNum(st.squads![sq].color)).setStrokeStyle(1, 0x2d1b12));
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
      // Schaden zählt erst am Zugende herunter (Server liefert `shown`)
      v.label.setText(String(Math.max(0, h.shown ?? h.hp)));
    }

    // Geschosse
    const alive = new Set(st.projs.map((p) => p.id));
    for (const [id, p] of this.projs) {
      if (!alive.has(id)) {
        if (this.followProj === id) {
          // Kurz auf dem Krater stehen bleiben
          this.cameras.main.stopFollow();
          this.followProj = -1;
          this.camMode = 'hold';
          this.camHoldUntil = this.time.now + CAM_HOLD_MS;
        }
        p.img.destroy();
        this.projs.delete(id);
      }
    }
    for (const p of st.projs) {
      if (this.projs.has(p.id)) continue;
      const [texKey, make] = PROJ_TEX[p.type] ?? PROJ_TEX.bazooka;
      const img = this.add.image(p.x, p.y, ensureTex(this, texKey, make)).setDepth(20);
      this.projs.set(p.id, { img, x: p.x, y: p.y });
      // Simultan: Überblick behalten statt einem Geschoss zu folgen; Splitter nicht verfolgen
      if (this.followProj === -1 && !st.simul && p.type !== 'frag') {
        // Kamera folgt dem Geschoss
        const cam = this.cameras.main;
        cam.panEffect.reset();
        cam.zoomTo(ZOOM_NEAR, 250, 'Sine.easeOut', true);
        cam.startFollow(img, true, 0.25, 0.25);
        this.followProj = p.id;
        this.camMode = 'proj';
      }
    }

    // Effekte
    for (const f of st.fx) {
      if (f.seq <= this.lastFx) continue;
      this.lastFx = f.seq;
      this.playFx(f);
    }

    this.syncObjs(st);

    // HP-Countdown in der Settle-Phase tickt hörbar
    const sum = st.hogs.reduce((a, h) => a + Math.max(0, h.shown ?? h.hp), 0);
    if (this.shownSum >= 0 && sum < this.shownSum && st.sub === 'settle' && this.time.now - this.lastTick > 70) {
      this.lastTick = this.time.now;
      sfx('tick', { vol: 0.35, pitch: 1.3 });
    }
    this.shownSum = sum;

    // Phasenwechsel im Simultan-Modus
    if (st.sub !== this.lastSub) {
      if (st.sub === 'aimAll') {
        this.showBanner('ALLE ZIELEN!', `${Math.round(st.endsIn / 1000)} Sekunden – dann fliegt alles!`, 1500);
        sfx('whistle');
      } else if (st.sub === 'flightAll') {
        this.showBanner('FEUER!', '', 900);
        sfx('go');
      } else if (st.sub === 'retreatAll') this.showBanner('RÜCKZUG!', '', 900);
      this.lastSub = st.sub;
    }

    // Banner
    if (st.sub === 'countdown') {
      this.banner.setText('IGEL-KRIEG!');
      const sq = st.squads ? `${st.squads.map((s) => s.name).join(' · ')}  –  ` : '';
      this.bannerSub.setText(`${sq}${st.simul ? 'ALLE GLEICHZEITIG  –  ' : ''}Los geht's in ${Math.max(1, Math.ceil(st.endsIn / 1000))} ...`);
    } else if (st.sub === 'over') {
      const winners = st.teams.filter((id) => !st.out.includes(id));
      const squadWin = st.squads ? st.squads.filter((s) => s.members.some((m) => winners.includes(m))) : null;
      const n = squadWin ? squadWin.length : winners.length;
      this.banner.setText(n === 1 ? 'SIEG!' : n === 0 ? 'ALLE NASS!' : 'ZEIT UM!');
      this.bannerSub.setText(n === 1 ? `${squadWin ? `Team ${squadWin[0].name}` : (playerById(winners[0])?.name ?? '?')} beherrscht die Insel` : '');
    } else if (!this.banner.getData('fx')) {
      this.banner.setText('');
      this.bannerSub.setText('');
    }

    this.renderHud(st);
  }

  /** Minen, Gaskartuschen und Kisten (mit Sonnenschirm, solange sie schweben) */
  private syncObjs(st: IgelState) {
    const alive = new Set(st.objs.map((o) => o.id));
    for (const [id, v] of this.objViews) {
      if (alive.has(id)) continue;
      v.img.destroy();
      v.chute?.destroy();
      this.objViews.delete(id);
    }
    for (const o of st.objs) {
      let v = this.objViews.get(o.id);
      if (!v) {
        const tex = o.type === 'barrel' ? ensureTex(this, 'igel_gas', gasCan) : o.type === 'crate' ? ensureTex(this, 'igel_crate', crateBox) : ensureTex(this, `igel_mine_${o.armed ? 1 : 0}`, () => urchin(!!o.armed));
        const img = this.add.image(o.x, o.y + 1, tex).setOrigin(0.5, 1).setDepth(9);
        v = { img, chute: null, x: o.x, y: o.y, type: o.type };
        this.objViews.set(o.id, v);
      }
      if (o.type === 'mine') v.img.setTexture(ensureTex(this, `igel_mine_${o.armed ? 1 : 0}`, () => urchin(!!o.armed)));
      if (o.chute && !v.chute) v.chute = this.add.image(o.x, o.y - 9, ensureTex(this, 'igel_chute', chute)).setOrigin(0.5, 1).setDepth(9);
      if (!o.chute && v.chute) {
        const c = v.chute;
        v.chute = null;
        this.tweens.add({ targets: c, y: c.y - 6, alpha: 0, angle: 30, duration: 500, onComplete: () => c.destroy() });
      }
    }
  }

  /** Wolkenband (nahtlos kachelbar) für die Windebene */
  private cloudStrip(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = IGEL.W;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    const spots = [
      [20, 8, 1],
      [130, 40, 4],
      [235, 14, 2],
      [330, 52, 5],
      [410, 22, 3],
    ];
    for (const [x, y, seed] of spots) ctx.drawImage(cloud(seed).canvas, x, y);
    return c;
  }

  private showBanner(text: string, sub: string, ms: number) {
    this.banner.setText(text).setData('fx', true);
    this.bannerSub.setText(sub);
    this.time.delayedCall(ms, () => {
      if (this.banner.text !== text) return;
      this.banner.setData('fx', false);
      this.banner.setText('');
      this.bannerSub.setText('');
    });
  }

  private hogTex(look: Look, frame: number) {
    return ensureTex(this, `igel_hog_${lookKey(look)}_${frame}`, () => hedgehog(look, frame));
  }

  private renderHud(st: IgelState) {
    const secs = st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'aimAll' || st.sub === 'retreatAll' ? Math.ceil(st.endsIn / 1000) : null;
    const flood = st.suddenDeath ? 'FLUT!' : `Flut ${Math.floor(st.suddenIn / 60000)}:${String(Math.floor(st.suddenIn / 1000) % 60).padStart(2, '0')}`;
    const hpOf = (id: string) => st.hogs.filter((h) => h.owner === id && h.state === 'ok').reduce((a, h) => a + Math.max(0, h.shown ?? h.hp), 0);
    const key = JSON.stringify([st.active, secs, st.sub, st.weapon, st.wind, flood, st.teams.map(hpOf), st.locked.length]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hudBuilding = true;
    try {
      this.buildHud(st, secs, flood, hpOf);
    } finally {
      this.hudBuilding = false;
    }
  }

  private buildHud(st: IgelState, secs: number | null, flood: string, hpOf: (id: string) => number) {
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 2, 476, 20));
    if (st.active) {
      const name = (playerById(st.active)?.name ?? '?').slice(0, 10);
      const who = st.sub === 'retreat' ? `${name}: weg da!` : `${name}${secs !== null ? ` ${secs}s` : ''}`;
      this.hud.add(ink(this, 10, 8, who, { origin: [0, 0], color: colorOf(st, st.active) === '#fdf7ea' ? '#3d2414' : colorOf(st, st.active) }));
      this.hud.add(ink(this, 240, 8, WEAPONS[st.weapon].short, { origin: [0.5, 0] }));
      const sq = squadOf(st, st.active);
      if (sq >= 0) this.hud.add(ink(this, 196, 8, st.squads![sq].name, { origin: [1, 0], color: st.squads![sq].color === '#f2c33a' ? '#a8702a' : st.squads![sq].color }));
    } else if (st.simul && st.sub !== 'countdown') {
      // Alle gleichzeitig: Phase + Zeit links, „Bereit x/y“ in der Mitte
      const label = st.sub === 'aimAll' ? 'ALLE ZIELEN' : st.sub === 'flightAll' ? 'FEUER!' : st.sub === 'retreatAll' ? 'RÜCKZUG' : 'Abwarten ...';
      this.hud.add(ink(this, 10, 8, `${label}${secs !== null ? ` ${secs}s` : ''}`, { origin: [0, 0], color: st.sub === 'aimAll' ? '#a8342a' : undefined }));
      if (st.sub === 'aimAll') this.hud.add(ink(this, 240, 8, `Bereit ${st.locked.length}/${st.hogs.filter((h) => h.state === 'ok').length}`, { origin: [0.5, 0] }));
    } else {
      this.hud.add(ink(this, 10, 8, st.sub === 'countdown' ? 'Igel auf Position ...' : '...', { origin: [0, 0] }));
    }
    // Windbalken: Mitte = windstill, nach links/rechts so weit wie der Wind
    this.hud.add(ink(this, 318, 8, 'Wind', { origin: [1, 0] }));
    const bx = 322;
    const bw = 64;
    const g = this.windG;
    g.clear();
    g.fillStyle(0x2d1b12).fillRect(bx, 8, bw, 8);
    g.fillStyle(0xfff4d6).fillRect(bx + 1, 9, bw - 2, 6);
    const half = (bw - 2) / 2;
    const len = Math.round(Math.abs(st.wind) * half);
    const col = Math.abs(st.wind) > 0.66 ? 0xe0503f : Math.abs(st.wind) > 0.33 ? 0xf2c33a : 0x46b04a;
    if (len > 0) g.fillStyle(col).fillRect(st.wind > 0 ? bx + 1 + half : bx + 1 + half - len, 9, len, 6);
    g.fillStyle(0x2d1b12).fillRect(bx + bw / 2 - 0.5, 7, 1, 10);
    this.hud.add(ink(this, 470, 8, flood, { origin: [1, 0], color: st.suddenDeath ? '#a8342a' : undefined }));

    // Spieler-Teams: Team-HP-Balken unten (je Team Name, Balken, Summe)
    if (st.squads) {
      const cw = 476 / st.squads.length;
      st.squads.forEach((s, i) => {
        const x = 4 + i * cw;
        const y = IGEL.H - 12;
        const hp = s.members.reduce((a, id) => a + hpOf(id), 0);
        const max = s.members.length * st.maxHp;
        const col = colorNum(s.color);
        const bw = Math.max(20, cw - 96);
        this.hud.add(this.add.rectangle(x + 4, y + 4, 7, 7, col).setStrokeStyle(1, 0x2d1b12).setAlpha(hp > 0 ? 1 : 0.4));
        this.hud.add(txt(this, x + 11, y, s.name, { origin: [0, 0], color: hp > 0 ? '#fff4d6' : '#9fb6c4' }));
        this.hud.add(this.add.rectangle(x + 60, y + 1, bw, 7, 0x2d1b12).setOrigin(0, 0));
        if (hp > 0) this.hud.add(this.add.rectangle(x + 61, y + 2, Math.max(1, ((bw - 2) * hp) / max), 5, col).setOrigin(0, 0));
        this.hud.add(txt(this, x + 64 + bw, y, String(hp), { origin: [0, 0], color: hp > 0 ? GOLD : '#9fb6c4' }));
      });
      return;
    }
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
        // Feuer, Rauch und Erdbrocken aus dem gemeinsamen Juice-Baukasten – Menge nach Kratergröße
        const k = Math.max(0.5, r / 20);
        this.juice.burst(f.x, f.y, 'fire', 12 * k);
        this.juice.burst(f.x, f.y - 4, 'smoke', 6 * k);
        this.juice.burst(f.x, f.y, 'sand', 12 * k);
        if (r >= 12) {
          const word = txt(this, f.x, f.y - r - 6, r >= 40 ? 'HALLELUJA!' : Math.random() < 0.5 ? 'BUMM!' : 'KRAWUMM!', { color: GOLD }).setDepth(42);
          this.tweens.add({ targets: word, y: word.y - 12, alpha: 0, duration: 800, delay: 150, onComplete: () => word.destroy() });
        }
        if (r >= 40) {
          // Heilige Ananas: Blitz, kurzer Hit-Stop, kräftiges Beben
          this.juice.flash(0xfff3c4, 260);
          this.juice.hitStop(110);
          this.juice.shake(3);
          this.juice.burst(f.x, f.y, 'confetti', 30);
        } else this.juice.shake(r >= 25 ? 2 : 1);
        sfx('boom', { x: f.x, vol: r >= 40 ? 1.3 : r < 12 ? 0.55 : 0.9, pitch: r >= 40 ? 0.7 : r < 12 ? 1.4 : 1 });
        break;
      }
      case 'fire':
        sfx('whoosh', { x: f.x });
        break;
      case 'holy':
        sfx('fanfare');
        this.showBanner('HALLELUJA!', 'Die Heilige Ananas fliegt ...', 1600);
        this.juice.burst(f.x, f.y, 'spark', 16);
        break;
      case 'shot': {
        // Wasserstrahl der Schrotflinte
        const x2 = f.x2 ?? f.x;
        const y2 = f.y2 ?? f.y;
        const line = this.add.line(0, 0, f.x, f.y, x2, y2, 0x93d3f3).setOrigin(0, 0).setLineWidth(2).setDepth(38);
        this.tweens.add({ targets: line, alpha: 0, duration: 350, onComplete: () => line.destroy() });
        this.juice.burst(x2, y2, 'splash', 8);
        sfx('shoot', { x: f.x });
        break;
      }
      case 'gull': {
        // Möwe fliegt über das Ziel und lässt die Bomben fallen
        const dir = f.text === 'l' ? -1 : 1;
        const bird = this.add.image(dir > 0 ? -20 : IGEL.W + 20, f.y, ensureTex(this, 'igel_gull_0', () => gullPix(0))).setDepth(36).setFlipX(dir < 0);
        let fr = 0;
        const flap = this.time.addEvent({ delay: 140, loop: true, callback: () => bird.setTexture(ensureTex(this, `igel_gull_${(fr = 1 - fr)}`, () => gullPix(fr))) });
        this.tweens.add({ targets: bird, x: dir > 0 ? IGEL.W + 20 : -20, duration: 1800, onComplete: () => (flap.remove(), bird.destroy()) });
        sfx('whistle', { x: f.x, pitch: 1.4 });
        const t = txt(this, f.x, 30, 'MÖWEN!', { color: '#fff4d6' }).setDepth(42);
        this.tweens.add({ targets: t, y: 22, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
        break;
      }
      case 'land':
        this.juice.burst(f.x, f.y, 'sand', 8);
        sfx('bonk', { x: f.x, vol: 0.7 });
        break;
      case 'crate': {
        this.juice.burst(f.x, f.y + 8, 'wood', 10);
        this.juice.burst(f.x, f.y + 8, 'spark', 8);
        const t = txt(this, f.x, f.y, f.text ?? '', { color: f.text?.includes('HP') ? '#9ad65a' : GOLD }).setDepth(43);
        this.tweens.add({ targets: t, y: t.y - 16, duration: 1200, ease: 'Quad.out' });
        this.tweens.add({ targets: t, alpha: 0, duration: 400, delay: 1000, onComplete: () => t.destroy() });
        sfx('powerup', { x: f.x });
        break;
      }
      case 'beep': {
        const t = txt(this, f.x, f.y - 4, f.text ?? 'PIEP!', { color: '#ff6b5a' }).setDepth(43);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 700, onComplete: () => t.destroy() });
        sfx('tick', { x: f.x, pitch: 2 });
        sfx('tick', { x: f.x, pitch: 2, delay: 0.25 });
        break;
      }
      case 'dmg': {
        const t = txt(this, f.x, f.y - 8, f.text ?? '', { color: '#ff6b5a' }).setDepth(43);
        this.tweens.add({ targets: t, y: t.y - 18, duration: 1100, ease: 'Quad.out' });
        this.tweens.add({ targets: t, alpha: 0, duration: 400, delay: 900, onComplete: () => t.destroy() });
        sfx('hit', { x: f.x, vol: 0.6 });
        break;
      }
      case 'splash': {
        this.juice.burst(f.x, f.y, 'splash', f.text ? 18 : 10);
        sfx('splash', { x: f.x, vol: f.text ? 1 : 0.6 });
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
        const what = f.text ?? '';
        if (what.startsWith('Surf')) {
          sfx('pop', { x: f.x });
          this.juice.burst(f.x, f.y + 8, 'sand', 8);
        } else if (what.startsWith('Zisch')) sfx('crack', { x: f.x, vol: 0.6 });
        else if (what === 'KRACKS') {
          this.juice.burst(f.x, f.y + 6, 'wood', 12);
          sfx('crack', { x: f.x });
        } else {
          sfx('hitHard', { x: f.x });
          this.juice.burst(f.x, f.y, 'spark', 8);
        }
        break;
      }
      case 'tele': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const sp = this.add.rectangle(f.x, f.y, 2, 2, i % 2 ? 0xf07aa8 : 0xfff3c4).setDepth(41);
          this.tweens.add({ targets: sp, x: f.x + Math.cos(a) * 14, y: f.y + Math.sin(a) * 14, alpha: 0, duration: 500, onComplete: () => sp.destroy() });
        }
        sfx('powerup', { x: f.x, pitch: 1.6, vol: 0.6 });
        break;
      }
      case 'ko': {
        const t = txt(this, f.x, f.y - 6, f.text ?? 'K.O.', { color: '#fff4d6' }).setDepth(42);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1500, onComplete: () => t.destroy() });
        this.juice.burst(f.x, f.y, 'puff', 10);
        sfx('ko', { x: f.x });
        break;
      }
      case 'water':
        this.showBanner(f.text ?? 'FLUT!', '', 1800);
        sfx('splash', { vol: 1.2, pitch: 0.7 });
        break;
      case 'taunt': {
        if (f.hog === undefined || !f.text) break;
        // Pro Igel nur eine Blase – ein neuer Spruch ersetzt den alten
        for (const b of this.bubbles.filter((b) => b.hog === f.hog)) b.t.destroy();
        this.bubbles = this.bubbles.filter((b) => b.hog !== f.hog);
        const t = ink(this, f.x, f.y - 30, f.text, { origin: [0.5, 1] }).setBackgroundColor('#fff6dc').setPadding(3, 2, 3, 2).setDepth(45).setScale(0.3);
        this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.out' });
        this.bubbles.push({ t, hog: f.hog, until: this.time.now + IGEL.TAUNT_SHOW_MS });
        sfx('pop', { x: f.x, vol: 0.4, pitch: 1.3 });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- Kamera

  private updateCamera(st: IgelState) {
    const cam = this.cameras.main;
    // Alle gleichzeitig: immer die ganze Insel im Blick
    if (st.simul) {
      if (this.camMode !== 'overview') {
        this.camMode = 'overview';
        cam.stopFollow();
        cam.panEffect.reset();
        cam.pan(IGEL.W / 2, IGEL.H / 2, 500, 'Sine.easeInOut', true);
        cam.zoomTo(1, 500, 'Sine.easeInOut', true);
      }
      return;
    }
    const ah = st.activeHog !== null ? this.hogs.get(st.activeHog) : undefined;
    // Zugbeginn: Schwenk + Zoom auf den aktiven Igel, Banner „<Name> ist dran“
    if (st.sub === 'aim' && st.turn !== this.camTurn && ah) {
      this.camTurn = st.turn;
      this.camMode = 'hog';
      this.followProj = -1;
      cam.stopFollow();
      const target = ah;
      cam.pan(target.x, target.y - 16, CAM_PAN_MS, 'Sine.easeInOut', true, (_c: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        if (progress === 1 && this.camMode === 'hog') cam.startFollow(target.c, true, 0.1, 0.1, 0, 16);
      });
      cam.zoomTo(ZOOM_NEAR, CAM_PAN_MS, 'Sine.easeInOut', true);
      const name = st.active ? (playerById(st.active)?.name ?? '?') : '?';
      const ahs = st.hogs[st.activeHog!];
      // Team-Modus: wer schon raus ist, steuert den Igel eines Mitspielers
      const sub = ahs && st.active && ahs.owner !== st.active ? `mit ${playerById(ahs.owner)?.name ?? '?'}s Igel` : '';
      this.showBanner(`${name} ist dran`, sub, 1400);
      sfx('select');
      return;
    }
    if (this.camMode === 'proj') return;
    if (this.camMode === 'hold' && this.time.now < this.camHoldUntil) return;
    const want: CamMode = st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'flight' ? 'hog' : 'overview';
    if (want === this.camMode) return;
    this.camMode = want;
    cam.stopFollow();
    cam.panEffect.reset();
    if (want === 'hog' && ah) {
      // Rückzug (nach Einschlag, Teleport oder Schlag): wieder dem eigenen Igel folgen
      cam.zoomTo(ZOOM_NEAR, 300, 'Sine.easeOut', true);
      cam.startFollow(ah.c, true, 0.12, 0.12, 0, 16);
    } else {
      // Settle/Ende: Überblick über die ganze Insel
      cam.pan(IGEL.W / 2, IGEL.H / 2, 500, 'Sine.easeInOut', true);
      cam.zoomTo(1, 500, 'Sine.easeInOut', true);
    }
  }

  // ---------------------------------------------------------------- Ziellinien

  /**
   * Ziellinie eines Igels (Fußpunkt hx/hy). `col` = Spielerfarbe (Simultan), null = Kraft-Farbverlauf (Rundlauf).
   * Wurfwaffen bekommen zusätzlich die ersten 20 % der Flugbahn gestrichelt (Zielhilfe aus `simulateBazooka`).
   */
  private drawAim(st: IgelState, hogId: number, hx: number, hy: number, weapon: IgelWeapon, aim: IgelAim, col: number | null, time: number) {
    const g = this.aimG;
    const cx = hx;
    const cy = hy - 4;
    const a = aim.angle;
    const p = aim.power;
    const kind = WEAPONS[weapon].aim;
    if (kind === 'map') {
      if (aim.tx === undefined) return;
      // Möwen-Luftschlag: Fadenkreuz über dem Ziel
      const sy = this.mask ? surfaceY(this.mask, aim.tx) : IGEL.H;
      const c = col ?? 0xe0503f;
      for (let y = 26; y < sy - 4; y += 8) g.fillStyle(c, 0.8).fillRect(aim.tx - 1, y, 2, 4);
      g.lineStyle(2, c).strokeCircle(aim.tx, sy - 6, 7 + Math.sin(time / 120));
      g.lineStyle(1, 0x2d1b12).strokeCircle(aim.tx, sy - 6, 9 + Math.sin(time / 120));
      return;
    }
    if (kind === 'none') return;
    if (weapon === 'teleport') {
      const c = col ?? 0xf07aa8;
      const tx = cx + Math.cos(a) * p * IGEL.TELE_RANGE;
      const tyy = cy + Math.sin(a) * p * IGEL.TELE_RANGE;
      for (let d = 8; d < p * IGEL.TELE_RANGE; d += 7) g.fillStyle(c, 0.8).fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2);
      g.lineStyle(1, c).strokeCircle(tx, tyy, 6 + Math.sin(time / 100));
      return;
    }
    // Zielhilfe: gestrichelter Anfang der Flugbahn
    if (isThrown(weapon) && this.mask) {
      const key = `${Math.round(hx)},${Math.round(hy)},${a},${p},${weapon},${st.wind},${st.ops.length}`;
      let c = this.aimCache.get(hogId);
      if (!c || c.key !== key) {
        c = { key, pts: aimPath(this.mask, { x: hx, y: cy }, a, p, st.wind, st.water, weapon) };
        this.aimCache.set(hogId, c);
      }
      const n = Math.min(c.pts.length, Math.max(8, Math.ceil(c.pts.length * AIM_HELP)));
      const pathCol = col ?? 0xfdf7ea;
      for (let i = 2; i < n; i++) {
        if (i % 3 === 0) continue;
        const [p0, p1] = [c.pts[i - 1], c.pts[i]];
        g.lineStyle(4, 0x2d1b12, 0.6).lineBetween(p0.x, p0.y, p1.x, p1.y);
        g.lineStyle(2, pathCol, 1).lineBetween(p0.x, p0.y, p1.x, p1.y);
      }
      // Kurzer Kraftpfeil am Igel, die Flugbahn zeigt den Rest
      if (col === null) {
        const L = 10 + p * 14;
        g.fillStyle(p > 0.66 ? 0xe0503f : p > 0.33 ? 0xf2c33a : 0x46b04a, 1).fillCircle(cx + Math.cos(a) * L, cy + Math.sin(a) * L, 2.5);
      }
      return;
    }
    const len = kind === 'dir' ? (weapon === 'shotgun' ? 34 : weapon === 'bridge' ? 26 : 14) : 12 + p * 60;
    for (let d = 8; d < len; d += 5) {
      const t = (d - 8) / Math.max(1, len - 8);
      const c = col ?? (kind === 'dir' ? 0xfdf7ea : t > 0.66 ? 0xe0503f : t > 0.33 ? 0xf2c33a : 0xfdf7ea);
      g.fillStyle(0x2d1b12, 0.6).fillRect(Math.round(cx + Math.cos(a) * d) - 2, Math.round(cy + Math.sin(a) * d) - 2, 4, 4);
      g.fillStyle(c, 1).fillRect(Math.round(cx + Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d) - 1, 2, 2);
    }
    const ex = cx + Math.cos(a) * (len + 3);
    const ey = cy + Math.sin(a) * (len + 3);
    g.lineStyle(1, 0x2d1b12).strokeCircle(ex, ey, 3);
  }

  // ---------------------------------------------------------------- Frame

  update(time: number, delta: number) {
    const s = this.latest;
    if (s?.mini?.kind !== 'igel') return;
    const st = s.mini.state;
    const dt = Math.min(0.1, delta / 1000);

    // Wind: Wolkenebene und ein paar Sandkörner/Blätter ziehen mit
    this.clouds.tilePositionX -= st.wind * CLOUD_SPEED * dt;
    for (const p of this.specks) {
      p.x += st.wind * CLOUD_SPEED * 2.2 * dt;
      if (p.x > IGEL.W + 4) p.x -= IGEL.W + 8;
      if (p.x < -4) p.x += IGEL.W + 8;
      p.r.setPosition(Math.round(p.x), Math.round(p.y + Math.sin(time / 300 + p.ph) * 3)).setAlpha(Math.min(0.9, Math.abs(st.wind) * 1.2));
    }

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

    this.updateCamera(st);

    // Sprechblasen der Zuschauer folgen ihrem Igel
    this.bubbles = this.bubbles.filter((b) => {
      const v = this.hogs.get(b.hog);
      if (time >= b.until || !v) {
        this.tweens.add({ targets: b.t, alpha: 0, duration: 250, onComplete: () => b.t.destroy() });
        return false;
      }
      const hs = st.hogs[b.hog];
      const drowned = hs?.state === 'drowned';
      b.t.setPosition(Math.round(drowned ? b.t.x : v.x), Math.round(drowned ? this.waterY - 12 : v.y - 30));
      return true;
    });

    // Aktiver Igel: Pfeil + Name (Rundlauf) bzw. alle Ziellinien in Spielerfarbe (Alle gleichzeitig)
    this.aimG.clear();
    const ah = st.activeHog !== null ? this.hogs.get(st.activeHog) : undefined;
    const ahs = st.activeHog !== null ? st.hogs[st.activeHog] : undefined;
    if (!st.simul && ah && ahs && ahs.state === 'ok' && st.sub !== 'over' && st.sub !== 'settle') {
      const bob = Math.sin(time / 160) * 2;
      const ctrl = st.active ?? ahs.owner;
      const col = colorNum(colorOf(st, ctrl));
      const ty = ah.y - 34 + bob;
      this.aimG.fillStyle(0x2d1b12).fillTriangle(ah.x - 5, ty - 1, ah.x + 5, ty - 1, ah.x, ty + 6);
      this.aimG.fillStyle(col).fillTriangle(ah.x - 3, ty, ah.x + 3, ty, ah.x, ty + 4);
      this.activeName.setText(playerById(ctrl)?.name ?? '').setPosition(Math.round(ah.x), Math.round(ty - 12)).setColor(colorOf(st, ctrl)).setVisible(true);
      if (st.sub === 'aim' && st.aim) this.drawAim(st, ahs.id, ah.x, ah.y, st.weapon, st.aim, null, time);
    } else this.activeName.setVisible(false);
    if (st.simul && st.sub === 'aimAll') {
      for (const h of st.hogs) {
        const v = this.hogs.get(h.id);
        if (!v || h.state !== 'ok') continue;
        const aim = st.aims[h.owner];
        const col = colorNum(colorOf(st, h.owner));
        if (aim) this.drawAim(st, h.id, v.x, v.y, st.weapons[h.owner] ?? 'bazooka', aim, col, time);
        if (st.locked.includes(h.owner)) {
          // Häkchen: dieser Igel ist bereit
          const x = Math.round(v.x);
          const y = Math.round(v.y - 32);
          this.aimG.fillStyle(0x2d1b12).fillRect(x - 5, y - 1, 11, 9);
          this.aimG.fillStyle(0x46b04a).fillRect(x - 4, y, 9, 7);
          this.aimG.fillStyle(0xfdf7ea).fillRect(x - 3, y + 3, 2, 2).fillRect(x - 1, y + 4, 2, 2).fillRect(x + 1, y + 2, 2, 2).fillRect(x + 2, y + 1, 2, 2);
        }
      }
    }
    // Geschosse
    for (const p of st.projs) {
      const v = this.projs.get(p.id);
      if (!v) continue;
      v.x += (p.x - v.x) * 0.6;
      v.y += (p.y - v.y) * 0.6;
      v.img.setPosition(Math.round(v.x), Math.round(v.y));
      if (p.type === 'bazooka' || p.type === 'frag') v.img.setAngle(time * 0.8);
      else if (p.type === 'cluster' || p.type === 'holy') v.img.setAngle(time * 0.4);
      else if (p.type === 'dynamite') v.img.setAlpha(0.75 + Math.sin(time / 60) * 0.25);
    }

    // Gegenstände (fallen weich nach, Kisten schweben am Schirm, ausgelöste Minen blinken)
    for (const o of st.objs) {
      const v = this.objViews.get(o.id);
      if (!v) continue;
      v.x += (o.x - v.x) * 0.4;
      v.y += (o.y - v.y) * 0.4;
      const sway = o.chute ? Math.sin(time / 400 + o.id) * 2 : 0;
      v.img.setPosition(Math.round(v.x + sway), Math.round(v.y + 1)).setAngle(o.chute ? sway * 3 : 0);
      v.chute?.setPosition(Math.round(v.x + sway * 1.5), Math.round(v.y - 9));
      if (o.lit) v.img.setTint(Math.floor(time / 90) % 2 ? 0xff6b5a : 0xffffff);
      else v.img.clearTint();
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

/** Zielhilfe: so viel der Flugbahn wird gestrichelt vorgezeichnet */
const AIM_HELP = 0.2;
const OUTLINE = '#2d1b12';

// ---------------------------------------------------------------- Sprites der neuen Waffen und Gegenstände

function pineapple(holy: boolean): Pix {
  const p = new Pix(8, 11);
  const body = holy ? '#ffd25e' : '#e0a83a';
  const dark = holy ? '#f0973a' : '#a8702a';
  p.ellipse(4, 7, 3.2, 3.6, body);
  p.overlayOn(() => {
    for (let y = 4; y < 11; y += 2) for (let x = (y / 2) % 2; x < 8; x += 2) p.px(x, y, dark);
  });
  p.rect(3, 1, 2, 3, '#46b04a').px(2, 2, '#46b04a').px(5, 2, '#46b04a').px(1, 1, '#5fa437').px(6, 1, '#5fa437');
  if (holy) p.px(2, 6, '#fffbe8').px(3, 5, '#fffbe8');
  p.outline(OUTLINE);
  return p;
}

function fragPix(): Pix {
  const p = new Pix(5, 5);
  p.disc(2.5, 2.5, 1.6, '#e0a83a');
  p.px(2, 1, '#46b04a');
  p.outline(OUTLINE);
  return p;
}

function gullEgg(): Pix {
  const p = new Pix(6, 8);
  p.ellipse(3, 4.5, 2.2, 2.8, '#f4efe2');
  p.overlayOn(() => p.px(2, 3, '#ffffff').px(4, 6, '#c9c2b0'));
  p.outline(OUTLINE);
  return p;
}

function boeller(): Pix {
  const p = new Pix(6, 11);
  p.rect(1, 3, 4, 7, '#d8473c').rect(1, 5, 4, 1, '#fff4d6').rect(1, 8, 4, 1, '#fff4d6');
  p.vline(3, 1, 2, '#5e4e40').px(3, 0, '#ffd25e');
  p.outline(OUTLINE);
  return p;
}

function urchin(armed: boolean): Pix {
  const p = new Pix(11, 8);
  const spike = '#3a1d4a';
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    p.px(5 + Math.round(Math.cos(a) * 5), 6 + Math.round(Math.sin(a) * 5), spike);
  }
  p.px(0, 7, spike).px(10, 7, spike);
  p.ellipse(5.5, 6, 3.6, 2.6, '#6b3a86');
  p.overlayOn(() => p.px(4, 5, '#9b5fc0'));
  p.px(5, 4, armed ? '#ff3b2a' : '#7a7a7a');
  p.outline(OUTLINE);
  return p;
}

function gasCan(): Pix {
  const p = new Pix(8, 11);
  p.rect(1, 3, 6, 8, '#d8473c');
  p.rect(2, 3, 1, 8, '#f08a7d');
  p.rect(1, 6, 6, 1, '#fff4d6');
  p.rect(3, 0, 2, 3, '#c9c9c9').px(3, 0, '#8a8a8a');
  p.outline(OUTLINE);
  return p;
}

function crateBox(): Pix {
  const p = new Pix(11, 10);
  p.rect(0, 0, 11, 10, '#a5602a');
  p.rect(1, 1, 9, 8, '#c98a4a');
  p.overlayOn(() => {
    for (let i = 1; i < 9; i++) p.px(i + 1, i, '#8d5629').px(9 - i, i, '#8d5629');
  });
  p.rect(4, 3, 3, 4, '#fff4d6').px(5, 4, '#e0503f').px(5, 5, '#e0503f');
  p.outline(OUTLINE);
  return p;
}

function chute(): Pix {
  const p = new Pix(19, 15);
  p.ellipse(9.5, 5, 9, 4.5, '#fdf7ea');
  p.overlayOn(() => {
    for (let x = 0; x < 19; x++) if (Math.floor(x / 3) % 2 === 0) p.vline(x, 0, 6, '#e0503f');
  });
  p.outline(OUTLINE);
  // Untere Hälfte weg: übrig bleibt der Schirm, darunter die Leinen zur Kiste
  p.g.clearRect(0, 6, 19, 9);
  p.hline(1, 5, 17, OUTLINE);
  for (let i = 0; i <= 8; i++) {
    p.px(2 + i * 0.6, 6 + i, '#5e4e40');
    p.px(16 - i * 0.6, 6 + i, '#5e4e40');
  }
  p.vline(9, 6, 9, '#5e4e40');
  return p;
}

function gullPix(frame: number): Pix {
  const p = new Pix(15, 7);
  p.ellipse(7.5, 4, 3.5, 1.6, '#fdf7ea');
  if (frame === 0) p.rect(1, 1, 5, 2, '#c9c9c9').rect(9, 1, 5, 2, '#c9c9c9');
  else p.rect(1, 4, 5, 2, '#c9c9c9').rect(9, 4, 5, 2, '#c9c9c9');
  p.px(12, 3, '#f2a33a').px(13, 4, '#f2a33a');
  p.outline(OUTLINE);
  return p;
}

const PROJ_TEX: Record<IgelProjType, [string, () => Pix]> = {
  bazooka: ['igel_coco', coconut],
  grenade: ['igel_bomb', waterBomb],
  cluster: ['igel_pine', () => pineapple(false)],
  holy: ['igel_holy', () => pineapple(true)],
  frag: ['igel_frag', fragPix],
  gull: ['igel_egg', gullEgg],
  dynamite: ['igel_dyn', boeller],
};
