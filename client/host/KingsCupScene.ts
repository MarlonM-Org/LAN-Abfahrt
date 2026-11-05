import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { KINGS, KINGS_RACE, KINGS_RULES, type KingsState } from '../../shared/kingscup';
import { WORLD } from '../../shared/flunky';
import { cardLabel } from '../../shared/games';
import { C } from '../art/palette';
import { Pix, rng } from '../art/pix';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, GOLD, GREEN_INK, INK, LIGHT, RED_INK, background, ensureTex, ink, nameTag, panel, txt } from './ui';

// Tisch links, Seitenleiste (Karte, Regeln, Fragenmeister) rechts
const TX = 162;
const TY = 138;
const SEAT_RX = 138;
const SEAT_RY = 96;
const RING_RX = 82;
const RING_RY = 48;
const SIDE_X = 326;
const SIDE_W = 150;

const seatPos = (i: number, n: number) => {
  // Oben beginnen, im Uhrzeigersinn (y wächst nach unten → wachsender Winkel = Uhrzeigersinn)
  const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  return { x: TX + Math.cos(a) * SEAT_RX, y: TY + Math.sin(a) * SEAT_RY, a };
};

// ------------------------------------------------------------------ Pixel-Art

function paintRoom(p: Pix) {
  paintWoodFloor(p, 0, 0, WORLD.W, WORLD.H, 911, '#7a4a2a');
  // Teppich unter dem Tisch
  p.ellipse(TX, TY + 4, 160, 112, '#5a2430');
  p.ellipse(TX, TY + 4, 154, 106, '#7a3040');
  const r = rng(912);
  p.overlayOn(() => p.speckle(0, 0, 330, 270, '#8a3a4a', 500, r));
  // Runder Tisch: Holzrand + grüner Filz
  p.ellipse(TX, TY + 5, 126, 80, '#3a1f10');
  p.ellipse(TX, TY, 126, 80, C.woodDark);
  p.ellipse(TX, TY - 1, 122, 76, C.wood);
  p.ellipse(TX, TY, 116, 71, '#1f5a2e');
  p.ellipse(TX, TY, 113, 68, '#2a7a3c');
  p.ellipse(TX - 16, TY - 12, 70, 36, '#2f8442');
  p.overlayOn(() => p.speckle(TX - 113, TY - 68, 226, 136, '#2f8a44', 220, r));
  // Pfeile auf dem Filzrand: im Uhrzeigersinn
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + (k + 0.5) * (Math.PI / 4);
    const x = TX + Math.cos(a) * 104;
    const y = TY + Math.sin(a) * 61;
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    for (let s = -3; s <= 3; s++) p.px(x + tx * s, y + ty * s * 0.6, '#5fae6a');
    p.px(x + tx * 3 - ty * 1.5, y + ty * 2 + tx * 1.5, '#5fae6a').px(x + tx * 3 + ty * 1.5, y + ty * 2 - tx * 1.5, '#5fae6a');
  }
}

function cardBack(): Pix {
  const p = new Pix(9, 13);
  p.rect(0, 0, 9, 13, '#3f62a8');
  for (let y = 2; y < 11; y += 2) for (let x = 2 + (y % 4 === 0 ? 1 : 0); x < 7; x += 2) p.px(x, y, '#7fa0e0');
  p.rect(0, 0, 9, 1, '#5a7cc4');
  p.outline(C.outline);
  return p;
}

