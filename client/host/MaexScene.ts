import Phaser from 'phaser';
import type { GameState, MaexState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { MAEXCHEN, maexLabel, maexSpoken } from '../../shared/maexchen';
import { C } from '../art/palette';
import { Pix, rng } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, GOLD, INK, RED_INK, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

// Runder Tisch am Pool, Spieler im Kreis darum (oben beginnend, im Uhrzeigersinn)
const TX = 240;
const TY = 150;
const SEAT_RX = 186;
const SEAT_RY = 88;
const CUP_Y = TY + 14;
/** Wohin der Becher beim Aufdecken kippt (rechts neben die Würfel) */
const CUP_LIFT = { x: TX + 66, y: CUP_Y - 6, angle: 28 };

const seatPos = (i: number, n: number) => {
  const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  return { x: TX + Math.cos(a) * SEAT_RX, y: TY - 4 + Math.sin(a) * SEAT_RY };
};

// ------------------------------------------------------------------ Pixel-Art

/** Pool-Terrasse am Abend: Abendhimmel, Pool mit Unterwasserlicht, Steinplatten, Holztisch mit Würfelfilz */
function paintPool(p: Pix) {
  const r = rng(4711);
  const sky = ['#2b2350', '#3a2b62', '#55336f', '#7a3b74', '#a8476e', '#d0605f', '#ec8b5a'];
  sky.forEach((c, i) => p.rect(0, i * 5, WORLD.W, 5, c));
  p.disc(404, 36, 13, '#ffd27a');
  p.disc(404, 36, 10, '#ffe7a8');
  for (let i = 0; i < 26; i++) p.px(Math.floor(r() * WORLD.W), Math.floor(r() * 14), '#e8dcff');
  // Hecke + Palmen als Silhouette
  p.rect(0, 30, WORLD.W, 8, '#2a1a2e');
  for (let x = 0; x < WORLD.W; x += 6) p.rect(x, 27 + Math.floor(r() * 3), 6, 4, '#2a1a2e');
  for (const [px, h] of [[26, 30], [70, 22], [446, 28]] as const) {
    for (let y = 0; y < h; y++) p.rect(px + Math.round(Math.sin(y / 6) * 2), 34 - y, 2, 1, '#1f1430');
    const ty = 34 - h;
    for (let k = -9; k <= 9; k++) {
      p.px(px + k, ty + Math.abs(k) * 0.45, '#1f1430').px(px + k, ty + 1 + Math.abs(k) * 0.5, '#1f1430');
    }
  }
  // Lichterkette
  for (let x = 0; x < WORLD.W; x += 2) {
    const y = 6 + Math.sin((x / WORLD.W) * Math.PI * 3) * 4 + 4;
    p.px(x, y, '#1a1024');
    if (x % 20 === 0) p.rect(x - 1, y + 1, 3, 3, [C.gold, C.pink, '#8fd3ff', C.green][(x / 20) % 4]);
  }
  // Pool
  p.rect(0, 38, WORLD.W, 4, '#e8dcc2');
  p.rect(0, 42, WORLD.W, 50, '#2a74b8');
  p.rect(0, 42, WORLD.W, 3, '#1f5a94');
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * WORLD.W);
    const y = 46 + Math.floor(r() * 44);
    p.rect(x, y, 4 + Math.floor(r() * 8), 1, r() < 0.5 ? '#4aa2dc' : '#6fc0ee');
  }
  for (const lx of [60, 180, 300, 420]) {
    p.ellipse(lx, 80, 14, 6, '#4fb0e8');
    p.ellipse(lx, 80, 7, 3, '#9fe3ff');
  }
  p.rect(0, 92, WORLD.W, 4, '#e8dcc2');
  p.rect(0, 96, WORLD.W, 1, '#b89a70');
  // Steinplatten
  p.rect(0, 97, WORLD.W, WORLD.H - 97, '#d4b386');
  for (let y = 97; y < WORLD.H; y += 16) p.rect(0, y, WORLD.W, 1, '#bf9d6f');
  for (let y = 97; y < WORLD.H; y += 16) for (let x = (y / 16) % 2 ? 0 : 12; x < WORLD.W; x += 24) p.rect(x, y, 1, 16, '#bf9d6f');
  p.overlayOn(() => p.speckle(0, 97, WORLD.W, WORLD.H - 97, '#dcc096', 500, r));
  // Tisch: Schatten, Holzrand, Platte, Würfelfilz
  p.ellipse(TX + 4, TY + 12, 104, 56, '#b8976a');
  p.ellipse(TX, TY + 5, 102, 56, C.woodDarker);
  p.ellipse(TX, TY, 102, 56, C.woodDark);
  p.ellipse(TX, TY - 1, 98, 53, C.wood);
  p.overlayOn(() => {
    for (let y = TY - 54; y < TY + 54; y += 7) p.rect(TX - 100, y, 200, 1, '#a5683a');
  });
  p.ellipse(TX, TY + 6, 58, 30, '#3a1f10');
  p.ellipse(TX, TY + 5, 56, 28, '#1f5a2e');
  p.ellipse(TX, TY + 5, 53, 26, '#2a7a3c');
  p.overlayOn(() => p.speckle(TX - 53, TY - 21, 106, 52, '#2f8a44', 160, r));
  // Cocktailgläser am Rand
  for (const [gx, gy, col] of [[TX - 82, TY - 10, C.pink], [TX + 78, TY - 18, C.gold], [TX + 70, TY + 24, '#8fd3ff']] as const) {
    p.rect(gx - 3, gy - 6, 7, 5, col).rect(gx, gy - 1, 1, 4, '#e8f4ff').rect(gx - 2, gy + 3, 5, 1, '#e8f4ff');
    p.px(gx + 2, gy - 8, C.green).px(gx + 3, gy - 9, C.green);
  }
}

