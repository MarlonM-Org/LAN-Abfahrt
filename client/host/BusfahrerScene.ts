import Phaser from 'phaser';
import type { GameState, Look } from '../../shared/types';
import { AV_W } from '../../shared/avatar';
import { WORLD } from '../../shared/flunky';
import { cardLabel } from '../../shared/games';
import { BUS_TIPP_TEXT, type BusCard, type BusState, busCardSpoken, busFrageText, busRankArtikel, busRed, busSchluecke, sipText } from '../../shared/busfahrer';
import { C } from '../art/palette';
import { Pix, rng } from '../art/pix';
import { bus as stateBus, getState, playerById } from './store';
import { avatarSprite, playAvatar } from './textures';
import { pcol } from './playerColor';
import { GOLD, GREEN_INK, INK, RED_INK, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

/*
 * Busfahrer (MiniKind `hilo`) am TV: Oben links die Kartenreihe (vier verdeckte Karten), oben rechts Frage bzw.
 * Auflösung, darunter fährt ein Doppeldecker durch die Landschaft – alle Spieler sitzen an den Fenstern
 * (oben/unten je 6 Plätze), vorne der Busfahrer. Straße und Kulisse scrollen, der Bus ruckelt.
 */

// ------------------------------------------------------------------ Maße

const BUS_X = 30;
const BUS_Y = 116;
const BW = 420;
const BH = 124;
const COLS = 6;
const WIN_X0 = 10;
const PITCH = 59;
const WIN_W = 49;
const WIN_H = 36;
const UP_Y = 14;
const LOW_Y = 66;
/** Fahrerfenster vorne unten, Panoramafenster vorne oben */
const DRV = { x: 368, w: 44 };
const WHEEL_X = [78, 360];
const ROAD_Y = 232;

const CARD_W = 44;
const CARD_H = 62;
const CARD_Y = 61;
const cardX = (i: number, n: number) => 107 + (i - (n - 1) / 2) * (CARD_W + 8);

const PANEL = { x: 214, y: 4, w: 262, h: 106 };
const PX = PANEL.x + PANEL.w / 2;

/** Der Busfahrer selbst: Schnauzer und Mütze */
const DRIVER_LOOK: Look = { skin: 1, hair: 6, hairStyle: 3, shirt: 1, beard: 3 };

const winX = (col: number) => WIN_X0 + col * PITCH;

/** Plätze im Bus: oben ceil(n/2), unten der Rest – jeweils gleichmäßig über die 6 Fenster verteilt */
function seatSlots(n: number): { deck: 0 | 1; col: number }[] {
  const up = Math.ceil(n / 2);
  const spread = (k: number) => Array.from({ length: k }, (_, j) => Math.min(COLS - 1, Math.floor(((j + 0.5) * COLS) / k)));
  return [...spread(up).map((col) => ({ deck: 0 as const, col })), ...spread(n - up).map((col) => ({ deck: 1 as const, col }))];
}

// ------------------------------------------------------------------ Pixel-Art

function paintSky(p: Pix) {
  const sky = ['#5fb4ea', '#6cbcec', '#7ac4ef', '#89ccf1', '#99d4f3', '#aadcf4', '#bce3f4', '#cfe9f1', '#e2eee9'];
  const band = Math.ceil(170 / sky.length);
  sky.forEach((c, i) => p.rect(0, i * band, WORLD.W, band, c));
  p.rect(0, 170, WORLD.W, WORLD.H - 170, '#e2eee9');
  // Sonne + ein paar Wolken
  p.disc(452, 128, 14, '#fff1b0');
  p.disc(452, 128, 11, '#ffe27a');
  const cloud = (x: number, y: number, w: number) => {
    p.ellipse(x, y, w, 5, '#ffffff').ellipse(x - w / 3, y - 3, w / 2, 5, '#ffffff').ellipse(x + w / 4, y - 4, w / 2.5, 5, '#ffffff');
  };
  cloud(26, 112, 18);
  cloud(470, 104, 14);
}

/** Ferne Hügel mit Dörfern (kachelbar, 480 breit) */
function paintFar(p: Pix) {
  const r = rng(5150);
  const h = p.h;
  for (let x = 0; x < p.w; x++) {
    const y = 30 + Math.round(Math.sin((x / p.w) * Math.PI * 4) * 8 + Math.sin((x / p.w) * Math.PI * 10) * 3);
    p.vline(x, y, h - y, '#8fc56a');
    const y2 = 48 + Math.round(Math.sin((x / p.w) * Math.PI * 6 + 1) * 6);
    p.vline(x, y2, h - y2, '#79b356');
  }
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 52 + Math.floor(r() * 18);
    const y = 52 + Math.floor(r() * 6);
    const col = ['#e8d8c0', '#f4efe2', '#e0c8a8'][i % 3];
    p.rect(x, y, 10, 7, col).rect(x - 1, y - 3, 12, 3, C.roof).px(x + 3, y + 3, '#6b7a99').px(x + 6, y + 3, '#6b7a99');
  }
}

