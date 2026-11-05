import Phaser from 'phaser';
import type { GameState, SpionState } from '../../shared/types';
import { SPION, SP_A, STATIONS, guestAnim, guestDir, guestVariant } from '../../shared/spion';
import { GF, guestPix, paintParty, partyBalloon, partyObjects, puddle } from '../art/spion';
import { C } from '../art/palette';
import { bus, getState, playerById } from './store';
import { GOLD, INK, RED_INK, background, ensureTex, ink, nameTag, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const short = (name: string, n: number) => name.replace(/^Bot\s+/, '').slice(0, Math.max(1, n));

interface GuestSprite {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

const STATION_LABELS = ['BUFFET', 'GRILL', 'POOL', 'HÄNGEMATTE'];
const LABEL_POS = [
  { x: 92, y: 62 },
  { x: 399, y: 62 },
  { x: 240, y: 104 },
  { x: 396, y: 236 },
];

/**
 * TV-Ansicht von „Spion unter Gästen“: alle Gäste sehen gleich aus und verhalten sich gleich –
 * welcher Gast ein Spieler ist, weiß nur das jeweilige Handy. Namensschilder gibt es nur für
 * Enttarnte, Fehlwürfe (kurz) und am Rundenende.
 */
export class SpionScene extends Phaser.Scene {
  private guests: GuestSprite[] = [];
  private tags = new Map<string, Phaser.GameObjects.Container>();
  private puddles = new Map<number, Phaser.GameObjects.Image>();
  private glow!: Phaser.GameObjects.Graphics;
  private bubbles!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private strip!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private newsText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private latest: SpionState | null = null;
  private endsAt = 0;
  private phaseKey = '';
  private stripKey = '';
  private newsSeq = 0;
  private throwSeen = new Map<number, boolean | null>();
  private flying = new Map<number, Phaser.GameObjects.Image>();
  private juice!: Juice;

  constructor() {
    super('spion');
  }

  create() {
    this.guests = [];
    this.tags.clear();
    this.puddles.clear();
    this.flying.clear();
    this.throwSeen.clear();
    this.latest = null;
    this.phaseKey = '';
    this.stripKey = '';
    this.newsSeq = 0;
    const st = getState();
    const m = st?.mini?.kind === 'spion' ? st.mini.state : null;
    // Alte Würfe nicht erneut abspielen
    for (const t of m?.throws ?? []) this.throwSeen.set(t.seq, t.hit);
    this.newsSeq = m?.news?.seq ?? 0;

    background(this, 'spion', SPION.W, SPION.H, paintParty);
    for (const [key, make, x, y] of partyObjects()) this.add.image(x, y, ensureTex(this, key, make)).setOrigin(0.5, 1).setDepth(y);
    STATION_LABELS.forEach((l, i) => txt(this, LABEL_POS[i].x, LABEL_POS[i].y, l, { color: '#fff4d6' }).setDepth(940).setAlpha(0.75));
    this.glow = this.add.graphics().setDepth(-500);
    this.bubbles = this.add.graphics().setDepth(960);
    panel(this, 0, 0, SPION.W, 22).setDepth(2000);
    this.hud = this.add.container(0, 0).setDepth(2001);
    // links etwas Platz für den „Spieler (P)“-Knopf der Laptop-Steuerung
    this.newsText = ink(this, 62, 7, '', { origin: [0, 0] });
    this.timerText = ink(this, SPION.W - 8, 7, '', { origin: [1, 0] });
    this.hud.add([this.newsText, this.timerText]);
    panel(this, 0, SPION.BOTTOM, SPION.W, SPION.H - SPION.BOTTOM, 'dark').setDepth(2000);
    this.strip = this.add.container(0, SPION.BOTTOM).setDepth(2001);
    this.overlay = this.add.container(0, 0).setDepth(2500);

    // Töne über den gemeinsamen Effekt-Bus (sfx.ts) statt eines eigenen AudioContext
    this.juice = new Juice(this, { depth: 1440 });
    const onState = (s: GameState) => this.onState(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.onState(st);
  }

  update() {
    const m = this.latest;
    if (!m) return;
    const left = Math.max(0, this.endsAt - performance.now());
    this.timerText.setText(m.sub === 'play' || m.sub === 'intro' ? fmt(left) : '');
    this.timerText.setColor(m.sub === 'play' && left < 20000 ? RED_INK : INK);
    const now = this.time.now;
    this.bubbles.clear();
    const using = STATIONS.map(() => 0);
    m.guests.forEach((g, i) => {
      const s = this.guests[i];
      if (!s) return;
      s.x += (g[0] - s.x) * 0.35;
      s.y += (g[1] - s.y) * 0.35;
      const a = guestAnim(g);
      if (a === SP_A.OUT) {
        s.img.setVisible(false);
        return;
      }
      s.img.setVisible(true);
      // Laufbild nach Strecke statt nach Zeit – alle Gäste wirken gleich
      const frame =
        a === SP_A.WALK ? (Math.floor((s.x + s.y) / 4) % 2 ? GF.WALK_A : GF.WALK_B) : a === SP_A.USE ? GF.USE : a === SP_A.CHAT ? (Math.floor(now / 400 + i * 0.37) % 3 === 0 ? GF.CHAT : GF.STAND) : a === SP_A.WET ? GF.WET : GF.STAND;
      const v = guestVariant(g);
      s.img.setTexture(ensureTex(this, `sp_g${v}_${frame}`, () => guestPix(v, frame)));
      s.img.setFlipX(guestDir(g) < 0);
      const bob = a === SP_A.WALK ? -Math.abs(Math.sin((s.x + s.y) / 3)) : 0;
      s.img.setPosition(Math.round(s.x), Math.round(s.y + bob)).setDepth(s.y);
      if (a === SP_A.USE) {
        const st = STATIONS.findIndex((t) => Math.hypot(t.x - g[0], t.y - g[1]) <= SPION.USE_R);
        if (st >= 0) using[st] += 1;
      }
      // Plauder-Blase (für alle Gäste gleich: nach Index und Zeit)
      if (a === SP_A.CHAT && Math.floor(now / 900 + i * 1.7) % 4 === 0) {
        const bx = Math.round(s.x) + (guestDir(g) > 0 ? 4 : -10), by = Math.round(s.y) - 25;
        this.bubbles.fillStyle(0xfdf7ea, 1).fillRect(bx, by, 7, 5).fillRect(bx + 1, by + 5, 2, 1);
        this.bubbles.fillStyle(0x3d2414, 1).fillRect(bx + 1, by + 2, 1, 1).fillRect(bx + 3, by + 2, 1, 1).fillRect(bx + 5, by + 2, 1, 1);
      }
    });
    // Auftragsorte leuchten, solange jemand (Gast oder Spion) dort zugange ist
    this.glow.clear();
    STATIONS.forEach((t, i) => {
      if (!using[i]) return;
      const pulse = 0.35 + Math.abs(Math.sin(now / 260)) * 0.35;
      this.glow.fillStyle(0xffd25e, pulse).fillEllipse(t.x, t.y, 34, 12);
      this.glow.lineStyle(1, 0xfff4d6, 0.9).strokeEllipse(t.x, t.y, 34 + Math.sin(now / 200) * 3, 12);
    });
    // Namensschilder folgen ihren Gästen
    for (const [k, c] of this.tags) {
      const gi = Number(k.split(':')[0]);
      const s = this.guests[gi];
      if (!s) continue;
      c.setPosition(Math.round(s.x), Math.round(s.y) + 2);
      if (k.endsWith(':miss')) c.setAlpha(Math.floor(now / 250) % 2 ? 1 : 0.55);
    }
    // Ballons im Flug
    for (const [seq, img] of this.flying) {
      const gi = img.getData('g') as number;
      const s = this.guests[gi];
      if (!s) continue;
      const t = Math.min(1, (performance.now() - (img.getData('t0') as number)) / SPION.FLY_MS);
      img.setPosition(s.x, s.y - 12 - (1 - t * t) * 90).setAngle(t * 360);
      img.setData('seq', seq);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'spion') return;
    const m = s.mini.state;
    this.latest = m;
    const key = `${m.round}-${m.sub}`;
    if (key !== this.phaseKey) {
      if (m.sub === 'intro' || this.guests.length !== m.guests.length) this.resetGuests(m);
      this.phaseKey = key;
      this.endsAt = performance.now() + m.endsIn;
      this.renderOverlay(m);
    }
    if (this.guests.length !== m.guests.length) this.resetGuests(m);
    if (m.news && m.news.seq !== this.newsSeq) {
      this.newsSeq = m.news.seq;
      sfx('tick', { pitch: 1.4, vol: 0.5 });
      this.newsText.setText(m.news.text.length > 45 ? `${m.news.text.slice(0, 44)}…` : m.news.text);
      this.tweens.add({ targets: this.newsText, alpha: { from: 0.2, to: 1 }, duration: 250 });
    }
    this.syncTags(m);
    this.syncThrows(m);
    this.renderStrip(m);
  }

  private resetGuests(m: SpionState) {
    for (const g of this.guests) g.img.destroy();
    for (const c of this.tags.values()) c.destroy();
    for (const p of this.puddles.values()) p.destroy();
    for (const f of this.flying.values()) f.destroy();
    this.tags.clear();
    this.puddles.clear();
    this.flying.clear();
    this.guests = m.guests.map((g) => {
      const v = guestVariant(g);
      const img = this.add.image(g[0], g[1], ensureTex(this, `sp_g${v}_0`, () => guestPix(v, 0))).setOrigin(0.5, 1).setDepth(g[1]);
      return { img, x: g[0], y: g[1] };
    });
  }

  private syncTags(m: SpionState) {
    const want = new Set(m.tags.map((t) => `${t.g}:${t.id}:${t.why}`));
    for (const [k, c] of this.tags) {
      if (!want.has(k)) {
        c.destroy();
        this.tags.delete(k);
      }
    }
    for (const t of m.tags) {
      const k = `${t.g}:${t.id}:${t.why}`;
      if (this.tags.has(k)) continue;
      const pl = playerById(t.id);
      const s = this.guests[t.g];
      if (!s) continue;
      const color = t.why === 'out' ? RED_INK : t.why === 'miss' ? '#a8342a' : INK;
      const c = nameTag(this, s.x, s.y + 2, short(pl?.name ?? '?', 8), color).setDepth(1300);
      if (t.why === 'miss') c.add(txt(this, 0, -32, '!', { size: 16, color: '#ff6a5a' }));
      if (t.why === 'reveal') c.add(txt(this, 0, -30, '▼', { color: GOLD }));
      this.tags.set(k, c);
      if (t.why === 'out' && !this.puddles.has(t.g)) {
        const p = this.add.image(s.x, s.y + 2, ensureTex(this, 'sp_puddle', puddle)).setOrigin(0.5, 1).setDepth(s.y - 2);
        this.puddles.set(t.g, p);
      }
    }
  }

  private syncThrows(m: SpionState) {
    for (const t of m.throws) {
      const seen = this.throwSeen.get(t.seq);
      if (seen === undefined) {
        this.throwSeen.set(t.seq, t.hit);
        if (t.hit === null) {
          const img = this.add.image(0, -20, ensureTex(this, 'sp_balloon', partyBalloon)).setDepth(1400);
          img.setData('g', t.g).setData('t0', performance.now());
          this.flying.set(t.seq, img);
          sfx('throw', { pitch: 1.2, vol: 0.6 });
        }
        continue;
      }
      if (seen === null && t.hit !== null) {
        this.throwSeen.set(t.seq, t.hit);
        this.flying.get(t.seq)?.destroy();
        this.flying.delete(t.seq);
        const s = this.guests[t.g];
        if (s) this.splash(s.x, s.y, t.hit, t.victim);
      }
    }
  }

  private splash(x: number, y: number, hit: boolean, victim: string | null) {
    for (let i = 0; i < 12; i++) {
      const d = this.add.rectangle(x, y - 10, 2, 2, i % 2 ? 0x93d3f3 : 0x4aa2dc).setDepth(1400);
      const a = (i / 12) * Math.PI * 2;
      this.tweens.add({ targets: d, x: x + Math.cos(a) * 18, y: y - 10 + Math.sin(a) * 10 + 6, alpha: 0, duration: 650, ease: 'Quad.out', onComplete: () => d.destroy() });
    }
    const label = hit ? `ENTTARNT: ${short(playerById(victim)?.name ?? '?', 10)}!` : 'PLATSCH! NUR EIN GAST';
    const t = txt(this, Phaser.Math.Clamp(x, 90, SPION.W - 90), Math.max(30, y - 44), label, { color: hit ? C.gold : '#ff8a7a' }).setDepth(1450);
    this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, delay: 1300, duration: 700, onComplete: () => t.destroy() });
    sfx('splash', { x, vol: 0.7 });
    if (hit) {
      // Enttarnt: Fanfare, Konfetti, kurzer Stopp
      this.juice.shake(2);
      this.juice.hitStop(80);
      this.juice.burst(x, y - 12, 'confetti', 30);
      sfx('fanfare', { delay: 0.1 });
    } else sfx('error', { x, delay: 0.1 });
  }

  // ---------------------------------------------------------------- HUD

  private renderStrip(m: SpionState) {
    const ids = Object.keys(m.players);
    const key = JSON.stringify([ids.map((id) => m.players[id]), ids.map((id) => playerById(id)?.name)]);
    if (key === this.stripKey) return;
    this.stripKey = key;
    this.strip.removeAll(true);
    const rows = ids.length > 6 ? 2 : 1;
    const perRow = Math.ceil(ids.length / rows);
    const w = Math.floor((SPION.W - 4) / perRow);
    const h = (SPION.H - SPION.BOTTOM) / rows;
    const chars = Math.floor((w - 30) / 8);
    ids.forEach((id, i) => {
      const p = m.players[id];
      const x = 2 + (i % perRow) * w;
      const y = Math.floor(i / perRow) * h + (rows === 1 ? 6 : 1);
      const name = txt(this, x + 2, y, short(playerById(id)?.name ?? '?', chars), { origin: [0, 0], color: p.out ? '#9b8f80' : '#fff4d6', shadow: false });
      this.strip.add(name);
      if (p.out) this.strip.add(this.add.rectangle(x + 2, y + 4, name.width, 1, 0xff6a5a).setOrigin(0, 0.5));
      const g = this.add.graphics();
      const px = x + w - 26;
      for (let k = 0; k < STATIONS.length; k++) g.fillStyle(k < p.tasks ? 0xffd25e : 0x5a4a3a, 1).fillRect(px + k * 4, y + 1, 3, 6);
      for (let k = 0; k < SPION.BALLOONS; k++) g.fillStyle(k < p.balloons ? 0xf07aa8 : 0x5a4a3a, 1).fillCircle(px + 19 + k * 4, y + 4, 1.6);
      this.strip.add(g);
    });
  }

  private renderOverlay(m: SpionState) {
    this.overlay.removeAll(true);
    if (m.sub === 'play') return;
    if (m.sub === 'intro') {
      this.overlay.add(panel(this, 60, 40, 360, 176));
      this.overlay.add(ink(this, 240, 52, `SPION UNTER GÄSTEN – RUNDE ${m.round}/${m.rounds}`));
      this.overlay.add(
        ink(
          this,
          240,
          74,
          'Jeder von euch ist einer der Gäste –\nnur euer Handy verrät, welcher!\n\nTippt auf die Karte, um hinzuschlendern.\nErledigt unauffällig alle 4 Aufträge:\nBuffet, Grill, Pool, Hängematte.\n\n2 Wasserballons enttarnen Spione –\nwer einen echten Gast trifft, fliegt auf!',
          { wrap: 340 },
        ),
      );
      return;
    }
    const ids = Object.keys(m.players).sort((a, b) => m.players[b].score - m.players[a].score);
    const h = 60 + Math.min(12, ids.length) * 11;
    const y0 = Math.max(26, Math.round((SPION.BOTTOM + 22 - h) / 2));
    this.overlay.add(panel(this, 110, y0, 260, h).setAlpha(0.95));
    this.overlay.add(ink(this, 240, y0 + 10, m.sub === 'over' ? 'PARTY VORBEI!' : `RUNDE ${m.round} VORBEI`));
    this.overlay.add(ink(this, 240, y0 + 24, m.news?.text ?? '', { wrap: 240 }));
    ids.forEach((id, i) => {
      const p = m.players[id];
      const y = y0 + 48 + i * 11;
      this.overlay.add(ink(this, 124, y, short(playerById(id)?.name ?? '?', 12), { origin: [0, 0], color: p.out ? RED_INK : INK }));
      this.overlay.add(ink(this, 356, y, `${p.score}`, { origin: [1, 0] }));
    });
    this.overlay.setAlpha(m.sub === 'reveal' ? 0.92 : 1);
    // Bei der Auflösung die Namensschilder sichtbar lassen: Panel kurz zeigen, dann ausblenden
    if (m.sub === 'reveal') this.tweens.add({ targets: this.overlay, alpha: 0, delay: 3800, duration: 600 });
  }

}