const SUITS = [
  ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  ['...r...', '..rrr..', '.rrrrr.', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  ['..rrr..', '..rrr..', 'rr.r.rr', 'rrrrrrr', 'rr.r.rr', '...r...', '..rrr..'],
  ['...r...', '..rrr..', '.rrrrr.', 'rrrrrrr', 'rrrrrrr', '.r.r.r.', '..rrr..'],
];

function cardFace(suit: number): Pix {
  const p = new Pix(30, 42);
  p.rect(0, 0, 30, 42, C.white);
  p.rect(1, 40, 28, 1, '#e6dcc5');
  const col = suit < 2 ? '#c0392b' : '#2d2d3a';
  p.map(11, 24, SUITS[suit], { r: col });
  p.map(21, 3, SUITS[suit].map((row) => row), { r: col });
  p.outline(C.outline);
  return p;
}

function cupPix(): Pix {
  const p = new Pix(28, 34);
  const g = C.gold;
  const gd = C.goldDark;
  // Kelch
  for (let y = 4; y < 18; y++) {
    const w = 22 - Math.floor((y - 4) * 0.7);
    p.rect(14 - w / 2, y, w, 1, g);
  }
  p.rect(3, 3, 22, 2, '#ffe9a0');
  // Bier mit Schaum
  p.rect(4, 2, 20, 2, '#fff8e0').px(6, 1, '#fff8e0').px(10, 1, '#fff8e0').px(17, 1, '#fff8e0').px(21, 1, '#fff8e0');
  // Krone als Verzierung
  p.rect(6, 8, 16, 2, gd);
  for (const x of [7, 11, 15, 19]) p.px(x, 7, gd);
  p.px(9, 11, C.red).px(14, 11, '#3f8fe0').px(19, 11, C.red);
  // Glanz
  p.vline(6, 5, 9, '#fff2b8').vline(7, 5, 6, '#fff2b8');
  p.vline(20, 6, 9, gd).vline(21, 5, 7, gd);
  // Stiel + Fuß
  p.rect(12, 18, 4, 9, g).vline(15, 18, 9, gd);
  p.rect(11, 21, 6, 2, gd);
  p.rect(6, 27, 16, 3, g).rect(6, 29, 16, 1, gd).rect(8, 26, 12, 1, g);
  p.outline(C.outline);
  return p;
}

function crownPix(): Pix {
  const p = new Pix(11, 8);
  p.map(0, 0, ['y....y....y', 'yy..yyy..yy', 'yyyyyyyyyyy', 'yryyybyyyry', 'yyyyyyyyyyy'], { y: C.gold, r: C.red, b: '#3f8fe0' });
  p.outline(C.outline);
  return p;
}

function mugPix(): Pix {
  const p = new Pix(9, 9);
  p.map(0, 0, ['.wwwww..', 'wwwwwww.', 'yyyyyy..', 'yyyyyyyy', 'yyyyyy.y', 'yyyyyy.y', 'yyyyyyyy', 'yyyyyy..'], { w: '#fff8e0', y: C.orange });
  p.outline(C.outline);
  return p;
}

function snailPix(): Pix {
  const p = new Pix(16, 11);
  p.map(0, 0, [
    '.......sss......',
    '.....ssbbss.....',
    '....sbbsbbbs....',
    '....sbsssbbs..e.e',
    '....sbbbbsbs..k.k',
    '.....sbbbbs...kk.',
    'kkkkkkkkkkkkkkk..',
    '.kkkkkkkkkkkkk...',
  ], { s: '#a5602a', b: '#d39a5c', k: '#9fd06a', e: '#2d1b12' });
  p.outline(C.outline);
  return p;
}

function dropPix(): Pix {
  const p = new Pix(7, 9);
  p.map(0, 0, ['...b...', '..bbb..', '..bbb..', '.bbbbb.', 'bbwbbbb', 'bwbbbbb', 'bbbbbbb', '.bbbbb.'], { b: '#4aa2dc', w: '#cdeeff' });
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Szene

export class KingsCupScene extends Phaser.Scene {
  private ringLayer!: Phaser.GameObjects.Container;
  private linkGfx!: Phaser.GameObjects.Graphics;
  private seatLayer!: Phaser.GameObjects.Container;
  private sideLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private popLayer!: Phaser.GameObjects.Container;
  private keys = { ring: '', seat: '', side: '', fx: '' };
  private fooledSeq = -1;
  private timer = new Countdown();
  private fxTotal = 0;
  /** Wird in update() pro Frame aktualisiert (Countdown, Timerbalken, Wasserfall) */
  private live: ((s: KingsState) => void) | null = null;
  private cupImg!: Phaser.GameObjects.Image;

  constructor() {
    super('kingscup');
  }

  create() {
    this.keys = { ring: '', seat: '', side: '', fx: '' };
    this.fooledSeq = -1;
    this.live = null;
    this.timer = new Countdown();
    background(this, 'kingscup', WORLD.W, WORLD.H, paintRoom);
    this.ringLayer = this.add.container(0, 0);
    this.cupImg = this.add.image(TX, TY + 2, ensureTex(this, 'kc_cup', cupPix)).setScale(2);
    this.tweens.add({ targets: this.cupImg, y: TY, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.add.text(TX, TY + 38, 'KÖNIGSBECHER', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', color: '#9fd8a8' }).setOrigin(0.5, 0);
    this.linkGfx = this.add.graphics();
    this.seatLayer = this.add.container(0, 0);
    this.sideLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.popLayer = this.add.container(0, 0);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private clear(layer: Phaser.GameObjects.Container) {
    const kill = (o: Phaser.GameObjects.GameObject) => {
      this.tweens.killTweensOf(o);
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(kill);
    };
    layer.list.forEach(kill);
    layer.removeAll(true);
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'kingscup') return;
    const s = gs.mini.state;
    const ring = `${s.total}-${s.drawn}-${s.sub === 'reveal' ? s.drawSeq : ''}`;
    if (ring !== this.keys.ring) {
      this.keys.ring = ring;
      this.drawRing(s);
    }
    const seat = JSON.stringify([
      s.order,
      s.order.map((id) => {
        const p = playerById(id);
        return p ? [p.name, p.look, p.connected] : null;
      }),
      s.drinks, s.qm, s.mates, s.drawer, s.sub, s.race?.phase, s.race?.times, s.chain?.turn, s.announce, s.waterfall,
    ]);
    if (seat !== this.keys.seat) {
      this.keys.seat = seat;
      this.drawSeats(s);
    }
    const side = JSON.stringify([s.rules, s.qm, s.card, s.drawn, s.total, playerById(s.qm)?.name]);
    if (side !== this.keys.side) {
      this.keys.side = side;
      this.drawSide(s);
    }
    const fx = `${s.sub}-${s.drawSeq}-${s.race?.phase ?? ''}-${s.chain?.step ?? ''}-${s.drawer}`;
    if (fx !== this.keys.fx) {
      this.keys.fx = fx;
      this.timer.set(s.endsIn);
      this.fxTotal = s.endsIn;
      this.drawFx(s);
    }
    if (s.fooled && s.fooled.seq !== this.fooledSeq) {
      if (this.fooledSeq !== -1) this.popFooled(s);
      this.fooledSeq = s.fooled.seq;
    } else if (!s.fooled) this.fooledSeq = 0;
  }

  update() {
    const gs = getState();
    if (this.live && gs?.mini?.kind === 'kingscup') this.live(gs.mini.state);
  }

  // ---------------------------------------------------------------- Kartenring

  private drawRing(s: KingsState) {
    this.clear(this.ringLayer);
    const back = ensureTex(this, 'kc_back', cardBack);
    for (let k = s.drawn; k < s.total; k++) {
      const a = -Math.PI / 2 + (k / s.total) * Math.PI * 2;
      const img = this.add.image(TX + Math.cos(a) * RING_RX, TY + Math.sin(a) * RING_RY, back).setRotation(a + Math.PI / 2);
      this.ringLayer.add(img);
    }
    // Gerade gezogene Karte fliegt zur Mitte
    if (s.sub === 'reveal' && s.drawn > 0) {
      const a = -Math.PI / 2 + ((s.drawn - 1) / s.total) * Math.PI * 2;
      const fly = this.add.image(TX + Math.cos(a) * RING_RX, TY + Math.sin(a) * RING_RY, back).setRotation(a + Math.PI / 2);
      this.ringLayer.add(fly);
      this.tweens.add({ targets: fly, x: 70, y: TY, rotation: 0, scale: 3, alpha: 0, duration: 380, ease: 'Quad.in' });
    }
  }

  // ---------------------------------------------------------------- Sitzplätze

  private drawSeats(s: KingsState) {
    this.clear(this.seatLayer);
    const g = this.linkGfx.clear();
    const n = s.order.length;
    const pos = new Map(s.order.map((id, i) => [id, seatPos(i, n)]));
    // Kumpel-Linien (unter den Figuren)
    for (const [a, b] of Object.entries(s.mates)) {
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (!pa || !pb) continue;
      g.lineStyle(3, 0x2d1b12, 0.8).lineBetween(pa.x, pa.y - 4, pb.x, pb.y - 4);
      g.lineStyle(1, 0xf07aa8, 1);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      for (let d = 0; d < len; d += 6) {
        const t0 = d / len;
        const t1 = Math.min(1, (d + 3) / len);
        g.lineBetween(pa.x + (pb.x - pa.x) * t0, pa.y - 4 + (pb.y - pa.y) * t0, pa.x + (pb.x - pa.x) * t1, pa.y - 4 + (pb.y - pa.y) * t1);
      }
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2 - 4;
      const heart = this.add.image(mx, my, ensureTex(this, 'kc_heart', () => {
        const p = new Pix(7, 6);
        p.map(0, 0, ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: C.pink });
        p.outline(C.outline);
        return p;
      }));
      this.seatLayer.add(heart);
      this.tweens.add({ targets: heart, scale: 1.3, duration: 500, yoyo: true, repeat: -1 });
    }
    const crowded = n > 8;
    const ann = s.sub === 'result' ? s.announce : null;
    const drinkers = new Set(ann?.drink ? [...ann.main, ...ann.extra.map((e) => e.id)] : []);
    const race = s.race;
    s.order.forEach((id, i) => {
      const p = playerById(id);
      const { x, y } = pos.get(id)!;
      const c = this.add.container(x, y);
      this.seatLayer.add(c);
      if (id === s.drawer && s.sub !== 'over') {
        const glow = this.add.ellipse(0, 6, 40, 14, 0xffd25e, 0.55);
        c.add(glow);
        this.tweens.add({ targets: glow, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
      }
      if (s.chain?.turn === id && s.sub === 'chain') c.add(this.add.ellipse(0, 6, 40, 14, 0x8fd3ff, 0.7));
      const img = this.add.image(0, 0, p ? ensurePortrait(this, p.look) : '__WHITE').setScale(2).setOrigin(0.5, 0.75);
      if (p && !p.connected) img.setAlpha(0.4);
      c.add(img);
      const nm = p ? p.name.replace(/^Bot\s+/, '') : '?';
      c.add(nameTag(this, 0, 9, nm.slice(0, crowded ? 5 : 7), id === s.drawer ? RED_INK : INK));
      // Strichliste
      const cnt = s.drinks[id] ?? 0;
      if (cnt) {
        c.add(this.add.image(19, -14, ensureTex(this, 'kc_mug', mugPix)));
        c.add(txt(this, 26, -18, String(cnt), { origin: [0, 0], color: GOLD }));
      }
      if (s.qm === id) {
        const crown = this.add.image(0, -28, ensureTex(this, 'kc_crown', crownPix));
        c.add(crown);
        c.add(txt(this, 0, -42, '?', { color: GOLD }));
      }
      if (id === s.drawer && s.sub === 'draw') {
        const arrow = txt(this, 0, -44, '▼', { color: GOLD });
        c.add(arrow);
        this.tweens.add({ targets: arrow, y: -38, duration: 350, yoyo: true, repeat: -1 });
      }
      // Knopf-Rennen: Häkchen / Zeiten
      if (race && race.players.includes(id)) {
        const t = race.times[id];
        // Oberster Platz: Zeit unter das Namensschild, sonst ragt sie aus dem Bild
        if (t !== undefined) c.add(txt(this, 0, y < 50 ? 24 : -38, race.phase === 'go' ? 'OK!' : (t / 1000).toFixed(2).replace('.', ','), { color: race.slow.includes(id) ? '#ff8a7a' : '#a8f0a0' }));
      }
      if (race?.phase === 'done' && race.slow.includes(id)) {
        const snail = this.add.image(-24, -2, ensureTex(this, 'kc_snail', snailPix)).setScale(1.5);
        c.add(snail);
        snail.x = -80;
        this.tweens.add({ targets: snail, x: -24, duration: 900, ease: 'Sine.out' });
      }
      if (drinkers.has(id)) {
        const mug = this.add.image(0, -40, ensureTex(this, 'kc_mug', mugPix)).setScale(2);
        c.add(mug);
        this.tweens.add({ targets: mug, y: -46, angle: -20, duration: 300, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: img, y: -3, duration: 160, yoyo: true, repeat: 5 });
      }
      if (s.sub === 'waterfall' && s.waterfall?.includes(id)) {
        const drop = this.add.image(-18, -16, ensureTex(this, 'kc_drop', dropPix)).setName(`drop-${s.waterfall.indexOf(id)}`);
        c.add(drop);
        this.tweens.add({ targets: drop, y: -12, duration: 250 + i * 13, yoyo: true, repeat: -1 });
      }
      c.setName(`seat-${id}`);
    });
  }

  // ---------------------------------------------------------------- Seitenleiste

  private drawSide(s: KingsState) {
    this.clear(this.sideLayer);
    const L = this.sideLayer;
    L.add(panel(this, SIDE_X, 4, SIDE_W, 262));
    const cx = SIDE_X + SIDE_W / 2;
    L.add(ink(this, cx, 12, 'KINGS CUP', { color: RED_INK }));
    L.add(ink(this, cx, 24, `Karte ${s.drawn}/${s.total}`));
    // Aktuelle Karte
    let y = 38;
    if (s.card) {
      const face = this.add.image(SIDE_X + 10, y, ensureTex(this, `kc_face_${s.card.suit}`, () => cardFace(s.card!.suit))).setOrigin(0, 0).setScale(0.8);
      L.add(face);
      L.add(ink(this, SIDE_X + 14, y + 3, cardLabel(s.card.rank), { origin: [0, 0], color: s.card.suit < 2 ? '#c0392b' : '#2d2d3a' }));
      L.add(ink(this, SIDE_X + 40, y + 2, KINGS_RULES[s.card.rank].title, { origin: [0, 0], wrap: SIDE_W - 46, align: 'left' }));
    } else {
      L.add(ink(this, cx, y + 8, 'Wer zieht?', { color: '#7a5a3a' }));
    }
    y = 78;
    L.add(this.add.rectangle(SIDE_X + 8, y, SIDE_W - 16, 1, 0xd3ad6c).setOrigin(0, 0));
    L.add(ink(this, cx, y + 5, 'REGELN', { color: RED_INK }));
    y += 18;
    if (!s.rules.length) L.add(ink(this, cx, y + 4, 'Noch keine –\nzieht einen Buben!', { color: '#7a5a3a' }));
    s.rules.forEach((r, i) => {
      const short = r.text.length > 32 ? `${r.text.slice(0, 30).trimEnd()}...` : r.text;
      const t = ink(this, SIDE_X + 10, y, `${i + 1}. ${short}`, { origin: [0, 0], wrap: SIDE_W - 18, align: 'left', color: i === s.rules.length - 1 ? GREEN_INK : INK });
      L.add(t);
      y += Math.min(t.height, 30) + 4;
    });
    // Fragenmeister + Hinweis
    const qy = 222;
    L.add(this.add.rectangle(SIDE_X + 8, qy, SIDE_W - 16, 1, 0xd3ad6c).setOrigin(0, 0));
    L.add(this.add.image(SIDE_X + 16, qy + 12, ensureTex(this, 'kc_crown', crownPix)));
    L.add(ink(this, SIDE_X + 28, qy + 5, 'Fragenmeister:', { origin: [0, 0], color: '#7a5a3a' }));
    L.add(ink(this, SIDE_X + 28, qy + 16, s.qm ? (playerById(s.qm)?.name ?? '?').slice(0, 13) : '– keiner –', { origin: [0, 0], color: s.qm ? RED_INK : '#7a5a3a' }));
    L.add(ink(this, cx, qy + 30, 'Wasser zählt auch!', { color: '#3f8fe0' }));
  }

  // ---------------------------------------------------------------- Mitte: Aktionen

  private name(id: string | null | undefined) {
    return playerById(id)?.name ?? '?';
  }

  private box(h: number, y = TY - h / 2) {
    const r = this.add.rectangle(TX, y, 236, h, 0x14241a, 0.86).setOrigin(0.5, 0).setStrokeStyle(2, 0xffd25e, 0.9);
    this.fxLayer.add(r);
    return y;
  }

  private drawFx(s: KingsState) {
    this.clear(this.fxLayer);
    this.live = null;
    this.cupImg.setVisible(s.sub === 'draw' || s.sub === 'over');
    const F = this.fxLayer;
    const card = s.card;
    const rule = card ? KINGS_RULES[card.rank] : null;
    switch (s.sub) {
      case 'draw': {
        const y = TY + 50;
        F.add(txt(this, TX, y - 4, `${this.name(s.drawer)} zieht ...`, { color: GOLD }));
        break;
      }
      case 'reveal':
        this.drawReveal(s);
        break;
      case 'pick': {
        const y = this.box(54);
        F.add(txt(this, TX, y + 8, rule!.title.toUpperCase(), { color: GOLD }));
        F.add(txt(this, TX, y + 24, s.pickFor === 'mate' ? `${this.name(s.drawer)} sucht\neinen Kumpel ...` : `${this.name(s.drawer)} sucht aus,\nwer trinkt ...`, { wrap: 220 }));
        break;
      }
      case 'race':
        this.drawRace(s);
        break;
      case 'word':
      case 'rule': {
        const y = this.box(54);
        F.add(txt(this, TX, y + 8, rule!.title.toUpperCase(), { color: GOLD }));
        const t = txt(this, TX, y + 26, `${this.name(s.drawer)} überlegt`, { wrap: 220 });
        F.add(t);
        let dots = 0;
        this.live = () => {
          const d = Math.floor(this.time.now / 400) % 4;
          if (d !== dots) t.setText(`${this.name(s.drawer)} überlegt${'.'.repeat((dots = d))}`);
        };
        break;
      }
      case 'chain':
        this.drawChain(s);
        break;
      case 'waterfall':
        this.drawWaterfall(s);
        break;
      case 'result':
        this.drawResult(s);
        break;
      case 'over': {
        const y = this.box(44, TY + 30);
        F.add(txt(this, TX, y + 8, 'DER BECHER IST LEER!', { color: GOLD }));
        F.add(txt(this, TX, y + 24, 'Gleich kommt die Strichliste ...'));
        break;
      }
    }
  }

  private drawReveal(s: KingsState) {
    const F = this.fxLayer;
    const card = s.card!;
    const rule = KINGS_RULES[card.rank];
    F.add(this.add.rectangle(0, 0, SIDE_X - 2, WORLD.H, 0x0d1710, 0.78).setOrigin(0, 0));
    const holder = this.add.container(70, TY);
    holder.add(this.add.image(0, 0, ensureTex(this, `kc_face_${card.suit}`, () => cardFace(card.suit))).setScale(2));
    holder.add(ink(this, -24, -38, cardLabel(card.rank), { size: 16, origin: [0, 0], color: card.suit < 2 ? '#c0392b' : '#2d2d3a' }));
    holder.add(ink(this, 0, -8, cardLabel(card.rank), { size: 24, color: card.suit < 2 ? '#c0392b' : '#2d2d3a' }).setOrigin(0.5, 0.5).setAlpha(0.18));
    F.add(holder);
    holder.setScale(0, 1);
    this.tweens.add({ targets: holder, scaleX: 1, duration: 260, delay: 300, ease: 'Back.out' });
    F.add(txt(this, 124, 30, `${this.name(s.drawer)} zieht:`, { origin: [0, 0], color: '#9fd8a8' }));
    const title = txt(this, 124, 50, rule.title, { size: 16, origin: [0, 0], wrap: 190, align: 'left', color: GOLD });
    F.add(title);
    F.add(txt(this, 124, 58 + title.height, rule.text, { origin: [0, 0], wrap: 190, align: 'left' }));
    title.setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 300, delay: 500 });
    if (card.rank === 14 || card.rank === 13) this.cameras.main.flash(250, 255, 220, 120);
  }

  private drawRace(s: KingsState) {
    const F = this.fxLayer;
    const r = s.race!;
    const label = KINGS_RACE[s.card!.rank].button;
    const y = this.box(74);
    const how = r.kind === 'boden' ? 'Hand auf den Boden!' : r.kind === 'himmel' ? 'Hände in den Himmel!' : `${this.name(s.drawer)} ist König – rudert!`;
    F.add(txt(this, TX, y + 6, how, { color: '#9fd8a8', wrap: 226 }));
    const big = txt(this, TX, y + 26, '', { size: 24, color: GOLD });
    F.add(big);
    const sub = txt(this, TX, y + 56, '', {});
    F.add(sub);
    if (r.phase === 'ready') {
      sub.setText(`Gleich am Handy: ${label}`);
      let last = '';
      this.live = () => {
        const ms = this.timer.remaining;
        const t = ms > 3000 ? 'ACHTUNG' : String(Math.max(1, Math.ceil(ms / 1000)));
        if (t !== last) {
          last = t;
          big.setText(t).setFontSize(t.length > 2 ? 16 : 24).setScale(1.6);
          this.tweens.add({ targets: big, scale: 1, duration: 250 });
        }
      };
    } else {
      big.setText('JETZT!').setColor('#ff6a5a');
      this.cameras.main.flash(160, 255, 255, 255);
      this.tweens.add({ targets: big, scale: 1.25, duration: 120, yoyo: true, repeat: -1 });
      this.live = (st) => {
        const rr = st.race;
        if (!rr) return;
        sub.setText(`${label}! ${Object.keys(rr.times).length}/${rr.players.length} gedrückt`);
      };
    }
  }

  private drawChain(s: KingsState) {
    const F = this.fxLayer;
    const c = s.chain!;
    const y = this.box(84);
    F.add(txt(this, TX, y + 6, c.mode === 'reim' ? 'REIMT AUF' : 'KATEGORIE', { color: '#9fd8a8' }));
    F.add(txt(this, TX, y + 20, c.word, { size: 16, color: GOLD, wrap: 228 }));
    F.add(txt(this, TX, y + 44, `Dran: ${this.name(c.turn)}`, { color: LIGHT }));
    F.add(txt(this, TX, y + 72, `${c.step}/${c.maxSteps} · Schiri: ${this.name(s.drawer).slice(0, 10)}`, { color: '#9fd8a8' }));
    const bw = 180;
    F.add(this.add.rectangle(TX - bw / 2, y + 58, bw, 6, 0x2d1b12).setOrigin(0, 0));
    const bar = this.add.rectangle(TX - bw / 2, y + 58, bw, 6, 0x7fd47f).setOrigin(0, 0);
    F.add(bar);
    this.live = () => {
      const f = Math.max(0, this.timer.remaining / KINGS.CHAIN_TURN_MS);
      bar.width = bw * f;
      bar.fillColor = f > 0.5 ? 0x7fd47f : f > 0.2 ? 0xf2c33a : 0xe04a3f;
    };
  }

  private drawWaterfall(s: KingsState) {
    const F = this.fxLayer;
    const order = s.waterfall ?? [];
    const y = this.box(64, TY - 32);
    const t = txt(this, TX, y + 6, 'WASSERFALL!', { size: 16, color: '#8fd3ff' });
    F.add(t);
    this.tweens.add({ targets: t, scale: 1.1, duration: 400, yoyo: true, repeat: -1 });
    F.add(txt(this, TX, y + 28, 'Alle trinken! Aufhören erst,\nwenn der Vordermann aufhört.', { wrap: 228 }));
    const info = txt(this, TX, y + 50, '', { color: GOLD });
    F.add(info);
    // Wasserstrahl am Becher entlang
    const total = this.fxTotal || 1;
    const per = total / (order.length + 1);
    let lastIdx = -2;
    this.live = () => {
      const elapsed = total - this.timer.remaining;
      const idx = Math.min(order.length - 1, Math.floor(elapsed / per) - 1);
      if (idx === lastIdx) return;
      lastIdx = idx;
      info.setText(idx < 0 ? `${this.name(order[0])} fängt an ...` : idx >= order.length - 1 ? 'Alle dürfen aufhören!' : `${this.name(order[idx + 1])} darf aufhören`);
      // Tropfen der Spieler, die aufhören durften, verschwinden
      for (let k = 0; k <= idx; k++) {
        const seat = this.seatLayer.getByName(`seat-${order[k]}`) as Phaser.GameObjects.Container | null;
        const drop = seat?.getByName(`drop-${k}`) as Phaser.GameObjects.Image | null;
        if (drop?.visible) {
          this.tweens.killTweensOf(drop);
          drop.setVisible(false);
          const ok = txt(this, seat!.x, seat!.y - 40, 'STOP', { color: '#a8f0a0' });
          F.add(ok);
          this.tweens.add({ targets: ok, y: seat!.y - 48, alpha: 0, duration: 1200 });
        }
      }
    };
  }

  private drawResult(s: KingsState) {
    const F = this.fxLayer;
    const a = s.announce;
    if (!a) return;
    const lines: string[] = [];
    for (const e of a.extra) lines.push(`+ Kumpel ${this.name(e.id)}`);
    const extraTxt = lines.slice(0, 4).join('\n') + (lines.length > 4 ? `\n+ ${lines.length - 4} weitere` : '');
    const h = 50 + (extraTxt ? Math.min(5, lines.length) * 12 : 0) + (a.note ? 12 : 0);
    const y = this.box(h);
    const title = txt(this, TX, y + 8, a.title, { size: a.title.length > 16 ? 8 : 16, color: a.drink ? '#ff8a7a' : GOLD, wrap: 226 });
    F.add(title);
    title.setScale(0.2);
    this.tweens.add({ targets: title, scale: 1, duration: 320, ease: 'Back.out' });
    let yy = y + 14 + title.height;
    if (extraTxt) {
      const ex = txt(this, TX, yy, extraTxt, { color: '#f7a8c8' });
      F.add(ex);
      yy += ex.height + 4;
    }
    if (a.note) F.add(txt(this, TX, yy + 2, a.note, { color: '#9fd8a8', wrap: 226 }));
    if (a.drink && s.race?.slow.length) this.cameras.main.shake(300, 0.012);
  }

  private popFooled(s: KingsState) {
    const f = s.fooled!;
    this.clear(this.popLayer);
    const extra = f.extra.length ? ` + Kumpel ${f.extra.map((id) => this.name(id)).join(', ')}` : '';
    const box = this.add.container(TX, 14);
    box.add(this.add.rectangle(0, 0, 300, 26, 0x5a2430, 0.95).setStrokeStyle(2, 0xffd25e));
    box.add(txt(this, 0, -8, `${this.name(f.id)} ist auf den Fragenmeister`, {}));
    box.add(txt(this, 0, 2, `reingefallen – trink!${extra}`.slice(0, 36), { color: GOLD }));
    this.popLayer.add(box);
    box.y = -20;
    this.tweens.add({ targets: box, y: 16, duration: 300, ease: 'Back.out' });
    this.tweens.add({ targets: box, alpha: 0, delay: 2800, duration: 400 });
  }
}

