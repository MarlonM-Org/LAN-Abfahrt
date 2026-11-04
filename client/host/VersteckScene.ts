import Phaser from 'phaser';
import type { GameState, VerstState, VsObject } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { POOL, PROPS, SEEKER_CORNER, WALLS, ZONES, pickTarget, propRect } from '../../shared/verstecken';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintTiles, paintWater, paintWoodFloor } from '../art/ground';
import { Pix } from '../art/pix';
import { hideProp, hidePropKey } from '../art/hideprops';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GREEN_INK, INK, RED_INK, background, ensureTex, ink, nameTag, panel, txt } from './ui';

// ------------------------------------------------------------------ Haus malen

function paintHouse(p: Pix) {
  p.rect(0, 0, WORLD.W, WORLD.H, C.woodDarker);
  const [wohn, kueche, schlaf, terr, garten] = ZONES;
  p.clip(wohn.x, wohn.y, wohn.w, wohn.h, () => paintWoodFloor(p, wohn.x, wohn.y, wohn.w, wohn.h, 81));
  p.clip(kueche.x, kueche.y, kueche.w, kueche.h, () => paintTiles(p, kueche.x, kueche.y, kueche.w + 8, kueche.h + 8, '#ece6d3', '#cfc6ad', 9));
  p.clip(schlaf.x, schlaf.y, schlaf.w, schlaf.h, () => paintWoodFloor(p, schlaf.x, schlaf.y, schlaf.w, schlaf.h, 82, '#a96a3a'));
  // Terrasse: helle Holzdielen
  p.clip(terr.x, terr.y, terr.w, terr.h, () => {
    for (let x = terr.x; x < terr.x + terr.w; x += 6) {
      p.rect(x, terr.y, 6, terr.h, (x / 6) % 2 ? '#d9a466' : '#cf9a5c');
      p.vline(x + 5, terr.y, terr.h, '#a87440');
    }
  });
  paintGrass(p, garten.x, garten.y, garten.w, garten.h, 83);
  // Pool mit Rand
  p.rect(POOL.x - 5, POOL.y - 5, POOL.w + 10, POOL.h + 10, C.stoneLight);
  for (let x = POOL.x - 5; x < POOL.x + POOL.w + 5; x += 7) p.vline(x, POOL.y - 5, 5, '#b9b5ab').vline(x, POOL.y + POOL.h, 5, '#b9b5ab');
  paintWater(p, POOL.x, POOL.y, POOL.w, POOL.h, 84);
  p.hline(POOL.x, POOL.y, POOL.w, C.waterDeep).hline(POOL.x, POOL.y + 1, POOL.w, C.waterDark);
  p.rect(POOL.x + POOL.w - 14, POOL.y - 6, 2, 9, '#d8d2c4').rect(POOL.x + POOL.w - 8, POOL.y - 6, 2, 9, '#d8d2c4');
  // Teppich (flach, Deko)
  p.draw(O.rug(56, 30), 70, 92);
  // Wände
  for (const w of WALLS) {
    if (w.h === 12) {
      // Rückwand mit Tapete
      p.rect(w.x, w.y, w.w, w.h, '#d9c7a0');
      for (let x = w.x; x < w.x + w.w; x += 6) p.vline(x, w.y, w.h, '#cbb78e');
      p.hline(w.x, w.y + w.h - 2, w.w, C.woodDark).hline(w.x, w.y + w.h - 1, w.w, C.woodDarker);
    } else if (w.h === 8) {
      // Hecke im Garten
      p.rect(w.x, w.y, w.w, w.h + 2, C.leafDark);
      for (let x = w.x; x < w.x + w.w; x += 5) p.disc(x + 2, w.y + 3, 3, C.leaf).px(x + 1, w.y + 1, C.leafLight);
      p.hline(w.x, w.y + w.h + 1, w.w, C.leafDarker);
    } else {
      p.rect(w.x, w.y, w.w, w.h, C.woodDark);
      p.rect(w.x, w.y, w.w, 2, C.woodLight);
      if (w.w > w.h) p.hline(w.x, w.y + w.h - 1, w.w, C.outline);
      else p.vline(w.x + w.w - 1, w.y, w.h, C.outline);
    }
  }
  // Fenster in der Rückwand
  for (const wx of [100, 270]) {
    p.rect(wx, 23, 22, 9, C.woodDarker).rect(wx + 1, 24, 20, 7, '#9fd8f5').rect(wx + 1, 24, 20, 3, '#c8ecfb').vline(wx + 11, 24, 7, C.woodDarker);
  }
  // Glastür zur Terrasse andeuten
  p.rect(222, 140, 36, 2, '#9fd8f5');
}