/** Kulisse direkt hinter dem Bus: Palmen, Büsche, Laternen (kachelbar) */
function paintMid(p: Pix) {
  const r = rng(5151);
  const base = p.h - 2;
  const palm = (x: number, hgt: number) => {
    for (let y = 0; y < hgt; y++) p.rect(x + Math.round(Math.sin(y / 9) * 2), base - y, 3, 1, y % 4 ? C.trunk : C.trunkDark);
    const tx = x + Math.round(Math.sin(hgt / 9) * 2) + 1;
    const ty = base - hgt;
    for (let k = -14; k <= 14; k++) {
      const yy = ty + Math.round((k * k) / 22);
      p.rect(tx + k, yy, 1, 2, Math.abs(k) % 5 ? C.leaf : C.leafDark);
    }
    for (let k = -8; k <= 8; k++) p.rect(tx + k, ty - 2 + Math.round((k * k) / 14) - 2, 1, 2, C.leafLight);
    p.disc(tx - 1, ty + 1, 2, '#7a4a26').disc(tx + 2, ty + 2, 2, '#7a4a26');
  };
  const bush = (x: number, w: number) => {
    p.ellipse(x, base - 4, w, 7, C.leafDark).ellipse(x - w / 3, base - 7, w / 2, 6, C.leaf).ellipse(x + w / 4, base - 8, w / 2.4, 6, C.leafLight);
  };
  const lamp = (x: number) => {
    p.rect(x, base - 52, 2, 52, '#4a4a58').rect(x - 6, base - 53, 8, 2, '#4a4a58').rect(x - 7, base - 51, 4, 2, '#fff1b0');
  };
  for (const [x, hgt] of [[40, 62], [190, 74], [330, 58], [440, 68]] as const) palm(x, hgt);
  for (const x of [100, 260, 400]) lamp(x);
  for (let i = 0; i < 8; i++) bush(20 + i * 60 + Math.floor(r() * 16), 9 + Math.floor(r() * 5));
}

/** Gehweg + Straße mit Mittelstreifen (kachelbar, Periode 40 px) */
function paintRoad(p: Pix) {
  const r = rng(5152);
  p.rect(0, 0, p.w, 4, '#c9c4b8').rect(0, 4, p.w, 2, '#9a958a');
  p.rect(0, 6, p.w, p.h - 6, '#4b4b57');
  p.overlayOn(() => p.speckle(0, 6, p.w, p.h - 6, '#56566a', 600, r).speckle(0, 6, p.w, p.h - 6, '#42424c', 400, r));
  for (let x = 0; x < p.w; x += 40) p.rect(x, 28, 20, 2, '#f4efe2');
  for (let x = 0; x < p.w; x += 8) p.vline(x, 0, 4, '#b4afa3');
}

/** Doppeldecker von der Seite (Fahrtrichtung rechts) – Fenster sind Löcher, dahinter sitzen die Spieler */
function paintBus(): Pix {
  const p = new Pix(BW, BH);
  const body = '#f2c33a';
  const bodyDark = '#d9a520';
  const bodyLight = '#ffe08a';
  p.rect(2, 2, BW - 4, BH - 6, body);
  p.rect(1, 4, 1, BH - 10, body).rect(BW - 2, 4, 1, BH - 10, body);
  // Dach, Lichtkante, Mittelstreifen (dort stehen die Namen der unteren Reihe), Schürze
  p.rect(2, 2, BW - 4, 2, '#fff4d6');
  p.rect(2, 4, BW - 4, 1, bodyLight);
  p.rect(2, 52, BW - 4, 13, '#e04a3f').rect(2, 52, BW - 4, 1, '#f27a6f').rect(2, 64, BW - 4, 1, '#a8342a');
  p.rect(2, 104, BW - 4, 14, bodyDark).rect(2, 104, BW - 4, 1, body);
  p.rect(2, 116, BW - 4, 2, '#5a4a2a');
  // Fenster ausstanzen
  const hole = (x: number, y: number, w: number, h: number) => p.g.clearRect(x, y, w, h);
  for (let c = 0; c < COLS; c++) {
    hole(winX(c), UP_Y, WIN_W, WIN_H);
    hole(winX(c), LOW_Y, WIN_W, WIN_H);
  }
  hole(DRV.x - 4, UP_Y, DRV.w + 4, WIN_H);
  hole(DRV.x, LOW_Y, DRV.w, WIN_H - 4);
  // Radkästen
  for (const wx of WHEEL_X) {
    p.g.save();
    p.g.globalCompositeOperation = 'destination-out';
    p.ellipse(wx, BH, 17, 17, '#000');
    p.g.restore();
  }
  // Lichter, Stoßstange, Zierleisten
  p.rect(BW - 6, 98, 4, 5, '#fff4b0').rect(BW - 6, 106, 4, 3, C.orange);
  p.rect(2, 96, 3, 6, C.red);
  p.rect(BW - 14, 112, 12, 5, '#6e6e7e');
  p.rect(2, 112, 10, 5, '#6e6e7e');
  for (let c = 0; c <= COLS; c++) {
    const x = winX(c) - 5;
    if (x > 2 && x < DRV.x - 6) p.vline(x, 104, 12, '#c4951a');
  }
  // Ziel-Anzeige oben vorn
  p.rect(DRV.x - 2, 5, DRV.w + 2, 7, '#2d2d3a');
  p.outline(C.outline);
  return p;
}

/** Innenraum: dunkel, mit Deckenlicht – sieht man nur durch die Fenster */
function paintInside(): Pix {
  const p = new Pix(BW, BH);
  p.rect(0, 0, BW, BH, '#2e2840');
  for (const y of [UP_Y, LOW_Y]) {
    p.rect(0, y, BW, 2, '#fff1b0').rect(0, y + 2, BW, 1, '#8a7a5a');
    p.rect(0, y + WIN_H - 3, BW, 3, '#3d3552');
  }
  // Haltestangen zwischen den Fenstern
  for (let c = 1; c < COLS; c++) p.vline(winX(c) - 5, 0, BH, '#7f7b8a');
  return p;
}

