import Phaser from 'phaser';
import type { GameState, IgelFx, IgelOp, IgelRecFrame, IgelReplay, IgelState } from '../../shared/types';
import { IGEL, IGEL_THEMES, REPLAY, WEAPONS, type Mask, genTerrain, seeded, surfaceY } from '../../shared/igel';
import { C } from '../art/palette';
import { cloud } from '../art/flieger';
import { HAIRS } from '../../shared/avatar';
import {
  type RaccoonLook, type RaccoonPose, balloons, bat, boeller, gasCan, gravestone, holyBin, junk, manhole, manholeLid, mouseTrap, paintCrater, paintIslandSky,
  paintTerrain, picnicBasket, pigeon, pigeonDrop, pine, raccoon, rocket, swimRing, tent, tinCan, trashBag, trashCan, umbrellaPix,
} from '../art/igel';
import { themeIcon, uiIcon, weaponIcon } from '../art/igelIcons';
import { playerColor } from '../../shared/players';
import { bus, getState, playerById } from './store';
import { pcol } from './playerColor';
import { GOLD, ensureTex, ink, panel, txt } from './ui';
import type { IgelAim, IgelObj, IgelProjType, IgelThemeId, IgelWeapon } from '../../shared/types';
import { aimPath, applyOp, isThrown, isTool, squadOf } from '../../shared/igel';
import { Pix } from '../art/pix';
import { Juice } from './juice';
import { sfx } from './sfx';
import { SnapBuffer, lerp, lerpJump } from './interp';
import { say } from './speech';

const TERRAIN_KEY = 'igel_terrain';
const lookKey = (l: RaccoonLook) => `${l.scarf}_${l.hat}_${l.hatColor}`;
/** Texturen der Icons (Waffenraster, HUD, Themenkarte) */
const iconKey = (scene: Phaser.Scene, w: IgelWeapon) => ensureTex(scene, `igel_icon_${w}`, () => weaponIcon(w));
/**
 * Waschbär-Aussehen: Halstuch in Spielerfarbe; im Team-Modus eine Bommelmütze in Teamfarbe,
 * sonst Kopfbedeckung nach dem Avatar (Cap, Mütze, Haarbüschel oder nichts) in Haarfarbe.
 */
function raccoonLook(st: IgelState, owner: string): RaccoonLook {
  const scarf = colorOf(st, owner);
  const sq = squadOf(st, owner);
  if (sq >= 0 && st.squads) return { scarf, hat: 'beanie', hatColor: st.squads[sq].color };
  const look = playerById(owner)?.look;
  const hatColor = HAIRS[look?.hair ?? 0] ?? HAIRS[0];
  const style = look?.hairStyle ?? 0;
  return { scarf, hat: style === 3 ? 'cap' : style === 4 || style === 5 ? 'beanie' : style === 2 || style === 6 ? 'tuft' : 'none', hatColor };
}/** Spielerfarbe des Abends (Fallback: Reihenfolge im Spiel) */
const colorOf = (st: IgelState, id: string) => pcol(id, Math.max(0, st.teams.indexOf(id))).hex;
const colorNum = (s: string) => parseInt(s.slice(1), 16);
/** Kamera: Zoom auf den aktiven Igel / das Geschoss, Überblick (ganze Insel bzw. alle Igel) in der Settle-Phase */
const ZOOM_NEAR = 1.5;
/** So lange bleibt die Kamera nach dem Einschlag auf dem Krater stehen */
const CAM_HOLD_MS = 300;
/** Über der Welt (y < 0) darf so viel Himmel ins Bild – z. B. wenn ein Geschoss hoch hinaus fliegt */
const CAM_SKY = 40;
/** Beim Herauszoomen (breite Insel) bleibt unten so viel vom zusätzlichen Platz Meer, der Rest wird Himmel */
const CAM_SEA = 0.3;
/** Wolken ziehen mit wind × 40 px/s */
const CLOUD_SPEED = 40;
/** Minikarte am TV (nur auf breiten Inseln): Textur in 1/4 Auflösung, angezeigt in 1/8 (bei Render ×2 pixelgenau) */
const MAP_RES = 4;
const MAP_SCALE = 0.5;
const MAP_KEY = 'igel_minimap';
/** Rand der Kulisse rund ums Bild (Bildschirmwackeln) */
const BG_PAD = 12;
const clamp = Phaser.Math.Clamp;

type CamMode = 'overview' | 'hog' | 'proj' | 'hold';

interface HogView {
  c: Phaser.GameObjects.Container;
  spr: Phaser.GameObjects.Image;
  /** Regenschirm über dem Waschbären */
  umb: Phaser.GameObjects.Image;
  /** Gewählte Waffe in der Pfote (nur der aktive Waschbär beim Zielen) */
  held: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  /** Team-Fähnchen neben der HP-Zahl */
  flag: Phaser.GameObjects.Rectangle | null;
  x: number;
  y: number;
  state: string;
  look: RaccoonLook;
}

/**
 * TV-Ansicht für die Waschbär-Bande (MiniKind `igel`, früher Igel-Krieg). Das Terrain wird lokal aus Seed + Breite + Kraterliste nachgebaut
 * und in eine Canvas-Textur gemalt – neue Krater werden nur noch hineingestanzt.
 * Breite Inseln (ab 6 Spielern bis 960 px): eigene Kamera (folgt Igel/Geschoss, zoomt für den Überblick heraus),
 * Kulisse in Bildschirm-Koordinaten (`bgLayer`) und eine Minikarte oben rechts.
 */
export class IgelScene extends Phaser.Scene {
  private seed = -1;
  /** Inselbreite der laufenden Partie */
  private w: number = IGEL.W;
  private mask: Mask | null = null;
  private applied = 0;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private terrainImg: Phaser.GameObjects.Image | null = null;
  private hogs = new Map<number, HogView>();
  private projs = new Map<number, { img: Phaser.GameObjects.Image; x: number; y: number; ang: number }>();
  /** Getroffene Waschbären zeigen kurz das Aua-Gesicht (bis zu dieser Zeit) */
  private hurtUntil = new Map<number, number>();
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
  /** Kamera: aktueller Stand und Ziel (Bildmitte + Zoom) – wird jedes Bild weich nachgezogen und an die Insel geklemmt */
  private view = { x: IGEL.W / 2, y: IGEL.H / 2, z: 1 };
  private viewGoal = { x: IGEL.W / 2, y: IGEL.H / 2, z: 1, rate: 4 };
  /** Kulisse in Bildschirm-Koordinaten (Abendhimmel, Wolken, Waldufer, Fledermäuse, Vollmond) – gleicht Zoom und Schwenk aus */
  private bgLayer!: Phaser.GameObjects.Container;
  private midSky!: Phaser.GameObjects.TileSprite;
  private cloudDrift = 0;
  /** Minikarte am TV (breite Inseln) */
  private mapBox!: Phaser.GameObjects.Container;
  private mapG: Phaser.GameObjects.Graphics | null = null;
  private mapTex: Phaser.Textures.CanvasTexture | null = null;
  private mapRect = { x: 0, y: 0, w: 0, h: 0, k: 1 };
  private mapDirty = false;
  /** Schriftgröße in der Welt gegen den Zoom ausgleichen (HP-Zahlen, Sprechblasen, Schadenszahlen bleiben lesbar) */
  private ls = 1;
  private clouds!: Phaser.GameObjects.TileSprite;
  private specks: { r: Phaser.GameObjects.Rectangle; x: number; y: number; ph: number }[] = [];
  /** Zuschauer-Sprüche: Text, Igel, Spruch und ob gerade der Name davorsteht (Igel nicht im Bild) */
  private bubbles: { t: Phaser.GameObjects.Text; hog: number; until: number; born: number; text: string; named: boolean }[] = [];
  /** Spitzen/Pfeile der Sprechblasen */
  private bubbleG!: Phaser.GameObjects.Graphics;
  private windG!: Phaser.GameObjects.Graphics;
  private juice!: Juice;
  private objViews = new Map<number, { img: Phaser.GameObjects.Image; chute: Phaser.GameObjects.Image | null; x: number; y: number; type: IgelObj['type'] }>();
  /** Zielhilfe-Cache pro Igel (Flugbahn nur neu rechnen, wenn sich etwas ändert) */
  private aimCache = new Map<number, { key: string; pts: { x: number; y: number }[] }>();
  private lastSub = '';
  private shownSum = -1;
  private lastTick = 0;
  /** Wäscheleinen (hinter den Waschbären) */
  private ropeG!: Phaser.GameObjects.Graphics;
  /** Themenkarte (Countdown) und Mondnacht-Abdunklung */
  private themeCard!: Phaser.GameObjects.Container;
  private themeKey = '';
  private night: Phaser.GameObjects.GameObject[] = [];
  /** Sprecher-Laufschrift + Ansage */
  private quipText!: Phaser.GameObjects.Text;
  private quipUntil = 0;
  private lastSay = 0;
  /** „Schuss des Abends“: laufende Wiederholung, Titel, schon abgespielt? */
  private rp: Replay | null = null;
  private rpTitle!: Phaser.GameObjects.Text;
  private rpSub!: Phaser.GameObjects.Text;
  private rpIcon!: Phaser.GameObjects.Image;
  private rpBg!: Phaser.GameObjects.Image;
  private rpSeed = -1;

  constructor() {
    super('igel');
  }

