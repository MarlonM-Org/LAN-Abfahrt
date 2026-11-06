import Phaser from 'phaser';
import type { GameState, Team } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import {
  WASSER as W,
  WASSER_BASE,
  WASSER_COVER,
  WASSER_HOSE,
  WASSER_HOSE_REEL,
  WASSER_PISTOL_SPOTS,
  WASSER_POOL,
  type WasserBalloon,
  type WasserPlayer,
  type WasserState,
  aimLanding,
  coverSaves,
  segHitsRect,
} from '../../shared/wasser';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { bucket, downArrow, dropIcon, fastDropIcon, hedge, hoseReel, nozzle, paintGarden, shieldIcon, sunIcon, towelIcon, waterBalloon, waterPistol } from '../art/garden';
import { bus, getState, playerById } from './store';
import { figure, type Figure } from './textures';
import { BLUE_INK, NameTags, background, ensureTex, fitText, ink, panel, prop, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { pcol } from './playerColor';
import { isWarmup } from './WarmupScene';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SUN_INK = '#b06d00';
const WATER = 0x93d3f3;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const TEAMS: Team[] = ['A', 'B'];
/** Text in Grundgröße `base` setzen und nur bei Bedarf weiter verkleinern (bis `min`) */
const fitAt = <T extends Phaser.GameObjects.Text>(t: T, maxW: number, base: number, min = 0.5): T => {
  t.setScale(1);
  return t.setScale(Math.max(min, Math.min(base, maxW / Math.max(1, t.width))));
};

interface Fig {
  f: Figure;
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  gun: Phaser.GameObjects.Image;
  /** Über dem Kopf: Handtuch (klatschnass/abtrocknen), Schild (Deckung schützt gerade); Sonne am Nässe-Balken */
  towel: Phaser.GameObjects.Image;
  shield: Phaser.GameObjects.Image;
  sun: Phaser.GameObjects.Image;
  x: number;
  y: number;
  barKey: string;
  dripAt: number;
  steamAt: number;
  /** Stand im letzten Snapshot (Hintragen zum Handtuch, Nachfüllen, Pistole aufgehoben) */
  status: string;
  ammo: number;
  pistol: boolean;
}

/** Schwebendes Schild über einem Ort im Garten (Eimer, Schlauch, Handtuch, Wasserpistole) */
type SpotId = 'bucketA' | 'bucketB' | 'hose' | 'towelA' | 'towelB' | 'pistol';
interface Spot {
  c: Phaser.GameObjects.Container;
  /** Grundposition des Schilds (wippt darum) */
  bx: number;
  by: number;
  /** Ort am Boden (Ring beim Hervorheben) */
  gx: number;
  gy: number;
  rx: number;
  ry: number;
  col: number;
  phase: number;
}

/** Aufwärm-Tour: jedes Element einmal zeigen – gleiche Symbole wie Schilder, Legende und Handy */
type TourIcon = 'drop' | 'fast' | 'towel' | 'shield' | 'sun' | 'pistol';
const TOUR: { icon: TourIcon; title: string; line: string; spots?: SpotId[]; covers?: boolean; pistol?: boolean }[] = [
  { icon: 'drop', title: 'EIMER = AUFFÜLLEN', line: 'Keine Bomben mehr? Ab zum Eimer deines Teams.', spots: ['bucketA', 'bucketB'] },
  { icon: 'fast', title: 'SCHLAUCH = SCHNELLER', line: 'In der Mitte füllst du fast 3× so schnell auf.', spots: ['hose'] },
  { icon: 'shield', title: 'HECKEN + LIEGEN = DECKUNG', line: 'Sie fangen Wasserbomben und Spritzer ab.', covers: true },
  { icon: 'towel', title: 'KLATSCHNASS? ZUM HANDTUCH', line: 'Bei 100 % Nässe: zum eigenen Handtuch, abtrocknen.', spots: ['towelA', 'towelB'] },
  { icon: 'sun', title: 'DIE SONNE TROCKNET', line: 'Wer eine Weile nicht getroffen wird, trocknet langsam.' },
  { icon: 'pistol', title: 'WASSERPISTOLE', line: 'Taucht ab und zu auf: drüberlaufen = 6 s Dauerstrahl.', pistol: true },
];
const TOUR_DELAY_MS = 2500;
const TOUR_STEP_MS = 4000;

export class WasserScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private balloons = new Map<number, { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; b: WasserBalloon; recv: number }>();
  private seenSplash = new Set<number>();
  private aimG!: Phaser.GameObjects.Graphics;
  /** Ringe am Boden (Hervorhebungen unter den Figuren) */
  private groundG!: Phaser.GameObjects.Graphics;
  private pistol!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private legend!: Phaser.GameObjects.Container;
  private legendMode!: Phaser.GameObjects.Text;
  private legendRows: { t: Phaser.GameObjects.Text; team: string; ffa: string }[] = [];
  private feed!: Phaser.GameObjects.Text;
  private latest: WasserState | null = null;
  private hudKey = '';
  private lastSoak = 0;
  private juice!: Juice;
  private tags!: NameTags;
  private names = new Map<string, string>();
  private spots = new Map<SpotId, Spot>();
  private coverImgs: Phaser.GameObjects.Image[] = [];
  private coverBadges: Phaser.GameObjects.Image[] = [];
  /** Schilder an Deckung für die Zielvorschau („wird geblockt“) – Pool, pro Frame neu verteilt */
  private blockPool: Phaser.GameObjects.Image[] = [];
  private arrows: Phaser.GameObjects.Image[] = [];
  private tour!: Phaser.GameObjects.Container;
  private tourIcon!: Phaser.GameObjects.Image;
  private tourTitle!: Phaser.GameObjects.Text;
  private tourLine!: Phaser.GameObjects.Text;
  private tourStep = -1;
  /** Seit wann die Aufwärmrunde in dieser Szene läuft (0 = keine) */
  private warmSince = 0;
  private ffaBuilt: boolean | null = null;

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
    this.names.clear();
    this.spots.clear();
    this.coverImgs = [];
    this.coverBadges = [];
    this.blockPool = [];
    this.arrows = [];
    this.legendRows = [];
    this.tourStep = -1;
    this.warmSince = 0;
    this.ffaBuilt = null;
    this.juice = new Juice(this, { depth: 1900 });
    this.tags = new NameTags(this, 1020);

    background(this, 'wassergarden', WORLD.W, WORLD.H, (p) => paintGarden(p, W.AREA, WASSER_POOL, WASSER_HOSE));
    this.groundG = this.add.graphics().setDepth(3);

    // Deko am Rand (außerhalb der Laufwege)
    prop(this, 'w_tree1', () => O.tree(5), 8, W.AREA.y + 34).setDepth(W.AREA.y + 34);
    prop(this, 'w_tree2', () => O.fruitTree(9), 472, W.AREA.y + 34).setDepth(W.AREA.y + 34);
    prop(this, 'w_bush', () => O.bush(12, true), 70, WORLD.H + 4).setDepth(400);
    prop(this, 'w_bush2', () => O.bush(13), 410, WORLD.H + 4).setDepth(400);

    // Hecken + Liegen = Deckung: jedes Stück trägt ein kleines Schild (gleiches Symbol wie Legende und Handy)
    const shieldTex = ensureTex(this, 'w_ico_shield', shieldIcon);
    for (const r of WASSER_COVER) {
      let img: Phaser.GameObjects.Image;
      if (r.kind === 'hedge') {
        img = this.add.image(r.x - 1, r.y - 7, ensureTex(this, `w_hedge_${r.w}_${r.h}`, () => hedge(r.w, r.h, 21 + r.w))).setOrigin(0, 0).setDepth(r.y + r.h);
      } else {
        const right = r.x > 240;
        const fabric = right ? TEAM_INFO.B.color : C.orange;
        img = this.add
          .image(r.x + r.w / 2, r.y + r.h + 4, ensureTex(this, `w_lounger_${right ? 'b' : 'a'}`, () => O.deckchair(fabric)))
          .setOrigin(0.5, 1)
          .setFlipX(right)
          .setDepth(r.y + r.h);
      }
      img.setData('x0', img.x);
      this.coverImgs.push(img);
      // Hecke: Schild oben auf der Hecke, Liege: über der Lehne
      const bx = r.x + r.w / 2;
      const by = r.kind === 'hedge' ? r.y - 4 : r.y - 6;
      this.coverBadges.push(this.add.image(bx, by, shieldTex).setDepth(r.y + r.h + 1).setAlpha(0.95));
    }
    prop(this, 'w_umbrella', () => O.umbrella(C.blue), WASSER_POOL.x - 14, WASSER_POOL.y + 28).setScale(0.8);
    prop(this, 'w_umbrella2', () => O.umbrella(C.orange), WASSER_POOL.x + WASSER_POOL.w + 14, WASSER_POOL.y + 28).setScale(0.8);

    // Lager: Handtuch + Eimer
    for (const t of TEAMS) {
      const b = WASSER_BASE[t];
      const col = TEAM_INFO[t].color;
      this.add.image(b.towel.x, b.towel.y, ensureTex(this, `w_towel_${t}`, () => O.towel(col))).setDepth(b.towel.y - 20);
      this.add.ellipse(b.towel.x, b.towel.y, W.TOWEL_R * 2 + 6, W.TOWEL_R + 8, TEAM_INFO[t].colorNum, 0.15).setDepth(b.towel.y - 21);
      this.add.ellipse(b.bucket.x, b.bucket.y + 2, W.REFILL_R * 2, W.REFILL_R, WATER, 0.25).setDepth(b.bucket.y - 21);
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

    this.buildSpots(false);
    this.buildCorners();

    this.aimG = this.add.graphics().setDepth(900);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.buildLegend();
    this.banner = txt(this, WORLD.W / 2, 104, '', { size: 24, color: C.gold }).setDepth(1201);
    this.feed = txt(this, WORLD.W / 2, 88, '', { color: C.white }).setDepth(1001);
    this.buildTour();

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Schilder, Legende, Tour

  private icon(k: TourIcon | 'dropA' | 'dropB' | 'towelA' | 'towelB'): string {
    switch (k) {
      case 'drop':
        return ensureTex(this, 'w_ico_drop', () => dropIcon());
      case 'fast':
        return ensureTex(this, 'w_ico_fast', fastDropIcon);
      case 'towel':
      case 'towelA':
        return ensureTex(this, 'w_ico_towel_A', () => towelIcon(TEAM_INFO.A.color));
      case 'towelB':
        return ensureTex(this, 'w_ico_towel_B', () => towelIcon(TEAM_INFO.B.color));
      case 'shield':
        return ensureTex(this, 'w_ico_shield', shieldIcon);
      case 'sun':
        return ensureTex(this, 'w_ico_sun', sunIcon);
      case 'pistol':
        return ensureTex(this, 'w_pistol', waterPistol);
      default:
        return ensureTex(this, 'w_ico_drop', () => dropIcon());
    }
  }

  /** Dunkles Schildchen: Symbol + kurzer Text, Rand in Team- bzw. Ortsfarbe */
  private pill(icon: string, label: string, edge: number, iconScale = 1, color = '#fff4d6') {
    const t = txt(this, 0, 0, label, { shadow: false, color }).setScale(0.5).setOrigin(0, 0.5);
    const ico = this.add.image(0, 0, icon).setOrigin(0, 0.5).setScale(iconScale);
    const w = Math.ceil(3 + ico.displayWidth + 2 + t.displayWidth + 3);
    const h = Math.ceil(Math.max(ico.displayHeight, 6) + 2);
    const g = this.add.graphics();
    g.fillStyle(0x2d1b12, 0.9).fillRect(-w / 2, -h / 2, w, h);
    g.lineStyle(1, edge, 1).strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
    ico.setPosition(-w / 2 + 3, 0);
    t.setPosition(-w / 2 + 3 + ico.displayWidth + 2, 0.5);
    return { parts: [g, ico, t] as Phaser.GameObjects.GameObject[], w, h };
  }

  private addSpot(id: SpotId, gx: number, gy: number, by: number, icon: string, label: string, edge: number, ring: [number, number], iconScale = 1, color?: string) {
    this.spots.get(id)?.c.destroy();
    const { parts, w } = this.pill(icon, label, edge, iconScale, color);
    const bx = clamp(gx, w / 2 + 2, WORLD.W - w / 2 - 2);
    const c = this.add.container(bx, by, parts).setDepth(1010);
    this.spots.set(id, { c, bx, by, gx, gy, rx: ring[0], ry: ring[1], col: edge, phase: Math.random() * 6 });
  }

  /** Schilder über Eimer, Schlauch und Handtuch – bei Jeder-gegen-jeden ohne Teamfarbe (alle dürfen überall hin) */
  private buildSpots(ffa: boolean) {
    this.ffaBuilt = ffa;
    for (const t of TEAMS) {
      const b = WASSER_BASE[t];
      // Team-Lager: Rand und Schrift in Teamfarbe – nur dieses Team füllt hier auf bzw. trocknet hier ab
      const edge = ffa ? WATER : TEAM_INFO[t].colorNum;
      const ink = ffa ? undefined : t === 'A' ? '#ffd25e' : '#9fd0ff';
      this.addSpot(`bucket${t}`, b.bucket.x, b.bucket.y, b.bucket.y - 23, this.icon('drop'), 'AUFFÜLLEN', edge, [W.REFILL_R * 2 + 6, W.REFILL_R + 6], 1, ink);
      this.addSpot(`towel${t}`, b.towel.x, b.towel.y, b.towel.y - 21, this.icon(`towel${t}`), 'TROCKNEN', edge, [W.TOWEL_R * 2 + 8, W.TOWEL_R + 10], 1, ink);
    }
    // Unter dem Schlauch: wer dort auffüllt, hat sein Namensschild oben – so verdeckt das Schild niemanden
    this.addSpot('hose', WASSER_HOSE.x, WASSER_HOSE.y, WASSER_HOSE.y + 27, this.icon('fast'), 'SCHNELL AUFFÜLLEN', WATER, [W.HOSE_R * 2 + 4, W.HOSE_R + 4]);
    this.addSpot('pistol', 0, 0, 0, this.icon('pistol'), 'WASSERPISTOLE', 0xf0973a, [22, 12], 0.75);
    this.spots.get('pistol')!.c.setVisible(false);
  }

  /** Dauer-Legende in den Terrassen-Ecken: Sonne trocknet · Hecke/Liege = Deckung */
  private buildCorners() {
    const make = (icon: string, label: string, edge: number, left: boolean) => {
      const { parts, w } = this.pill(icon, label, edge);
      this.add.container(left ? 4 + w / 2 : WORLD.W - 4 - w / 2, 14, parts).setDepth(999);
    };
    make(this.icon('sun'), 'SONNE TROCKNET DICH', 0xffd25e, true);
    make(this.icon('shield'), 'HECKE/LIEGE = DECKUNG', 0x9be37b, false);
  }

  /** Legende zum Countdown: alle Elemente mit denselben Symbolen wie die Schilder */
  private buildLegend() {
    const L = this.add.container(0, 0).setDepth(1200).setVisible(false);
    const X = 20;
    const Y = 62;
    L.add(panel(this, X, Y, 440, 142, 'dark'));
    this.legendMode = txt(this, WORLD.W / 2, Y + 34, '', { color: C.gold });
    L.add(this.legendMode);
    const rows: { icon: TourIcon | 'towelA'; title: string; team: string; ffa?: string }[] = [
      { icon: 'drop', title: 'EIMER', team: 'auffüllen – nur dein Team', ffa: 'auffüllen – an jedem Eimer' },
      { icon: 'fast', title: 'SCHLAUCH', team: 'auffüllen, fast 3× schneller' },
      { icon: 'towelA', title: 'KLATSCHNASS?', team: 'ab zum eigenen Handtuch', ffa: 'ab zu einem Handtuch' },
      { icon: 'shield', title: 'HECKE + LIEGE', team: 'Deckung – fängt Bomben ab' },
      { icon: 'sun', title: 'SONNE', team: 'trocknet dich langsam' },
      { icon: 'pistol', title: 'WASSERPISTOLE', team: 'drüberlaufen: 6 s Strahl' },
    ];
    rows.forEach((r, i) => {
      const cx = X + 16 + (i >= 3 ? 214 : 0);
      const cy = Y + 54 + (i % 3) * 24;
      L.add(this.add.image(cx + 8, cy + 7, this.icon(r.icon)));
      L.add(txt(this, cx + 22, cy, r.title, { color: C.gold, origin: [0, 0] }));
      const t = fitAt(txt(this, cx + 22, cy + 11, r.team, { origin: [0, 0] }), 186, 0.75);
      L.add(t);
      this.legendRows.push({ t, team: r.team, ffa: r.ffa ?? r.team });
    });
    L.add(fitAt(txt(this, WORLD.W / 2, Y + 128, 'Links laufen · rechts zielen, loslassen = Wurf', { color: '#c9b998' }), 420, 0.75));
    this.legend = L;
  }

  /** Aufwärm-Tour (nur in der Aufwärmrunde): Leiste unter der AUFWÄRMEN-Leiste, Pfeile zeigen auf die Orte */
  private buildTour() {
    const T = this.add.container(0, 0).setDepth(1300).setVisible(false);
    T.add(panel(this, 58, 35, 364, 30, 'dark'));
    this.tourIcon = this.add.image(76, 50, this.icon('drop')).setScale(1.5);
    this.tourTitle = txt(this, 94, 40, '', { color: C.gold, origin: [0, 0] });
    this.tourLine = txt(this, 94, 52, '', { origin: [0, 0] });
    T.add([this.tourIcon, this.tourTitle, this.tourLine]);
    this.tour = T;
    for (let i = 0; i < 8; i++) this.arrows.push(this.add.image(0, 0, ensureTex(this, 'w_arrow', () => downArrow())).setDepth(1305).setVisible(false));
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'wasser') return;
    const st = s.mini.state;
    this.latest = st;
    const now = this.time.now;
    const warm = isWarmup(s);
    if (warm && !this.warmSince) this.warmSince = now;
    if (!warm) this.warmSince = 0;
    if (this.ffaBuilt !== st.ffa) {
      this.buildSpots(st.ffa);
      for (const r of this.legendRows) fitAt(r.t.setText(st.ffa ? r.ffa : r.team), 186, 0.75);
    }

    // Figuren
    for (const [id, p] of Object.entries(st.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      this.names.set(id, pl.name);
      const bar = this.add.graphics();
      const gun = this.add.image(7, -9, ensureTex(this, 'w_pistol', waterPistol)).setScale(0.75).setVisible(false);
      const towel = this.add.image(0, -33, this.icon(p.t === 'B' ? 'towelB' : 'towelA')).setVisible(false);
      const shield = this.add.image(-13, -22, this.icon('shield')).setScale(0.75).setVisible(false);
      const sun = this.add.image(14, 4.5, this.icon('sun')).setScale(0.5).setVisible(false);
      f.add([bar, gun, towel, shield, sun]);
      this.figs.set(id, { f, img, bar, gun, towel, shield, sun, x: p.x, y: p.y, barKey: '', dripAt: 0, steamAt: 0, status: p.s, ammo: p.a, pistol: p.pi > 0 });
    }

    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      // Klatschnass und nicht selbst zum Handtuch geschafft → hingetragen: Figur springt, kleine Staubwolke
      if (a.status === 'soaked' && p.s === 'drying' && Math.hypot(p.x - a.x, p.y - a.y) > 24) {
        this.juice.burst(a.x, a.y - 4, 'puff', 8);
        a.x = p.x;
        a.y = p.y;
        this.juice.burst(p.x, p.y - 4, 'puff', 10);
        sfx('whoosh', { x: p.x, vol: 0.5 });
      }
      // Nachgefüllt: +1 über der Figur, leises Plopp
      if (a.status === 'ok' && p.s === 'ok' && p.a > a.ammo) {
        const t = txt(this, a.x, a.y - 50, '+1', { color: '#9fe0ff' }).setScale(0.75).setDepth(2000);
        this.tweens.add({ targets: t, y: t.y - 8, alpha: 0, duration: 650, onComplete: () => t.destroy() });
        sfx('pop', { x: p.x, vol: 0.35, pitch: 1.3 + p.a * 0.12 });
      }
      // Wasserpistole aufgehoben
      if (!a.pistol && p.pi > 0) {
        this.juice.float(a.x, a.y - 50, 'WASSERPISTOLE!', '#ffb867');
        sfx('powerup', { x: p.x, vol: 0.6 });
      }
      a.status = p.s;
      a.ammo = p.a;
      a.pistol = p.pi > 0;
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
      sfx('throw', { x: b.fx, vol: 0.5 });
      const shadow = this.add.ellipse(b.fx, b.fy + 8, 6, 2, 0x000000, 0.25).setDepth(5);
      this.balloons.set(b.id, { img, shadow, b, recv: now });
    }

    // Platscher
    for (const sp of st.splashes) {
      if (this.seenSplash.has(sp.id)) continue;
      this.seenSplash.add(sp.id);
      this.splash(sp.x, sp.y, sp.big, sp.c);
      if (sp.cover) this.blocked(sp.x, sp.y);
      sfx('splash', { x: sp.x, vol: sp.big ? 0.9 : 0.55, pitch: sp.big ? 0.9 : 1.2 });
      this.juice.burst(sp.x, sp.y - 2, 'splash', sp.big ? 12 : 6);
      if (sp.big) this.juice.shake(1);
    }
    if (this.seenSplash.size > 400) this.seenSplash = new Set([...this.seenSplash].slice(-100));

    // Wasserpistole + ihr Schild
    this.pistol.setVisible(!!st.pistol);
    const ps = this.spots.get('pistol')!;
    ps.c.setVisible(!!st.pistol);
    if (st.pistol) {
      this.pistol.setPosition(st.pistol.x, st.pistol.y).setDepth(st.pistol.y);
      ps.gx = st.pistol.x;
      ps.gy = st.pistol.y;
      ps.bx = clamp(st.pistol.x, 34, WORLD.W - 34);
      ps.by = st.pistol.y > WASSER_HOSE.y ? st.pistol.y + 15 : st.pistol.y - 17;
    }

    // Klatschnass-Meldung
    if (st.lastSoak && st.lastSoak.seq !== this.lastSoak) {
      this.lastSoak = st.lastSoak.seq;
      const v = st.players[st.lastSoak.victim];
      const name = playerById(st.lastSoak.victim)?.name ?? '?';
      const by = st.lastSoak.by ? playerById(st.lastSoak.by)?.name : null;
      this.feed.setText(`${name} ist klatschnass!${by ? ` (${by})` : ''}`).setAlpha(1);
      this.tweens.killTweensOf(this.feed);
      this.tweens.add({ targets: this.feed, alpha: 0, delay: 2200, duration: 500 });
      // Klatschnass: lauter Platscher, kurzer Stopp, Gejohle
      sfx('splash', { x: v?.x, pitch: 0.7 });
      sfx('ko', { x: v?.x, vol: 0.5, delay: 0.08 });
      sfx('cheer', { vol: 0.5, delay: 0.15 });
      this.juice.hitStop(70);
      this.juice.shake(2);
      if (v) {
        this.juice.burst(v.x, v.y - 12, 'splash', 18);
        const t = txt(this, v.x, v.y - 52, 'KLATSCHNASS!', { color: '#9fe0ff' }).setDepth(2000);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1300, onComplete: () => t.destroy() });
      }
    }

    // Banner + Legende (in der Aufwärmrunde erklärt die Tour, dort nur die Zahl)
    const legend = st.sub === 'countdown' && !warm;
    this.legend.setVisible(legend);
    if (st.sub === 'countdown') {
      this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000)))).setY(legend ? 66 : 104);
      this.legendMode.setText(st.ffa ? 'Jeder gegen jeden!' : 'Team Sonne gegen Team Meer!');
    } else if (st.sub === 'play') {
      this.banner.setText('');
    } else {
      const end = st.endReason === 'away' ? 'Spielende!' : 'Zeit um!';
      if (this.banner.text !== end) sfx('whistle');
      this.banner.setText(end).setY(104);
    }

    // HUD
    const key = JSON.stringify([Math.ceil(st.endsIn / 1000), st.score, st.ffa ? Object.values(st.players).map((p) => p.k) : 0]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 120, 1, 240, 26));
    if (st.ffa) {
      Object.entries(st.players).forEach(([id, p], i) => {
        const name = tagName(playerById(id)?.name ?? '?');
        this.hud.add(fitText(ink(this, 130 + i * 62, 10, `${name} ${p.k}`, { color: hex(p.c), origin: [0, 0] }), 58, 0.5));
      });
      this.hud.add(ink(this, 350, 10, mmss(st.endsIn), { origin: [1, 0] }));
    } else {
      this.hud.add(ink(this, 132, 10, `Sonne ${st.score.A}`, { color: SUN_INK, origin: [0, 0] }));
      this.hud.add(ink(this, WORLD.W / 2, 10, mmss(st.endsIn)));
      this.hud.add(ink(this, 348, 10, `${st.score.B} Meer`, { color: BLUE_INK, origin: [1, 0] }));
    }
  }

  private splash(x: number, y: number, big: boolean, color: number) {
    const ring = this.add.ellipse(x, y, 6, 3, WATER, 0.9).setDepth(y + 1);
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
    }
  }

  /** Bombe an Hecke/Liege abgeprallt: Deckung wackelt, Blätter/Splitter fliegen, Schild + „GEBLOCKT!“ */
  private blocked(x: number, y: number) {
    let best = -1;
    let bd = Infinity;
    WASSER_COVER.forEach((r, i) => {
      const d = Math.hypot(x - clamp(x, r.x, r.x + r.w), y - clamp(y, r.y, r.y + r.h));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && bd < 8) {
      const img = this.coverImgs[best];
      const x0 = img.getData('x0') as number;
      this.tweens.killTweensOf(img);
      img.x = x0;
      this.tweens.add({ targets: img, x: x0 + 1.5, duration: 45, yoyo: true, repeat: 3, onComplete: () => img.setX(x0) });
      const hedgeHit = WASSER_COVER[best].kind === 'hedge';
      const cols = hedgeHit ? [0x3f8a32, 0x5fae42, 0x2e6b26] : [0xc98a10, 0xeaf8ff, 0xa5602a];
      for (let i = 0; i < 7; i++) {
        const d = this.add.rectangle(x, y - 3, 2, 2, cols[i % cols.length]).setDepth(y + 3);
        this.tweens.add({ targets: d, x: x + (Math.random() - 0.5) * 22, y: y - 4 - Math.random() * 12, angle: 180, alpha: 0, duration: 500 + Math.random() * 200, ease: 'Quad.easeOut', onComplete: () => d.destroy() });
      }
      const badge = this.coverBadges[best];
      this.tweens.add({ targets: badge, scale: 1.6, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
    }
    const sh = this.add.image(x, y - 10, this.icon('shield')).setDepth(2000).setScale(0.2);
    this.tweens.add({ targets: sh, scale: 1.3, duration: 160, ease: 'Back.Out' });
    this.tweens.add({ targets: sh, y: sh.y - 6, alpha: 0, delay: 500, duration: 400, onComplete: () => sh.destroy() });
    const t = txt(this, x, y - 30, 'GEBLOCKT!', { color: '#c8f0c0' }).setDepth(2000).setScale(0.75);
    this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, delay: 250, duration: 750, onComplete: () => t.destroy() });
    sfx('bonk', { x, vol: 0.45, pitch: 1.3 });
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    const g = this.aimG;
    const gg = this.groundG;
    g.clear();
    gg.clear();
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const play = st.sub === 'play';
    const players = Object.entries(st.players);

    // Wer braucht gerade welchen Ort? → dessen Schild pulsiert, Ring am Boden
    const hot = new Set<SpotId>();
    const sides = (p: WasserPlayer): Team[] => (p.t ? [p.t] : TEAMS);
    if (play) {
      for (const [, p] of players) {
        if (p.away) continue;
        if (p.s === 'ok' && p.a === 0 && p.pi === 0) {
          hot.add('hose');
          for (const t of sides(p)) hot.add(`bucket${t}`);
        }
        if (p.s === 'soaked') for (const t of sides(p)) hot.add(`towel${t}`);
      }
    }

    // Aufwärm-Tour
    const tourOn = !!this.warmSince && now - this.warmSince > TOUR_DELAY_MS && st.sub !== 'over';
    this.tour.setVisible(tourOn);
    let step: (typeof TOUR)[number] | null = null;
    if (tourOn) {
      const i = Math.floor((now - this.warmSince - TOUR_DELAY_MS) / TOUR_STEP_MS) % TOUR.length;
      step = TOUR[i];
      if (i !== this.tourStep) {
        this.tourStep = i;
        this.tourIcon.setTexture(this.icon(step.icon));
        this.tourTitle.setText(step.title);
        fitAt(this.tourTitle, 318, 1, 0.75);
        fitAt(this.tourLine.setText(step.line), 318, 0.75);
        this.tour.setAlpha(0);
        this.tweens.add({ targets: this.tour, alpha: 1, duration: 200 });
        sfx('select', { vol: 0.3, pitch: 1.2 });
      }
    }
    const tourSpots = new Set<SpotId>(step?.spots ?? []);
    if (step?.pistol && st.pistol) tourSpots.add('pistol');
    let arrowN = 0;
    const arrowAt = (x: number, y: number) => {
      const a = this.arrows[arrowN++];
      if (a) a.setVisible(true).setPosition(x, y - 2 - Math.abs(Math.sin(now / 180)) * 4);
    };

    // Schilder wippen; pulsieren, wenn jemand sie braucht; durchsichtig, wenn eine Figur darunter steht
    for (const [id, s] of this.spots) {
      if (!s.c.visible) continue;
      const isHot = hot.has(id) || tourSpots.has(id) || (id === 'pistol' && play);
      const y = s.by + Math.sin(now / 450 + s.phase) * 1.5;
      s.c.setPosition(s.bx, Math.round(y * 2) / 2).setScale(isHot ? 1 + 0.12 * pulse : 1);
      const near = players.some(([fid]) => {
        const a = this.figs.get(fid);
        return a && Math.abs(a.x - s.bx) < 30 && a.y - 30 < s.by + 6 && a.y > s.by - 4;
      });
      s.c.setAlpha(near ? 0.45 : isHot ? 1 : 0.85);
      if (isHot) {
        gg.lineStyle(2, s.col, 0.35 + 0.5 * pulse).strokeEllipse(s.gx, s.gy + 2, s.rx, s.ry);
        gg.fillStyle(s.col, 0.12 * pulse).fillEllipse(s.gx, s.gy + 2, s.rx, s.ry);
      }
      if (tourSpots.has(id)) arrowAt(s.bx, s.by - 11);
    }
    // Tour: Deckung hervorheben (Umriss + Schilder größer) bzw. die Orte, an denen die Pistole auftaucht
    for (let i = 0; i < this.coverBadges.length; i++) {
      const b = this.coverBadges[i];
      if (!this.tweens.isTweening(b)) b.setScale(step?.covers ? 1 + 0.25 * pulse : 1);
    }
    if (step?.covers) {
      for (const r of WASSER_COVER) g.lineStyle(1, 0xc8f0c0, 0.4 + 0.5 * pulse).strokeRect(r.x - 2.5, r.y - 8.5, r.w + 5, r.h + (r.kind === 'hedge' ? 11 : 13));
      for (const i of [1, 5, 2, 6]) arrowAt(WASSER_COVER[i].x + WASSER_COVER[i].w / 2, WASSER_COVER[i].y - 15);
    }
    if (step?.pistol && !st.pistol) {
      for (const sp of WASSER_PISTOL_SPOTS) gg.lineStyle(1, 0xf0973a, 0.3 + 0.5 * pulse).strokeEllipse(sp.x, sp.y + 2, 18, 9);
    }
    for (let i = arrowN; i < this.arrows.length; i++) this.arrows[i].setVisible(false);

    // Figuren
    const tagSpecs: { id: string; x: number; y: number; name: string; color: string; dot?: number; alpha?: number }[] = [];
    const shielded = new Set<string>();
    let blockN = 0;
    for (const [id, p] of players) {
      const a = this.figs.get(id);
      if (!a) continue;
      a.x += (p.x - a.x) * 0.35;
      a.y += (p.y - a.y) * 0.35;
      tagSpecs.push({ id, x: a.x, y: a.y - 42, name: this.names.get(id) ?? '?', color: pcol(id).hex, dot: p.c, alpha: p.s === 'ok' ? 1 : 0.75 });

      a.img.setFlipX(p.d < 0);
      a.f.play(p.s === 'soaked' ? 'hit' : p.m ? 'walk' : 'idle');
      a.f.setPosition(a.x, a.y + 4).setDepth(a.y + 4);
      // Nass = bläulich, Abtrocknen = gelblich
      if (p.s === 'soaked') a.img.setTint(0x8fc4ff);
      else if (p.s === 'drying') a.img.setTint(0xfff0b0);
      else if (p.w > 60) a.img.setTint(0xc8e2ff);
      else a.img.clearTint();
      // away = Verbindung weg (eingefroren, unverwundbar)
      a.f.setAlpha(p.away ? 0.4 : p.s === 'ok' || Math.floor(now / 200) % 2 ? 1 : 0.75);
      a.gun.setVisible(p.pi > 0).setFlipX(p.d < 0).setX(p.d < 0 ? -7 : 7);
      // Klatschnass/abtrocknen: Handtuch über dem Kopf statt Munition
      const towel = p.s !== 'ok';
      a.towel.setVisible(towel).setY(-34 + Math.sin(now / 200) * 1.2);
      // Leer: die leeren Ballons blinken rot (am Handy steht, wo es Nachschub gibt)
      const empty = p.s === 'ok' && p.a === 0 && p.pi === 0 && play;
      const blinkOff = empty && Math.floor(now / 300) % 2 === 1;
      a.sun.setVisible(!!p.dr && p.s === 'ok');

      // Munition (Ballons, der nächste füllt sich beim Nachfüllen von unten) + Nässe-Balken
      const rf = p.rf ? Math.round(p.rf * 4) : 0;
      const barKey = `${p.s}-${p.w}-${p.a}-${p.dp}-${rf}-${p.w >= 70 ? Math.floor(now / 250) % 2 : 0}-${empty}-${blinkOff}`;
      if (barKey !== a.barKey) {
        a.barKey = barKey;
        const bar = a.bar;
        bar.clear();
        bar.fillStyle(0x2d1b12, 1).fillRect(-10, 2, 20, 5);
        bar.fillStyle(0x5a4632, 1).fillRect(-9, 3, 18, 3);
        if (p.s === 'drying') bar.fillStyle(0xffd25e, 1).fillRect(-9, 3, Math.round(18 * p.dp), 3);
        else {
          const blink = p.w >= 70 && Math.floor(now / 250) % 2 === 0;
          bar.fillStyle(p.w >= 100 ? 0x2b6ba6 : blink ? 0xeaf8ff : p.w >= 70 ? 0x3f8fe0 : WATER, 1).fillRect(-9, 3, Math.round((18 * p.w) / 100), 3);
        }
        if (!towel) {
          for (let i = 0; i < W.MAX_AMMO; i++) {
            const x = -8 + i * 6;
            const y = -35;
            bar.fillStyle(0x2d1b12, 1).fillRect(x, y + 1, 5, 4).fillRect(x + 1, y, 3, 6).fillRect(x + 2, y + 6, 1, 1);
            bar.fillStyle(empty && !blinkOff ? 0xe0603e : 0x7a5a3a, 1).fillRect(x + 1, y + 1, 3, 4);
            if (i < p.a) {
              bar.fillStyle(p.c, 1).fillRect(x + 1, y + 1, 3, 4);
              bar.fillStyle(0xffffff, 0.8).fillRect(x + 1, y + 1, 1, 1);
            } else if (i === p.a && rf > 0) bar.fillStyle(WATER, 1).fillRect(x + 1, y + 5 - rf, 3, rf);
          }
        }
      }
      // Tropfen bei Klatschnassen, Dampf, wenn die Sonne trocknet
      if (p.s === 'soaked' && now > a.dripAt) {
        a.dripAt = now + 140;
        const d = this.add.rectangle(a.x - 5 + Math.random() * 10, a.y - 16 + Math.random() * 10, 1, 2, WATER).setDepth(a.y + 6);
        this.tweens.add({ targets: d, y: d.y + 10, alpha: 0, duration: 400, onComplete: () => d.destroy() });
      }
      if (p.dr && p.s === 'ok' && now > a.steamAt) {
        a.steamAt = now + 320;
        const d = this.add.rectangle(a.x - 5 + Math.random() * 10, a.y - 18 + Math.random() * 6, Math.random() < 0.5 ? 1 : 2, 1, 0xf4f1e6, 0.85).setDepth(a.y + 6);
        this.tweens.add({ targets: d, y: d.y - 9, x: d.x + (Math.random() - 0.5) * 4, alpha: 0, duration: 750, onComplete: () => d.destroy() });
      }
      // Frisch abgetrocknet: kurz geschützt (Blase)
      if (p.pr) g.lineStyle(1, 0xeaf8ff, 0.35 + 0.4 * pulse).strokeEllipse(a.x, a.y - 9, 22, 30);

      // Klatschnass: gestrichelte Spur zum eigenen Handtuch (wer nicht hinläuft, wird nach SOAKED_AUTO_MS hingetragen)
      if (p.s === 'soaked' && play) {
        const towelAt = sides(p)
          .map((t) => WASSER_BASE[t].towel)
          .reduce((u, v) => (Math.hypot(a.x - u.x, a.y - u.y) <= Math.hypot(a.x - v.x, a.y - v.y) ? u : v));
        const dist = Math.hypot(towelAt.x - a.x, towelAt.y - a.y);
        if (dist > W.TOWEL_R) {
          const n = Math.max(2, Math.floor(dist / 9));
          const shift = (now / 260) % 1;
          for (let i = 0; i < n; i++) {
            const t = (i + shift) / n;
            const x = Math.round(a.x + (towelAt.x - a.x) * t);
            const y = Math.round(a.y + (towelAt.y - a.y) * t);
            g.fillStyle(0x2d1b12, 0.6).fillRect(x - 1, y - 1, 3, 3);
            g.fillStyle(WATER, 0.9).fillRect(x, y, 1, 1);
          }
          // Ring zeigt, wie lange es noch bis zum Hintragen dauert
          const k = clamp(p.sk / W.SOAKED_AUTO_MS, 0, 1);
          g.lineStyle(2, p.c, 0.5 + 0.4 * Math.abs(Math.sin(now / 180))).strokeEllipse(towelAt.x, towelAt.y, W.TOWEL_R * 2 + 8, W.TOWEL_R + 10);
          if (k > 0) {
            g.lineStyle(2, 0x2d1b12, 0.8).beginPath();
            g.arc(a.x + 11, a.y - 20, 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).strokePath();
          }
        }
      }

      // Zielvorschau
      const len = Math.hypot(p.ax, p.ay);
      if (p.s !== 'ok' || p.away || len < W.AIM_MIN) continue;
      const fx = a.x;
      const fy = a.y - 8;
      if (p.pi > 0) {
        // Wasserpistole: Strahl endet an der ersten Deckung
        const ux = p.ax / len;
        const uy = p.ay / len;
        let L = W.PISTOL_RANGE;
        for (const r of WASSER_COVER) {
          const t = segHitsRect(p.x, p.y, p.x + ux * W.PISTOL_RANGE, p.y + uy * W.PISTOL_RANGE, r);
          if (t !== null) L = Math.min(L, t * W.PISTOL_RANGE);
        }
        const ex = fx + ux * L;
        const ey = fy + 6 * (L / W.PISTOL_RANGE) + uy * L;
        g.lineStyle(3, WATER, 0.85).lineBetween(fx, fy, ex, ey);
        g.lineStyle(1, 0xeaf8ff, 1).lineBetween(fx, fy, ex, ey);
        for (let i = 0; i < 4; i++) {
          const t = ((now / 300 + i / 4) % 1) * 1.05;
          g.fillStyle(0xeaf8ff, 1).fillRect(fx + (ex - fx) * t - 1 + Math.sin(i * 7 + now / 50), fy + (ey - fy) * t + Math.cos(i * 5 + now / 60), 2, 2);
        }
        if (L < W.PISTOL_RANGE - 1) this.blockIcon(blockN++, ex, ey - 2);
        for (const [oid, o] of players) {
          if (oid === id || (!st.ffa && o.t === p.t) || o.s !== 'ok') continue;
          const dx = o.x - p.x;
          const dy = o.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < W.PISTOL_RANGE && d > 1 && (dx * ux + dy * uy) / d > Math.cos(W.PISTOL_CONE) && d > L) shielded.add(oid);
        }
        continue;
      }
      // Dieselbe Rechnung wie der Server beim Wurf (shared/wasser.ts): Ziel, Aufschlag, Deckung dazwischen
      const l = aimLanding(p);
      const { x: tx, y: ty } = l.target;
      const dist = Math.hypot(tx - p.x, ty - p.y);
      const h = 10 + dist * 0.3;
      const col = p.a > 0 ? p.c : 0x7a5a3a;
      const steps = Math.max(3, Math.round(dist / 7));
      const shift = (now / 90) % 1;
      // Geblockt: Bahn nur bis zur Deckung (gleiche Parametrisierung wie throwLanding: ab 60 % der Strecke)
      const tStop = l.cover ? clamp(Math.hypot(l.x - fx, l.y - fy) / Math.max(1, Math.hypot(tx - fx, ty - fy)), 0, 1) : 1;
      for (let i = 0; i < steps; i++) {
        const t = (i + shift) / steps;
        if (t <= 0.04 || t > tStop) continue;
        const x = Math.round(fx + (tx - fx) * t);
        const y = Math.round(fy + (ty - fy) * t - Math.sin(Math.PI * t) * h);
        g.fillStyle(0x2d1b12, 0.85).fillRect(x - 2, y - 2, 4, 4);
        g.fillStyle(col, 1).fillRect(x - 1, y - 1, 2, 2);
      }
      if (l.cover) {
        // Ziel dahinter nur angedeutet, an der Deckung ein Schild: „das wird geblockt“
        g.lineStyle(1, 0x2d1b12, 0.35).strokeEllipse(tx, ty, W.SPLASH_R * 2, W.SPLASH_R);
        this.blockIcon(blockN++, l.x, l.y - 4);
      } else {
        g.lineStyle(1, col, 0.9).strokeEllipse(tx, ty, W.SPLASH_R * 2, W.SPLASH_R);
        g.fillStyle(col, 0.18).fillEllipse(tx, ty, W.SPLASH_R * 2, W.SPLASH_R);
        g.lineStyle(1, 0x2d1b12, 0.8).strokeEllipse(tx, ty, W.DIRECT_R * 2, W.DIRECT_R);
      }
      // Wen die Deckung gerade rettet: Schild an der Figur
      for (const [oid, o] of players) {
        if (oid === id || (!st.ffa && o.t === p.t) || o.s !== 'ok') continue;
        if (coverSaves(l, o)) shielded.add(oid);
      }
    }
    for (let i = blockN; i < this.blockPool.length; i++) this.blockPool[i].setVisible(false);
    for (const [id, a] of this.figs) a.shield.setVisible(shielded.has(id)).setAlpha(0.6 + 0.4 * pulse);
    this.tags.update(tagSpecs);

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

  /** Schild an der Deckung in der Zielvorschau (Pool) */
  private blockIcon(i: number, x: number, y: number) {
    let img = this.blockPool[i];
    if (!img) {
      img = this.add.image(0, 0, this.icon('shield')).setDepth(960);
      this.blockPool.push(img);
    }
    img.setVisible(true).setPosition(Math.round(x), Math.round(y));
  }
}