/** Spiegelungen auf den Scheiben + Lenkrad */
function paintGlass(): Pix {
  const p = new Pix(BW, BH);
  const shine = 'rgba(255,255,255,0.22)';
  const streak = (x: number, y: number, h: number) => {
    for (let k = 0; k < h - 4; k++) p.px(x + 6 + k * 0.6, y + h - 2 - k, shine).px(x + 9 + k * 0.6, y + h - 2 - k, shine);
  };
  for (let c = 0; c < COLS; c++) {
    streak(winX(c) + WIN_W - 26, UP_Y, WIN_H);
    streak(winX(c) + WIN_W - 26, LOW_Y, WIN_H);
  }
  streak(DRV.x + 10, UP_Y, WIN_H);
  // Lenkrad vor dem Fahrer
  p.ellipse(DRV.x + DRV.w - 8, LOW_Y + WIN_H - 10, 4, 7, '#2d2d3a');
  p.ellipse(DRV.x + DRV.w - 8, LOW_Y + WIN_H - 10, 2, 5, 'rgba(0,0,0,0)');
  p.rect(DRV.x + DRV.w - 7, LOW_Y + WIN_H - 6, 2, 6, '#2d2d3a');
  return p;
}

/** Rad, zwei Bilder für die Drehung (Schrauben versetzt) */
function wheelPix(frame: number): Pix {
  const p = new Pix(28, 28);
  p.disc(14, 14, 13, '#2d2d3a');
  p.disc(14, 14, 8, '#b9b9c6');
  p.disc(14, 14, 7, '#9a9aa8');
  p.disc(14, 14, 3, '#5a5a6a');
  const a0 = frame ? Math.PI / 4 : 0;
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    p.rect(14 + Math.round(Math.cos(a) * 5) - 1, 14 + Math.round(Math.sin(a) * 5) - 1, 2, 2, '#e8e8f0');
  }
  p.outline(C.outline);
  return p;
}