  create() {
    this.seed = -1;
    this.w = IGEL.W;
    this.mask = null;
    this.applied = 0;
    this.tex = null;
    this.terrainImg = null;
    this.hogs.clear();
    this.projs.clear();
    this.hurtUntil.clear();
    this.rings = [];
    this.hudKey = '';
    this.lastFx = -1;
    this.waterY = IGEL.WATER_Y;
    this.latest = null;
    this.camMode = 'overview';
    this.camTurn = -1;
    this.camHoldUntil = 0;
    this.followProj = -1;
    this.view = { x: IGEL.W / 2, y: IGEL.H / 2, z: 1 };
    this.viewGoal = { x: IGEL.W / 2, y: IGEL.H / 2, z: 1, rate: 4 };
    this.cloudDrift = 0;
    this.ls = 1;
    this.mapG = null;
    this.mapTex = null;
    this.mapDirty = false;
    this.specks = [];
    this.bubbles = [];
    this.hudBuilding = false;
    this.objViews.clear();
    this.aimCache.clear();
    this.lastSub = '';
    this.shownSum = -1;
    this.lastTick = 0;
    this.themeKey = '';
    this.night = [];
    this.quipUntil = 0;
    this.lastSay = 0;
    this.rp = null;
    this.rpSeed = -1;

    // Kameras: Hauptkamera für die Welt (Zoom/Schwenk, eigene Steuerung in applyView()), HUD-Kamera fix darüber.
    // Alles, was neu in die Szene kommt, sieht die HUD-Kamera nicht – außer beim HUD-Aufbau.
    const main = this.cameras.main;
    main.stopFollow();
    main.removeBounds().setZoom(1).centerOn(IGEL.W / 2, IGEL.H / 2);
    this.hudCam = this.cameras.add(0, 0, IGEL.W, IGEL.H);
    const onAdded = (go: Phaser.GameObjects.GameObject) => {
      if (!this.hudBuilding) this.hudCam.ignore(go);
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);

    // Kulisse in Bildschirm-Koordinaten: die Ebene gleicht Zoom und Schwenk aus (layoutBg) und füllt so immer das Bild –
    // auch über (y < 0) und neben der Welt beim Herauszoomen. Parallax über die Kachel-Verschiebung von Wolken und Horizont.
    // Kacheln mit BG_PAD Rand (Bildschirmwackeln deckt sonst einen Streifen auf), oben Himmelfarbe, unten See.
    // Fester Abendhimmel (Waschbären kommen abends raus) – deshalb ohne Tageszeit-Abdunklung.
    this.bgLayer = this.add.container(0, 0).setDepth(-900).setScrollFactor(0);
    const skyKey = ensureTex(this, 'igel_sky', () => {
      const p = new Pix(IGEL.W, IGEL.H);
      paintIslandSky(p, 9, 'far');
      return p;
    });
    const above = this.add.rectangle(-BG_PAD, -BG_PAD, IGEL.W + 2 * BG_PAD, BG_PAD, 0x25285a).setOrigin(0, 0);
    const sky = this.add.tileSprite(-BG_PAD, 0, IGEL.W + 2 * BG_PAD, IGEL.H, skyKey).setOrigin(0, 0);
    sky.tilePositionX = -BG_PAD;
    const below = this.add.rectangle(-BG_PAD, IGEL.H - 1, IGEL.W + 2 * BG_PAD, BG_PAD + 1, 0x4f6fa8).setOrigin(0, 0);
    // Wolken im Abendlicht (rosa getönt)
    this.clouds = this.add.tileSprite(-BG_PAD, 6, IGEL.W + 2 * BG_PAD, 96, ensureTex(this, 'igel_clouds', () => this.cloudStrip())).setOrigin(0, 0).setAlpha(0.7).setTint(0xe8a9c0);
    const seaKey = ensureTex(this, 'igel_horizon', () => {
      const p = new Pix(IGEL.W, IGEL.H);
      paintIslandSky(p, 9, 'mid');
      return p;
    });
    this.midSky = this.add.tileSprite(-BG_PAD, 0, IGEL.W + 2 * BG_PAD, IGEL.H, seaKey).setOrigin(0, 0);
    this.bgLayer.add([above, sky, below, this.clouds, this.midSky]);
    this.bats();
    this.ropeG = this.add.graphics().setDepth(9);
    this.aimG = this.add.graphics().setDepth(25);
    this.bubbleG = this.add.graphics().setDepth(45);
    this.waterG = this.add.graphics().setDepth(30);
    this.activeName = txt(this, 0, 0, '', {}).setDepth(26);
    this.hudBuilding = true;
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, IGEL.W / 2, 92, '', { size: 24, color: GOLD }).setDepth(1001);
    this.bannerSub = txt(this, IGEL.W / 2, 124, '', { size: 8 }).setDepth(1001);
    this.windG = this.add.graphics().setDepth(1002);
    this.quipText = ink(this, IGEL.W / 2, 27, '', { origin: [0.5, 0] }).setBackgroundColor('#fff6dc').setPadding(4, 3, 4, 3).setDepth(1003).setVisible(false);
    this.themeCard = this.add.container(0, 0).setDepth(1004).setVisible(false);
    this.rpBg = panel(this, 50, 26, 380, 42, 'dark').setDepth(1005).setVisible(false);
    this.rpTitle = txt(this, IGEL.W / 2, 31, '', { size: 16, color: GOLD }).setDepth(1006);
    this.rpSub = txt(this, IGEL.W / 2, 52, '', { size: 8 }).setDepth(1006);
    this.rpIcon = this.add.image(0, 56, iconKey(this, 'bazooka')).setDepth(1006).setVisible(false);
    this.mapBox = this.add.container(0, 0).setDepth(1002).setVisible(false);
    this.hudBuilding = false;
    main.ignore([this.hud, this.banner, this.bannerSub, this.windG, this.quipText, this.themeCard, this.rpBg, this.rpTitle, this.rpSub, this.rpIcon, this.mapBox]);
    // Partikel/Töne aus dem gemeinsamen Baukasten (Emitter landen nur in der Welt-Kamera)
    this.juice = new Juice(this, { depth: 41 });

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', fn);
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
      if (this.textures.exists(REPLAY_KEY)) this.textures.remove(REPLAY_KEY);
      if (this.textures.exists(MAP_KEY)) this.textures.remove(MAP_KEY);
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
    this.w = st.w ?? IGEL.W;
    this.mask = genTerrain(st.seed, this.w);
    this.applied = 0;
    this.tex = this.textures.createCanvas(TERRAIN_KEY, this.w, IGEL.H)!;
    const ctx = this.tex.getContext();
    const img = ctx.createImageData(this.w, IGEL.H);
    paintTerrain(img, this.mask);
    ctx.putImageData(img, 0, 0);
    paintDecor(ctx, st.seed, this.mask);
    this.tex.refresh();
    this.terrainImg = this.add.image(0, 0, TERRAIN_KEY).setOrigin(0, 0).setDepth(0);
    // Mondnacht: Himmel abdunkeln, Mond und Sterne (in der Kulisse: über Himmel/Horizont, unter der Insel)
    for (const o of this.night) o.destroy();
    this.night = [];
    if (st.theme === 'mond') {
      this.night.push(this.add.rectangle(-IGEL.W / 2, -IGEL.H / 2, IGEL.W * 2, IGEL.H * 2, 0x141c48, 0.5).setOrigin(0, 0));
      this.night.push(this.add.circle(400, 40, 13, 0xfff4d6));
      this.night.push(this.add.circle(394, 36, 11, 0x141c48, 0.5));
      const r = seeded(st.seed ^ 0x57a2);
      for (let i = 0; i < 28; i++) this.night.push(this.add.rectangle(Math.floor(r() * IGEL.W), Math.floor(r() * 120), 1, 1, 0xfff4d6, 0.4 + r() * 0.6));
      this.bgLayer.add(this.night);
    }
    // Blätter und Papierfetzen im Wind über die ganze Insel
    for (const p of this.specks) p.r.destroy();
    this.specks = [];
    for (let i = 0, n = Math.round((18 * this.w) / IGEL.W); i < n; i++) {
      const x = Math.random() * this.w;
      const y = 30 + Math.random() * 170;
      const r = this.add.rectangle(x, y, i % 3 ? 2 : 3, i % 3 ? 1 : 2, i % 3 ? 0x7cc46a : 0xe8e2d4).setDepth(5).setAlpha(0);
      this.specks.push({ r, x, y, ph: Math.random() * Math.PI * 2 });
    }
    this.buildMiniMap();
    // Neue Partie: Kamera sofort auf die ganze Insel
    this.view = { x: this.w / 2, y: IGEL.H / 2, z: this.zMin() };
    this.viewGoal = { ...this.view, rate: 3 };
    // Effekte von vor dem Szenenstart nicht nochmal abspielen
    this.lastFx = st.fx.length ? st.fx[st.fx.length - 1].seq : 0;
  }

  /** Neue Terrain-Operationen einarbeiten: Krater stanzen bzw. Brett-Pixel aufmalen */
  private applyCraters(st: IgelState) {
    if (!this.mask || !this.tex || this.applied >= st.ops.length) return;
    this.applied = stampOps(this.mask, this.tex, st.ops, this.applied, st.ops.length);
    this.mapDirty = true;
  }

  // ---------------------------------------------------------------- Minikarte (TV)

  /** Minikarte oben rechts – nur auf breiten Inseln, die nicht mehr ganz ins Bild passen */
  private buildMiniMap() {
    this.mapBox.removeAll(true);
    this.mapG = null;
    if (this.textures.exists(MAP_KEY)) this.textures.remove(MAP_KEY);
    this.mapTex = null;
    this.mapBox.setVisible(false);
    if (this.w <= IGEL.W || !this.mask) return;
    const tw = Math.ceil(this.w / MAP_RES);
    const th = Math.ceil(IGEL.H / MAP_RES);
    this.mapTex = this.textures.createCanvas(MAP_KEY, tw, th)!;
    const mw = tw * MAP_SCALE;
    const mh = th * MAP_SCALE;
    const x0 = IGEL.W - 4 - mw;
    const y0 = 25;
    this.mapRect = { x: x0, y: y0, w: mw, h: mh, k: mw / this.w };
    this.hudBuilding = true;
    try {
      this.mapBox.add(this.add.rectangle(x0 - 2, y0 - 2, mw + 4, mh + 4, 0x2d1b12).setOrigin(0, 0));
      this.mapBox.add(this.add.rectangle(x0, y0, mw, mh, 0xa9dcf6).setOrigin(0, 0));
      this.mapBox.add(this.add.image(x0, y0, MAP_KEY).setOrigin(0, 0).setScale(MAP_SCALE));
      this.mapG = this.add.graphics();
      this.mapBox.add(this.mapG);
    } finally {
      this.hudBuilding = false;
    }
    this.mapDirty = true;
  }

  /** Terrain der Minikarte neu malen (nach Kratern): Mehrheit fester Pixel je Kachel, Gras an der Oberkante */
  private paintMiniMap() {
    const m = this.mask;
    const tex = this.mapTex;
    if (!m || !tex) return;
    this.mapDirty = false;
    const tw = tex.width;
    const th = tex.height;
    const solid = new Uint8Array(tw * th);
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        let n = 0;
        for (let dy = 0; dy < MAP_RES; dy++) {
          const y = j * MAP_RES + dy;
          if (y >= IGEL.H) continue;
          for (let dx = 0; dx < MAP_RES; dx++) {
            const x = i * MAP_RES + dx;
            if (x < m.w && m[y * m.w + x]) n++;
          }
        }
        solid[j * tw + i] = n * 2 >= MAP_RES * MAP_RES ? 1 : 0;
      }
    }
    const ctx = tex.getContext();
    const img = ctx.createImageData(tw, th);
    for (let k = 0; k < tw * th; k++) {
      if (!solid[k]) continue;
      const top = k < tw || !solid[k - tw];
      img.data.set(top ? [95, 164, 55, 255] : [201, 154, 94, 255], k * 4);
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
  }

  /** Minikarte: Wasser, Kisten, Igel (Spielerfarbe, der Aktive blinkt weiß), Geschosse und der Bildausschnitt */
  private drawMiniMap(st: IgelState, time: number) {
    const g = this.mapG;
    const show = !!g && !this.rp && st.sub !== 'over' && st.sub !== 'replay';
    this.mapBox.setVisible(show);
    if (!g || !show) return;
    if (this.mapDirty) this.paintMiniMap();
    const { x: x0, y: y0, w: mw, h: mh, k } = this.mapRect;
    const X = (x: number) => x0 + clamp(x, 0, this.w) * k;
    const Y = (y: number) => y0 + clamp(y, 0, IGEL.H) * k;
    g.clear();
    g.fillStyle(0x3784c2, 0.85).fillRect(x0, Y(this.waterY), mw, y0 + mh - Y(this.waterY));
    for (const o of st.objs) if (o.type === 'crate') g.fillStyle(0xa5602a).fillRect(Math.round(X(o.x)) - 1, Math.round(Y(o.y)) - 2, 2, 2);
    for (const h of st.hogs) {
      if (h.state === 'drowned') continue;
      const v = this.hogs.get(h.id);
      const x = Math.round(X(v ? v.x : h.x));
      const y = Math.round(Y((v ? v.y : h.y) - 4));
      if (h.state === 'dead') {
        g.fillStyle(0xf1d49a).fillRect(x - 1, y, 2, 2);
        continue;
      }
      const active = !st.simul && h.id === st.activeHog;
      g.fillStyle(active && Math.floor(time / 250) % 2 ? 0xfdf7ea : 0x2d1b12).fillRect(x - 2, y - 2, 5, 5);
      g.fillStyle(colorNum(colorOf(st, h.owner))).fillRect(x - 1, y - 1, 3, 3);
    }
    for (const p of st.projs) {
      const v = this.projs.get(p.id);
      g.fillStyle(0x2d1b12).fillRect(Math.round(X(v ? v.x : p.x)) - 1, Math.round(Y(v ? v.y : p.y)) - 1, 2, 2);
    }
    // Bildausschnitt der Kamera
    const wv = this.cameras.main.worldView;
    const vx0 = X(wv.x);
    const vx1 = X(wv.right);
    const vy0 = Y(wv.y);
    const vy1 = Y(wv.bottom);
    g.lineStyle(1, 0xfdf7ea, 0.9).strokeRect(vx0 + 0.5, vy0 + 0.5, Math.max(2, vx1 - vx0 - 1), Math.max(2, vy1 - vy0 - 1));
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
        const look = raccoonLook(st, h.owner);
        const spr = this.add.image(0, 2, this.hogTex(look, 'stand')).setOrigin(0.5, 1);
        const umb = this.add.image(0, -13, ensureTex(this, 'igel_umb', umbrellaPix)).setOrigin(0.5, 1).setVisible(false);
        const held = this.add.image(8, -6, iconKey(this, 'bazooka')).setScale(2 / 3).setVisible(false);
        const label = txt(this, 0, -24, String(h.hp), { color: colorOf(st, h.owner) });
        const c = this.add.container(h.x, h.y, [umb, spr, held, label]).setDepth(10);
        // Spieler-Teams: kleines Fähnchen in Teamfarbe links neben der HP-Zahl
        const sq = squadOf(st, h.owner);
        const flag = sq >= 0 ? this.add.rectangle(-17, -24, 4, 6, colorNum(st.squads![sq].color)).setStrokeStyle(1, 0x2d1b12).setOrigin(0.5, 0) : null;
        if (flag) c.add(flag);
        v = { c, spr, umb, held, label, flag, x: h.x, y: h.y, state: 'ok', look };
        this.hogs.set(h.id, v);
      }
      if (h.state !== v.state) {
        if (h.state === 'dead') {
          v.spr.setTexture(ensureTex(this, 'igel_grave', gravestone)).setAngle(0).setFlipX(false);
          v.held.setVisible(false);
          v.label.setVisible(false);
        } else if (h.state === 'drowned') {
          v.c.setVisible(false);
          const img = this.add.image(h.x, st.water, ensureTex(this, `igel_ring_${lookKey(v.look)}`, () => swimRing(v!.look))).setOrigin(0.5, 0.75).setDepth(31);
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
      const img = this.add.image(p.x, p.y, projTex(this, p.type, p.id)).setDepth(20);
      this.projs.set(p.id, { img, x: p.x, y: p.y, ang: 0 });
      // Simultan: Überblick behalten statt einem Geschoss zu folgen; Splitter nicht verfolgen
      if (this.followProj === -1 && !st.simul && p.type !== 'frag' && p.type !== 'dynamite') {
        // Kamera folgt dem Geschoss (updateCamera) – dem Böller nicht, da läuft man ja gerade weg
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

    // Themenkarte: im Countdown groß, einmal angesagt
    this.themeCard.setVisible(st.sub === 'countdown' && !this.rp);
    if (st.sub === 'countdown' && this.themeKey !== `${st.seed}`) this.showThemeCard(st);

    // „Schuss des Abends“: Server schaltet auf `replay` – kurz das Siegerbanner, dann die Zeitlupe
    if (st.sub === 'replay' && st.best && this.rpSeed !== st.seed) {
      this.rpSeed = st.seed;
      const best = st.best;
      this.time.delayedCall(REPLAY.LEAD_MS - 300, () => {
        const now = this.latest?.mini?.kind === 'igel' ? this.latest.mini.state : null;
        if (now?.sub === 'replay' && now.seed === st.seed) this.startReplay(now, best);
      });
    }
    if (this.rp && st.sub !== 'replay') this.stopReplay();

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
      this.banner.setText('WASCHBÄR-BANDE!');
      const sq = st.squads ? `${st.squads.map((s) => s.name).join(' · ')}  –  ` : '';
      this.bannerSub.setText(`${sq}${st.simul ? 'ALLE GLEICHZEITIG  –  ' : ''}Los geht's in ${Math.max(1, Math.ceil(st.endsIn / 1000))} ...`);
    } else if (this.rp) {
      this.banner.setText('');
      this.bannerSub.setText('');
    } else if (st.sub === 'over' || st.sub === 'replay') {
      const winners = st.teams.filter((id) => !st.out.includes(id));
      const squadWin = st.squads ? st.squads.filter((s) => s.members.some((m) => winners.includes(m))) : null;
      const n = squadWin ? squadWin.length : winners.length;
      this.banner.setText(n === 1 ? 'SIEG!' : n === 0 ? 'ALLE NASS!' : 'ZEIT UM!');
      this.bannerSub.setText(n === 1 ? `${squadWin ? `Team ${squadWin[0].name}` : (playerById(winners[0])?.name ?? '?')} beherrscht den Campingplatz` : '');
    } else if (!this.banner.getData('fx')) {
      this.banner.setText('');
      this.bannerSub.setText('');
    }

    this.renderHud(st);
  }

  /** Mausefallen, Gaskartuschen und Picknickkörbe (an Luftballons, solange sie schweben) */
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
        const tex = objTex(this, o.type, !!o.armed);
        const img = this.add.image(o.x, o.y + 1, tex).setOrigin(0.5, 1).setDepth(9);
        v = { img, chute: null, x: o.x, y: o.y, type: o.type };
        this.objViews.set(o.id, v);
      }
      if (o.type === 'mine') v.img.setTexture(objTex(this, 'mine', !!o.armed));
      if (o.chute && !v.chute) v.chute = this.add.image(o.x, o.y - 9, ensureTex(this, 'igel_balloons', balloons)).setOrigin(0.5, 1).setDepth(9);
      if (!o.chute && v.chute) {
        // Gelandet: die Luftballons steigen davon
        const c = v.chute;
        v.chute = null;
        this.tweens.add({ targets: c, y: c.y - 60, x: c.x + 10, alpha: 0, duration: 1600, ease: 'Quad.in', onComplete: () => c.destroy() });
      }
    }
  }

  /** Zwei Fledermäuse flattern ab und zu über den Abendhimmel (in der Kulisse) */
  private bats() {
    for (let i = 0; i < 2; i++) {
      const img = this.add.image(-20, 40, ensureTex(this, 'igel_bat_0', () => bat(0))).setAlpha(0.9);
      this.bgLayer.add(img);
      let fr = 0;
      this.time.addEvent({ delay: 110 + i * 20, loop: true, callback: () => img.setTexture(ensureTex(this, `igel_bat_${(fr = 1 - fr)}`, () => bat(fr))) });
      const fly = () => {
        const ltr = Math.random() < 0.5;
        const y = 20 + Math.random() * 90;
        img.setPosition(ltr ? -20 : IGEL.W + 20, y);
        this.tweens.add({ targets: img, x: ltr ? IGEL.W + 20 : -20, duration: 7000 + Math.random() * 5000, delay: 1000 + Math.random() * 8000, onComplete: fly });
        this.tweens.add({ targets: img, y: y + 14, duration: 500 + Math.random() * 300, yoyo: true, repeat: 12, ease: 'Sine.inOut' });
      };
      fly();
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

  private hogTex(look: RaccoonLook, pose: RaccoonPose) {
    return ensureTex(this, `igel_wb_${lookKey(look)}_${pose}`, () => raccoon(look, pose));
  }

  private renderHud(st: IgelState) {
    const secs = st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'aimAll' || st.sub === 'retreatAll' ? Math.ceil(st.endsIn / 1000) : null;
    // Hochwasser: Wellen-Icon + Restzeit bzw. „STEIGT!“
    const flood = st.suddenDeath ? 'STEIGT!' : `${Math.floor(st.suddenIn / 60000)}:${String(Math.floor(st.suddenIn / 1000) % 60).padStart(2, '0')}`;
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
      this.hud.add(ink(this, 10, 8, who, { origin: [0, 0], color: colorOf(st, st.active) === playerColor(7).hex ? '#3d2414' : colorOf(st, st.active) }));
      // Waffe: eigenes Pixel-Icon + Kurzname
      this.hud.add(this.add.image(214, 12, iconKey(this, st.weapon)));
      this.hud.add(ink(this, 225, 8, WEAPONS[st.weapon].short, { origin: [0, 0] }));
      const sq = squadOf(st, st.active);
      if (sq >= 0) this.hud.add(ink(this, 196, 8, st.squads![sq].name, { origin: [1, 0], color: st.squads![sq].color === '#f2c33a' ? '#a8702a' : st.squads![sq].color }));
    } else if (st.simul && st.sub !== 'countdown') {
      // Alle gleichzeitig: Phase + Zeit links, „Bereit x/y“ in der Mitte
      const label = st.sub === 'aimAll' ? 'ALLE ZIELEN' : st.sub === 'flightAll' ? 'FEUER!' : st.sub === 'retreatAll' ? 'RÜCKZUG' : 'Abwarten ...';
      this.hud.add(ink(this, 10, 8, `${label}${secs !== null ? ` ${secs}s` : ''}`, { origin: [0, 0], color: st.sub === 'aimAll' ? '#a8342a' : undefined }));
      if (st.sub === 'aimAll') this.hud.add(ink(this, 240, 8, `Bereit ${st.locked.length}/${st.hogs.filter((h) => h.state === 'ok').length}`, { origin: [0.5, 0] }));
    } else {
      this.hud.add(ink(this, 10, 8, st.sub === 'countdown' ? 'Waschbären auf Position ...' : '...', { origin: [0, 0] }));
    }
    // Windbalken: Mitte = windstill, nach links/rechts so weit wie der Wind
    this.hud.add(this.add.image(310, 12, ensureTex(this, 'igel_ui_wind', () => uiIcon('wind'))));
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
    const fl = ink(this, 470, 8, flood, { origin: [1, 0], color: st.suddenDeath ? '#a8342a' : undefined });
    this.hud.add(this.add.image(Math.round(470 - fl.width - 10), 12, ensureTex(this, 'igel_ui_flood', () => uiIcon('flood'))));
    this.hud.add(fl);

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
          const word = txt(this, f.x, f.y - r - 6, r >= 40 ? 'HALLELUJA!' : Math.random() < 0.5 ? 'BUMM!' : 'KRAWUMM!', { color: GOLD }).setDepth(42).setScale(this.ls);
          this.tweens.add({ targets: word, y: word.y - 12, alpha: 0, duration: 800, delay: 150, onComplete: () => word.destroy() });
        }
        if (r >= 40) {
          // Heilige Mülltonne: Blitz, kurzer Hit-Stop, kräftiges Beben
          this.juice.flash(0xfff3c4, 260);
          this.juice.hitStop(110);
          this.juice.shake(3);
          this.juice.burst(f.x, f.y, 'confetti', 30);
        } else this.juice.shake(r >= 25 ? 2 : 1);
        sfx('boom', { x: this.sx(f.x), vol: r >= 40 ? 1.3 : r < 12 ? 0.55 : 0.9, pitch: r >= 40 ? 0.7 : r < 12 ? 1.4 : 1 });
        break;
      }
      case 'fire':
        sfx('whoosh', { x: this.sx(f.x) });
        break;
      case 'holy':
        sfx('fanfare');
        this.showBanner('HALLELUJA!', 'Die Heilige Mülltonne fliegt ...', 1600);
        this.juice.burst(f.x, f.y, 'spark', 16);
        break;
      case 'shot': {
        // Wasserstrahl des Gartenschlauchs
        const x2 = f.x2 ?? f.x;
        const y2 = f.y2 ?? f.y;
        const line = this.add.line(0, 0, f.x, f.y, x2, y2, 0x93d3f3).setOrigin(0, 0).setLineWidth(2).setDepth(38);
        this.tweens.add({ targets: line, alpha: 0, duration: 350, onComplete: () => line.destroy() });
        this.juice.burst(x2, y2, 'splash', 8);
        sfx('shoot', { x: this.sx(f.x) });
        break;
      }
      case 'gull': {
        // Drei Tauben fliegen über das Ziel und lassen ihre Ladung fallen (auf breiten Inseln nur ein Stück um das Ziel herum)
        const dir = f.text === 'l' ? -1 : 1;
        for (let i = 0; i < 3; i++) {
          const bird = this.add.image(f.x - dir * (160 + i * 16), f.y + (i - 1) * 6, ensureTex(this, 'igel_pigeon_0', () => pigeon(0))).setDepth(36).setFlipX(dir < 0);
          let fr = i % 2;
          const flap = this.time.addEvent({ delay: 130 + i * 15, loop: true, callback: () => bird.setTexture(ensureTex(this, `igel_pigeon_${(fr = 1 - fr)}`, () => pigeon(fr))) });
          this.tweens.add({ targets: bird, x: f.x + dir * (420 - i * 16), duration: 1800, onComplete: () => (flap.remove(), bird.destroy()) });
        }
        sfx('whistle', { x: this.sx(f.x), pitch: 1.4 });
        const t = txt(this, f.x, 30, 'TAUBEN!', { color: '#fff4d6' }).setDepth(42).setScale(this.ls);
        this.tweens.add({ targets: t, y: 22, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
        break;
      }
      case 'land':
        this.juice.burst(f.x, f.y, 'sand', 8);
        sfx('bonk', { x: this.sx(f.x), vol: 0.7 });
        break;
      case 'crate': {
        // Picknickkorb eingesammelt: Inhalt (Waffen-Icon) steigt mit dem Text auf
        this.juice.burst(f.x, f.y + 8, 'wood', 10);
        this.juice.burst(f.x, f.y + 8, 'spark', 8);
        const t = txt(this, f.x, f.y, f.text ?? '', { color: f.text?.includes('HP') ? '#9ad65a' : GOLD }).setDepth(43).setScale(this.ls);
        const parts: Phaser.GameObjects.GameObject[] = [t];
        if (f.loot) {
          const ic = this.add.image(f.x, f.y - 12 * this.ls, iconKey(this, f.loot)).setDepth(43).setScale(this.ls);
          parts.push(ic);
          this.tweens.add({ targets: ic, y: ic.y - 16, duration: 1200, ease: 'Quad.out' });
        }
        this.tweens.add({ targets: t, y: t.y - 16, duration: 1200, ease: 'Quad.out' });
        this.tweens.add({ targets: parts, alpha: 0, duration: 400, delay: 1000, onComplete: () => parts.forEach((o) => o.destroy()) });
        sfx('powerup', { x: this.sx(f.x) });
        break;
      }
      case 'beep': {
        // Mausefalle schnappt zu – gleich knallt's
        const t = txt(this, f.x, f.y - 4, f.text ?? 'SCHNAPP!', { color: '#ff6b5a' }).setDepth(43).setScale(this.ls);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 700, onComplete: () => t.destroy() });
        sfx('crack', { x: this.sx(f.x), pitch: 1.8, vol: 0.7 });
        sfx('tick', { x: this.sx(f.x), pitch: 2, delay: 0.25 });
        break;
      }
      case 'rope': {
        // Wäscheleine schnellt hinaus (bei Fehlschuss verblasst sie wieder)
        const x2 = f.x2 ?? f.x;
        const y2 = f.y2 ?? f.y;
        const line = this.add.line(0, 0, f.x, f.y, x2, y2, 0xf4efe6).setOrigin(0, 0).setLineWidth(1.5).setDepth(9);
        this.tweens.add({ targets: line, alpha: 0, duration: f.text === 'miss' ? 450 : 200, onComplete: () => line.destroy() });
        sfx(f.text === 'miss' ? 'whoosh' : 'catch', { x: this.sx(x2), vol: 0.6, pitch: 1.3 });
        if (f.text !== 'miss') this.juice.burst(x2, y2, 'sand', 4);
        break;
      }
      case 'dig':
        this.juice.burst(f.x, f.y, 'sand', 14);
        sfx('crack', { x: this.sx(f.x), vol: 0.5, pitch: 0.8 });
        break;
      case 'quip':
        this.showQuip(f.text ?? '');
        break;
      case 'dmg': {
        const heal = f.text?.startsWith('+');
        if (!heal && f.hog !== undefined) this.hurtUntil.set(f.hog, this.time.now + 550);
        const t = txt(this, f.x, f.y - 8, f.text ?? '', { color: heal ? '#9ad65a' : '#ff6b5a' }).setDepth(43).setScale(this.ls);
        this.tweens.add({ targets: t, y: t.y - 18, duration: 1100, ease: 'Quad.out' });
        this.tweens.add({ targets: t, alpha: 0, duration: 400, delay: 900, onComplete: () => t.destroy() });
        if (heal) sfx('powerup', { x: this.sx(f.x), vol: 0.4, pitch: 1.5 });
        else sfx('hit', { x: this.sx(f.x), vol: 0.6 });
        break;
      }
      case 'splash': {
        this.juice.burst(f.x, f.y, 'splash', f.text ? 18 : 10);
        sfx('splash', { x: this.sx(f.x), vol: f.text ? 1 : 0.6 });
        for (let i = 0; i < 7; i++) {
          const drop = this.add.circle(f.x, f.y, 2, 0xbfe9ff).setDepth(41);
          this.tweens.add({ targets: drop, x: f.x + (i - 3) * 5, y: f.y - 14 - Math.random() * 10, duration: 220, ease: 'Quad.out', onComplete: () => this.tweens.add({ targets: drop, y: f.y + 4, alpha: 0, duration: 280, ease: 'Quad.in', onComplete: () => drop.destroy() }) });
        }
        if (f.text) {
          const t = txt(this, f.x, f.y - 26, f.text, { color: '#bfe9ff' }).setDepth(42).setScale(this.ls);
          this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 1200, delay: 300, onComplete: () => t.destroy() });
        }
        break;
      }
      case 'pow': {
        const t = txt(this, f.x, f.y - 8, f.text ?? 'POW!', { color: GOLD }).setDepth(42).setScale(0.4 * this.ls);
        this.tweens.add({ targets: t, scale: 1.2 * this.ls, duration: 160, yoyo: true, hold: 300, onComplete: () => t.destroy() });
        const what = f.text ?? '';
        if (what.startsWith('Brett')) {
          sfx('pop', { x: this.sx(f.x) });
          this.juice.burst(f.x, f.y + 8, 'wood', 8);
        } else if (what.startsWith('Schirm')) sfx('pop', { x: this.sx(f.x), pitch: 1.2 });
        else if (what.startsWith('Zisch')) sfx('crack', { x: this.sx(f.x), vol: 0.6 });
        else if (what === 'KRACKS') {
          this.juice.burst(f.x, f.y + 6, 'wood', 12);
          sfx('crack', { x: this.sx(f.x) });
        } else {
          sfx('hitHard', { x: this.sx(f.x) });
          this.juice.burst(f.x, f.y, 'spark', 8);
        }
        break;
      }
      case 'tele': {
        // Gully: ein offenes Kanalloch am Boden, der Deckel hüpft hoch – rein hier, raus dort
        const fy = f.y + 4;
        const hole = this.add.image(f.x, fy + 1, ensureTex(this, 'igel_manhole', manhole)).setDepth(11).setScale(0.3, 1);
        this.tweens.add({ targets: hole, scaleX: 1, duration: 140, ease: 'Back.out' });
        this.tweens.add({ targets: hole, alpha: 0, delay: 650, duration: 300, onComplete: () => hole.destroy() });
        const lid = this.add.image(f.x + 6, fy, ensureTex(this, 'igel_lid', manholeLid)).setDepth(12);
        this.tweens.add({ targets: lid, y: fy - 16, angle: 200, duration: 260, ease: 'Quad.out', yoyo: true, onComplete: () => lid.destroy() });
        this.juice.burst(f.x, fy, 'puff', 6);
        const t = txt(this, f.x, fy - 26, 'PLOPP!', { color: '#fff4d6' }).setDepth(42).setScale(this.ls);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 700, onComplete: () => t.destroy() });
        sfx('pop', { x: this.sx(f.x), pitch: 0.7, vol: 0.8 });
        break;
      }
      case 'ko': {
        const t = txt(this, f.x, f.y - 6, f.text ?? 'K.O.', { color: '#fff4d6' }).setDepth(42).setScale(this.ls);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1500, onComplete: () => t.destroy() });
        this.juice.burst(f.x, f.y, 'puff', 10);
        sfx('ko', { x: this.sx(f.x) });
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
        const t = ink(this, f.x, f.y - 22 - 8 * this.ls, f.text, { origin: [0.5, 1] }).setBackgroundColor('#fff6dc').setPadding(3, 2, 3, 2).setDepth(45).setScale(0.3 * this.ls);
        this.tweens.add({ targets: t, scale: this.ls, duration: 160, ease: 'Back.out' });
        this.bubbles.push({ t, hog: f.hog, until: this.time.now + IGEL.TAUNT_SHOW_MS, born: this.time.now, text: f.text, named: false });
        sfx('pop', { x: this.sx(f.x), vol: 0.4, pitch: 1.3 });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- Zuschauer-Sprechblasen

  /**
   * Sprechblasen der Zuschauer folgen ihrem Igel, stehen aber immer ganz im Bild: an den Bildrand geklemmt, nicht unter
   * HUD-Leisten oder Minikarte. Ist der Igel selbst nicht im Bild (Kamera beim aktiven Igel), steht sein Name in der
   * Blase und ein Pfeil in Spielerfarbe zeigt zu ihm; sonst zeigt eine kleine Spitze auf den Igel.
   */
  private updateBubbles(st: IgelState, time: number) {
    const g = this.bubbleG;
    g.clear();
    if (!this.bubbles.length) return;
    const z = this.view.z;
    const vw = IGEL.W / z;
    const vh = IGEL.H / z;
    const L = this.view.x - vw / 2;
    const T = this.view.y - vh / 2;
    /** Bildschirm-Pixel → Welt; Rand so groß, dass auch der Pfeil noch ins Bild passt */
    const px = 1 / z;
    const m = 10 * this.ls;
    const hudBottom = st.squads ? 14 : 14 + (Math.ceil(st.teams.length / 6) - 1) * 11;
    const box = { l: L + m, r: L + vw - m, t: T + 24 * px + m, b: T + vh - hudBottom * px - m };
    type Box = { l: number; r: number; t: number; b: number };
    /** Feste Hindernisse: Minikarte oben rechts (breite Insel) und das Ansage-Banner („Lena ist dran“, Bildschirm-y 92 … 132) */
    const fixed: Box[] = [];
    if (this.mapBox.visible) fixed.push({ l: L + (this.mapRect.x - 4) * px, r: Infinity, t: -Infinity, b: T + (this.mapRect.y + this.mapRect.h + 4) * px });
    if (this.banner.text) fixed.push({ l: -Infinity, r: Infinity, t: T + 88 * px, b: T + (this.bannerSub.text ? 134 : 118) * px });
    /** Schon platzierte Blasen (eine neue legt sich nie darüber) */
    const placed: Box[] = [];
    const gap = 2 * this.ls;
    this.bubbles = this.bubbles.filter((b) => {
      const v = this.hogs.get(b.hog);
      if (time >= b.until || !v) {
        this.tweens.add({ targets: b.t, alpha: 0, duration: 250, onComplete: () => b.t.destroy() });
        return false;
      }
      const hs = st.hogs[b.hog];
      const hx = v.x;
      const hy = hs?.state === 'drowned' ? this.waterY : v.y;
      // Kopf des Igels sichtbar (nicht unter den Leisten)?
      const inView = hx >= L && hx <= L + vw && hy - 8 >= T + 22 * px && hy - 8 <= T + vh - hudBottom * px;
      if (inView === b.named) {
        b.named = !inView;
        const name = hs ? (playerById(hs.owner)?.name ?? '') : '';
        b.t.setText(b.named && name ? `${name}:\n${b.text}` : b.text);
      }
      if (time > b.born + 170) b.t.setScale(this.ls);
      // Endgröße (die Aufpopp-Animation wächst nur hinein); Ursprung der Blase = Mitte unten
      const w = b.t.width * this.ls;
      const h = b.t.height * this.ls;
      let x = hx;
      let y = hy - 22 - 8 * this.ls;
      // Oben kein Platz (Igel am oberen Bildrand) → unter den Igel
      if (inView && y - h < box.t) y = hy + 6 * this.ls + h;
      x = w >= box.r - box.l ? (box.l + box.r) / 2 : Phaser.Math.Clamp(x, box.l + w / 2, box.r - w / 2);
      y = h >= box.b - box.t ? box.t + h : Phaser.Math.Clamp(y, box.t + h, box.b);
      // Nicht unter Minikarte, Ansage-Banner oder eine schon platzierte Blase: kürzester Ausweichweg (hoch, runter,
      // links, rechts), der im Bild bleibt – bevorzugt einer, der dabei nichts anderes verdeckt
      const hit = (cx: number, cy: number, o: Box) => cx - w / 2 < o.r + gap && cx + w / 2 > o.l - gap && cy - h < o.b + gap && cy > o.t - gap;
      const fits = (c: { x: number; y: number }) => c.x - w / 2 >= box.l - 0.5 && c.x + w / 2 <= box.r + 0.5 && c.y - h >= box.t - 0.5 && c.y <= box.b + 0.5;
      for (let n = 0; n < 6; n++) {
        const obstacles = [...fixed, ...placed];
        const o = obstacles.find((o) => hit(x, y, o));
        if (!o) break;
        const options = [
          { x, y: o.t - gap },
          { x, y: o.b + gap + h },
          { x: o.l - gap - w / 2, y },
          { x: o.r + gap + w / 2, y },
        ].filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && fits(c));
        if (!options.length) break;
        const cost = (c: { x: number; y: number }) => Math.abs(c.x - x) + Math.abs(c.y - y) + (obstacles.some((q) => hit(c.x, c.y, q)) ? 1e4 : 0);
        options.sort((a, c) => cost(a) - cost(c));
        ({ x, y } = options[0]);
      }
      placed.push({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
      b.t.setPosition(Math.round(x), Math.round(y));
      if (time <= b.born + 170 || !hs) return true;
      // Spitze bzw. Pfeil: vom Rand der Blase Richtung Igel-Kopf
      const cx = Math.round(x);
      const cy = Math.round(y) - h / 2;
      const dx = hx - cx;
      const dy = hy - 8 - cy;
      const d = Math.hypot(dx, dy);
      if (d < 1) return true;
      const ux = dx / d;
      const uy = dy / d;
      const edge = Math.min(Math.abs(ux) > 1e-3 ? w / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? h / 2 / Math.abs(uy) : Infinity);
      if (d <= edge) return true;
      const ex = cx + ux * edge;
      const ey = cy + uy * edge;
      const len = Math.min((b.named ? 8 : 5) * this.ls, d - edge);
      const half = (b.named ? 5 : 3) * this.ls;
      const tri = (grow: number) =>
        [ex - uy * (half + grow) - ux * grow, ey + ux * (half + grow) - uy * grow, ex + uy * (half + grow) - ux * grow, ey - ux * (half + grow) - uy * grow, ex + ux * (len + grow), ey + uy * (len + grow)] as const;
      if (b.named) {
        g.fillStyle(0x2d1b12).fillTriangle(...tri(1.5 * this.ls));
        g.fillStyle(colorNum(colorOf(st, hs.owner))).fillTriangle(...tri(0));
      } else g.fillStyle(0xfff6dc).fillTriangle(...tri(0));
      return true;
    });
  }

  // ---------------------------------------------------------------- Themenkarte, Sprecher

  private showThemeCard(st: IgelState) {
    this.themeKey = `${st.seed}`;
    const th = IGEL_THEMES[st.theme];
    if (!th) return;
    this.hudBuilding = true;
    try {
      this.themeCard.removeAll(true);
      this.themeCard.add(panel(this, 90, 144, 300, 84, 'dark'));
      this.themeCard.add(txt(this, IGEL.W / 2, 151, 'THEMENKARTE', { color: '#9fb6c4' }));
      const title = txt(this, IGEL.W / 2, 165, th.name.toUpperCase(), { size: 16, color: GOLD });
      this.themeCard.add(title);
      const ik = ensureTex(this, `igel_theme_${st.theme}`, () => themeIcon(st.theme as IgelThemeId));
      for (const side of [-1, 1]) this.themeCard.add(this.add.image(Math.round(IGEL.W / 2 + side * (title.width / 2 + 14)), 173, ik));
      this.themeCard.add(txt(this, IGEL.W / 2, 189, th.text, { wrap: 280 }));
    } finally {
      this.hudBuilding = false;
    }
    this.themeCard.setScale(1).setAlpha(0).setY(10);
    this.tweens.add({ targets: this.themeCard, alpha: 1, y: 0, duration: 350, ease: 'Back.out' });
    sfx('drumroll', { vol: 0.5 });
    this.speak(`Themenkarte: ${th.name}! ${th.text}`, true);
  }

  /** Sprecher-Kommentar: Laufschrift unter dem HUD + Ansage (neben der Minikarte, falls es eine gibt) */
  private showQuip(text: string) {
    if (!text) return;
    const mapW = this.mapG ? IGEL.W - this.mapRect.x : 0;
    this.quipText.setX((IGEL.W - mapW) / 2).setWordWrapWidth(IGEL.W - mapW - 16);
    this.quipText.setText(text).setVisible(true).setScale(0.4);
    this.tweens.add({ targets: this.quipText, scale: 1, duration: 180, ease: 'Back.out' });
    this.quipUntil = this.time.now + 2800;
    this.speak(text);
  }

  /** Ansage über say(): Bots ohne „Bot“, höchstens alle 2,5 s (außer `force`) */
  private speak(text: string, force = false) {
    const now = performance.now();
    if (!force && now - this.lastSay < 2500) return;
    this.lastSay = now;
    say(text.replace(/\bBot\s+/g, ''), force ? { interrupt: true } : {});
  }

  // ---------------------------------------------------------------- „Schuss des Abends“

  /** Wiederholung starten: eigenes Terrain (Stand vor dem Schuss), eigene Figuren, SnapBuffer im Zeitlupen-Modus */
  private startReplay(st: IgelState, best: IgelReplay) {
    if (this.rp || best.frames.length < 2) return;
    // Live-Ansicht ausblenden
    this.terrainImg?.setVisible(false);
    for (const v of this.hogs.values()) v.c.setVisible(false);
    for (const v of this.objViews.values()) (v.img.setVisible(false), v.chute?.setVisible(false));
    for (const v of this.projs.values()) v.img.setVisible(false);
    for (const r of this.rings) r.img.setVisible(false);
    for (const b of this.bubbles) b.t.destroy();
    this.bubbles = [];
    this.bubbleG.clear();
    this.activeName.setVisible(false);
    this.aimG.clear();
    this.ropeG.clear();
    this.themeCard.setVisible(false);
    // Terrain wie vor dem Schuss: Seed + die ersten ops0 Operationen (gleiche Bemalung wie live)
    if (this.textures.exists(REPLAY_KEY)) this.textures.remove(REPLAY_KEY);
    const mask = genTerrain(st.seed, this.w);
    const tex = this.textures.createCanvas(REPLAY_KEY, this.w, IGEL.H)!;
    const ctx = tex.getContext();
    const img0 = ctx.createImageData(this.w, IGEL.H);
    paintTerrain(img0, mask);
    ctx.putImageData(img0, 0, 0);
    paintDecor(ctx, st.seed, mask);
    const applied = stampOps(mask, tex, st.ops, 0, best.ops0);
    const img = this.add.image(0, 0, REPLAY_KEY).setOrigin(0, 0).setDepth(0);
    // Wiedergabe über den gemeinsamen SnapBuffer: alle Bilder rein, dann replay() in Zeitlupe
    const buf = new SnapBuffer<IgelRecFrame>();
    buf.keep = 60_000;
    for (const f of best.frames) buf.push(f.t, f);
    const t0 = best.frames[0].t;
    const t1 = best.frames[best.frames.length - 1].t;
    buf.replay(t0, t1, best.rate);
    const g = this.add.graphics().setDepth(9);
    // Kamera startet beim Schützen (sein Igel im ersten Bild der Aufnahme)
    const f0 = best.frames[0];
    const own = st.hogs.findIndex((h, i) => h.owner === best.owner && f0.h[i]?.[3] === 0);
    const camX = own >= 0 ? f0.h[own][0] : best.fx0;
    const camY = own >= 0 ? f0.h[own][1] - 10 : best.fy0;
    this.rp = { best, buf, mask, tex, img, applied, hogs: new Map(), projs: new Map(), objs: new Map(), g, fxIdx: 0, camX, camY };
    // Effekte (Partikel, Tweens) laufen im selben Tempo mit
    this.juice.slowMo(best.rate, best.ms + 200);
    this.setGoal({ x: camX, y: camY, z: 1.4 }, 4);
    this.mapBox.setVisible(false);
    const name = playerById(best.owner)?.name ?? '?';
    const extra = [`${best.dmg} Schaden`, best.kos ? `${best.kos} K.O.` : '', WEAPONS[best.weapon]?.short ?? ''].filter(Boolean).join(' · ');
    this.rpBg.setVisible(true);
    this.rpTitle.setText('SCHUSS DES ABENDS');
    this.rpSub.setText(`<< ${name.replace(/^Bot\s+/, '')} · ${extra}`);
    if (WEAPONS[best.weapon]) this.rpIcon.setTexture(iconKey(this, best.weapon)).setX(Math.round(IGEL.W / 2 + this.rpSub.width / 2 + 12)).setVisible(true);
    this.quipUntil = 0;
    this.quipText.setVisible(false);
    this.banner.setText('');
    this.bannerSub.setText('');
    sfx('drumroll', { vol: 0.6 });
    this.speak(`Schuss des Abends: ${name}!`, true);
  }

  private updateReplay(time: number) {
    const rp = this.rp!;
    const s = rp.buf.sample();
    if (!s) return;
    if (!rp.buf.replaying) {
      this.finishReplay();
      return;
    }
    const { a, b, f, t } = s;
    // Terrain: Operationen bis zum Bild vor der Uhr
    if (a.o > rp.applied) rp.applied = stampOps(rp.mask, rp.tex, this.latestIgel()?.ops ?? [], rp.applied, a.o);
    // Effekte zur passenden Zeit (Sprechblasen und Sprecher nicht)
    const fx = rp.best.fx;
    while (rp.fxIdx < fx.length && fx[rp.fxIdx].t <= t) {
      const e = fx[rp.fxIdx++];
      if (e.type !== 'taunt' && e.type !== 'quip' && e.type !== 'water') this.playFx(e);
    }
    const live = this.latestIgel();
    this.drawWater(a.w ?? live?.water ?? IGEL.WATER_Y, time, 1);
    rp.g.clear();
    // Igel
    b.h.forEach((row, id) => {
      const ra = a.h[id] ?? row;
      let v = rp.hogs.get(id);
      if (!v) {
        const owner = live?.hogs[id]?.owner;
        const look = owner ? raccoonLook(live!, owner) : { scarf: '#e0503f', hat: 'none' as const, hatColor: '#3a2418' };
        const spr = this.add.image(0, 2, this.hogTex(look, 'stand')).setOrigin(0.5, 1);
        const umb = this.add.image(0, -13, ensureTex(this, 'igel_umb', umbrellaPix)).setOrigin(0.5, 1).setVisible(false);
        const c = this.add.container(row[0], row[1], [umb, spr]).setDepth(10);
        v = { c, spr, umb, look };
        rp.hogs.set(id, v);
      }
      const x = lerpJump(ra[0], row[0], f, 40);
      const y = lerpJump(ra[1], row[1], f, 40);
      const state = f < 0.5 ? ra[3] : row[3];
      const flags = row[4];
      v.c.setPosition(Math.round(x), Math.round(y)).setVisible(state !== 2);
      if (state === 1) v.spr.setTexture(ensureTex(this, 'igel_grave', gravestone)).setAngle(0).setFlipX(false);
      else {
        const pose: RaccoonPose = flags & 6 ? 'hang' : (this.hurtUntil.get(id) ?? 0) > time ? 'hurt' : flags & 1 ? 'jump' : 'stand';
        v.spr.setTexture(this.hogTex(v.look, pose)).setFlipX(row[2] < 0).setAngle(flags & 1 && !(flags & 6) ? Math.sin(time / 60) * 12 : 0);
      }
      v.umb.setVisible(state === 0 && !!(flags & 4));
      if (flags & 2 && row.length >= 7) drawRope(rp.g, row[5], row[6], x, y - 15);
    });
    // Geschosse (Kamera folgt dem ersten)
    const alive = new Set<number>();
    let follow: { x: number; y: number } | null = null;
    for (const p of b.p) {
      alive.add(p[0]);
      const pa = a.p.find((q) => q[0] === p[0]) ?? p;
      const x = lerp(pa[2], p[2], f);
      const y = lerp(pa[3], p[3], f);
      let img = rp.projs.get(p[0]);
      if (!img) {
        img = this.add.image(x, y, projTex(this, p[1], p[0])).setDepth(20);
        rp.projs.set(p[0], img);
      }
      img.setPosition(Math.round(x), Math.round(y)).setAngle(projAngle(p[1], time, p[2] - pa[2], p[3] - pa[3], img.angle));
      if (!follow && p[1] !== 'frag') follow = { x, y };
    }
    for (const [id, img] of rp.projs) if (!alive.has(id)) (img.destroy(), rp.projs.delete(id));
    // Gegenstände
    const objAlive = new Set<number>();
    for (const o of b.b) {
      objAlive.add(o[0]);
      let img = rp.objs.get(o[0]);
      if (!img) {
        const tex = objTex(this, o[1], true);
        img = this.add.image(o[2], o[3] + 1, tex).setOrigin(0.5, 1).setDepth(9);
        rp.objs.set(o[0], img);
      }
      img.setPosition(Math.round(o[2]), Math.round(o[3] + 1));
    }
    for (const [id, img] of rp.objs) if (!objAlive.has(id)) (img.destroy(), rp.objs.delete(id));
    // Kamera: dem Geschoss folgen, sonst zum großen Einschlag gleiten
    const tx = follow ? follow.x : rp.best.fx0;
    const ty = follow ? follow.y : rp.best.fy0;
    rp.camX += (tx - rp.camX) * 0.08;
    rp.camY += (ty - rp.camY) * 0.08;
    this.setGoal({ x: rp.camX, y: rp.camY, z: 1.4 }, this.view.z > 1.35 ? 20 : 4);
  }

  private latestIgel(): IgelState | null {
    return this.latest?.mini?.kind === 'igel' ? this.latest.mini.state : null;
  }

  /** Wiederholung fertig: Siegerbanner wieder, Kamera zurück */
  private finishReplay() {
    this.stopReplay();
    const st = this.latestIgel();
    if (st) this.onState(this.latest!);
    sfx('cheer', { vol: 0.7 });
  }

  /** Wiederholung abbauen und die Live-Ansicht zurückholen */
  private stopReplay() {
    const rp = this.rp;
    if (!rp) return;
    this.rp = null;
    for (const v of rp.hogs.values()) v.c.destroy();
    for (const v of rp.projs.values()) v.destroy();
    for (const v of rp.objs.values()) v.destroy();
    rp.g.destroy();
    rp.img.destroy();
    if (this.textures.exists(REPLAY_KEY)) this.textures.remove(REPLAY_KEY);
    this.juice.slowMo(1, 0);
    this.terrainImg?.setVisible(true);
    for (const v of this.hogs.values()) v.c.setVisible(v.state !== 'drowned');
    for (const v of this.objViews.values()) (v.img.setVisible(true), v.chute?.setVisible(true));
    for (const v of this.projs.values()) v.img.setVisible(true);
    for (const r of this.rings) r.img.setVisible(true);
    this.rpBg.setVisible(false);
    this.rpTitle.setText('');
    this.rpSub.setText('');
    this.rpIcon.setVisible(false);
    this.camMode = 'overview';
  }

  // ---------------------------------------------------------------- Kamera

  /** Kleinster Zoom: die ganze Inselbreite im Bild (480 → 1, 960 → 0,5) */
  private zMin() {
    return Math.min(1, IGEL.W / this.w);
  }

  private setGoal(g: { x: number; y: number; z: number }, rate: number) {
    this.viewGoal = { x: g.x, y: g.y, z: g.z, rate };
  }

  /**
   * Kamera-Ziel, das alle Punkte (Igel-Fußpunkte) mit Rand zeigt – Zoom zwischen ganzer Insel und `zMax`.
   * Überblick (`zMax` ≤ 1): unten verankert (Meer und Flut im Bild) – bei Zoom 1 genau die Welt 0–270 wie früher.
   */
  private fit(pts: { x: number; y: number }[], zMax = 1, pad = 36) {
    if (!pts.length) return { x: this.w / 2, y: IGEL.H * 2, z: this.zMin() };
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    // oben Platz für Igel, HP-Zahl und Sprechblase
    x0 -= pad;
    x1 += pad;
    y0 -= pad + 24;
    y1 += pad * 0.5;
    const z = clamp(Math.min(IGEL.W / (x1 - x0), IGEL.H / (y1 - y0)), this.zMin(), zMax);
    return { x: (x0 + x1) / 2, y: zMax <= 1 ? IGEL.H * 2 : (y0 + y1) / 2, z };
  }

  /** Lebende Igel (geglättete Anzeige-Position) */
  private alivePts(st: IgelState) {
    const pts: { x: number; y: number }[] = [];
    for (const h of st.hogs) {
      const v = this.hogs.get(h.id);
      if (v && h.state === 'ok') pts.push({ x: v.x, y: v.y });
    }
    return pts;
  }

  /**
   * Weich zum Ziel, dann an die Insel klemmen: seitlich nie über den Inselrand, oben etwas Himmel (CAM_SKY),
   * unten beim Herauszoomen ein Streifen Meer – Himmel und Horizont füllt die Kulisse (layoutBg).
   */
  private applyView(dt: number) {
    const v = this.view;
    const g = this.viewGoal;
    const k = 1 - Math.exp(-dt * g.rate);
    v.z += (g.z - v.z) * k;
    v.x += (g.x - v.x) * k;
    v.y += (g.y - v.y) * k;
    v.z = clamp(v.z, this.zMin(), 2);
    const vw = IGEL.W / v.z;
    const vh = IGEL.H / v.z;
    v.x = vw >= this.w ? this.w / 2 : clamp(v.x, vw / 2, this.w - vw / 2);
    const yMax = IGEL.H + Math.max(0, vh - IGEL.H) * CAM_SEA - vh / 2;
    v.y = clamp(v.y, Math.min(yMax, vh / 2 - CAM_SKY), yMax);
    this.cameras.main.setZoom(v.z).centerOn(v.x, v.y);
    // Schrift in der Welt: bei Zoom < 1 hochskalieren (bei ganzzahligem Gesamtmaßstab bleibt sie pixelscharf)
    this.ls = clamp(1 / v.z, 1, 2);
  }

  /** Kulisse bildfüllend halten (Ebene in Bildschirm-Koordinaten) + Parallax über die Kachel-Verschiebung */
  private layoutBg() {
    const z = this.view.z;
    this.bgLayer.setPosition(IGEL.W / 2 - IGEL.W / 2 / z, IGEL.H / 2 - IGEL.H / 2 / z).setScale(1 / z);
    const off = this.view.x - this.w / 2;
    this.midSky.tilePositionX = off * 0.45 - BG_PAD;
    this.clouds.tilePositionX = this.cloudDrift + off * 0.3 - BG_PAD;
  }

  /** Stereo-Position eines Geräuschs: Welt-x → Bildschirm-x (0–480) */
  private sx(x: number) {
    const wv = this.cameras.main.worldView;
    return wv.width > 0 ? ((x - wv.x) / wv.width) * IGEL.W : x;
  }

  /**
   * Kamera-Regie (live): Rundlauf – Schwenk + Zoom auf den aktiven Igel, dem Geschoss folgen, kurz auf dem Krater halten,
   * dann Überblick; „Alle gleichzeitig“ – alle lebenden Igel (und fliegenden Geschosse) im Bild, zoomt mit, wenn es leerer wird.
   */
  private updateCamera(st: IgelState) {
    if (this.rp) return;
    if (st.simul) {
      this.camMode = 'overview';
      const pts = this.alivePts(st);
      if (st.sub === 'aimAll') {
        // Tauben-Ziele mit ins Bild
        for (const a of Object.values(st.aims)) if (a.tx !== undefined) pts.push({ x: a.tx, y: this.mask ? surfaceY(this.mask, a.tx) : IGEL.H / 2 });
      } else if (st.sub === 'flightAll') {
        for (const p of this.projs.values()) pts.push({ x: p.x, y: clamp(p.y, 60, IGEL.H) });
      }
      this.setGoal(this.fit(pts, 1), 2.5);
      return;
    }
    const ah = st.activeHog !== null ? this.hogs.get(st.activeHog) : undefined;
    const ahOk = !!ah && st.activeHog !== null && st.hogs[st.activeHog]?.state === 'ok';
    // Zugbeginn: Schwenk + Zoom auf den aktiven Igel, Banner „<Name> ist dran“
    if (st.sub === 'aim' && st.turn !== this.camTurn && ah) {
      this.camTurn = st.turn;
      this.camMode = 'hog';
      this.followProj = -1;
      const name = st.active ? (playerById(st.active)?.name ?? '?') : '?';
      const ahs = st.hogs[st.activeHog!];
      // Team-Modus: wer schon raus ist, steuert den Igel eines Mitspielers
      const sub = ahs && st.active && ahs.owner !== st.active ? `mit ${playerById(ahs.owner)?.name ?? '?'}s Waschbär` : '';
      this.showBanner(`${name} ist dran`, sub, 1400);
      sfx('select');
    }
    if (this.camMode === 'proj') {
      const p = this.projs.get(this.followProj);
      if (p) {
        this.setGoal({ x: p.x, y: p.y, z: ZOOM_NEAR }, 9);
        return;
      }
      this.camMode = 'hold';
      this.camHoldUntil = this.time.now + CAM_HOLD_MS;
    }
    if (this.camMode === 'hold' && this.time.now < this.camHoldUntil) return;
    // Noch etwas unterwegs (Müllbrocken, Tauben-Ladung)? Alle Geschosse im Bild behalten
    const flying = [...this.projs.values()];
    if (st.sub === 'flight' && flying.length) {
      this.camMode = 'hold';
      this.setGoal(this.fit(flying.map((p) => ({ x: p.x, y: clamp(p.y, 60, IGEL.H) })), 1.2, 30), 5);
      return;
    }
    const want: CamMode = (st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'flight') && ahOk ? 'hog' : 'overview';
    this.camMode = want;
    if (want === 'hog' && ah) {
      const goal = { x: ah.x, y: ah.y - 16, z: ZOOM_NEAR };
      const aim = st.sub === 'aim' ? st.aim : null;
      if (aim && aim.tx !== undefined && WEAPONS[st.weapon].aim === 'map') {
        // Tauben-Angriff: Waschbär und Fadenkreuz zusammen ins Bild
        this.setGoal(this.fit([{ x: ah.x, y: ah.y }, { x: aim.tx, y: ah.y }], ZOOM_NEAR, 50), 4);
        return;
      }
      // Wurfwaffen: Kamera schaut ein Stück in Zielrichtung
      if (aim && isThrown(st.weapon)) goal.x += Math.cos(aim.angle) * (16 + 40 * aim.power);
      // Böller gelegt: beim Weglaufen den Böller mit im Bild behalten
      const dyn = st.sub === 'retreat' ? st.projs.find((p) => p.type === 'dynamite') : undefined;
      if (dyn) {
        this.setGoal(this.fit([{ x: ah.x, y: ah.y }, { x: dyn.x, y: dyn.y }], ZOOM_NEAR, 50), 5);
        return;
      }
      this.setGoal(goal, 5);
    } else {
      // Settle/Countdown/Ende: alle lebenden Igel (bei 480 ist das die ganze Insel)
      this.setGoal(this.fit(this.alivePts(st), 1), 3);
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
      // Tauben-Angriff: Fadenkreuz über dem Ziel
      const sy = this.mask ? surfaceY(this.mask, aim.tx) : IGEL.H;
      const c = col ?? 0xe0503f;
      for (let y = 26; y < sy - 4; y += 8) g.fillStyle(c, 0.8).fillRect(aim.tx - 1, y, 2, 4);
      g.lineStyle(2, c).strokeCircle(aim.tx, sy - 6, 7 + Math.sin(time / 120));
      g.lineStyle(1, 0x2d1b12).strokeCircle(aim.tx, sy - 6, 9 + Math.sin(time / 120));
      return;
    }
    if (kind === 'none') return;
    if (weapon === 'teleport') {
      // Gully-Tunnel: gepunktete Linie bis zum Ausstieg (gelb wie der Pfeil im Icon)
      const c = col ?? 0xffd25e;
      const tx = cx + Math.cos(a) * p * IGEL.TELE_RANGE;
      const tyy = cy + Math.sin(a) * p * IGEL.TELE_RANGE;
      for (let d = 8; d < p * IGEL.TELE_RANGE; d += 7) {
        g.fillStyle(0x2d1b12, 0.6).fillRect(cx + Math.cos(a) * d - 2, cy + Math.sin(a) * d - 2, 4, 4);
        g.fillStyle(c, 1).fillRect(cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2);
      }
      g.lineStyle(3, 0x2d1b12, 0.6).strokeCircle(tx, tyy, 6 + Math.sin(time / 100));
      g.lineStyle(1, c).strokeCircle(tx, tyy, 6 + Math.sin(time / 100));
      return;
    }
    // Zielhilfe: gestrichelter Anfang der Flugbahn
    if (isThrown(weapon) && this.mask) {
      const key = `${Math.round(hx)},${Math.round(hy)},${a},${p},${weapon},${st.wind},${st.ops.length}`;
      let c = this.aimCache.get(hogId);
      if (!c || c.key !== key) {
        c = { key, pts: aimPath(this.mask, { x: hx, y: cy }, a, p, st.wind * (st.windMul ?? 1), st.water, weapon, st.grav ?? 1) };
        this.aimCache.set(hogId, c);
      }
      const n = Math.min(c.pts.length, Math.max(8, Math.ceil(c.pts.length * AIM_HELP)));
      const pathCol = col ?? 0xfdf7ea;
      for (let i = 2; i < n; i++) {
        if (i % 3 === 0) continue;
        const [p0, p1] = [c.pts[i - 1], c.pts[i]];
        g.lineStyle(4 * this.ls, 0x2d1b12, 0.6).lineBetween(p0.x, p0.y, p1.x, p1.y);
        g.lineStyle(2 * this.ls, pathCol, 1).lineBetween(p0.x, p0.y, p1.x, p1.y);
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
    this.cloudDrift -= st.wind * CLOUD_SPEED * dt;
    for (const p of this.specks) {
      p.x += st.wind * CLOUD_SPEED * 2.2 * dt;
      if (p.x > this.w + 4) p.x -= this.w + 8;
      if (p.x < -4) p.x += this.w + 8;
      p.r.setPosition(Math.round(p.x), Math.round(p.y + Math.sin(time / 300 + p.ph) * 3)).setAlpha(Math.min(0.9, Math.abs(st.wind) * 1.2));
    }

    if (this.quipUntil && time > this.quipUntil) {
      this.quipUntil = 0;
      this.quipText.setVisible(false);
    }
    if (this.rp) {
      this.updateReplay(time);
      this.applyView(dt);
      this.layoutBg();
      return;
    }

    // Waschbären (+ Wäscheleinen dahinter)
    this.ropeG.clear();
    for (const h of st.hogs) {
      const v = this.hogs.get(h.id);
      if (!v || h.state === 'drowned') continue;
      const k = h.flying ? 0.55 : 0.35;
      v.x += (h.x - v.x) * k;
      v.y += (h.y - v.y) * k;
      v.c.setPosition(Math.round(v.x), Math.round(v.y));
      // Aktiver Waschbär beim Zielen: Waffe in der Pfote (nicht bei Werkzeugen und Tauben-Luftschlag)
      const aiming = !st.simul && st.sub === 'aim' && h.id === st.activeHog && h.state === 'ok' && !h.flying && !isTool(st.weapon) && WEAPONS[st.weapon].aim !== 'map';
      if (h.state === 'ok') {
        const hurt = (this.hurtUntil.get(h.id) ?? 0) > time;
        const pose: RaccoonPose = h.rope || h.chute ? 'hang' : hurt ? 'hurt' : h.flying ? 'jump' : h.walking ? (Math.floor(time / 130) % 2 ? 'walk' : 'stand') : aiming ? 'aim' : 'stand';
        v.spr.setTexture(this.hogTex(v.look, pose)).setFlipX(h.dir < 0);
        // An der Leine und unterm Schirm wackelt der Waschbär nicht wild herum
        v.spr.setAngle(h.flying && !h.rope && !h.chute ? Math.sin(time / 60) * 12 : h.chute ? Math.sin(time / 300) * 5 : 0);
        v.spr.setY(h.walking ? 2 - (Math.floor(time / 130) % 2) : 2);
        if (h.rope) drawRope(this.ropeG, h.rope[0], h.rope[1], v.x, v.y - 15);
      }
      v.held.setVisible(aiming);
      if (aiming) v.held.setTexture(iconKey(this, st.weapon)).setFlipX(h.dir < 0).setPosition(h.dir * 9, -6);
      v.umb.setVisible(h.state === 'ok' && !!h.chute).setAngle(Math.sin(time / 300) * 6);
      v.c.setDepth(h.id === st.activeHog ? 12 : 10);
      // HP-Zahl und Team-Fähnchen gegen den Zoom ausgleichen (Unterkante bleibt über dem Igel)
      v.label.setScale(this.ls).setY(-16 - 8 * this.ls);
      v.flag?.setScale(this.ls).setPosition(-9 - 8 * this.ls, -16 - 8 * this.ls);
    }

    // Geschosse
    for (const p of st.projs) {
      const v = this.projs.get(p.id);
      if (!v) continue;
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      v.x += dx * 0.6;
      v.y += dy * 0.6;
      v.img.setPosition(Math.round(v.x), Math.round(v.y));
      v.ang = projAngle(p.type, time, dx, dy, v.ang);
      v.img.setAngle(v.ang);
      if (p.type === 'dynamite') v.img.setAlpha(0.75 + Math.sin(time / 60) * 0.25);
    }

    this.updateCamera(st);
    this.applyView(dt);
    this.layoutBg();
    this.drawMiniMap(st, time);

    this.updateBubbles(st, time);

    // Aktiver Igel: Pfeil + Name (Rundlauf) bzw. alle Ziellinien in Spielerfarbe (Alle gleichzeitig)
    this.aimG.clear();
    const ah = st.activeHog !== null ? this.hogs.get(st.activeHog) : undefined;
    const ahs = st.activeHog !== null ? st.hogs[st.activeHog] : undefined;
    if (!st.simul && ah && ahs && ahs.state === 'ok' && st.sub !== 'over' && st.sub !== 'settle') {
      const bob = Math.sin(time / 160) * 2;
      const ctrl = st.active ?? ahs.owner;
      const col = colorNum(colorOf(st, ctrl));
      const ty = ah.y - 26 - 8 * this.ls + bob;
      this.aimG.fillStyle(0x2d1b12).fillTriangle(ah.x - 5, ty - 1, ah.x + 5, ty - 1, ah.x, ty + 6);
      this.aimG.fillStyle(col).fillTriangle(ah.x - 3, ty, ah.x + 3, ty, ah.x, ty + 4);
      this.activeName.setText(playerById(ctrl)?.name ?? '').setScale(this.ls).setPosition(Math.round(ah.x), Math.round(ty - 4 - 8 * this.ls)).setColor(colorOf(st, ctrl)).setVisible(true);
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
          // Häkchen: dieser Igel ist bereit (wächst beim Herauszoomen mit, wie die HP-Zahl)
          const s = this.ls;
          const x = Math.round(v.x);
          const y = Math.round(v.y - 15 - 17 * s);
          this.aimG.fillStyle(0x2d1b12).fillRect(x - 5 * s, y - s, 11 * s, 9 * s);
          this.aimG.fillStyle(0x46b04a).fillRect(x - 4 * s, y, 9 * s, 7 * s);
          this.aimG.fillStyle(0xfdf7ea).fillRect(x - 3 * s, y + 3 * s, 2 * s, 2 * s).fillRect(x - s, y + 4 * s, 2 * s, 2 * s).fillRect(x + s, y + 2 * s, 2 * s, 2 * s).fillRect(x + 2 * s, y + s, 2 * s, 2 * s);
        }
      }
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

    this.drawWater(st.water, time, 0.05);
    for (const r of this.rings) {
      r.img.x += r.vx * (1 / 60);
      r.img.y = this.waterY + Math.sin(time / 300 + r.img.x / 20) * 1.5;
      if (r.img.x < -20 || r.img.x > this.w + 20) r.img.setVisible(false);
    }
  }

  /** Wasser über die ganze Inselbreite (steigt im Sudden Death; `k` = wie schnell der Spiegel nachzieht) – reicht beim Herauszoomen bis unten ins Bild */
  private drawWater(target: number, time: number, k: number) {
    this.waterY += (target - this.waterY) * k;
    const wy = this.waterY;
    const g = this.waterG;
    const deep = IGEL.H * 2;
    g.clear();
    g.fillStyle(0x3784c2, 0.82).fillRect(-8, wy + 2, this.w + 16, deep - wy);
    g.fillStyle(0x2b6ba6, 0.5).fillRect(-8, wy + 12, this.w + 16, deep - wy);
    for (let x = -6; x < this.w + 6; x += 3) {
      const off = Math.round(Math.sin(x / 11 + time / 400) * 1.5 + Math.sin(x / 5 + time / 260) * 0.7);
      g.fillStyle(0x4aa2dc, 0.9).fillRect(x, wy + off, 3, 3);
      g.fillStyle(0xeaf8ff, 0.95).fillRect(x, wy + off - 1, 3, 1);
    }
  }
}

/** Zielhilfe: so viel der Flugbahn wird gestrichelt vorgezeichnet */
const AIM_HELP = 0.2;
const OUTLINE = '#2d1b12';

// ---------------------------------------------------------------- Sprites der Geschosse und Gegenstände

/** Geschoss-Texturen (Müllbrocken je nach id in drei Varianten) */
const PROJ_TEX: Record<IgelProjType, [string, () => Pix]> = {
  bazooka: ['igel_rocket', rocket],
  grenade: ['igel_can', tinCan],
  cluster: ['igel_bag', trashBag],
  holy: ['igel_holybin', holyBin],
  frag: ['igel_junk_0', () => junk(0)],
  gull: ['igel_drop', pigeonDrop],
  dynamite: ['igel_boeller', boeller],
};

function projTex(scene: Phaser.Scene, type: IgelProjType, id: number) {
  if (type === 'frag') return ensureTex(scene, `igel_junk_${id % 3}`, () => junk(id));
  const [key, make] = PROJ_TEX[type] ?? PROJ_TEX.bazooka;
  return ensureTex(scene, key, make);
}

/** Gaskartusche, Picknickkorb oder Mausefalle (gespannt / noch nicht scharf) */
function objTex(scene: Phaser.Scene, type: IgelObj['type'], armed: boolean) {
  if (type === 'barrel') return ensureTex(scene, 'igel_gas', gasCan);
  if (type === 'crate') return ensureTex(scene, 'igel_basket', picnicBasket);
  return ensureTex(scene, `igel_trap_${armed ? 1 : 0}`, () => mouseTrap(armed));
}

/** Drehung der Geschosse: Rakete zeigt in Flugrichtung, Tonne wackelt (Heiligenschein bleibt oben), der Rest trudelt */
function projAngle(type: IgelProjType, time: number, dx: number, dy: number, prev: number) {
  if (type === 'bazooka') return Math.hypot(dx, dy) > 0.05 ? Phaser.Math.RadToDeg(Math.atan2(dy, dx)) : prev;
  if (type === 'frag') return time * 0.8;
  if (type === 'grenade' || type === 'cluster') return time * 0.4;
  if (type === 'holy') return Math.sin(time / 90) * 14;
  return 0;
}

// ---------------------------------------------------------------- Terrain-Helfer (live und Wiederholung)

/** Operationen [from, to) in Maske und Terrain-Textur einarbeiten; liefert den neuen Stand */
function stampOps(mask: Mask, tex: Phaser.Textures.CanvasTexture, ops: IgelOp[], from: number, to: number) {
  const ctx = tex.getContext();
  let i = from;
  for (; i < to && i < ops.length; i++) {
    const op = ops[i];
    const [cx, cy, r, kind] = op;
    applyOp(mask, op);
    const pad = kind === 'add' ? 1 : 4;
    const x0 = Math.max(0, Math.floor(cx - r - pad));
    const y0 = Math.max(0, Math.floor(cy - r - pad));
    const x1 = Math.min(mask.w, Math.ceil(cx + r + pad));
    const y1 = Math.min(IGEL.H, Math.ceil(cy + r + pad));
    if (x1 <= x0 || y1 <= y0) continue;
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    if (kind === 'add') paintPlank(img, x0, y0, cx, cy, r, mask);
    else paintCrater(img, x0, y0, mask, cx, cy, r);
    ctx.putImageData(img, x0, y0);
  }
  tex.refresh();
  return i;
}

/** Tannen, Zelte und Mülltonnen direkt ins Terrain malen (gehen bei Explosionen mit kaputt) – 3 je 480 px Inselbreite */
function paintDecor(ctx: CanvasRenderingContext2D, seed: number, m: Mask) {
  const r = seeded(seed ^ 0x5eed);
  const used: number[] = [];
  const items = [() => pine(6), () => pine(11), () => tent(C.orange), () => tent(C.green), () => trashCan()];
  const k = m.w / IGEL.W;
  let placed = 0;
  for (let tries = 0; tries < 60 * k && placed < Math.round(3 * k); tries++) {
    const x = 30 + Math.floor(r() * (m.w - 60));
    const sy = surfaceY(m, x);
    if (sy > IGEL.WATER_Y - 22 || sy < 60 || used.some((u) => Math.abs(u - x) < 70)) continue;
    if (Math.abs(surfaceY(m, x - 6) - surfaceY(m, x + 6)) > 6) continue;
    // Nur auf festem Boden (nicht auf schwebenden Felsen oder über Höhlen)
    if (![6, 14, 24, 34].every((dy) => m[(sy + dy) * m.w + x] === 1)) continue;
    const pix = items[Math.floor(r() * items.length)]();
    ctx.drawImage(pix.canvas, Math.round(x - pix.w / 2), sy - pix.h + 3);
    used.push(x);
    placed++;
  }
}

/** Holzbrett: neue feste Pixel in Holzfarben (hell oben, Maserung in der Mitte, dunkler Rand unten) */
function paintPlank(img: ImageData, ox: number, oy: number, cx: number, cy: number, r: number, mask: Mask) {
  const d = img.data;
  for (let j = 0; j < img.height; j++) {
    for (let i = 0; i < img.width; i++) {
      const x = ox + i;
      const y = oy + j;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 0.01 || !mask[y * mask.w + x]) continue;
      const k = (j * img.width + i) * 4;
      if (d[k + 3] > 0 && !(d[k] === 0xd3 && d[k + 1] === 0x9a) && !(d[k] === 0xb8 && d[k + 1] === 0x78) && !(d[k] === 0x8d && d[k + 1] === 0x56)) continue;
      const dy = y + 0.5 - cy;
      const [rr, gg, bb] = dy > r * 0.45 ? [0x8d, 0x56, 0x29] : dy < -r * 0.45 ? [0xd3, 0x9a, 0x5c] : [0xb8, 0x78, 0x3f];
      d[k] = rr;
      d[k + 1] = gg;
      d[k + 2] = bb;
      d[k + 3] = 255;
    }
  }
}