function cupPix(): Pix {
  const p = new Pix(26, 30);
  for (let y = 2; y < 28; y++) {
    const w = 16 + Math.floor(((y - 2) / 25) * 8);
    const x0 = 13 - w / 2;
    p.rect(x0, y, w, 1, '#7a3b2e');
    p.rect(x0, y, 2, 1, '#a5502e');
    p.rect(x0 + w - 3, y, 3, 1, '#4a2018');
  }
  p.ellipse(13, 2.5, 8, 2, '#5a2a20');
  p.rect(1, 26, 24, 2, '#c9a24a');
  for (let x = 2; x < 24; x += 3) p.px(x, 24, '#c9a24a');
  p.rect(9, 10, 8, 6, '#c9a24a').rect(10, 11, 6, 4, '#7a3b2e');
  p.px(12, 12, '#fbf6ea').px(14, 13, '#fbf6ea');
  p.outline(C.outline);
  return p;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function diePix(n: number): Pix {
  const p = new Pix(14, 14);
  p.rect(2, 1, 10, 12, '#fbf6ea').rect(1, 2, 12, 10, '#fbf6ea');
  p.rect(2, 12, 10, 1, '#d9cdb4').rect(12, 2, 1, 10, '#d9cdb4');
  for (const [cx, cy] of PIPS[n]) p.rect(3 + cx * 3, 3 + cy * 3, 2, 2, n === 1 ? C.red : C.outline);
  p.outline(C.outline);
  return p;
}

function heartPix(full: boolean): Pix {
  const p = new Pix(9, 8);
  p.map(1, 1, ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: full ? '#e0503f' : '#6e5a52' });
  if (full) p.px(2, 2, '#ffb0a0');
  p.outline(C.outline);
  return p;
}

function mugPix(): Pix {
  const p = new Pix(9, 9);
  p.map(0, 0, ['.wwwww..', 'wwwwwww.', 'yyyyyy..', 'yyyyyyyy', 'yyyyyy.y', 'yyyyyy.y', 'yyyyyyyy', 'yyyyyy..'], { w: '#fff8e0', y: C.orange });
  p.outline(C.outline);
  return p;
}

// ------------------------------------------------------------------ Szene

export class MaexScene extends Phaser.Scene {
  private seatLayer!: Phaser.GameObjects.Container;
  private tableLayer!: Phaser.GameObjects.Container;
  private hudLayer!: Phaser.GameObjects.Container;
  private bubbleLayer!: Phaser.GameObjects.Container;
  private juice!: Juice;
  private cup!: Phaser.GameObjects.Image;
  private dice: Phaser.GameObjects.Image[] = [];
  private clock!: Phaser.GameObjects.Text;
  private timer = new Countdown();
  private keys = { seat: '', table: '', hud: '' };
  /** Zuletzt gesehener Zustand (für Übergänge: Ton, Sprecher, Juice) */
  private prev: MaexState | null = null;

