import Phaser from 'phaser';
import type { GameState, PostEntry, StillepostState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { DrawingRaster } from '../../shared/stillepost';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { Pix } from '../art/pix';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, fitText, ink, nameTag, panel, prop, tagName } from './ui';
import { sfx } from './sfx';

const TASK_TEXT: Record<string, string> = {
  write: 'Schreibt einen Satz!',
  draw: 'Malt, was ihr lest!',
  describe: 'Beschreibt das Bild!',
};

/** Eine Zeichnung als Textur – optional Strich für Strich abgespielt */
interface LiveDrawing {
  raster: DrawingRaster;
  tex: Phaser.Textures.CanvasTexture;
  perFrame: number;
}

/** Stille Post mit Bildern: Mal-Atelier im Ferienhaus */
export class StillepostScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private stateKey = '';
  private texKeys: string[] = [];
  private live: LiveDrawing[] = [];
  private texSeq = 0;
  private timerY = 0;

  constructor() {
    super('stillepost');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.texKeys = [];
    this.live = [];
    background(this, 'stillepost', WORLD.W, WORLD.H, (p) => {
      // Tapete mit Streifen
      p.rect(0, 0, WORLD.W, 150, '#e9d3a6');
      for (let x = 0; x < WORLD.W; x += 16) p.rect(x, 0, 6, 150, '#e2c792');
      p.rect(0, 146, WORLD.W, 6, C.woodDark);
      p.hline(0, 146, WORLD.W, C.woodLight);
      paintWoodFloor(p, 0, 152, WORLD.W, WORLD.H - 152, 41);
      // Wäscheleine mit Bildern
      const lineY = (x: number) => 20 + Math.round(Math.sin(x / 76) * 3);
      for (let x = 0; x < WORLD.W; x += 2) p.px(x, lineY(x), C.woodDarker);
      // Aufgehängte Kinderzeichnungen (links und rechts neben den Panels sichtbar)
      const pics = [
        { x: 8, sky: '#93d3f3', thing: C.red },
        { x: 444, sky: '#f7c6a3', thing: C.blue },
      ];
      for (const pic of pics) {
        const y = lineY(pic.x + 14) + 2;
        p.rect(pic.x, y, 28, 24, C.outline);
        p.rect(pic.x + 1, y + 1, 26, 22, '#fff6dc');
        p.rect(pic.x + 3, y + 3, 22, 12, pic.sky);
        p.rect(pic.x + 3, y + 15, 22, 6, C.grass);
        p.disc(pic.x + 18, y + 7, 3, '#f2c33a');
        p.rect(pic.x + 7, y + 11, 5, 6, pic.thing);
        p.rect(pic.x + 12, y - 3, 3, 5, C.wood);
      }
    });
    prop(this, 'sp_rug', () => O.rug(300, 60, '#5b7fb5'), 240, 262).setDepth(-500);
    prop(this, 'plantL', O.plant, 16, 160);
    prop(this, 'plantR', O.plant, 464, 160);
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
    // Zeichnungen Strich für Strich abspielen
    for (const l of this.live) {
      if (l.raster.finished) continue;
      if (l.raster.advance(l.perFrame)) this.flush(l);
    }
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || !this.timerY) return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(99, this.timerY - 1, 282, 6);
    this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(100, this.timerY, 280 * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'stillepost') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}`;
    if (tKey !== this.timerKey) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
    }
    const key = JSON.stringify([st.sub, st.round, st.chain, st.shown, st.done, st.voted, st.chainLikes, s.players.map((p) => p.connected)]);
    if (key === this.stateKey) return;
    const prev = this.stateKey ? (JSON.parse(this.stateKey) as unknown[]) : null;
    this.stateKey = key;
    // Nur bei neuem Eintrag animieren – nicht, wenn z. B. jemand die Verbindung verliert
    const animate = !!prev && (prev[0] !== st.sub || prev[2] !== st.chain || prev[3] !== st.shown);
    // Töne: Abgabe-/Abstimmungs-Tick, Auflösungs-Pling pro Eintrag, Lacher-Jingle am Kettenende
    if (prev) {
      if (prev[0] !== st.sub) {
        if (st.sub === 'write' || st.sub === 'draw' || st.sub === 'describe') sfx('select');
        if (st.sub === 'vote') sfx('pop', { pitch: 0.9 });
        if (st.sub === 'tally') (sfx('drumroll', { vol: 0.7 }), sfx('coin', { delay: 0.6 }));
        if (st.sub === 'over') sfx('fanfare');
      }
      if (st.sub === 'reveal' && (prev[3] !== st.shown || prev[2] !== st.chain)) {
        sfx('coin', { pitch: 1 + Math.min(0.8, st.shown * 0.08), vol: 0.6 });
        if (st.entries.length && st.shown >= st.entries.length) sfx('cheer', { delay: 0.3 });
      }
      if (st.sub === 'vote' && st.voted.length > ((prev[5] as string[] | undefined)?.length ?? 0)) sfx('tick', { pitch: 1 + st.voted.length * 0.05 });
      if ((st.sub === 'write' || st.sub === 'draw' || st.sub === 'describe') && st.done.length > ((prev[4] as string[] | undefined)?.length ?? 0)) sfx('tick', { pitch: 1.4, vol: 0.5 });
    }

    this.clearLayer();
    this.timerY = 0;
    if (st.sub === 'write' || st.sub === 'draw' || st.sub === 'describe') this.renderPlaying(s, st);
    else if (st.sub === 'reveal') this.renderReveal(st, animate);
    else if (st.sub === 'vote' || st.sub === 'tally') this.renderOverview(s, st);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Das war Stille Post!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Likes ...'));
    }
  }

  private clearLayer() {
    this.layer?.removeAll(true);
    for (const k of this.texKeys) if (this.textures.exists(k)) this.textures.remove(k);
    this.texKeys = [];
    this.live = [];
  }

  // ---------------------------------------------------------------- Spielrunde

  private renderPlaying(s: GameState, st: StillepostState) {
    this.layer.add(panel(this, 50, 28, 380, 60));
    this.layer.add(ink(this, WORLD.W / 2, 36, `Stille Post mit Bildern · Schritt ${st.round}/${st.steps}`, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 52, TASK_TEXT[st.sub] ?? '', { size: 16 }));
    this.timerY = 74;

    // Ablauf-Leiste: Satz → Bild → Satz …
    const tile = 26;
    const x0 = WORLD.W / 2 - (st.steps * tile) / 2;
    for (let i = 0; i < st.steps; i++) {
      const kind = i === 0 ? 'write' : i % 2 === 1 ? 'draw' : 'describe';
      const cur = i + 1 === st.round;
      const past = i + 1 < st.round;
      const x = x0 + i * tile + tile / 2;
      const icon = this.add.image(x, 102, ensureTex(this, `sp_icon_${kind === 'draw' ? 'pic' : 'txt'}`, () => (kind === 'draw' ? picIcon() : textIcon())));
      icon.setAlpha(past ? 0.45 : cur ? 1 : 0.8);
      if (cur) {
        const ring = this.add.rectangle(x, 102, 22, 20).setStrokeStyle(2, 0xa8342a);
        this.layer.add(ring);
        this.tweens.add({ targets: ring, scale: 1.12, duration: 400, yoyo: true, repeat: -1 });
      }
      this.layer.add(icon);
      if (i < st.steps - 1) this.layer.add(ink(this, x + tile / 2, 99, '›', { color: '#7a5a3a' }));
    }

    // Spieler mit Häkchen
    const players = st.order.map((id) => s.players.find((p) => p.id === id)).filter((p) => !!p);
    const n = players.length;
    const rows = n > 8 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const col = i % perRow;
      const spacing = Math.min(58, 440 / perRow);
      const x = WORLD.W / 2 + (col - (inRow - 1) / 2) * spacing;
      const y = rows === 1 ? 214 : 176 + row * 64;
      const done = st.done.includes(p.id);
      const f = figure(this, p.look, x, y, 2);
      if (!done) f.setAlpha(p.connected ? 0.6 : 0.3);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, y + 3, p.name, done ? GREEN_INK : INK, spacing - 2));
      const bubbleY = y - 62;
      if (done) {
        const c = this.add.image(x, bubbleY, ensureTex(this, 'sp_check', checkIcon)).setScale(2);
        this.layer.add(c);
        this.tweens.add({ targets: c, scale: 2.4, duration: 180, yoyo: true });
      } else if (p.connected) {
        const dots = this.add.image(x, bubbleY, ensureTex(this, 'sp_think', thinkIcon));
        this.layer.add(dots);
        this.tweens.add({ targets: dots, y: bubbleY - 3, duration: 500 + (i % 3) * 90, yoyo: true, repeat: -1 });
      }
    });
    this.layer.add(ink(this, WORLD.W / 2, 258, `${st.done.length}/${n} fertig · Fertig am Handy tippen`).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  // ---------------------------------------------------------------- Vorführung

  private chainTitle(st: StillepostState, extra: string) {
    const owner = playerById(st.order[st.chain])?.name ?? '?';
    this.layer.add(panel(this, 40, 2, 400, 34));
    this.layer.add(ink(this, WORLD.W / 2, 9, `Kette von ${owner}  (${st.chain + 1}/${st.chains})`, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 21, extra, { color: '#7a5a3a' }));
  }

  private renderReveal(st: StillepostState, animate: boolean) {
    this.chainTitle(st, `Schritt ${st.shown}/${st.steps} · VIP tippt am Handy auf Weiter`);
    const cur = st.entries[st.shown - 1];
    const prev = st.shown >= 2 ? st.entries[st.shown - 2] : null;
    if (!cur) return;
    if (!prev) {
      this.entryCard(cur, WORLD.W / 2, 44, 300, 200, animate, true);
      return;
    }
    this.entryCard(prev, 104, 52, 176, 196, false, false);
    const arrow = ink(this, 212, 136, '»', { size: 24, color: RED_INK });
    this.layer.add(arrow);
    this.tweens.add({ targets: arrow, x: 218, duration: 450, yoyo: true, repeat: -1 });
    this.entryCard(cur, 348, 40, 236, 222, animate, true);
  }

  /** Karte mit Autor-Zeile und Text oder Zeichnung; cx = Mitte, y = Oberkante */
  private entryCard(e: PostEntry, cx: number, y: number, w: number, h: number, animate: boolean, big: boolean) {
    const who = playerById(e.by)?.name ?? '?';
    const verb = e.kind === 'drawing' ? 'malte' : 'schrieb';
    const cap = ink(this, cx, y, `${who} ${verb}:`, { color: big ? RED_INK : '#7a5a3a' }).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1);
    if (e.kind === 'drawing') {
      const size = Math.min(w, h - 16) - 4;
      const img = this.drawingImage(e, cx, y + 14 + size / 2 + 2, size, animate ? 140 : 0);
      this.layer.add(this.add.rectangle(cx, img.y, size + 6, size + 6, 0x5e3518));
      this.layer.add(img);
      if (!big) img.setAlpha(0.9);
    } else {
      const text = e.text ?? '';
      const ph = Math.min(h - 16, big ? 120 : 110);
      const pw = w - (w % 2);
      const card = panel(this, Math.round(cx - pw / 2), y + 14, pw, ph);
      this.layer.add(card);
      const size = big && text.length <= 36 ? 16 : 8;
      const t = ink(this, cx, y + 14 + ph / 2, text, { size, wrap: pw - 24 }).setOrigin(0.5, 0.5);
      this.layer.add(t);
      if (animate) {
        t.setScale(0.2);
        this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
      }
    }
    this.layer.add(cap);
  }

  /** Zeichnung als Bild; frames > 0 → in so vielen Frames Strich für Strich abspielen */
  private drawingImage(e: PostEntry, x: number, y: number, size: number, frames: number) {
    const s = Math.max(8, Math.round(size));
    const key = `sp_draw_${++this.texSeq}`;
    const tex = this.textures.createCanvas(key, s, s)!;
    this.texKeys.push(key);
    const raster = new DrawingRaster(e.drawing, s);
    const l: LiveDrawing = { raster, tex, perFrame: frames > 0 ? Math.max(1, Math.ceil(raster.total / frames)) : Infinity };
    if (frames <= 0) raster.advance();
    this.flush(l);
    this.live.push(l);
    return this.add.image(Math.round(x), Math.round(y), key);
  }

  private flush(l: LiveDrawing) {
    const s = l.raster.size;
    l.tex.context.putImageData(new ImageData(new Uint8ClampedArray(l.raster.data), s, s), 0, 0);
    l.tex.refresh();
  }

  /** Abstimmung + Auflösung: alle Schritte der Kette nebeneinander */
  private renderOverview(s: GameState, st: StillepostState) {
    const tally = st.sub === 'tally' ? st.chainLikes : null;
    const votable = st.order.filter((id) => s.players.find((p) => p.id === id)?.connected).length;
    const lastChain = st.chain + 1 >= st.chains;
    this.chainTitle(
      st,
      tally ? `Die Likes! VIP: ${lastChain ? 'weiter zur Auswertung' : 'weiter zur nächsten Kette'}` : `Stimmt am Handy ab: Was war am besten? (${st.voted.length}/${votable})`,
    );
    if (!tally) this.timerY = 39;
    const n = st.entries.length;
    const cols = Math.min(4, n);
    const rows = Math.ceil(n / cols);
    const cw = 112;
    const ch = rows === 1 ? 170 : 108;
    const gap = 4;
    const top = rows === 1 ? 60 : 46;
    const max = tally ? Math.max(...tally) : 0;
    st.entries.forEach((e, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = i % cols;
      const cx = WORLD.W / 2 + (col - (inRow - 1) / 2) * (cw + gap);
      const y = top + row * (ch + gap);
      this.layer.add(panel(this, Math.round(cx - cw / 2), y, cw, ch));
      const who = tagName(playerById(e.by)?.name ?? '?');
      this.layer.add(fitText(ink(this, cx, y + 7, `${i + 1}. ${who}`, { color: '#7a5a3a' }), cw - 8));

      if (e.kind === 'drawing') {
        const size = Math.min(cw - 16, ch - (rows === 1 ? 44 : 38));
        this.layer.add(this.add.rectangle(cx, y + 19 + size / 2, size + 4, size + 4, 0x5e3518));
        this.layer.add(this.drawingImage(e, cx, y + 19 + size / 2, size, 0));
      } else {
        const t = ink(this, cx, y + 19 + (ch - 30) / 2, e.text ?? '', { wrap: cw - 16 }).setOrigin(0.5, 0.5);
        if (t.height > ch - 28) t.setText(`${(e.text ?? '').slice(0, 54)}...`);
        this.layer.add(t);
      }
      if (tally) {
        const likes = tally[i] ?? 0;
        const hx = cx + cw / 2 - 16;
        const hy = y + ch - 12;
        const heart = this.add.image(hx - 8, hy, ensureTex(this, 'heart', O.heart)).setScale(likes ? 1.5 : 1).setAlpha(likes ? 1 : 0.35);
        this.layer.add(heart);
        this.layer.add(ink(this, hx + 4, hy - 4, String(likes), { color: likes ? RED_INK : '#7a5a3a', origin: [0, 0] }));
        if (likes && likes === max) {
          const crown = this.add.image(cx - cw / 2 + 8, y + 4, ensureTex(this, 'crown', O.crown)).setScale(1.5);
          this.layer.add(crown);
          this.tweens.add({ targets: [heart, crown], y: '-=3', duration: 300, yoyo: true, repeat: -1 });
        }
      }
    });
  }
}

// ------------------------------------------------------------------ kleine Pixel-Icons

function checkIcon(): Pix {
  const p = new Pix(11, 10);
  p.map(1, 1, ['.......gg', '......gg.', '.....gg..', 'gg..gg...', '.gggg....', '..gg.....'], { g: C.green });
  p.outline(C.outline);
  return p;
}

function thinkIcon(): Pix {
  const p = new Pix(19, 9);
  p.rect(1, 1, 17, 7, C.white);
  for (const x of [5, 9, 13]) p.rect(x, 4, 2, 2, C.ink);
  p.outline(C.outline);
  return p;
}

function textIcon(): Pix {
  const p = new Pix(18, 16);
  p.rect(1, 1, 16, 14, C.paper);
  for (const y of [4, 7, 10]) p.hline(4, y, y === 10 ? 6 : 10, C.ink);
  p.outline(C.outline);
  return p;
}

function picIcon(): Pix {
  const p = new Pix(18, 16);
  p.rect(1, 1, 16, 14, '#fff6dc');
  p.rect(3, 3, 12, 6, '#93d3f3');
  p.disc(12, 5, 2, '#f2c33a');
  p.rect(3, 9, 12, 4, C.grass);
  p.rect(5, 7, 3, 2, C.grass);
  p.outline(C.outline);
  return p;
}
