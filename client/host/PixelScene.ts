import Phaser from 'phaser';
import type { GameState, PixelState, PlayerPublic } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { PIXEL, PIXEL_COLORS, paintPic } from '../../shared/pixel';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { Pix, shade } from '../art/pix';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, ink, nameTag, panel, prop } from './ui';

const SOFT = '#7a5a3a';
/** Füllstand der Staffelei: so viele Felder gelten als "voll" (ganze Fläche bemalt ist selten) */
const FULL_AT = 150;

/** Pixel-Galerie: Atelier und Vernissage in einer kleinen Kunstgalerie */
export class PixelScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private stateKey = '';
  private timerY = 0;
  private texKeys: string[] = [];
  private texSeq = 0;

  constructor() {
    super('pixel');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.timerY = 0;
    this.texKeys = [];
    background(this, 'pixel', WORLD.W, WORLD.H, paintGalleryRoom);
    prop(this, 'px_plantL', O.plant, 14, 222).setDepth(-500);
    prop(this, 'px_plantR', O.plant, 466, 222).setDepth(-500);
    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.clearLayer();
    });
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || !this.timerY) return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(99, this.timerY - 1, 282, 6);
    this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(100, this.timerY, 280 * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'pixel') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}`;
    // Countdown bei Phasenwechsel – und wenn der Server ihn verkürzt (alle fertig)
    if (tKey !== this.timerKey || st.endsIn < this.countdown.remaining - 1500) {
      if (tKey !== this.timerKey) this.total = Math.max(1, st.endsIn);
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
    }
    const key = JSON.stringify([tKey, st.filled, st.done, st.voted, st.gallery.map((g) => g.votes), s.players.map((p) => p.connected)]);
    if (key === this.stateKey) return;
    const prevKey = this.stateKey ? (JSON.parse(this.stateKey) as string[])[0] : '';
    this.stateKey = key;
    const fresh = prevKey !== tKey;

    this.clearLayer();
    this.timerY = 0;
    if (st.sub === 'intro') this.renderIntro(st, fresh);
    else if (st.sub === 'paint') this.renderPaint(s, st, fresh);
    else if (st.sub === 'vote' || st.sub === 'reveal') this.renderGallery(s, st, fresh);
    else if (st.sub === 'scores') this.renderScores(st);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Die Galerie schließt!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Auswertung ...'));
    }
  }

  private clearLayer() {
    this.layer?.removeAll(true);
    for (const k of this.texKeys) if (this.textures.exists(k)) this.textures.remove(k);
    this.texKeys = [];
  }

  // ---------------------------------------------------------------- Intro

  private renderIntro(st: PixelState, fresh: boolean) {
    this.layer.add(panel(this, 70, 40, 340, 150));
    this.layer.add(ink(this, WORLD.W / 2, 52, `PIXEL-GALERIE · Runde ${st.round}/${st.rounds}`, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 74, 'Das Thema:', { color: SOFT }));
    const big = fitInk(this, WORLD.W / 2, 108, st.prompt, 310, 40);
    this.layer.add(big);
    const rule =
      st.round === 1
        ? 'Malt am Handy auf 16 × 16 Pixeln. Danach stimmt ihr in der Vernissage für euer Lieblingsbild!'
        : 'Neues Thema, neues Glück – Pinsel bereit!';
    this.layer.add(ink(this, WORLD.W / 2, 140, rule, { wrap: 300 }));
    if (fresh) {
      big.setScale(0.2);
      this.tweens.add({ targets: big, scale: 1, duration: 420, ease: 'Back.Out' });
    }
  }

  // ---------------------------------------------------------------- Malen

  private renderPaint(s: GameState, st: PixelState, fresh: boolean) {
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => !!p);
    const n = players.length;
    const doneCount = players.filter((p) => st.done.includes(p.id)).length;
    this.layer.add(panel(this, 40, 6, 400, 74));
    this.layer.add(ink(this, WORLD.W / 2, 14, `Pixel-Galerie · Runde ${st.round}/${st.rounds} · ${doneCount}/${n} fertig`, { color: RED_INK }));
    this.layer.add(fitInk(this, WORLD.W / 2, 42, st.prompt, 370, 40));
    this.timerY = 66;

    const rows = n > 6 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const spacing = Math.min(80, 470 / perRow);
    const scale = rows === 1 ? 2 : 1.5;
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = Math.round(WORLD.W / 2 + ((i % perRow) - (inRow - 1) / 2) * spacing);
      const y = rows === 1 ? 226 : 162 + row * 84;
      const done = st.done.includes(p.id);
      const es = rows === 1 ? 1.5 : 1;
      const ex = Math.round(x - 12 * es);
      // Staffelei mit Füllstand (das Bild selbst bleibt geheim)
      const easel = this.add.container(ex, y).setScale(es);
      easel.add(this.add.image(0, 0, ensureTex(this, 'px_easel', easelPix)).setOrigin(0.5, 1));
      const frac = Math.min(1, (st.filled[p.id] ?? 0) / FULL_AT);
      const filledH = Math.round(22 * frac);
      for (let b = 0; b < filledH; b += 3) {
        const h = Math.min(3, filledH - b);
        const col = Phaser.Display.Color.HexStringToColor(PIXEL_COLORS[[2, 3, 4, 5, 6, 8, 9][((b / 3) | 0) % 7]]).color;
        easel.add(this.add.rectangle(-11, -45 + 22 - b - h, 22, h, col).setOrigin(0, 0));
      }
      if (!p.connected) easel.setAlpha(0.4);
      this.layer.add(easel);
      const f = figure(this, p.look, Math.round(x + 14 * es), y, scale);
      if (!done) f.setAlpha(p.connected ? 0.75 : 0.3);
      this.layer.add(f);
      const tagW = Math.max(4, Math.floor(spacing / 8) - 1);
      this.layer.add(nameTag(this, x, y + 3, p.name.slice(0, tagW), done ? GREEN_INK : INK));
      const iconY = y - Math.round(54 * es) - 2;
      if (done) {
        const c = this.add.image(ex, iconY, ensureTex(this, 'px_check', checkIcon)).setScale(2);
        this.layer.add(c);
        if (fresh) return;
        this.tweens.add({ targets: c, scale: 2.4, duration: 180, yoyo: true });
      } else if (p.connected) {
        const brush = this.add.image(ex + Math.round(8 * es), iconY + 4, ensureTex(this, 'px_brush', brushIcon));
        this.layer.add(brush);
        this.tweens.add({ targets: brush, angle: { from: -18, to: 18 }, duration: 380 + (i % 3) * 70, yoyo: true, repeat: -1 });
      }
    });
  }

  // ---------------------------------------------------------------- Vernissage (Abstimmung + Auflösung)

  private renderGallery(s: GameState, st: PixelState, fresh: boolean) {
    const reveal = st.sub === 'reveal';
    const n = st.gallery.length;
    this.layer.add(panel(this, 40, 2, 400, 36));
    this.layer.add(ink(this, WORLD.W / 2, 9, `Vernissage · „${st.prompt}“`, { color: RED_INK }));
    if (!n) {
      this.layer.add(ink(this, WORLD.W / 2, 22, 'Leere Wände – niemand hat gemalt!', { color: SOFT }));
      return;
    }
    const votable = st.voters.filter((id) => s.players.find((p) => p.id === id)?.connected).length;
    this.layer.add(
      ink(this, WORLD.W / 2, 22, reveal ? 'Die Künstler! VIP: Weiter am Handy' : `Stimmt am Handy für euer Lieblingsbild! (${st.voted.length}/${votable})`, { color: SOFT }),
    );
    if (!reveal) this.timerY = 41;

    const L = galleryLayout(n);
    const max = reveal ? Math.max(...st.gallery.map((g) => g.votes ?? 0)) : 0;
    st.gallery.forEach((e, i) => {
      const row = Math.floor(i / L.cols);
      const inRow = Math.min(L.cols, n - row * L.cols);
      const cx = Math.round(WORLD.W / 2 + ((i % L.cols) - (inRow - 1) / 2) * (L.frame + L.gap));
      const cy = Math.round(L.top + row * (L.frame + L.label + L.gap) + L.frame / 2);
      const card = this.add.container(cx, cy);
      card.add(this.add.image(0, 0, ensureTex(this, `px_frame_${L.frame}`, () => framePix(L.frame))));
      card.add(this.add.image(0, 0, this.picTexture(e.pic, L.cell)));
      this.layer.add(card);
      const ly = cy + L.frame / 2 + 2;
      if (!reveal) {
        const num = ink(this, cx, ly, `Nr. ${i + 1}`).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1);
        this.layer.add(num);
        if (fresh) {
          card.setScale(0.2).setAlpha(0);
          this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 320, delay: i * 110, ease: 'Back.Out' });
        }
        return;
      }
      const votes = e.votes ?? 0;
      const top = votes > 0 && votes === max;
      const who = playerById(e.by)?.name ?? '?';
      const maxChars = Math.max(4, Math.floor((L.frame + L.gap) / 8) - 1);
      const tag = ink(this, cx, ly, who.slice(0, maxChars), { color: top ? RED_INK : INK }).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1);
      this.layer.add(tag);
      // Stimmen-Plakette unten rechts am Rahmen
      const bx = cx + L.frame / 2 - 12;
      const by = cy + L.frame / 2 - 10;
      const badge = this.add.container(bx, by);
      badge.add(this.add.rectangle(0, 0, 26, 13, 0xfff6dc).setStrokeStyle(1, 0x2d1b12));
      badge.add(this.add.image(-6, 0, ensureTex(this, 'heart', O.heart)).setAlpha(votes ? 1 : 0.35));
      badge.add(ink(this, 7, -4, String(votes), { color: votes ? RED_INK : SOFT }));
      this.layer.add(badge);
      if (top) {
        const crown = this.add.image(cx, cy - L.frame / 2 - 2, ensureTex(this, 'crown', O.crown)).setScale(1.5);
        this.layer.add(crown);
        this.tweens.add({ targets: crown, y: crown.y - 3, duration: 320, yoyo: true, repeat: -1 });
        if (fresh) this.tweens.add({ targets: card, scale: 1.08, duration: 260, yoyo: true, delay: 300 });
      }
      if (fresh) {
        badge.setScale(0);
        this.tweens.add({ targets: badge, scale: 1, duration: 260, delay: 150 + i * 140, ease: 'Back.Out' });
      }
      if (fresh) {
        tag.setAlpha(0);
        this.tweens.add({ targets: tag, alpha: 1, duration: 250, delay: 150 + i * 140 });
      }
    });
  }

  /** Bild als eigene (pixelgenaue) Textur */
  private picTexture(pic: string, cell: number) {
    const key = `px_pic_${++this.texSeq}`;
    const size = PIXEL.SIZE * cell;
    const tex = this.textures.createCanvas(key, size, size)!;
    paintPic(tex.context, pic, cell);
    tex.refresh();
    this.texKeys.push(key);
    return key;
  }

  // ---------------------------------------------------------------- Zwischenstand

  private renderScores(st: PixelState) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0));
    const rowH = ranked.length > 8 ? 15 : 18;
    const h = 44 + ranked.length * rowH;
    const top = Math.round((WORLD.H - h) / 2);
    this.layer.add(panel(this, 110, top, 260, h + (h % 2)));
    this.layer.add(ink(this, WORLD.W / 2, top + 10, st.round >= st.rounds ? 'Endstand (Stimmen)' : `Stimmen nach Runde ${st.round}/${st.rounds}`, { color: RED_INK }));
    let place = 0;
    let prev = -1;
    ranked.forEach((id, i) => {
      const pts = st.points[id] ?? 0;
      if (pts !== prev) place = i + 1;
      prev = pts;
      const y = top + 30 + i * rowH;
      const p = playerById(id);
      this.layer.add(ink(this, 126, y, `${place}.`, { origin: [0, 0], color: place === 1 ? RED_INK : INK }));
      if (p) this.layer.add(this.add.image(156, y + 3, ensurePortrait(this, p.look)));
      this.layer.add(ink(this, 170, y, (p?.name ?? '?').slice(0, 10), { origin: [0, 0] }));
      this.layer.add(ink(this, 312, y, String(pts), { origin: [1, 0] }));
      const gain = st.roundGain[id] ?? 0;
      if (gain) {
        const g = ink(this, 356, y, `+${gain}`, { origin: [1, 0], color: GREEN_INK });
        this.layer.add(g);
        g.setAlpha(0);
        this.tweens.add({ targets: g, alpha: 1, duration: 300, delay: 300 + i * 120 });
      }
    });
  }
}

/** Raster der Ausstellung: Spalten, Feldgröße (Pixel pro Bildpunkt), Rahmengröße */
function galleryLayout(n: number) {
  const rows = n > 4 ? 2 : 1;
  const cols = Math.ceil(n / rows);
  const gap = 8;
  const label = 14;
  const border = 12;
  const availW = 468;
  const availH = WORLD.H - 50 - 6;
  let cell = 7;
  while (cell > 2) {
    const frame = PIXEL.SIZE * cell + border;
    if (cols * frame + (cols - 1) * gap <= availW && rows * (frame + label) + (rows - 1) * gap <= availH) break;
    cell--;
  }
  const frame = PIXEL.SIZE * cell + border;
  const totalH = rows * (frame + label) + (rows - 1) * gap;
  const top = 50 + Math.max(0, Math.floor((availH - totalH) / 2));
  return { rows, cols, cell, frame, gap, label, top };
}

/** Text so groß wie möglich (16 px oder 8 px), mittig */
function fitInk(scene: Phaser.Scene, x: number, y: number, text: string, w: number, h: number) {
  let t = ink(scene, x, y, text, { size: 16, wrap: w }).setOrigin(0.5, 0.5);
  if (t.width > w + 2 || t.height > h) {
    t.destroy();
    t = ink(scene, x, y, text, { size: 8, wrap: w }).setOrigin(0.5, 0.5);
  }
  return t;
}

// ------------------------------------------------------------------ Pixel-Art

/** Galerie-Raum: helle Wand mit Spots, Holzleiste, Parkett */
function paintGalleryRoom(p: Pix) {
  const W = WORLD.W;
  const wall = '#ebe1cc';
  p.rect(0, 0, W, 204, wall);
  // Wandpaneele
  for (let x = 30; x < W; x += 70) {
    p.rect(x, 52, 50, 130, shade(wall, 1.03));
    p.hline(x, 52, 50, shade(wall, 0.93)).vline(x, 52, 130, shade(wall, 0.93));
    p.hline(x, 181, 50, shade(wall, 1.08)).vline(x + 49, 52, 130, shade(wall, 1.08));
  }
  // Deckenleiste + Spots mit Lichtkegeln
  p.rect(0, 0, W, 5, '#cbb894');
  p.hline(0, 5, W, '#a8946c');
  for (let x = 40; x < W; x += 80) {
    for (let y = 8; y < 70; y++) {
      const half = 4 + Math.floor((y - 8) * 0.45);
      p.hline(x - half, y, half * 2, shade(wall, 1.04 + 0.02 * (1 - (y - 8) / 62)));
    }
    p.rect(x - 2, 5, 4, 3, '#4a4440');
    p.rect(x - 4, 8, 8, 4, '#2f2b28');
    p.hline(x - 3, 12, 6, '#ffe8a8');
  }
  // Fußleiste und Sockel
  p.rect(0, 196, W, 4, C.woodDark);
  p.hline(0, 196, W, C.woodLight);
  p.rect(0, 200, W, 12, '#cdb791');
  for (let x = 0; x < W; x += 40) p.vline(x, 200, 12, '#b9a27a');
  p.rect(0, 212, W, 2, C.woodDarker);
  paintWoodFloor(p, 0, 214, W, WORLD.H - 214, 61);
  // Absperrkordel an den Seiten
  for (const x0 of [0, W - 36]) {
    p.rect(x0 + 4, 226, 3, 22, '#c9a227').rect(x0 + 29, 226, 3, 22, '#c9a227');
    p.rect(x0 + 2, 247, 7, 3, '#8a6d12').rect(x0 + 27, 247, 7, 3, '#8a6d12');
    for (let x = x0 + 6; x < x0 + 31; x++) p.px(x, 229 + Math.round(Math.sin(((x - x0 - 6) / 25) * Math.PI) * 4), '#a8342a');
  }
}

/** Goldener Bilderrahmen (quadratisch, innen transparent) */
function framePix(size: number): Pix {
  const p = new Pix(size, size);
  const gold = '#d9a93a';
  p.rect(0, 0, size, size, '#6e4a12');
  p.rect(1, 1, size - 2, size - 2, gold);
  p.hline(1, 1, size - 2, '#ffe08a').vline(1, 1, size - 2, '#ffe08a');
  p.hline(1, size - 2, size - 2, '#a87418').vline(size - 2, 1, size - 2, '#a87418');
  p.rect(4, 4, size - 8, size - 8, '#8a5e14');
  p.g.clearRect(6, 6, size - 12, size - 12);
  // Ecken-Ornamente
  for (const [x, y] of [[2, 2], [size - 5, 2], [2, size - 5], [size - 5, size - 5]]) p.rect(x, y, 3, 3, '#fff1b8');
  return p;
}

/** Staffelei mit leerer Leinwand (Leinwand bei x 4…26, y 3…25) */
function easelPix(): Pix {
  const p = new Pix(30, 50);
  // Beine
  for (let y = 0; y < 50; y++) {
    const k = y / 50;
    p.px(Math.round(15 - 3 + k * -9), y, C.woodDark).px(Math.round(15 + 2 + k * 9), y, C.woodDark);
  }
  p.vline(15, 0, 46, C.woodDarker);
  // Leinwand
  p.rect(3, 4, 24, 24, '#fff6dc');
  p.rect(2, 28, 26, 3, C.wood);
  p.hline(2, 28, 26, C.woodLight);
  p.outline(C.outline);
  return p;
}

function checkIcon(): Pix {
  const p = new Pix(11, 10);
  p.map(1, 1, ['.......gg', '......gg.', '.....gg..', 'gg..gg...', '.gggg....', '..gg.....'], { g: C.green });
  p.outline(C.outline);
  return p;
}

/** Pinsel (wackelt, solange gemalt wird) */
function brushIcon(): Pix {
  const p = new Pix(8, 20);
  p.rect(3, 0, 2, 11, C.wood);
  p.rect(3, 11, 2, 2, '#c9c1a8');
  p.rect(2, 13, 4, 4, C.red);
  p.rect(3, 17, 2, 2, C.red);
  p.outline(C.outline);
  return p;
}