  constructor() {
    super('maexchen');
  }

  create() {
    this.keys = { seat: '', table: '', hud: '' };
    this.prev = null;
    this.dice = [];
    this.timer = new Countdown();
    background(this, 'maexchen', WORLD.W, WORLD.H, paintPool);
    this.tableLayer = this.add.container(0, 0);
    this.dice = [0, 1].map((i) => this.add.image(TX - 11 + i * 22, CUP_Y - 6, ensureTex(this, 'mx_die_1', () => diePix(1))).setScale(2).setVisible(false));
    this.cup = this.add.image(TX, CUP_Y, ensureTex(this, 'mx_cup', cupPix)).setScale(2).setOrigin(0.5, 1);
    this.seatLayer = this.add.container(0, 0);
    this.hudLayer = this.add.container(0, 0);
    this.bubbleLayer = this.add.container(0, 0);
    this.clock = txt(this, 466, 8, '', { origin: [1, 0], color: GOLD }).setDepth(10);
    this.juice = new Juice(this, { depth: 500 });
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const secs = this.timer.none ? 0 : this.timer.seconds;
    const s = getState()?.mini;
    const show = s?.kind === 'maexchen' && (s.state.sub === 'roll' || s.state.sub === 'announce') && secs > 0;
    this.clock.setText(show ? `⏱ ${secs}` : '');
    this.clock.setColor(secs <= 5 ? '#ff8a7a' : GOLD);
  }

  private clear(layer: Phaser.GameObjects.Container) {
    const kill = (o: Phaser.GameObjects.GameObject) => {
      this.tweens.killTweensOf(o);
      if (o instanceof Phaser.GameObjects.Container) o.list.forEach(kill);
    };
    layer.list.forEach(kill);
    layer.removeAll(true);
  }

