import Phaser from 'phaser';
import type { GameState, KartState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { getTrack, wrapAngle } from '../../shared/kart';
import { SHIRTS } from '../../shared/avatar';
import { C } from '../art/palette';
import { paintKartTrack } from '../art/kart';
import { bananaPeel, coconut, itemBox, kartSprite, seagull } from '../art/kartsprites';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, GOLD, background, ensureTex, panel, txt } from './ui';

interface KartView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  x: number;
  y: number;
  a: number;
  spinA: number;
  lastPuff: number;
}

/** Kart-Rennen von oben: die ganze Strecke passt auf den Bildschirm (480 × 270). */
export class KartScene extends Phaser.Scene {
  private karts = new Map<string, KartView>();
  private boxes: Phaser.GameObjects.Image[] = [];
  private hazards = new Map<number, Phaser.GameObjects.Image>();
  private gulls = new Map<number, { img: Phaser.GameObjects.Image; x: number }>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Image;
  private sub!: Phaser.GameObjects.Text;
  private ticker!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private latest: GameState | null = null;
  private hudKey = '';
  private builtTrack = -1;
  private lastEvent = 0;
  private lastSub = '';
  private tickerUntil = 0;
  private cd = new Countdown();

  constructor() {
    super('kart');
  }

  create() {
    this.karts.clear();
    this.boxes = [];
    this.hazards.clear();
    this.gulls.clear();
    this.hudKey = '';
    this.builtTrack = -1;
    this.lastEvent = 0;
    this.lastSub = '';
    this.tickerUntil = 0;
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.bannerBg = panel(this, 80, 90, 320, 62, 'dark').setDepth(1001).setVisible(false);
    this.banner = txt(this, WORLD.W / 2, 100, '', { size: 24, color: GOLD }).setDepth(1002);
    this.sub = txt(this, WORLD.W / 2, 134, '', { size: 8 }).setDepth(1002);
    this.ticker = txt(this, WORLD.W / 2, WORLD.H - 14, '', { size: 8 }).setDepth(1002);
    this.clock = txt(this, WORLD.W - 4, 24, '', { size: 8, color: GOLD, origin: [1, 0] }).setDepth(1002);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private build(st: KartState) {
    if (this.builtTrack === st.track) return;
    this.builtTrack = st.track;
    const track = getTrack(st.track);
    background(this, `kart_${st.track}`, WORLD.W, WORLD.H, (p) => p.draw(paintKartTrack(track, WORLD.W, WORLD.H), 0, 0));
    ensureTex(this, 'kbox0', () => itemBox(0));
    ensureTex(this, 'kbox1', () => itemBox(2));
    this.boxes = st.boxes.map((b) => this.add.image(b.x, b.y, 'kbox0').setDepth(2));
    ensureTex(this, 'kcoco', coconut);
    ensureTex(this, 'kbanana', bananaPeel);
    ensureTex(this, 'kgull0', () => seagull(0));
    ensureTex(this, 'kgull1', () => seagull(1));
  }

  private kartView(id: string): KartView | undefined {
    const have = this.karts.get(id);
    if (have) return have;
    const pl = playerById(id);
    const car = this.latest?.mini?.kind === 'kart' ? this.latest.mini.state.karts[id] : undefined;
    if (!pl || !car) return undefined;
    const color = SHIRTS[pl.look.shirt] ?? C.red;
    const body = this.add.image(0, 0, ensureTex(this, `kart_${color}`, () => kartSprite(color)));
    const head = this.add.image(0, -3, ensurePortrait(this, pl.look)).setScale(0.62).setOrigin(0.5, 0.6);
    const shadow = this.add.ellipse(1, 3, 15, 8, 0x000000, 0.25);
    const tag = txt(this, 0, -17, '', { size: 8, color: GOLD }).setVisible(false);
    const root = this.add.container(car.x, car.y, [shadow, body, head, tag]);
    const v: KartView = { root, body, head, tag, x: car.x, y: car.y, a: car.angle, spinA: 0, lastPuff: 0 };
    this.karts.set(id, v);
    return v;
  }

  update(_t: number, dms: number) {
    const s = this.latest;
    if (s?.mini?.kind !== 'kart') return;
    const st = s.mini.state;
    const now = this.time.now;
    if (st.sub === 'countdown') this.countdownBanner(getTrack(st.track).def.name, st.laps);
    for (const [id, car] of Object.entries(st.karts)) {
      const v = this.kartView(id);
      if (!v) continue;
      v.x += (car.x - v.x) * 0.4;
      v.y += (car.y - v.y) * 0.4;
      v.a += wrapAngle(car.angle - v.a) * 0.4;
      if (car.spin > 0) v.spinA += dms * 0.018;
      else v.spinA = 0;
      const driftTilt = car.drift ? car.drift * 0.35 : 0;
      v.body.setRotation(v.a + v.spinA + driftTilt);
      v.head.setY(-3 + (car.offroad && !car.finished ? Math.sin(now / 40) * 0.8 : 0));
      v.root.setPosition(Math.round(v.x), Math.round(v.y)).setDepth(10 + v.y).setAlpha(car.finished ? 0.65 : 1);
      // Effekte
      if (now - v.lastPuff > 70 && st.sub === 'race') {
        v.lastPuff = now;
        const bx = v.x - Math.cos(v.a) * 8;
        const by = v.y - Math.sin(v.a) * 8;
        if (car.boost) this.puff(bx, by, Math.random() < 0.5 ? 0xffd25e : 0xf0973a, 2.5, 260);
        else if (car.drift) {
          const col = car.charged ? (Math.random() < 0.5 ? 0xf0973a : 0xffd25e) : 0x93d3f3;
          for (const side of [-1, 1]) this.puff(bx - Math.sin(v.a) * side * 5, by + Math.cos(v.a) * side * 5, col, 1.5, 200);
        } else if (car.offroad && !car.finished) this.puff(bx, by, 0xdfb878, 2, 300);
      }
    }
    for (const g of this.gulls.values()) g.img.setTexture(Math.floor(now / 120) % 2 ? 'kgull1' : 'kgull0');
    this.boxes.forEach((b, i) => {
      if (!b.visible) return;
      b.setTexture(Math.floor(now / 250 + i) % 2 ? 'kbox1' : 'kbox0');
      b.setY(st.boxes[i].y + Math.sin(now / 300 + i) * 1);
    });
    for (const h of this.hazards.values()) if (h.texture.key === 'kcoco') h.rotation += dms * 0.02;
    if (this.tickerUntil && now > this.tickerUntil) {
      this.ticker.setText('');
      this.tickerUntil = 0;
    }
  }

  private countdownBanner(name: string, laps: number) {
    const secs = this.cd.seconds;
    this.banner.setText(secs > 3 ? name.toUpperCase() : String(Math.max(1, secs)));
    this.banner.setFontSize(secs > 3 ? 16 : 24);
    this.sub.setText(secs > 3 ? `${laps} Runden – Handys bereit?` : '');
    this.bannerBg.setVisible(true);
  }

  private puff(x: number, y: number, color: number, r: number, ms: number) {
    const c = this.add.circle(x, y, r, color, 0.85).setDepth(9 + y);
    this.tweens.add({ targets: c, scale: 0.2, alpha: 0, duration: ms, onComplete: () => c.destroy() });
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'kart') return;
    const st = s.mini.state;
    this.build(st);
    const track = getTrack(st.track);

    // Boxen, Hindernisse, Möwen
    st.boxes.forEach((b, i) => this.boxes[i]?.setVisible(b.on));
    const alive = new Set(st.hazards.map((h) => h.id));
    for (const [id, img] of this.hazards) {
      if (alive.has(id)) continue;
      this.tweens.add({ targets: img, scale: 2, alpha: 0, duration: 220, onComplete: () => img.destroy() });
      this.hazards.delete(id);
    }
    for (const h of st.hazards) {
      let img = this.hazards.get(h.id);
      if (!img) {
        img = this.add.image(h.x, h.y, h.kind === 'coconut' ? 'kcoco' : 'kbanana');
        this.hazards.set(h.id, img);
      }
      img.setPosition(h.x, h.y).setDepth(5 + h.y);
    }
    const flying = new Set(st.gulls.map((g) => g.id));
    for (const [id, g] of this.gulls) {
      if (flying.has(id)) continue;
      this.tweens.add({ targets: g.img, y: g.img.y - 30, alpha: 0, duration: 500, onComplete: () => g.img.destroy() });
      this.gulls.delete(id);
    }
    for (const g of st.gulls) {
      let v = this.gulls.get(g.id);
      if (!v) {
        v = { img: this.add.image(g.x, g.y, 'kgull0').setDepth(900), x: g.x };
        this.gulls.set(g.id, v);
      }
      v.img.setFlipX(g.x < v.x);
      v.x = g.x;
      v.img.setPosition(g.x, g.y - 8);
    }

    // Plätze über fertigen Karts
    for (const [id, car] of Object.entries(st.karts)) {
      const v = this.kartView(id);
      if (!v) continue;
      v.tag.setVisible(car.finished).setText(`${car.place}.`);
    }

    // Ereignisse als Laufschrift unten
    const ev = st.events[st.events.length - 1];
    if (ev && ev.seq !== this.lastEvent) {
      this.lastEvent = ev.seq;
      if (ev.kind !== 'item' || this.tickerUntil === 0) {
        this.ticker.setText(ev.text.toUpperCase());
        this.tickerUntil = this.time.now + 2600;
      }
      if (ev.kind === 'hit' || ev.kind === 'gull') {
        const v = this.karts.get(ev.who);
        if (v) {
          const t = txt(this, v.x, v.y - 18, ev.kind === 'gull' ? 'KRAH!' : 'AUA!', { color: '#ff8a7a' }).setDepth(1001);
          this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, duration: 900, onComplete: () => t.destroy() });
        }
      }
    }

    // Banner
    const secs = Math.ceil(st.endsIn / 1000);
    if (st.sub === 'countdown') {
      // Während des Countdowns kommen keine Updates – lokal weiterzählen (siehe update())
      this.cd.set(st.endsIn);
      this.countdownBanner(track.def.name, st.laps);
    } else if (st.sub === 'race') {
      if (this.lastSub === 'countdown') {
        this.banner.setText('LOS!').setFontSize(24);
        this.time.delayedCall(800, () => {
          if (this.latest?.mini?.kind !== 'kart' || this.latest.mini.state.sub !== 'race') return;
          this.banner.setText('');
          this.bannerBg.setVisible(false);
        });
      }
      this.sub.setText('');
    } else {
      this.banner.setText('ZIEL!').setFontSize(24);
      this.sub.setText(st.finishOrder[0] ? `${playerById(st.finishOrder[0])?.name ?? '?'} gewinnt!` : '');
    }
    this.lastSub = st.sub;
    this.bannerBg.setVisible(this.banner.text !== '');
    this.clock.setText(st.closing && st.sub === 'race' ? `NOCH ${secs}s` : '');

    // Rangliste oben
    const order = Object.entries(st.karts).sort((a, b) => a[1].place - b[1].place);
    const leaderLap = Math.max(1, ...order.map(([, c]) => c.lap));
    const key = JSON.stringify([order.map(([id, c]) => [id, c.finished]), Math.min(leaderLap, st.laps)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 0, 0, WORLD.W, 20, 'dark'));
    this.hud.add(txt(this, 6, 6, `RUNDE ${Math.min(leaderLap, st.laps)}/${st.laps}`, { origin: [0, 0], color: GOLD }));
    const slot = Math.min(30, Math.floor((WORLD.W - 104) / Math.max(1, order.length)));
    order.forEach(([id, car], i) => {
      const pl = playerById(id);
      const x = 104 + i * slot;
      this.hud.add(txt(this, x + 7, 6, String(i + 1), { size: 8, color: i === 0 ? GOLD : car.finished ? '#b9e39a' : '#fff4d6', origin: [1, 0] }));
      if (pl) this.hud.add(this.add.image(x + 9, 3, ensurePortrait(this, pl.look)).setOrigin(0, 0).setScale(0.9));
    });
  }
}

export const KART_SCENES = [KartScene];