/** Wäscheleine vom Anker (Wäscheklammer) zu den Pfoten, mit einer Socke darauf */
function drawRope(g: Phaser.GameObjects.Graphics, ax: number, ay: number, x: number, y: number) {
  g.lineStyle(3, 0x2d1b12, 0.8).lineBetween(ax, ay, x, y);
  g.lineStyle(1.5, 0xf4efe6, 1).lineBetween(ax, ay, x, y);
  // Socke bei 40 % der Leine
  const sx = Math.round(ax + (x - ax) * 0.4);
  const sy = Math.round(ay + (y - ay) * 0.4);
  g.fillStyle(0x2d1b12).fillRect(sx - 2, sy, 5, 6).fillRect(sx - 2, sy + 4, 7, 3);
  g.fillStyle(0xe04a3f).fillRect(sx - 1, sy + 1, 3, 4).fillRect(sx - 1, sy + 4, 5, 2);
  g.fillStyle(0xfdf7ea).fillRect(sx - 1, sy + 1, 3, 1);
  // Wäscheklammer am Anker
  g.fillStyle(0x2d1b12).fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 4, 6);
  g.fillStyle(0xd39a5c).fillRect(Math.round(ax) - 1, Math.round(ay) - 1, 2, 4);
}

/** Laufende Wiederholung „Schuss des Abends“ (eigene Terrain-Kopie, eigene Figuren) */
interface Replay {
  best: IgelReplay;
  buf: SnapBuffer<IgelRecFrame>;
  mask: Mask;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  applied: number;
  hogs: Map<number, { c: Phaser.GameObjects.Container; spr: Phaser.GameObjects.Image; umb: Phaser.GameObjects.Image; look: RaccoonLook }>;
  projs: Map<number, Phaser.GameObjects.Image>;
  objs: Map<number, Phaser.GameObjects.Image>;
  g: Phaser.GameObjects.Graphics;
  fxIdx: number;
  camX: number;
  camY: number;
}

const REPLAY_KEY = 'igel_replay_terrain';
