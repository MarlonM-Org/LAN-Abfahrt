import Phaser from 'phaser';
import type { GameState, KurvePower, KurveState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { KURVE, KURVE_POWER_INFO } from '../../shared/games';
import { playerColor } from '../../shared/players';
import { type TrailCursor, ingestTrail, walkLine } from '../../shared/kurve';
import { C } from '../art/palette';
import { paintSky } from '../art/ground';
import { Pix, rng, shade } from '../art/pix';
import { bus, getState, playerById } from './store';
import { Juice } from './juice';
import { Countdown, background, ensureTex, txt } from './ui';

const A = KURVE.ARENA;
/** Spurfarbe = Spielerfarbe des Abends (der Raum gibt sie dem Spiel als Farbindex mit) */
const colorNum = (i: number) => playerColor(i).num;

/** Power-up-Symbole (13 × 13) */
function powerIcon(type: KurvePower): Pix {
  const p = new Pix(13, 13);
  const base = KURVE_POWER_INFO[type].color;
  p.disc(6.5, 6.5, 6, base);
  p.overlayOn(() => p.disc(5, 4.5, 3, shade(base, 1.25)));
  const W = C.white;
  const D = C.outline;
  if (type === 'turbo') {
    // Blitz
    p.map(3, 2, ['...WW', '..WW.', '.WWWW', '...WW', '..WW.', '.WW..', '.W...'], { W, D });
  } else {
    // Schnecke
    p.map(2, 3, ['..DDD...', '.DWWWD..', '.DWDWD..', '.DWWWD.W', 'WWWWWWWW', '........'], { W, D: '#7a4a26' });
  }
  p.outline(C.outline);
  return p;
}

/** Rand ist offen: Position zurück in die Spielfläche falten (rechts raus = links rein) */
const wrapX = (x: number) => (x < A.x ? x + A.w : x >= A.x + A.w ? x - A.w : x);
const wrapY = (y: number) => (y < A.y ? y + A.h : y >= A.y + A.h ? y - A.h : y);

/**
 * Kurven-Duell auf dem TV. Die Spuren kommen nur stückweise (letzte Punkte + Startindex)
 * und werden inkrementell in eine RenderTexture gemalt – neue Runde = leeren.
 * Die Ränder sind offen: wer rechts rausfährt, kommt links wieder rein (Funken an beiden Stellen).
 */
export class KurveScene extends Phaser.Scene {
  private rt!: Phaser.GameObjects.RenderTexture;
  private pen!: Phaser.GameObjects.Graphics;
  private heads!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private stormText!: Phaser.GameObjects.Text;
  private cursors = new Map<string, TrailCursor>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  /** Letzte Kopfposition pro Spieler – ein großer Sprung = über den Rand gefahren */
  private lastPos = new Map<string, { x: number; y: number }>();
  private juice!: Juice;
  private powerImgs = new Map<number, Phaser.GameObjects.Image>();
  private latest: KurveState | null = null;
  private latestAt = 0;
  private round = 0;
  private lastDeath = 0;
  private lastPickup = 0;
  private hudKey = '';
  private wasStorm = false;
  private countdown = new Countdown();

  constructor() {
    super('kurve');
  }

  create() {
    // Szene wird wiederverwendet → alles zurücksetzen
    this.cursors.clear();
    this.labels.clear();
    this.lastPos.clear();
    this.powerImgs.clear();
    this.latest = null;
    this.round = 0;
    this.lastDeath = 0;
    this.lastPickup = 0;
    this.hudKey = '';
    this.wasStorm = false;

    background(this, 'kurve', WORLD.W, WORLD.H, (p) => {
      // Warmer Abendhimmel über der Punktetafel
      paintSky(p, 0, 0, WORLD.W, A.y - 2, ['#2a1f45', '#4b2f5e', '#7a3f62']);
      const r = rng(77);
      p.speckle(0, 0, WORLD.W, A.y - 10, '#fff4d6', 40, r);
      p.disc(462, 11, 7, '#fff1c4');
      p.disc(459, 9, 1.5, '#e9d9a8').disc(464, 14, 1, '#e9d9a8');
      // Strand bei Nacht
      p.rect(0, A.y - 4, WORLD.W, WORLD.H - A.y + 4, C.woodDarker);
      p.rect(A.x, A.y, A.w, A.h, '#3d3150');
      p.speckle(A.x, A.y, A.w, A.h, '#4a3d5f', 1400, r);
      p.speckle(A.x, A.y, A.w, A.h, '#352a47', 900, r);
      p.speckle(A.x, A.y, A.w, A.h, '#5a4b70', 120, r);
      // Offener Rand: leuchtende Punktlinie statt fester Bande
      for (let x = A.x; x < A.x + A.w; x += 3) p.px(x, A.y, '#8a6fb0').px(x, A.y + A.h - 1, '#8a6fb0');
      for (let y = A.y; y < A.y + A.h; y += 3) p.px(A.x, y, '#8a6fb0').px(A.x + A.w - 1, y, '#8a6fb0');
      // Holzsteg-Rahmen
      for (let x = 0; x < WORLD.W; x += 12) {
        p.rect(x, A.y - 4, 11, 4, C.woodDark).hline(x, A.y - 4, 11, C.wood);
        p.rect(x, A.y + A.h, 11, WORLD.H - A.y - A.h, C.woodDark).hline(x, A.y + A.h, 11, C.wood);
      }
      for (let y = A.y; y < A.y + A.h; y += 12) {
        p.rect(0, y, A.x, 11, C.woodDark).vline(0, y, 11, C.wood);
        p.rect(A.x + A.w, y, WORLD.W - A.x - A.w, 11, C.woodDark).vline(A.x + A.w, y, 11, C.wood);
      }
      // Lichterkette am oberen Rand
      const bulbs = ['#ffd25e', '#e0503f', '#46b04a', '#3f8fe0', '#f07aa8'];
      for (let x = 8, i = 0; x < WORLD.W; x += 16, i++) {
        p.px(x, A.y - 6, C.outline);
        p.rect(x - 1, A.y - 5, 3, 3, bulbs[i % bulbs.length]);
      }
    });

    this.rt = this.add.renderTexture(0, 0, WORLD.W, WORLD.H).setOrigin(0, 0).setDepth(10);
    this.pen = this.make.graphics({}, false);
    this.heads = this.add.graphics().setDepth(30);
    this.juice = new Juice(this, { depth: 36 });
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 112, '', { size: 24, color: C.gold }).setDepth(1001);
    this.subText = txt(this, WORLD.W / 2, 90, '', { size: 16 }).setDepth(1001);
    this.stormText = txt(this, WORLD.W / 2, A.y + A.h - 16, '', { color: '#ffb867' }).setDepth(1001);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private resetRound(st: KurveState) {
    this.round = st.round;
    this.rt.clear();
    this.cursors.clear();
    this.lastPos.clear();
    for (const l of this.labels.values()) l.destroy();
    this.labels.clear();
    for (const img of this.powerImgs.values()) img.destroy();
    this.powerImgs.clear();
    this.lastDeath = st.deaths.length ? st.deaths[st.deaths.length - 1].seq : this.lastDeath;
    for (const [id, h] of Object.entries(st.players)) {
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 6);
      const label = txt(this, h.x, h.y - 16, name, { color: playerColor(h.color).hex }).setDepth(40);
      this.labels.set(id, label);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'kurve') return;
    const st = s.mini.state;
    if (st.round !== this.round) this.resetRound(st);
    this.latest = st;
    this.latestAt = performance.now();
    this.countdown.set(st.endsIn);

    // Neue Spurstücke malen
    for (const [id, h] of Object.entries(st.players)) {
      let cur = this.cursors.get(id);
      if (!cur) this.cursors.set(id, (cur = { idx: -1, x: 0, y: 0 }));
      const col = colorNum(h.color);
      this.pen.fillStyle(col, 1);
      ingestTrail(h, cur, (x0, y0, x1, y1) =>
        walkLine(x0, y0, x1, y1, (x, y) => this.pen.fillRect(Math.round(x) - 1, Math.round(y) - 1, KURVE.LINE, KURVE.LINE)),
      );
    }
    this.rt.draw(this.pen);
    this.pen.clear();

    // Über den Rand gefahren? Funken an Aus- und Eintrittsstelle
    for (const [id, h] of Object.entries(st.players)) {
      const prev = this.lastPos.get(id);
      this.lastPos.set(id, { x: h.x, y: h.y });
      if (!prev || !h.alive || st.sub !== 'play') continue;
      if (Math.abs(h.x - prev.x) > A.w / 2 || Math.abs(h.y - prev.y) > A.h / 2) {
        this.juice.burst(prev.x, prev.y, 'spark', 4);
        this.juice.burst(h.x, h.y, 'spark', 4);
      }
    }

    // Power-ups
    const present = new Set(st.powerups.map((p) => p.id));
    for (const [pid, img] of this.powerImgs) {
      if (present.has(pid)) continue;
      this.tweens.add({ targets: img, scale: 0, duration: 180, onComplete: () => img.destroy() });
      this.powerImgs.delete(pid);
    }
    for (const pu of st.powerups) {
      if (this.powerImgs.has(pu.id)) continue;
      const img = this.add.image(pu.x, pu.y, ensureTex(this, `kv_pw_${pu.type}`, () => powerIcon(pu.type))).setDepth(20).setScale(0);
      this.tweens.add({ targets: img, scale: 1, duration: 250, ease: 'Back.Out' });
      this.tweens.add({ targets: img, y: pu.y - 1.5, duration: 600, yoyo: true, repeat: -1, delay: 250 });
      this.powerImgs.set(pu.id, img);
    }

    // Crashs
    for (const d of st.deaths) {
      if (d.seq <= this.lastDeath) continue;
      this.lastDeath = d.seq;
      this.burst(d.x, d.y, colorNum(st.players[d.id]?.color ?? 0));
    }
    // Power-up eingesammelt
    if (st.pickup && st.pickup.seq !== this.lastPickup) {
      this.lastPickup = st.pickup.seq;
      const info = KURVE_POWER_INFO[st.pickup.type];
      const t = txt(this, st.pickup.x, st.pickup.y - 14, info.label, { color: info.color }).setDepth(1002);
      this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, delay: 500, duration: 900, onComplete: () => t.destroy() });
    }
    if (st.storm && !this.wasStorm) {
      this.stormText.setText('STURM! Alle werden schneller ...').setAlpha(1);
      this.tweens.add({ targets: this.stormText, alpha: 0, delay: 2200, duration: 600 });
    }
    this.wasStorm = st.storm;

    // Banner
    if (st.sub === 'countdown') this.subText.setText(`Runde ${st.round}/${st.rounds}`);
    else if (st.sub === 'roundEnd') {
      const w = st.roundWinner ? playerById(st.roundWinner)?.name : null;
      this.subText.setText(w ? `${w} gewinnt Runde ${st.round}!` : 'Alle raus!');
    } else if (st.sub === 'over') this.subText.setText('Endstand!');
    else this.subText.setText('');

    this.drawHud(st);
  }

  private burst(x: number, y: number, color: number) {
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
      const d = 8 + Math.random() * 10;
      const r = this.add.rectangle(x, y, 2, 2, i % 3 === 0 ? 0xffffff : color).setDepth(35);
      this.tweens.add({ targets: r, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: 450 + Math.random() * 250, onComplete: () => r.destroy() });
    }
    this.cameras.main.shake(120, 0.004);
  }

  private drawHud(st: KurveState) {
    const entries = Object.entries(st.players).sort((a, b) => b[1].score - a[1].score);
    const key = JSON.stringify([st.round, entries.map(([id, h]) => [id, h.score, h.alive])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(txt(this, 6, 4, 'Runde', { origin: [0, 0] }));
    this.hud.add(txt(this, 6, 15, `${st.round}/${st.rounds}`, { origin: [0, 0], color: C.gold }));
    const perRow = entries.length > 6 ? Math.ceil(entries.length / 2) : 6;
    const rows = entries.length > 6 ? 2 : 1;
    const x0 = 56;
    const colW = Math.floor((420 - 8) / perRow);
    entries.forEach(([id, h], i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const x = x0 + col * colW;
      const y = rows === 1 ? 10 : 4 + row * 11;
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, perRow > 5 ? 3 : 5);
      const alpha = h.alive || st.sub === 'countdown' ? 1 : 0.45;
      this.hud.add(this.add.rectangle(x + 3, y + 3, 7, 7, colorNum(h.color)).setStrokeStyle(1, 0x2d1b12).setAlpha(alpha));
      this.hud.add(txt(this, x + 10, y, `${name} ${h.score}`, { origin: [0, 0], color: playerColor(h.color).hex }).setAlpha(alpha));
    });
  }

  update() {
    const st = this.latest;
    if (!st) return;
    const g = this.heads;
    g.clear();
    const now = this.time.now;
    const ahead = Math.min(0.08, (performance.now() - this.latestAt) / 1000);
    const counting = st.sub === 'countdown';
    if (counting) this.banner.setText(String(Math.max(1, this.countdown.seconds)));
    else this.banner.setText('');

    for (const [id, h] of Object.entries(st.players)) {
      const label = this.labels.get(id);
      if (label) label.setVisible(counting && Math.floor(now / 250) % 2 === 0).setPosition(h.x, h.y - 16);
      const col = colorNum(h.color);
      if (!h.alive) {
        g.fillStyle(0x2d1b12, 0.8).fillRect(h.x - 2, h.y - 2, 5, 5);
        g.fillStyle(col, 0.6).fillRect(h.x - 1, h.y - 1, 3, 3);
        continue;
      }
      // Kopf leicht vorhersagen, damit er zwischen den Updates nicht ruckelt
      const moving = st.sub === 'play';
      const x = wrapX(h.x + (moving ? Math.cos(h.a) * h.v * ahead : 0));
      const y = wrapY(h.y + (moving ? Math.sin(h.a) * h.v * ahead : 0));
      if (counting) {
        // Blinken + Richtungspfeil, damit jeder seinen Kopf findet
        if (Math.floor(now / 160) % 2 === 0) {
          g.fillStyle(0xffffff, 0.9).fillCircle(x, y, 6);
        }
        g.fillStyle(col, 1);
        for (const d of [7, 10, 13]) g.fillRect(Math.round(x + Math.cos(h.a) * d) - 1, Math.round(y + Math.sin(h.a) * d) - 1, 2, 2);
      }
      if (h.fx.includes('turbo')) g.lineStyle(1, 0xf0973a, 1).strokeCircle(x, y, 5 + (Math.floor(now / 60) % 3));
      if (h.fx.includes('slow')) g.lineStyle(1, 0x46b04a, 0.8).strokeCircle(x, y, 5);
      // In einer Lücke: heller Rand statt dunklem
      g.fillStyle(h.gap ? 0xfff4d6 : 0x2d1b12, 1).fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
      g.fillStyle(col, 1).fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
      g.fillStyle(0xffffff, 1).fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
    }
  }
}