  private name(id: string | null | undefined) {
    return tagName(playerById(id)?.name ?? '?');
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'maexchen') return;
    const s = gs.mini.state;
    const seat = JSON.stringify([
      s.order.map((id) => {
        const p = playerById(id);
        return p ? [p.name, p.look, p.connected] : null;
      }),
      s.turn, s.sub, s.claim, s.lives, s.sips, s.reveal?.loser,
    ]);
    if (seat !== this.keys.seat) {
      this.keys.seat = seat;
      this.drawSeats(s);
    }
    const table = `${s.sub}-${s.phaseNo}`;
    if (table !== this.keys.table) {
      this.keys.table = table;
      this.timer.set(s.endsIn);
      const prev = this.prev;
      this.drawTable(s);
      if (prev) this.transition(prev, s);
    }
    const hud = `${s.round}-${s.rounds}-${s.drink}`;
    if (hud !== this.keys.hud) {
      this.keys.hud = hud;
      this.drawHud(s);
    }
    this.prev = s;
  }

  // ---------------------------------------------------------------- Kopfzeile

  private drawHud(s: MaexState) {
    this.clear(this.hudLayer);
    this.hudLayer.add(panel(this, 4, 3, 172, 22));
    this.hudLayer.add(ink(this, 90, 10, `MÄXCHEN · Runde ${s.round}/${s.rounds}`, { color: RED_INK }));
    // Rangfolge als Spickzettel
    this.hudLayer.add(txt(this, 5, 259, '31-65 < Pasch < Mäxchen', { origin: [0, 0], color: '#fff4d6' }));
    this.hudLayer.add(txt(this, 475, 259, s.drink ? 'Mäxchen: 2 Schluck' : 'Mäxchen: 2 Leben', { origin: [1, 0], color: '#fff4d6' }));
  }

  // ---------------------------------------------------------------- Sitzplätze

  private drawSeats(s: MaexState) {
    this.clear(this.seatLayer);
    this.clear(this.bubbleLayer);
    const n = s.order.length;
    const crowded = n > 8;
    s.order.forEach((id, i) => {
      const p = playerById(id);
      const { x, y } = seatPos(i, n);
      const c = this.add.container(x, y);
      this.seatLayer.add(c);
      const out = !s.drink && (s.lives[id] ?? 0) <= 0;
      const active = id === s.turn && s.sub !== 'over' && !out;
      if (active) {
        const glow = this.add.ellipse(0, 6, 42, 15, 0xffd25e, 0.6);
        c.add(glow);
        this.tweens.add({ targets: glow, alpha: 0.15, duration: 550, yoyo: true, repeat: -1 });
      }
      const img = this.add.image(0, 0, p ? ensurePortrait(this, p.look) : '__WHITE').setScale(2).setOrigin(0.5, 0.75);
      if (out || (p && !p.connected)) img.setAlpha(0.35);
      c.add(img);
      c.add(nameTag(this, 0, 9, this.name(id), active ? RED_INK : INK, crowded ? 50 : 64));
      if (s.drink) {
        const cnt = s.sips[id] ?? 0;
        if (cnt) {
          c.add(this.add.image(18, -14, ensureTex(this, 'mx_mug', mugPix)));
          c.add(txt(this, 24, -18, String(cnt), { origin: [0, 0], color: GOLD }));
        }
      } else if (out) {
        c.add(txt(this, 0, -30, 'RAUS', { color: '#ff8a7a' }));
      } else {
        const lives = s.lives[id] ?? 0;
        // Viele Spieler: Herzen senkrecht neben den Kopf (zur Tischmitte hin), sonst als Reihe darüber
        const inner = x > TX ? -1 : 1;
        for (let k = 0; k < 3; k++) {
          const hx = crowded ? inner * 22 : (k - 1) * 9;
          const hy = crowded ? -18 + k * 8 : -27;
          c.add(this.add.image(hx, hy, ensureTex(this, `mx_heart_${k < lives}`, () => heartPix(k < lives))));
        }
      }
      if (active && (s.sub === 'roll' || s.sub === 'announce')) {
        const arrow = txt(this, 0, -46, '▼', { color: GOLD });
        c.add(arrow);
        this.tweens.add({ targets: arrow, y: -41, duration: 320, yoyo: true, repeat: -1 });
      }
    });
    // Sprechblase: letzte Ansage über dem, der sie gemacht hat
    if (s.claim && (s.sub === 'roll' || s.sub === 'lift')) this.bubble(s, s.claim.by, maexLabel(s.claim.value), s.claim.value === MAEXCHEN);
  }

  private bubble(s: MaexState, id: string, text: string, hot: boolean) {
    const i = s.order.indexOf(id);
    if (i < 0) return;
    const { x, y } = seatPos(i, s.order.length);
    const label = ink(this, 0, 0, text, { color: hot ? RED_INK : INK, size: text.length > 4 ? 8 : 16 });
    const w = Math.max(30, label.width + 12);
    const h = label.height + 8;
    // Unten vor dem Tisch: Blase neben den Kopf (sonst landet sie auf dem Tisch), sonst darüber
    const side = y > TY && Math.abs(x - TX) < 130 ? (x > TX ? 1 : x < TX ? -1 : 1) : 0;
    const bx = side ? x + side * (w / 2 + 20) : Phaser.Math.Clamp(x, w / 2 + 4, WORLD.W - w / 2 - 4);
    const by = side ? y - 8 : Math.max(h / 2 + 2, y - 52);
    const c = this.add.container(bx, by);
    const g = this.add.graphics();
    const fill = hot ? 0xffe08a : 0xfff4d6;
    g.fillStyle(0x2d1b12, 1).fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 4);
    g.fillStyle(fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 3);
    if (side) {
      const ex = (-side * w) / 2;
      g.fillStyle(0x2d1b12, 1).fillTriangle(ex, -5, ex, 5, ex - side * 8, 0);
      g.fillStyle(fill, 1).fillTriangle(ex + side, -3.5, ex + side, 3.5, ex - side * 5.5, 0);
    } else {
      const tx = Phaser.Math.Clamp(x - bx, -w / 2 + 6, w / 2 - 6);
      g.fillStyle(0x2d1b12, 1).fillTriangle(tx - 5, h / 2, tx + 5, h / 2, tx, h / 2 + 7);
      g.fillStyle(fill, 1).fillTriangle(tx - 3.5, h / 2 - 1, tx + 3.5, h / 2 - 1, tx, h / 2 + 5);
    }
    c.add(g);
    label.setPosition(0, -label.height / 2 + 0.5);
    c.add(label);
    this.bubbleLayer.add(c);
    c.setScale(0.3);
    this.tweens.add({ targets: c, scale: 1, duration: 260, ease: 'Back.Out' });
  }

  // ---------------------------------------------------------------- Tisch: Becher, Würfel, Status

  private drawTable(s: MaexState) {
    this.clear(this.tableLayer);
    this.tweens.killTweensOf(this.cup);
    this.cup.setAngle(0).setAlpha(1).setY(CUP_Y).setX(TX);
    const r = s.reveal;
    const showDice = s.sub === 'reveal' && !!r?.dice;
    this.dice.forEach((d, i) => {
      this.tweens.killTweensOf(d);
      d.setVisible(showDice).setScale(2).setY(CUP_Y - 6);
      if (showDice) d.setTexture(ensureTex(this, `mx_die_${r!.dice![i]}`, () => diePix(r!.dice![i])));
    });
    if (showDice) this.cup.setPosition(CUP_LIFT.x, CUP_LIFT.y).setAngle(CUP_LIFT.angle);
    this.cup.setVisible(s.sub !== 'over');
    const L = this.tableLayer;
    // Zwei Zeilen auf dem Tisch unter dem Becher (auf Filzbreite verkleinert statt umbrochen)
    const line = (t: string, color = '#fff4d6', row = 0) => L.add(fitText(txt(this, TX, TY + 22 + row * 15, t, { color }), 196, 0.55));
    const turn = this.name(s.turn);
    const hist = s.chain.slice(-5).map((c) => maexLabel(c.value).replace('er-Pasch', 'er-P.').replace('MÄXCHEN', 'MÄX')).join(' › ');
    switch (s.sub) {
      case 'roll':
        if (!s.claim) {
          line(`${turn} beginnt`, GOLD);
          line('Schütteln = würfeln', '#cfe8c8', 1);
        } else {
          line(s.claim.value === MAEXCHEN ? `Glaubt ${turn} das?` : `Glaubt ${turn}?`, s.claim.value === MAEXCHEN ? '#ffb0a0' : GOLD);
          line(hist, '#cfe8c8', 1);
        }
        break;
      case 'announce':
        line(`${turn} schaut nach …`);
        if (hist) line(hist, '#cfe8c8', 1);
        break;
      case 'lift':
        line(`${this.name(r?.doubter)} deckt auf!`, '#ffb0a0');
        line(`${this.name(r?.by)} sagte ${maexLabel(r?.claimed ?? 0)}`, GOLD, 1);
        break;
      case 'reveal':
        if (!r) break;
        if (r.accepted) {
          line(`${this.name(r.doubter)} glaubt es`, '#ffb0a0');
          line(`${this.costText(s, r.cost)} – ohne Aufdecken`, '#fff4d6', 1);
          L.add(txt(this, TX, TY - 6, '?', { size: 24, color: GOLD }));
        } else {
          line(`${this.name(r.loser)} ${this.costText(s, r.cost)}`, r.lied ? '#ff8a7a' : '#a8f0a0');
          line(`Wurf ${maexLabel(r.actual ?? 0)} · Ansage ${maexLabel(r.claimed)}`, '#fff4d6', 1);
        }
        break;
      case 'over':
        line('Spiel vorbei!', GOLD);
        break;
    }
  }

  private costText(s: MaexState, cost: number) {
    if (s.drink) return cost === 1 ? 'trinkt!' : `trinkt ${cost}!`;
    return cost === 1 ? '−1 Leben' : `−${cost} Leben`;
  }

  // ---------------------------------------------------------------- Übergänge: Ton, Sprecher, Juice

  private seatXY(s: MaexState, id: string | null | undefined) {
    const i = id ? s.order.indexOf(id) : -1;
    return i < 0 ? { x: TX, y: TY } : seatPos(i, s.order.length);
  }

  private transition(prev: MaexState, s: MaexState) {
    // Becher geschüttelt → Klackern
    if (s.sub === 'announce' && s.rollSeq !== prev.rollSeq) {
      for (let k = 0; k < 7; k++) sfx('tick', { delay: k * 0.07, pitch: 0.8 + Math.random() * 0.6, x: TX });
      this.tweens.add({ targets: this.cup, angle: { from: -14, to: 14 }, duration: 70, yoyo: true, repeat: 4, onComplete: () => this.cup.setAngle(0) });
      this.tweens.add({ targets: this.cup, y: CUP_Y - 6, duration: 90, yoyo: true, repeat: 2 });
      this.juice.burst(TX, CUP_Y, 'puff', 6);
    }
    // Neue Ansage
    if (s.claim && s.claim !== prev.claim && (!prev.claim || prev.claim.by !== s.claim.by || prev.claim.value !== s.claim.value)) {
      const who = spokenName(playerById(s.claim.by)?.name);
      say(`${who} sagt: ${maexSpoken(s.claim.value)}`);
      if (s.claim.value === MAEXCHEN) {
        sfx('fanfare');
        this.juice.banner('MÄXCHEN?!', `${tagName(playerById(s.claim.by)?.name ?? '?')} behauptet es …`, 1300);
        this.juice.zoomPunch(0.06);
      } else sfx('pop', { pitch: 0.9 + Math.min(0.6, s.chain.length * 0.08) });
    }
    if (s.sub === 'lift' && prev.sub !== 'lift' && s.reveal) {
      sfx('drumroll');
      say(`${spokenName(playerById(s.reveal.doubter)?.name)} deckt auf!`, { interrupt: true });
      this.juice.zoomPunch(0.04, 400);
      this.tweens.add({ targets: this.cup, angle: { from: -4, to: 4 }, duration: 110, yoyo: true, repeat: -1 });
    }
    if (s.sub === 'reveal' && prev.sub !== 'reveal' && s.reveal) this.revealFx(s);
    if (s.sub === 'over' && prev.sub !== 'over') sfx('fanfare');
  }

  private revealFx(s: MaexState) {
    const r = s.reveal!;
    const loser = spokenName(playerById(r.loser)?.name);
    const at = this.seatXY(s, r.loser);
    const costWord = s.drink ? (r.cost === 1 ? 'trinkt' : 'trinkt doppelt') : r.cost === 1 ? 'verliert ein Leben' : 'verliert zwei Leben';
    const floatText = s.drink ? `+${r.cost} SCHLUCK` : `−${r.cost} ♥`;
    if (r.accepted) {
      sfx('bonk');
      say(`${loser} glaubt das Mäxchen und ${costWord}.`);
      this.juice.float(at.x, at.y - 36, floatText, 'dmg');
      return;
    }
    // Becher hebt sich in Zeitlupe, Würfel hüpfen raus
    this.juice.slowMo(0.35, 900);
    this.cup.setPosition(TX, CUP_Y).setAngle(0);
    this.tweens.add({ targets: this.cup, x: CUP_LIFT.x, y: CUP_LIFT.y, angle: CUP_LIFT.angle, duration: 560, ease: 'Back.Out' });
    this.dice.forEach((d, i) => {
      d.setScale(0.5);
      this.tweens.add({ targets: d, scale: 2, duration: 380, delay: 120 + i * 80, ease: 'Back.Out' });
    });
    this.time.delayedCall(260, () => {
      if (r.lied) {
        sfx('boom');
        this.juice.shake(2);
        this.juice.flash(0xe0503f, 220);
        this.juice.burst(TX, CUP_Y - 8, 'spark', 16);
        this.juice.banner('GELOGEN!', '', 900);
      } else {
        sfx('cheer');
        this.juice.flash(0xa8f0a0, 160);
        this.juice.burst(TX, CUP_Y - 8, 'confetti', 30);
        this.juice.banner('STIMMT!', '', 900);
      }
      this.juice.float(at.x, at.y - 36, floatText, 'dmg');
      if (r.out) {
        sfx('ko', { delay: 0.4 });
        this.juice.float(at.x, at.y - 52, 'RAUS!', '#ff8a7a');
      }
    });
    const actual = r.actual ?? 0;
    say(r.lied ? `Gelogen! Nur ${maexSpoken(actual)}. ${loser} ${costWord}.` : `Stimmt! ${maexSpoken(actual)}. ${loser} ${costWord}.`);
  }
}