const SUITS = [
  ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  ['...r...', '..rrr..', '.rrrrr.', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  ['..rrr..', '..rrr..', 'rr.r.rr', 'rrrrrrr', 'rr.r.rr', '...r...', '..rrr..'],
  ['...r...', '..rrr..', '.rrrrr.', 'rrrrrrr', 'rrrrrrr', '.r.r.r.', '..rrr..'],
];

function suitAt(p: Pix, suit: number, x: number, y: number, s: number, col: string) {
  SUITS[suit].forEach((row, j) => [...row].forEach((ch, i) => ch === 'r' && p.rect(x + i * s, y + j * s, s, s, col)));
}

function cardFace(suit: number): Pix {
  const p = new Pix(CARD_W, CARD_H);
  p.rect(0, 0, CARD_W, CARD_H, C.white);
  p.rect(1, CARD_H - 2, CARD_W - 2, 1, '#e6dcc5');
  const col = suit < 2 ? '#c0392b' : '#2d2d3a';
  suitAt(p, suit, 11, 28, 3, col);
  suitAt(p, suit, CARD_W - 11, CARD_H - 11, 1, col);
  p.outline(C.outline);
  return p;
}

function cardBack(): Pix {
  const p = new Pix(CARD_W, CARD_H);
  p.rect(0, 0, CARD_W, CARD_H, '#3f62a8');
  p.rect(2, 2, CARD_W - 4, CARD_H - 4, '#fdf7ea').rect(3, 3, CARD_W - 6, CARD_H - 6, '#3f62a8');
  for (let y = 6; y < CARD_H - 5; y += 4) for (let x = 6 + ((y / 4) % 2) * 2; x < CARD_W - 5; x += 4) p.px(x, y, '#7fa0e0');
  p.outline(C.outline);
  return p;
}

/** Kleines Symbol (♥ ♦ ♣ ♠) für Textzeilen */
function suitPix(suit: number): Pix {
  const p = new Pix(9, 9);
  suitAt(p, suit, 1, 1, 1, suit < 2 ? '#c0392b' : '#2d2d3a');
  p.outline('#fff6dc');
  return p;
}

function mugPix(): Pix {
  const p = new Pix(10, 11);
  p.rect(1, 2, 6, 8, C.gold).rect(1, 2, 6, 2, '#fff8e0').rect(7, 4, 2, 4, '#d9a520').px(8, 5, 'rgba(0,0,0,0)').px(8, 6, 'rgba(0,0,0,0)');
  p.px(1, 1, '#fff8e0').px(4, 1, '#fff8e0');
  p.vline(2, 4, 5, '#ffe9a0');
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Szene

interface Seat {
  id: string;
  /** Fenster-Mitte und Oberkante (Bus-Koordinaten) */
  x: number;
  top: number;
  spr: Phaser.GameObjects.Sprite;
  phase: number;
}

export class BusfahrerScene extends Phaser.Scene {
  private juice!: Juice;
  private far!: Phaser.GameObjects.TileSprite;
  private mid!: Phaser.GameObjects.TileSprite;
  private road!: Phaser.GameObjects.TileSprite;
  private busC!: Phaser.GameObjects.Container;
  private seatLayer!: Phaser.GameObjects.Container;
  private tagLayer!: Phaser.GameObjects.Container;
  private cardLayer!: Phaser.GameObjects.Container;
  private panelLayer!: Phaser.GameObjects.Container;
  private wheels: Phaser.GameObjects.Image[] = [];
  private driver!: Phaser.GameObjects.Sprite;
  private seats = new Map<string, Seat>();
  private keys = { seats: '', cards: '', tags: '', panel: '' };
  private prev: BusState | null = null;
  /** Fahrtempo: 1 = normal, 0 = steht (Endstation) */
  private speed = 1;
  private targetSpeed = 1;
  private dist = 0;
  private nextBump = 0;
  private bumpY = 0;
  private nextSmoke = 0;
  private wheelFrame = -1;
  /** Zählt Neuzeichnungen der Schilder – verspätete Auflösungs-Schilder alter Zeichnungen verfallen */
  private tagSeq = 0;

  constructor() {
    super('hilo');
  }

  create() {
    this.seats = new Map();
    this.keys = { seats: '', cards: '', tags: '', panel: '' };
    this.prev = null;
    this.speed = 1;
    this.targetSpeed = 1;
    this.dist = 0;
    this.nextBump = 0;
    this.bumpY = 0;
    this.nextSmoke = 0;
    this.wheelFrame = -1;
    this.tagSeq = 0;
    this.wheels = [];

    background(this, 'busfahrer_sky', WORLD.W, WORLD.H, paintSky);
    this.far = this.add.tileSprite(0, 112, WORLD.W, 120, ensureTex(this, 'bf_far', () => {
      const p = new Pix(WORLD.W, 120);
      paintFar(p);
      return p;
    })).setOrigin(0, 0).setDepth(-900);
    this.mid = this.add.tileSprite(0, 140, WORLD.W, 92, ensureTex(this, 'bf_mid', () => {
      const p = new Pix(WORLD.W, 92);
      paintMid(p);
      return p;
    })).setOrigin(0, 0).setDepth(-800);
    this.road = this.add.tileSprite(0, ROAD_Y, WORLD.W, WORLD.H - ROAD_Y, ensureTex(this, 'bf_road', () => {
      const p = new Pix(WORLD.W, WORLD.H - ROAD_Y);
      paintRoad(p);
      return p;
    })).setOrigin(0, 0).setDepth(-700);

    // Schatten, Bus (Innenraum, Sitze + Spieler, Karosserie, Glas, Namen), Räder
    this.add.ellipse(BUS_X + BW / 2, BUS_Y + BH + 12, BW + 10, 10, 0x000000, 0.25).setDepth(-600);
    this.busC = this.add.container(BUS_X, BUS_Y).setDepth(10);
    this.busC.add(this.add.image(0, 0, ensureTex(this, 'bf_inside', paintInside)).setOrigin(0, 0));
    this.seatLayer = this.add.container(0, 0);
    this.busC.add(this.seatLayer);
    this.driver = avatarSprite(this, DRIVER_LOOK).setOrigin(0.5, 0).setScale(2).setCrop(0, 0, AV_W, 20);
    this.driver.setPosition(DRV.x + 16, LOW_Y + 2);
    this.busC.add(this.driver);
    this.busC.add(this.add.image(0, 0, ensureTex(this, 'bf_body', paintBus)).setOrigin(0, 0));
    this.busC.add(this.add.image(0, 0, ensureTex(this, 'bf_glass', paintGlass)).setOrigin(0, 0));
    this.busC.add(ink(this, 215, 106, 'B U S F A H R E R', { color: '#8a5a10' }));
    this.busC.add(txt(this, DRV.x + DRV.w / 2 - 1, 5, 'PARTY', { color: C.orange, shadow: false }).setScale(0.75));
    this.tagLayer = this.add.container(0, 0);
    this.busC.add(this.tagLayer);
    const w0 = ensureTex(this, 'bf_wheel0', () => wheelPix(0));
    ensureTex(this, 'bf_wheel1', () => wheelPix(1));
    for (const wx of WHEEL_X) this.wheels.push(this.add.image(BUS_X + wx, BUS_Y + BH, w0).setDepth(20));

    this.cardLayer = this.add.container(0, 0).setDepth(30);
    this.panelLayer = this.add.container(0, 0).setDepth(30);
    panel(this, 4, 4, 206, 106, 'dark').setDepth(25);
    panel(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h).setDepth(25);
    this.juice = new Juice(this, { depth: 500 });

    const fn = (s: GameState) => this.onState(s);
    stateBus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => stateBus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update(time: number, delta: number) {
    const dt = Math.min(0.05, delta / 1000);
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 0.9);
    if (this.targetSpeed === 0 && this.speed < 0.02) this.speed = 0;
    const v = 150 * this.speed;
    this.dist += v * dt;
    this.road.tilePositionX = Math.round(this.dist);
    this.mid.tilePositionX = Math.round(this.dist * 0.4);
    this.far.tilePositionX = Math.round(this.dist * 0.08);
    // Räder: Schrauben springen mit der gefahrenen Strecke
    const wf = Math.floor(this.dist / 6) % 2;
    if (wf !== this.wheelFrame) {
      this.wheelFrame = wf;
      for (const w of this.wheels) w.setTexture(`bf_wheel${wf}`);
    }
    // Ruckeln: Motor-Zittern + ab und zu ein Schlagloch
    if (this.speed > 0.1 && time > this.nextBump) {
      this.nextBump = time + 1400 + Math.random() * 2600;
      this.bump(Math.random() < 0.3 ? 2 : 1);
    }
    const shake = this.speed > 0.1 && Math.floor(time / 90) % 7 === 0 ? 1 : 0;
    this.busC.y = BUS_Y + Math.round(this.bumpY) - shake;
    // Köpfe wippen mit, jeder etwas versetzt
    for (const seat of this.seats.values()) {
      const off = this.speed > 0.1 ? Math.round(Math.max(0, Math.sin(time / 260 + seat.phase)) * 1.2 * this.speed) : 0;
      seat.spr.y = seat.top + 2 + off;
    }
    this.driver.y = LOW_Y + 2 + (this.speed > 0.1 && Math.sin(time / 300) > 0.6 ? 1 : 0);
    // Auspuff
    if (this.speed > 0.1 && time > this.nextSmoke) {
      this.nextSmoke = time + 380;
      this.juice.burst(BUS_X - 2, BUS_Y + BH - 8, 'smoke', 1);
    }
  }

  /** Schlagloch: Karosserie springt kurz hoch und federt nach */
  private bump(level: 1 | 2) {
    this.tweens.killTweensOf(this);
    this.bumpY = -level * 1.5;
    this.tweens.add({ targets: this, bumpY: 0, duration: 260 + level * 80, ease: 'Bounce.Out' });
  }

  private name(id: string | null | undefined) {
    return tagName(playerById(id)?.name ?? '?');
  }

  private clear(layer: Phaser.GameObjects.Container) {
    const kill = (o: Phaser.GameObjects.GameObject) => {
      this.tweens.killTweensOf(o);
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(kill);
    };
    layer.list.forEach(kill);
    layer.removeAll(true);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'hilo') return;
    const s = gs.mini.state;
    const ids = Object.keys(s.sips);
    const seatKey = JSON.stringify(ids.map((id) => {
      const p = playerById(id);
      return [id, p?.look, p?.color];
    }));
    if (seatKey !== this.keys.seats) {
      this.keys.seats = seatKey;
      this.buildSeats(ids);
      // Schilder hängen an den Plätzen – neu setzen
      this.keys.tags = '';
    }
    const prev = this.prev;
    const flip = !!prev && prev.round === s.round && prev.sub === 'guess' && s.sub === 'reveal';
    const cardKey = JSON.stringify([s.pass, s.step, s.sub, s.cards.length]);
    if (cardKey !== this.keys.cards) {
      this.keys.cards = cardKey;
      this.drawCards(s, flip);
    }
    const tagKey = JSON.stringify([s.round, s.sub, s.chosen, s.roundSips, s.out, ids.map((id) => [playerById(id)?.name, playerById(id)?.connected])]);
    if (tagKey !== this.keys.tags) {
      this.keys.tags = tagKey;
      this.drawTags(s, ids, flip);
    }
    const missing = ids.filter((id) => playerById(id)?.connected && !s.chosen.includes(id));
    const panelKey = JSON.stringify([s.round, s.sub, s.chosen.length, missing.map((id) => this.name(id))]);
    if (panelKey !== this.keys.panel) {
      this.keys.panel = panelKey;
      this.drawPanel(s, ids, missing, flip);
    }
    if (prev) this.transition(prev, s, ids);
    else if (s.sub === 'guess') this.announce(s);
    this.targetSpeed = s.sub === 'over' ? 0 : 1;
    this.prev = s;
  }

  // ---------------------------------------------------------------- Plätze im Bus

  private buildSeats(ids: string[]) {
    this.clear(this.seatLayer);
    this.seats.clear();
    const slots = seatSlots(ids.length);
    const taken = new Map<string, string>();
    ids.forEach((id, i) => taken.set(`${slots[i].deck}-${slots[i].col}`, id));
    for (let deck = 0; deck < 2; deck++) {
      for (let col = 0; col < COLS; col++) {
        const id = taken.get(`${deck}-${col}`);
        const top = deck ? LOW_Y : UP_Y;
        const x = winX(col) + WIN_W / 2;
        const color = id ? pcol(id).num : 0x4a5470;
        const light = Phaser.Display.Color.ValueToColor(color).lighten(18).color;
        // Sitz in der Spielerfarbe (leere Plätze grau-blau): Kopfstütze + Lehne
        this.seatLayer.add(this.add.rectangle(x, top + 12, 20, 9, light).setStrokeStyle(1, 0x2d1b12));
        this.seatLayer.add(this.add.rectangle(x, top + WIN_H - 10, 36, 20, color).setStrokeStyle(1, 0x2d1b12));
        this.seatLayer.add(this.add.rectangle(x, top + WIN_H - 19, 34, 2, light));
        if (!id) continue;
        const p = playerById(id);
        if (!p) continue;
        const spr = avatarSprite(this, p.look).setOrigin(0.5, 0).setScale(2).setCrop(0, 0, AV_W, 20);
        spr.setPosition(x, top + 2);
        this.seatLayer.add(spr);
        this.seats.set(id, { id, x, top, spr, phase: Math.random() * Math.PI * 2 });
      }
    }
  }

  /** Namen über den Fenstern, Status-Schilder, Krüge */
  private drawTags(s: BusState, ids: string[], flip: boolean) {
    this.clear(this.tagLayer);
    const seq = ++this.tagSeq;
    const delay = flip ? 520 : 0;
    for (const id of ids) {
      const seat = this.seats.get(id);
      if (!seat) continue;
      const p = playerById(id);
      const online = !!p?.connected;
      seat.spr.setAlpha(online || s.sub !== 'guess' ? 1 : 0.4);
      const tagY = seat.top === UP_Y ? 1 : 53;
      this.tagLayer.add(nameTag(this, seat.x, tagY, p?.name ?? '?', s.sub === 'over' && this.isDriver(s, id) ? RED_INK : INK, WIN_W + 6));
      const corner = { x: seat.x + WIN_W / 2 - 8, y: seat.top + 7 };
      if (s.sub === 'guess') {
        if (s.chosen.includes(id)) this.badge(corner.x, corner.y, 'OK', 0x46b04a, '#fff4d6');
        else if (online) this.badge(corner.x, corner.y, '...', 0xfff4d6, INK);
        else this.badge(corner.x, corner.y, 'zz', 0x9a958a, '#fff4d6');
        continue;
      }
      if (s.sub === 'reveal') {
        const n = s.roundSips?.[id] ?? 0;
        const out = s.out.includes(id);
        const show = () => {
          if (seq !== this.tagSeq || !this.tagLayer.active) return;
          if (out) this.badge(corner.x, corner.y, '–', 0x9a958a, '#fff4d6');
          else if (n) {
            this.badge(corner.x, corner.y, `+${n}`, 0xc0392b, '#fff4d6', flip);
            if (flip) this.drink(seat, n);
          } else {
            this.badge(corner.x, corner.y, 'OK', 0x46b04a, '#fff4d6', flip);
            if (flip) this.cheer(seat);
          }
        };
        if (delay) this.time.delayedCall(delay, show);
        else show();
        continue;
      }
      // Zusammenfassung: Schlücke insgesamt am Fenster
      const total = s.sips[id] ?? 0;
      this.badge(corner.x - 2, corner.y, String(total), total ? 0xc0392b : 0x46b04a, '#fff4d6');
    }
  }

  private badge(x: number, y: number, text: string, fill: number, color: string, pop = false) {
    const c = this.add.container(x, y);
    const t = txt(this, 0, -4, text, { color, shadow: false });
    const w = Math.max(14, t.width + 6);
    c.add(this.add.rectangle(0, 0, w, 12, fill).setStrokeStyle(1, 0x2d1b12));
    c.add(t);
    this.tagLayer.add(c);
    if (pop) {
      c.setScale(0.2);
      this.tweens.add({ targets: c, scale: 1, duration: 260, ease: 'Back.Out' });
    }
  }

  private cheer(seat: Seat) {
    playAvatar(seat.spr, 'cheer');
    this.time.delayedCall(1600, () => seat.spr.active && playAvatar(seat.spr, 'idle'));
  }

  /** Krug am Fenster heben – so oft wie Schlücke (höchstens 4) */
  private drink(seat: Seat, n: number) {
    playAvatar(seat.spr, 'hit');
    this.time.delayedCall(1400, () => seat.spr.active && playAvatar(seat.spr, 'idle'));
    const mug = this.add.image(seat.x - 13, seat.top + 24, ensureTex(this, 'bf_mug', mugPix)).setOrigin(0.3, 0.9);
    this.tagLayer.add(mug);
    this.tweens.add({ targets: mug, angle: -55, y: seat.top + 18, duration: 320, yoyo: true, hold: 180, repeat: Math.min(4, n) - 1, ease: 'Sine.InOut' });
  }

  private isDriver(s: BusState, id: string) {
    const most = Math.max(0, ...Object.values(s.sips));
    return most > 0 && s.sips[id] === most;
  }

  // ---------------------------------------------------------------- Kartenreihe

  private drawCards(s: BusState, flip: boolean) {
    this.clear(this.cardLayer);
    const L = this.cardLayer;
    L.add(txt(this, 107, 9, 'BUSFAHRER', { size: 16, color: GOLD }));
    const n = s.fragen.length;
    for (let i = 0; i < n; i++) {
      const x = cardX(i, n);
      const card = s.cards[i] ?? null;
      const cur = i === s.step && s.sub !== 'over';
      const c = this.add.container(x, CARD_Y);
      L.add(c);
      if (cur && s.sub === 'guess') {
        const glow = this.add.rectangle(0, 0, CARD_W + 8, CARD_H + 8, 0xffd25e, 0.7);
        c.add(glow);
        this.tweens.add({ targets: glow, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: c, y: CARD_Y - 2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
      const face = this.add.container(0, 0);
      c.add(face);
      const showFace = (k: BusCard) => {
        face.removeAll(true);
        face.add(this.add.image(0, 0, ensureTex(this, `bf_face_${k.suit}`, () => cardFace(k.suit))));
        face.add(ink(this, -CARD_W / 2 + 4, -CARD_H / 2 + 4, cardLabel(k.rank), { size: 16, origin: [0, 0], color: busRed(k) ? '#c0392b' : '#2d2d3a' }));
      };
      const showBack = () => {
        face.removeAll(true);
        face.add(this.add.image(0, 0, ensureTex(this, 'bf_back', cardBack)));
        face.add(txt(this, 0, -8, '?', { size: 16, color: cur ? GOLD : '#c9d8f5' }));
      };
      if (card && cur && flip) {
        // Umdrehen: zuklappen, Vorderseite, aufklappen
        showBack();
        this.tweens.add({
          targets: face, scaleX: 0, duration: 140, delay: 120, ease: 'Quad.In',
          onComplete: () => {
            showFace(card);
            this.juice.burst(x, CARD_Y, 'spark', 12);
            this.tweens.add({ targets: face, scaleX: 1, duration: 180, ease: 'Back.Out' });
          },
        });
        this.tweens.add({ targets: c, y: CARD_Y - 6, duration: 160, yoyo: true, ease: 'Quad.Out' });
      } else if (card) showFace(card);
      else showBack();
      // Einsatz unter der Karte
      const sx = x - 8;
      L.add(this.add.image(sx, 99, ensureTex(this, 'bf_mug', mugPix)));
      L.add(txt(this, sx + 8, 95, `${busSchluecke(i)}`, { origin: [0, 0], color: i === s.step && s.sub !== 'over' ? GOLD : '#fff4d6' }));
    }
  }

  // ---------------------------------------------------------------- Frage / Auflösung / Zusammenfassung

  private drawPanel(s: BusState, ids: string[], missing: string[], flip: boolean) {
    this.clear(this.panelLayer);
    const L = this.panelLayer;
    const top = PANEL.y + 9;
    const wrap = PANEL.w - 22;
    const line = (y: number, text: string, opts: { size?: 8 | 16; color?: string } = {}) => {
      const t = ink(this, PX, y, text, { ...opts, wrap });
      L.add(t);
      return t;
    };
    const head = `Karte ${s.step + 1} von ${s.fragen.length}${s.passes > 1 ? ` · Durchgang ${s.pass}/${s.passes}` : ''}`;
    if (s.sub === 'guess') {
      line(top, head, { color: RED_INK });
      // Frage groß (kurz), darunter klein die Bezugskarten
      const q = ink(this, PX, 0, this.frageKurz(s), { size: 16, wrap: PANEL.w - 14 });
      if (q.height > 40) q.setFontSize(8);
      q.setY(top + 13 + Math.round((38 - q.height) / 2));
      L.add(q);
      this.frageDetail(s, top + 55);
      line(top + 68, `Falsch = ${sipText(busSchluecke(s.step))}`, { color: RED_INK });
      const wait = missing.length && missing.length <= 3 ? `Warte auf ${missing.map((id) => this.name(id)).join(', ')}` : `Getippt: ${s.chosen.length}/${ids.length}`;
      L.add(fitText(ink(this, PX, top + 81, wait, { color: '#7a5a3a' }), wrap, 0.6));
      return;
    }
    if (s.sub === 'reveal') {
      const objs: Phaser.GameObjects.GameObject[] = [];
      const ans = line(top, `${s.answer ? BUS_TIPP_TEXT[s.answer] : ''}!`, { size: 16, color: GREEN_INK });
      const why = line(top + 20, s.answerText);
      objs.push(ans, why);
      const sips = busSchluecke(s.step);
      const drinkers = ids.filter((id) => (s.roundSips?.[id] ?? 0) > 0);
      const safe = ids.filter((id) => !drinkers.includes(id) && !s.out.includes(id));
      const names = (list: string[]) => list.map((id) => this.name(id)).join(', ');
      let y = top + 36;
      if (!drinkers.length) {
        objs.push(line(y, 'Alle sicher – keiner trinkt!', { color: GREEN_INK }));
      } else {
        const t1 = line(y, drinkers.length === ids.length ? `ALLE trinken ${sipText(sips)}!` : `Trinken ${sips === 1 ? '1 Schluck' : `je ${sipText(sips)}`}:`, { color: RED_INK });
        objs.push(t1);
        y += 12;
        if (drinkers.length < ids.length) {
          const t2 = line(y, names(drinkers));
          objs.push(t2);
          y += t2.height + 6;
          if (safe.length && y < PANEL.y + PANEL.h - 14) objs.push(fitText(ink(this, PX, y, `Sicher: ${names(safe)}`, { color: GREEN_INK }), wrap, 0.5));
        }
      }
      if (flip) {
        for (const o of objs) (o as Phaser.GameObjects.Text).setAlpha(0);
        this.tweens.add({ targets: objs, alpha: 1, duration: 200, delay: 480 });
        (ans as Phaser.GameObjects.Text).setScale(1.6);
        this.tweens.add({ targets: ans, scale: 1, duration: 300, delay: 480, ease: 'Back.Out' });
      }
      return;
    }
    // Endstation: alle Schlücke
    line(top, 'ENDSTATION!', { size: 16, color: RED_INK });
    const most = Math.max(0, ...Object.values(s.sips));
    const drivers = ids.filter((id) => most > 0 && s.sips[id] === most);
    const driverText = !most ? 'Keiner musste trinken!' : drivers.length === 1 ? `${this.name(drivers[0])} fährt den Bus!` : `Busfahrer: ${drivers.map((id) => this.name(id)).join(', ')}`;
    L.add(fitText(ink(this, PX, top + 19, driverText, { color: INK }), wrap, 0.6));
    const sorted = [...ids].sort((a, b) => (s.sips[b] ?? 0) - (s.sips[a] ?? 0));
    const perCol = Math.ceil(sorted.length / 2);
    sorted.forEach((id, i) => {
      const col = i < perCol ? 0 : 1;
      const row = col ? i - perCol : i;
      const x = PANEL.x + 14 + col * 124;
      const y = top + 34 + row * 10;
      const n = s.sips[id] ?? 0;
      L.add(fitText(ink(this, x, y, this.name(id), { origin: [0, 0], color: drivers.includes(id) ? RED_INK : INK }), 84, 0.6));
      L.add(ink(this, x + 112, y, String(n), { origin: [1, 0], color: n ? RED_INK : GREEN_INK }));
    });
  }

  /** Kurze Frage für die große Schrift am TV (passt in zwei Zeilen) */
  private frageKurz(s: BusState) {
    const frage = s.fragen[s.step];
    if (frage === 'farbe') return 'Rot oder Schwarz?';
    if (frage === 'hoehe') {
      const ref = s.cards[s.cards.length - 1]?.rank ?? 8;
      return ref >= 14 ? 'Tiefer oder gleich?' : ref <= 2 ? 'Höher oder gleich?' : 'Höher, tiefer oder gleich?';
    }
    if (frage === 'zwischen') {
      if (!s.options.includes('zwischen')) return 'Außerhalb oder gleich?';
      if (!s.options.includes('ausserhalb')) return 'Dazwischen oder gleich?';
      return 'Dazwischen oder außerhalb?';
    }
    return 'Symbol schon dabei?';
  }

  /** Kleine Zeile unter der Frage: wogegen verglichen wird (Symbole als Pixel-Icons) */
  private frageDetail(s: BusState, y: number) {
    const L = this.panelLayer;
    const frage = s.fragen[s.step];
    const muted = '#7a5a3a';
    if (frage === 'farbe') {
      this.suitLine(y, [['Rot', [0, 1]], ['Schwarz', [2, 3]]]);
      return;
    }
    if (frage === 'hoehe') {
      const ref = s.cards[s.cards.length - 1];
      if (ref) L.add(fitText(ink(this, PX, y, `als ${busRankArtikel(ref.rank)} · Ass ist hoch`, { color: muted }), PANEL.w - 22, 0.6));
      return;
    }
    if (frage === 'zwischen') {
      const a = s.cards[s.cards.length - 2]?.rank ?? 2;
      const b = s.cards[s.cards.length - 1]?.rank ?? 14;
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      const text = lo === hi ? `Grenze ${cardLabel(lo)} · gleich = noch eine ${cardLabel(lo)}` : `Grenzen ${cardLabel(lo)} und ${cardLabel(hi)} · gleich = ${cardLabel(lo)} oder ${cardLabel(hi)}`;
      L.add(fitText(ink(this, PX, y, text, { color: muted }), PANEL.w - 22, 0.6));
      return;
    }
    const seen = [...new Set(s.cards.map((c) => c.suit))].sort();
    this.suitLine(y, [['Schon da:', seen]]);
  }

  /** Text + Symbol-Icons in einer zentrierten Zeile, z. B. „Rot ♥♦   Schwarz ♣♠“ */
  private suitLine(y: number, parts: [string, number[]][]) {
    const row: { o: Phaser.GameObjects.Image | Phaser.GameObjects.Text | null; w: number }[] = [];
    parts.forEach(([label, suits], i) => {
      if (i) row.push({ o: null, w: 14 });
      const t = ink(this, 0, y, label, { origin: [0, 0], color: '#7a5a3a' });
      row.push({ o: t, w: t.width + 4 });
      for (const su of suits) row.push({ o: this.add.image(0, y + 4, ensureTex(this, `bf_suit_${su}`, () => suitPix(su))).setOrigin(0, 0.5), w: 11 });
    });
    let x = PX - row.reduce((sum, r) => sum + r.w, 0) / 2;
    for (const r of row) {
      if (r.o) this.panelLayer.add(r.o.setX(Math.round(x)));
      x += r.w;
    }
  }

  // ---------------------------------------------------------------- Übergänge: Ton, Sprecher, Juice

  private announce(s: BusState) {
    const frage = s.fragen[s.step];
    const text = frage === 'farbe' || frage === 'symbol' ? busFrageText(frage, s.cards) : busFrageText(frage, s.cards).replace(' – ', ', ').replace(/[()]/g, '');
    say(`Karte ${s.step + 1}. ${text}`);
  }

  private transition(prev: BusState, s: BusState, ids: string[]) {
    if (s.sub === 'guess' && (prev.round !== s.round || prev.sub !== 'guess')) {
      sfx('select');
      if (s.step === 0 && s.pass > 1) sfx('whistle');
      this.announce(s);
      return;
    }
    if (s.sub === 'guess' && s.chosen.length > prev.chosen.length) {
      sfx('tick', { pitch: 1 + s.chosen.length * 0.05 });
      return;
    }
    if (s.sub === 'reveal' && prev.sub === 'guess') {
      const card = s.cards[s.step];
      sfx('whoosh', { pitch: 1.4 });
      const drinkers = ids.filter((id) => (s.roundSips?.[id] ?? 0) > 0);
      const n = busSchluecke(s.step);
      this.time.delayedCall(450, () => {
        if (!drinkers.length) {
          sfx('coin');
          this.juice.burst(BUS_X + BW / 2, BUS_Y + 40, 'confetti', 30);
        } else {
          sfx('pop', { pitch: 0.8 });
          this.bump(2);
          if (drinkers.length >= Math.max(2, ids.length / 2)) sfx('cheer', { delay: 0.15, vol: 0.7 });
        }
      });
      if (card) say(`${busCardSpoken(card)}! ${this.drinkSpeech(drinkers, ids, n)}`);
      return;
    }
    if (s.sub === 'over' && prev.sub !== 'over') {
      sfx('fanfare');
      this.juice.burst(BUS_X + BW / 2, BUS_Y + 20, 'confetti', 50);
      const most = Math.max(0, ...Object.values(s.sips));
      const drivers = ids.filter((id) => most > 0 && s.sips[id] === most);
      say(most ? `Endstation! ${drivers.map((id) => spokenName(playerById(id)?.name)).join(' und ')} ${drivers.length > 1 ? 'fahren' : 'fährt'} den Bus.` : 'Endstation! Keiner musste trinken.');
    }
  }

  private drinkSpeech(drinkers: string[], ids: string[], n: number) {
    const amount = ['', 'einen Schluck', 'zwei Schlücke', 'drei Schlücke', 'vier Schlücke', 'fünf Schlücke'][n] ?? `${n} Schlücke`;
    if (!drinkers.length) return 'Alle sicher!';
    if (drinkers.length === ids.length) return `Alle trinken ${amount}!`;
    if (drinkers.length > 3) return `${drinkers.length} von euch trinken ${amount}.`;
    const names = drinkers.map((id) => spokenName(playerById(id)?.name));
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
    return `${who} ${names.length === 1 ? 'trinkt' : 'trinken'} ${amount}.`;
  }
}