/** Feste Deko (kein Versteck): [Sprite, x (Mitte), y (unten)] */
const DECOR: [string, () => Pix, number, number][] = [
  ['sofa', () => O.sofa(), 60, 72],
  ['counter', O.counter, 70, 162],
  ['table', O.table, 70, 214],
  ['bed', () => O.bed(), 212, 68],
  ['bed2', () => O.bed(C.red), 236, 68],
  ['grill', O.grill, 352, 72],
  ['bush1', () => O.bush(5), 330, 252],
  ['bush2', () => O.bush(6, true), 432, 100],
];

/** Notensymbol fürs Pfeifen */
function note(): Pix {
  const p = new Pix(9, 11);
  p.map(0, 0, ['...####.', '...#..##', '...#...#', '...#....', '...#....', '...#....', '.###....', '####....', '.##.....'], { '#': C.white });
  p.outline(C.outline);
  return p;
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ Szene

export class VersteckScene extends Phaser.Scene {
  private objs = new Map<number, Phaser.GameObjects.Image>();
  private figs = new Map<string, { f: Phaser.GameObjects.Container; x: number; y: number; dizzy: Phaser.GameObjects.Text }>();
  private hud!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private timerText!: Phaser.GameObjects.Text;
  private aim!: Phaser.GameObjects.Graphics;
  private latest: VerstState | null = null;
  private endsAt = 0;
  private phaseKey = '';
  private hudKey = '';
  private lastCheck = 0;
  private lastWhistle = 0;
  private audio: AudioContext | null = null;

  constructor() {
    super('verstecken');
  }

  create() {
    this.objs.clear();
    this.figs.clear();
    this.latest = null;
    this.phaseKey = '';
    this.hudKey = '';
    const st = getState();
    const m = st?.mini?.kind === 'verstecken' ? st.mini.state : null;
    // Alte Effekte nicht erneut abspielen
    this.lastCheck = m?.checks.at(-1)?.seq ?? 0;
    this.lastWhistle = m?.whistles.at(-1)?.seq ?? 0;

    background(this, 'vs_house', WORLD.W, WORLD.H, paintHouse);
    for (const [key, make, x, y] of DECOR) {
      this.add.image(x, y, ensureTex(this, `vsd_${key}`, make)).setOrigin(0.5, 1).setDepth(y);
    }
    ZONES.forEach((z, i) => {
      const label = txt(this, z.x + 4, i === 0 || i === 2 ? z.y + 3 : i === 4 ? z.y + 12 : z.y + 6, z.name.toUpperCase(), {
        origin: [0, 0],
        color: i === 0 || i === 2 ? INK : '#fff4d6',
        shadow: !(i === 0 || i === 2),
      });
      // Über den Möbeln, damit nichts das Raumschild verdeckt
      label.setDepth(950).setAlpha(0.8);
    });
    this.aim = this.add.graphics().setDepth(900);
    this.overlay = this.add.container(0, 0).setDepth(1500);
    panel(this, 0, 0, WORLD.W, 22).setDepth(2000);
    this.hud = this.add.container(0, 0).setDepth(2001);
    this.timerText = ink(this, WORLD.W - 8, 7, '', { origin: [1, 0] }).setDepth(2002);

    const unlock = () => void this.sound0();
    this.input.on('pointerdown', unlock);
    window.addEventListener('keydown', unlock, { once: true });

    const onState = (s: GameState) => this.onState(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      window.removeEventListener('keydown', unlock);
      void this.audio?.close();
      this.audio = null;
    });
    if (st) this.onState(st);
  }

  update() {
    const m = this.latest;
    const left = Math.max(0, this.endsAt - performance.now());
    this.timerText.setText(m && (m.sub === 'hide' || m.sub === 'seek' || m.sub === 'intro') ? fmt(left) : '');
    this.timerText.setColor(m?.sub === 'seek' && left < 30000 ? RED_INK : INK);
    if (!m) return;
    for (const [id, a] of this.figs) {
      const av = m.avatars[id];
      if (!av) continue;
      a.x += (av.x - a.x) * 0.4;
      a.y += (av.y - a.y) * 0.4;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(av.dir < 0);
      img.setY(av.moving ? -Math.abs(Math.sin(this.time.now / 80)) * 2 : 0);
      a.f.setPosition(Math.round(a.x), Math.round(a.y)).setDepth(a.y + 0.5);
      a.dizzy.setVisible(av.stunned).setAngle(Math.sin(this.time.now / 90) * 20);
    }
    // Zielmarkierung: was hat der Sucher gerade vor sich?
    this.aim.clear();
    if (m.sub !== 'seek') return;
    for (const id of m.seekers) {
      const av = m.avatars[id];
      if (!av || av.stunned) continue;
      const t = pickTarget(m.objects, av.x, av.y, av.dir);
      if (!t) continue;
      const r = propRect(t);
      const blink = Math.floor(this.time.now / 250) % 2 ? 0xfff4d6 : 0xffd25e;
      this.aim.lineStyle(1, blink, 1);
      const x0 = r.x - 2, y0 = r.y - 2, x1 = r.x + r.w + 1, y1 = r.y + r.h + 1, k = 3;
      this.aim.lineBetween(x0, y0, x0 + k, y0).lineBetween(x0, y0, x0, y0 + k);
      this.aim.lineBetween(x1, y0, x1 - k, y0).lineBetween(x1, y0, x1, y0 + k);
      this.aim.lineBetween(x0, y1, x0 + k, y1).lineBetween(x0, y1, x0, y1 - k);
      this.aim.lineBetween(x1, y1, x1 - k, y1).lineBetween(x1, y1, x1, y1 - k);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'verstecken') return;
    const m = s.mini.state;
    this.latest = m;
    const key = `${m.round}-${m.sub}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.endsAt = performance.now() + m.endsIn;
      this.renderOverlay(m);
    }
    this.syncObjects(m.objects);
    this.syncFigures(m);
    this.effects(m);
    this.renderHud(m);
  }

  // ---------------------------------------------------------------- Möbel & Figuren

  private syncObjects(list: VsObject[]) {
    const seen = new Set<number>();
    for (const o of list) {
      seen.add(o.o);
      const tex = ensureTex(this, hidePropKey(o.t, o.v), () => hideProp(o.t, o.v));
      let img = this.objs.get(o.o);
      if (!img) {
        img = this.add.image(o.x, o.y, tex).setOrigin(0.5, 1);
        this.objs.set(o.o, img);
      } else if (img.texture.key !== tex) {
        img.setTexture(tex);
      }
      // Kein Tween läuft? Dann exakt auf Server-Position (keine Interpolation → echte und falsche Möbel verhalten sich gleich)
      if (!img.getData('shaking')) img.setPosition(o.x, o.y);
      img.setFlipX(o.f).setDepth(o.y);
    }
    for (const [o, img] of this.objs) {
      if (!seen.has(o)) {
        img.destroy();
        this.objs.delete(o);
      }
    }
  }

  private syncFigures(m: VerstState) {
    for (const [id, a] of this.figs) {
      if (!m.avatars[id]) {
        a.f.destroy();
        this.figs.delete(id);
      }
    }
    for (const [id, av] of Object.entries(m.avatars)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, av.x, av.y);
      const seeker = m.seekers.includes(id);
      f.add(txt(this, 0, -37, pl.name.replace(/^Bot\s+/, '').slice(0, 6), { color: seeker ? '#ff8a7a' : '#fff4d6' }));
      const dizzy = txt(this, 0, -46, '@ @', { color: C.gold }).setVisible(false);
      f.add(dizzy);
      this.figs.set(id, { f, x: av.x, y: av.y, dizzy });
    }
  }

  // ---------------------------------------------------------------- Effekte

  private effects(m: VerstState) {
    for (const c of m.checks) {
      if (c.seq <= this.lastCheck) continue;
      this.lastCheck = c.seq;
      if (c.ok && c.found) this.foundFx(c.found, c.x, c.y);
      else this.missFx(c.x, c.y);
    }
    for (const w of m.whistles) {
      if (w.seq <= this.lastWhistle) continue;
      this.lastWhistle = w.seq;
      this.whistleFx(w.x, w.y, w.forced);
    }
  }

  private foundFx(id: string, x: number, y: number) {
    const pl = playerById(id);
    const c = this.add.container(0, 0).setDepth(1200);
    if (pl) {
      const f = figure(this, pl.look, x, y);
      c.add(f);
      this.tweens.add({ targets: f, y: y - 10, duration: 220, yoyo: true, ease: 'Quad.out' });
      c.add(nameTag(this, x, y + 2, pl.name.replace(/^Bot\s+/, '').slice(0, 8)));
    }
    const t = txt(this, x, y - 52, 'GEFUNDEN!', { color: C.gold });
    c.add(t);
    for (let i = 0; i < 14; i++) {
      const colors = [0xe04a3f, 0x3f8fe0, 0xffd25e, 0x46b04a, 0xf07aa8];
      const dot = this.add.rectangle(x, y - 14, 2, 2, colors[i % colors.length]);
      c.add(dot);
      const a = (i / 14) * Math.PI * 2;
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * 26, y: y - 14 + Math.sin(a) * 18 + 10, alpha: 0, duration: 800, ease: 'Quad.out' });
    }
    this.tweens.add({ targets: c, alpha: 0, delay: 1800, duration: 500, onComplete: () => c.destroy() });
    this.cameras.main.shake(150, 0.004);
    this.beep([523, 659, 784], 0.09, 'square');
  }

  private missFx(x: number, y: number) {
    // Das echte Möbel wackelt kurz – "Nix!"
    const img = [...this.objs.values()].find((i) => Math.round(i.x) === x && Math.round(i.y) === y);
    if (img && !img.getData('shaking')) {
      img.setData('shaking', true);
      this.tweens.add({
        targets: img,
        x: x + 1,
        duration: 50,
        yoyo: true,
        repeat: 3,
        onComplete: () => {
          img.setData('shaking', false);
          img.setX(x);
        },
      });
    }
    const t = txt(this, x, y - 30, 'NIX!', { color: '#ff8a7a' }).setDepth(1200);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    this.beep([220, 165], 0.12, 'sawtooth');
  }

  private whistleFx(x: number, y: number, forced: boolean) {
    const ring = this.add.circle(x, y, 6, 0xffffff, 0).setStrokeStyle(1, 0xfff4d6, 0.9).setDepth(1100);
    this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 1200, onComplete: () => ring.destroy() });
    for (let i = 0; i < 2; i++) {
      const n = this.add.image(x + (i ? 6 : -4), y, ensureTex(this, 'vs_note', note)).setDepth(1101).setAlpha(0.95);
      this.tweens.add({ targets: n, y: y - 22 - i * 6, x: n.x + (i ? 4 : -3), alpha: 0, delay: i * 250, duration: 1600, onComplete: () => n.destroy() });
    }
    if (forced) {
      const t = txt(this, x, y - 22, 'PFIFF!', { color: C.gold }).setDepth(1101);
      this.tweens.add({ targets: t, alpha: 0, delay: 600, duration: 800, onComplete: () => t.destroy() });
    }
    this.whistleSound();
  }

  // ---------------------------------------------------------------- Ton (WebAudio, kein Asset)

  private sound0(): AudioContext | null {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
    } catch {
      this.audio = null;
    }
    return this.audio;
  }

  private whistleSound() {
    const ctx = this.sound0();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1300, t);
    o.frequency.exponentialRampToValueAtTime(2200, t + 0.18);
    o.frequency.setValueAtTime(1500, t + 0.26);
    o.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
    g.gain.setValueAtTime(0.18, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.24);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.62);
  }

  private beep(freqs: number[], step: number, type: OscillatorType) {
    const ctx = this.sound0();
    if (!ctx) return;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + i * step;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + step * 1.7);
    });
  }

  // ---------------------------------------------------------------- HUD & Karten

  private renderHud(m: VerstState) {
    const left = m.hiders.length - m.found.length;
    const key = JSON.stringify([m.sub, m.round, left]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(ink(this, 8, 7, `Runde ${m.round}/${m.rounds}`, { origin: [0, 0] }));
    const label =
      m.sub === 'intro' ? 'Gleich geht’s los' : m.sub === 'hide' ? 'VERSTECKEN!' : m.sub === 'seek' ? 'SUCHEN!' : m.sub === 'reveal' ? 'Auflösung' : 'Ende';
    this.hud.add(ink(this, WORLD.W / 2 - 30, 7, label, { color: m.sub === 'seek' ? RED_INK : m.sub === 'hide' ? GREEN_INK : INK }));
    if (m.sub === 'seek' || m.sub === 'reveal') this.hud.add(ink(this, 360, 7, `Versteckt: ${left}`, { origin: [1, 0] }));
  }

  private renderOverlay(m: VerstState) {
    this.overlay.removeAll(true);
    const names = (ids: string[]) => ids.map((id) => playerById(id)?.name ?? '?').join(', ');
    if (m.sub === 'intro') {
      const h = m.round === 1 ? 168 : 120;
      const y = 135 - h / 2 + 10;
      this.overlay.add(panel(this, 60, y, 360, h));
      this.overlay.add(ink(this, WORLD.W / 2, y + 12, m.round === 1 ? 'Versteckspiel mit Möbeln' : `Runde ${m.round}`, { size: 16, color: RED_INK }));
      this.overlay.add(ink(this, WORLD.W / 2, y + 36, `Sucher: ${names(m.seekers)}`, { color: RED_INK, wrap: 330 }));
      m.seekers.forEach((id, i) => {
        const pl = playerById(id);
        if (pl) this.overlay.add(figure(this, pl.look, WORLD.W / 2 + (i - (m.seekers.length - 1) / 2) * 30, y + 84, 2));
      });
      this.overlay.add(ink(this, WORLD.W / 2, y + 90, 'Alle anderen: verwandelt euch in Möbel!', { wrap: 330 }));
      if (m.round === 1) {
        this.overlay.add(
          ink(this, WORLD.W / 2, y + 112, 'Steht da, wo so ein Ding hingehört –\nund EINRASTEN, sonst wackelt ihr.\nPfeifen gibt Punkte, verrät aber den Raum.', {
            color: '#7a5a3a',
            wrap: 340,
          }),
        );
      }
      return;
    }
    if (m.sub === 'hide') {
      // Vorhang über den Suchern
      const r = SEEKER_CORNER;
      const g = this.add.graphics();
      g.fillStyle(0x8e3329, 1).fillRect(r.x, r.y, r.w, r.h);
      for (let x = r.x; x < r.x + r.w; x += 6) g.fillStyle(0xb9493a, 1).fillRect(x, r.y, 3, r.h);
      g.fillStyle(0x5e3518, 1).fillRect(r.x - 2, r.y - 3, r.w + 4, 4);
      g.lineStyle(1, 0x2d1b12, 1).strokeRect(r.x, r.y, r.w, r.h);
      this.overlay.add(g);
      this.overlay.add(txt(this, r.x + r.w / 2, r.y + 12, 'AUGEN\nZU!', { color: C.gold }));
      const back = this.add.rectangle(WORLD.W / 2, 128, 420, 34, 0x2d1b12, 0.75);
      const banner = txt(this, WORLD.W / 2, 116, `${names(m.seekers)}: Augen zu!\nAlle anderen: Versteckt euch!`, { color: C.gold, wrap: 400 });
      this.overlay.add([back, banner]);
      this.tweens.add({ targets: [back, banner], alpha: 0, delay: 3500, duration: 800 });
      return;
    }
    if (m.sub === 'seek') {
      const banner = txt(this, WORLD.W / 2, 118, 'SUCHEN!', { size: 24, color: C.gold });
      this.overlay.add(banner);
      this.tweens.add({ targets: banner, alpha: 0, scale: 1.4, delay: 900, duration: 700 });
      return;
    }
    if (m.sub === 'reveal' || m.sub === 'over') {
      for (const r of m.reveal ?? []) {
        const pl = playerById(r.id);
        if (!pl) continue;
        const top = Math.max(40, r.y - PROPS[r.t].h);
        const arrow = txt(this, r.x, top - 10, 'v', { color: C.gold });
        this.overlay.add(arrow);
        this.tweens.add({ targets: arrow, y: top - 7, duration: 300, yoyo: true, repeat: -1 });
        const short = pl.name.replace(/^Bot\s+/, '').slice(0, 8);
        const half = (short.length * 8 + 6) / 2;
        this.overlay.add(nameTag(this, Math.max(half + 2, Math.min(WORLD.W - half - 2, r.x)), top - 24, short, GREEN_INK));
      }
      const seekersWon = m.winner === 'seekers';
      const title = m.sub === 'over' ? 'Spiel vorbei!' : seekersWon ? 'Alle gefunden!' : 'Zeit um – Verstecker gewinnen!';
      const sub = m.sub === 'over' ? 'Gleich kommt die Wertung ...' : seekersWon ? m.seekers.length > 1 ? 'Die Sucher haben gute Augen!' : `${names(m.seekers)} hat gute Augen!` : 'Die Pfeile zeigen, wer wo war.';
      // Karte dorthin, wo sie keine Auflösung verdeckt
      const cy = (m.reveal ?? []).some((r) => r.y > 196) ? 40 : 220;
      this.overlay.add(panel(this, 90, cy, 300, 44));
      this.overlay.add(ink(this, WORLD.W / 2, cy + 8, title, { color: seekersWon ? RED_INK : GREEN_INK }));
      this.overlay.add(ink(this, WORLD.W / 2, cy + 24, sub, { color: '#7a5a3a', wrap: 290 }));
    }
  }
}
