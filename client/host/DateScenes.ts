import Phaser from 'phaser';
import type { GameState, Look } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { DESCENT, DESCENT_PATH, INGREDIENT_NAMES, WRAP_RECIPE, descentPos } from '../../shared/dategames';
import { AV_H, AV_W, drawAvatar } from '../../shared/avatar';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { Pix } from '../art/pix';
import { ingredient, wrapStack } from '../art/food';
import {
  blanket,
  boulder,
  paintBoulders,
  paintBridgeUnderside,
  paintNightSky,
  paintPillar,
  paintRiver,
  paintSkyline,
  paintStoneWalk,
  pigeon,
  puddle,
  sittingFrom,
} from '../art/rhine';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { duckMusic, playRhythmSong } from './music';
import { toLocalPerf } from '../timesync';
import { RHYTHM } from '../../shared/dategames';
import { NameTags, RED_INK, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { sfx } from './sfx';
import { gulls, twinkle } from './ambient';

const PINK_INK = '#b0306a';
const SHORT: Record<string, string> = { descent: 'Abstieg', rhythm: 'Gespräch', wrap: 'Wraps', stars: 'Sterne' };

/** Szene, die nur auf Zustandsänderungen reagiert */
abstract class StateScene extends Phaser.Scene {
  protected abstract onState(s: GameState): void;

  protected listen() {
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  protected heartTex() {
    return ensureTex(this, 'heart', O.heart);
  }

  protected floatHeart(x: number, y: number) {
    const h = this.add.image(x, y, this.heartTex()).setDepth(4000);
    this.tweens.add({ targets: h, y: y - 26, x: x + Phaser.Math.Between(-8, 8), alpha: 0, duration: 1200, ease: 'Quad.out', onComplete: () => h.destroy() });
  }
}

function avatarCanvas(look: Look) {
  const c = document.createElement('canvas');
  c.width = AV_W;
  c.height = AV_H;
  drawAvatar(c.getContext('2d')!, look);
  return c;
}

/** Rhein bei Nacht unter der Brücke – gemeinsamer Hintergrund */
function rhineBackground(p: Pix) {
  paintNightSky(p, 0, 0, WORLD.W, 130);
  paintSkyline(p, 120);
  paintRiver(p, 120, 70);
  paintBridgeUnderside(p, 34);
  paintPillar(p, 20, 34, 34, 150);
  paintBoulders(p, 0, 186, WORLD.W, 84, 77);
}

// ================================================================== Story-Karten

export class StoryScene extends StateScene {
  private layer!: Phaser.GameObjects.Container;
  private key = '';

  constructor() {
    super('story');
  }

  create() {
    this.key = '';
    background(this, 'rhine', WORLD.W, WORLD.H, rhineBackground);
    this.add.circle(400, 70, 14, 0xfff7c9).setDepth(-900);
    this.add.circle(405, 66, 12, 0x18204a).setDepth(-899);
    this.layer = this.add.container(0, 0);
    this.listen();
  }

  protected onState(s: GameState) {
    const d = s.date;
    if (!d?.card) return;
    const key = JSON.stringify([d.chapter, d.card.title, d.totalHearts]);
    if (key === this.key) return;
    this.key = key;
    this.layer.removeAll(true);
    const card = d.card;
    this.layer.add(panel(this, 60, 40, 360, 180));
    this.layer.add(ink(this, WORLD.W / 2, 52, card.kicker, { color: PINK_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 68, card.title, { size: 16, color: RED_INK, wrap: 330 }));
    this.layer.add(ink(this, WORLD.W / 2, 100, card.text, { wrap: 330 }));

    // Kapitel-Herzen
    d.chapters.forEach((ch, i) => {
      const x = WORLD.W / 2 + (i - (d.chapters.length - 1) / 2) * 84;
      const h = d.hearts[i];
      const active = i === d.chapter;
      this.layer.add(txt(this, x, 228, SHORT[ch.kind] ?? ch.title.slice(0, 8), { color: active ? C.gold : '#c9c3e6' }));
      this.layer.add(txt(this, x, 242, h === null ? '–' : `♥ ${h}`, { color: h === null ? '#8a86a8' : '#ff9fc4' }));
    });

    // Das Paar
    d.couple.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const f = figure(this, p.look, i === 0 ? 30 : 450, 228, 2);
      (f.getData('img') as Phaser.GameObjects.Image).setFlipX(i === 1);
      this.layer.add(f);
    });
    this.layer.add(txt(this, WORLD.W / 2, 258, 'Am Handy auf „Weiter“ tippen', { color: '#c9c3e6' }));
  }
}

// ================================================================== Abstieg

export class DescentScene extends StateScene {
  private runners = new Map<string, { f: Phaser.GameObjects.Container; s: number; name: string; hits: number }>();
  private tags!: NameTags;
  private stones = new Map<number, Phaser.GameObjects.Image>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: GameState | null = null;
  private hudKey = '';

  constructor() {
    super('descent');
  }

  create() {
    this.runners.clear();
    this.stones.clear();
    this.hudKey = '';
    this.tags = new NameTags(this, 900);
    background(this, 'descent', WORLD.W, WORLD.H, (p) => {
      paintNightSky(p, 0, 0, WORLD.W, 80);
      paintSkyline(p, 70, 81);
      paintBoulders(p, 0, 52, WORLD.W, 218, 82);
      paintRiver(p, 250, 20, 83);
      paintStoneWalk(p, DESCENT_PATH, 10);
      paintBridgeUnderside(p, 30);
    });
    for (const ob of this.latestObstacles()) {
      const pos = descentPos(ob.s);
      const key = ob.type === 'bottle' ? ensureTex(this, 'bottle2', O.bottle) : ob.type === 'pigeon' ? ensureTex(this, 'pigeon', pigeon) : ensureTex(this, 'puddle', puddle);
      const img = this.add.image(pos.x, pos.y + 3, key).setOrigin(0.5, 1).setDepth(pos.y);
      if (ob.type === 'pigeon') this.tweens.add({ targets: img, y: img.y - 1, duration: 300, yoyo: true, repeat: -1 });
    }
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 120, '', { size: 24, color: C.gold }).setDepth(1500);
    this.listen();
  }

  private latestObstacles() {
    const s = getState();
    return s?.mini?.kind === 'descent' ? s.mini.state.obstacles : [];
  }

  update() {
    const s = this.latest;
    if (s?.mini?.kind !== 'descent') return;
    const d = s.mini.state;
    const specs: { id: string; x: number; y: number; name: string; color: string }[] = [];
    for (const [id, r] of Object.entries(d.runners)) {
      const a = this.runners.get(id);
      if (!a) continue;
      a.s += (r.s - a.s) * 0.35;
      const pos = descentPos(a.s);
      const jumpT = r.jumpLeft > 0 ? 1 - r.jumpLeft / DESCENT.JUMP_MS : 0;
      const hop = r.jumpLeft > 0 ? Math.sin(Math.PI * Math.min(1, jumpT)) * 15 : 0;
      a.f.setPosition(pos.x, pos.y + 2);
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setY(-hop).setFlipX(pos.dir < 0).setAngle(r.stunned ? (pos.dir > 0 ? 70 : -70) : 0);
      a.f.setDepth(pos.y + 1);
      specs.push({ id, x: pos.x, y: pos.y - 34 - hop, name: a.name, color: '#fff4d6' });
    }
    // Namensschilder verteilen sich selbst (bei Gedränge Initiale + Farbpunkt statt „BoFoMiBen“)
    this.tags.update(specs);
  }

  protected onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'descent') return;
    const d = s.mini.state;
    for (const [id, r] of Object.entries(d.runners)) {
      if (this.runners.has(id)) continue;
      const p = playerById(id);
      if (!p) continue;
      const f = figure(this, p.look, 0, 0);
      this.runners.set(id, { f, s: r.s, name: p.name, hits: r.hits });
    }
    // Getroffen: Plumps
    for (const [id, r] of Object.entries(d.runners)) {
      const a = this.runners.get(id);
      if (a && r.hits > a.hits) sfx('bonk', { pitch: 0.8, vol: 0.6 });
      if (a) a.hits = r.hits;
    }
    // Steine
    const alive = new Set(d.stones.map((st) => st.id));
    for (const [id, img] of this.stones) {
      if (!alive.has(id)) {
        img.destroy();
        this.stones.delete(id);
      }
    }
    for (const st of d.stones) {
      let img = this.stones.get(st.id);
      if (!img) {
        img = this.add.image(0, 0, ensureTex(this, 'boulder', boulder));
        this.stones.set(st.id, img);
      }
      const pos = descentPos(st.s);
      img.setPosition(pos.x, pos.y - 3).setDepth(pos.y).setAngle(st.s * 4 * pos.dir);
    }

    if (d.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(d.endsIn / 1000))));
    else if (d.sub === 'run') this.banner.setText('');
    else this.banner.setText('Unten!');

    const key = JSON.stringify([Math.ceil(d.endsIn / 1000), Object.values(d.runners).map((r) => [r.hits, r.finished])]);
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hud.removeAll(true);
      const parts = Object.entries(d.runners).map(([id, r]) => `${tagName(playerById(id)?.name ?? '?').slice(0, 6)} ${r.finished ? 'unten' : `${r.hits}x`}`);
      // Viele Läufer (bis 12): auf mehrere Zeilen à 4 verteilen, statt aus dem Bild zu laufen
      const lines: string[] = [];
      for (let i = 0; i < parts.length; i += 4) lines.push(parts.slice(i, i + 4).join('  '));
      lines[0] = `${Math.ceil(d.endsIn / 1000)}s  ${lines[0] ?? ''}`;
      const text = lines.join('\n');
      const w = Math.min(470, Math.max(...lines.map((l) => l.length)) * 8 + 24);
      this.hud.add(panel(this, Math.round((WORLD.W - w) / 2), 30, w, 26 + (lines.length - 1) * 12));
      this.hud.add(ink(this, WORLD.W / 2, 39, text));
    }
  }
}

// ================================================================== Gespräch

export class RhythmScene extends StateScene {
  private bubble!: Phaser.GameObjects.Container;
  private meter!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.Text;
  private seats = new Map<string, Phaser.GameObjects.Image>();
  private playStart = 0;
  private playSeq = 0;
  private lastHits = new Map<string, number>();
  private phraseIdx = -1;
  private latest: GameState | null = null;
  private stopSong?: () => void;

  constructor() {
    super('rhythm');
  }

  create() {
    this.seats.clear();
    this.lastHits.clear();
    this.playSeq = 0;
    this.phraseIdx = -1;
    background(this, 'rhine', WORLD.W, WORLD.H, rhineBackground);
    // Wasser glitzert
    for (let i = 0; i < 14; i++) {
      const s = this.add.rectangle(Phaser.Math.Between(60, WORLD.W), Phaser.Math.Between(126, 184), 3, 1, 0xffd77a).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 0.8, duration: 700, yoyo: true, repeat: -1, delay: i * 210, repeatDelay: 1400 });
    }
    this.meter = this.add.graphics().setDepth(1001);
    this.bubble = this.add.container(0, 0).setDepth(1000);
    this.info = txt(this, WORLD.W / 2, 254, '').setDepth(1001);
    panel(this, 130, 36, 220, 30).setDepth(1000);
    ink(this, WORLD.W / 2, 42, 'Sympathie', { color: PINK_INK }).setDepth(1001);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stopSong?.();
      duckMusic(false);
    });
    this.listen();
  }

  update() {
    const s = this.latest;
    if (s?.mini?.kind !== 'rhythm') return;
    const r = s.mini.state;
    this.meter.clear();
    this.meter.fillStyle(0x2d1b12).fillRect(150, 53, 180, 8);
    this.meter.fillStyle(0xf6d7e2).fillRect(151, 54, 178, 6);
    this.meter.fillStyle(0xe46e98).fillRect(151, 54, 178 * (r.sympathy / 100), 6);
    if (r.sub !== 'play') return;
    const now = performance.now() - this.playStart;
    const idx = r.phrases.findIndex((p) => now >= p.from && now < p.to);
    if (idx !== this.phraseIdx) {
      this.phraseIdx = idx;
      this.bubble.removeAll(true);
      const ph = r.phrases[idx];
      const seat = ph && this.seats.get(ph.speaker);
      if (ph && seat) {
        const w = Math.max(60, ph.topic.length * 8 + 16);
        this.bubble.add(panel(this, Math.round(seat.x - w / 2), 150, w, 24));
        this.bubble.add(ink(this, seat.x, 158, ph.topic));
        this.bubble.setAlpha(0);
        this.tweens.add({ targets: this.bubble, alpha: 1, duration: 200 });
      }
    }
    if (now < r.leadIn) this.info.setText(`Gleich geht’s los ... ${Math.ceil((r.leadIn - now) / 1000)}`);
    else if (now > r.duration) this.info.setText('');
    else this.info.setText('Im Takt bleiben!');
  }

  protected onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'rhythm') return;
    const r = s.mini.state;
    const ids = Object.keys(r.charts);
    ids.forEach((id, i) => {
      if (this.seats.has(id)) return;
      const p = playerById(id);
      if (!p) return;
      const facing = i === 0 ? 1 : -1;
      const key = ensureTex(this, `sit_${id}_${facing}`, () => sittingFrom(avatarCanvas(p.look), facing as 1 | -1));
      const img = this.add.image(WORLD.W / 2 + (i === 0 ? -34 : 34), 214, key).setOrigin(0.5, 1).setScale(2).setDepth(500);
      this.seats.set(id, img);
      this.add.existing(nameTag(this, img.x, 218, p.name.slice(0, 8))).setDepth(501);
    });
    if (r.sub === 'ready') {
      const waiting = ids.filter((id) => !r.ready.includes(id)).map((id) => playerById(id)?.name ?? '?');
      this.info.setText(waiting.length ? `Warte auf: ${waiting.join(', ')} (Ton an!)` : '');
    }
    if (r.sub === 'play' && r.playSeq !== this.playSeq) {
      this.playSeq = r.playSeq;
      // Song-Start aus der synchronisierten Serverzeit – passt zu den Noten auf den Handys
      this.playStart = toLocalPerf(r.startAt);
      duckMusic(true);
      this.stopSong = playRhythmSong(this.playStart, r.bpm, RHYTHM.BEATS, r.leadIn);
    }
    if (r.sub === 'over') {
      duckMusic(false);
      this.bubble.removeAll(true);
      this.info.setText(r.sympathy > 70 ? 'Da hat es gefunkt!' : 'Schön war’s trotzdem.');
    }
    for (const [id, h] of Object.entries(r.lastHit)) {
      if (this.lastHits.get(id) === h.seq) continue;
      this.lastHits.set(id, h.seq);
      const seat = this.seats.get(id);
      if (!seat) continue;
      if (h.q === 2) this.floatHeart(seat.x, seat.y - 44);
      else if (h.q === 0) {
        const t = txt(this, seat.x, seat.y - 46, '...', { color: '#c9c3e6' }).setDepth(4000);
        this.tweens.add({ targets: t, alpha: 0, y: t.y - 10, duration: 700, onComplete: () => t.destroy() });
      }
    }
  }
}

// ================================================================== Wrap

export class WrapScene extends StateScene {
  private layer!: Phaser.GameObjects.Container;
  private key = '';

  constructor() {
    super('wrap');
  }

  private wrapFx = new Map<string, { step: number; mistakes: number }>();

  create() {
    this.key = '';
    this.wrapFx.clear();
    background(this, 'rhine', WORLD.W, WORLD.H, rhineBackground);
    this.add.image(WORLD.W / 2, 262, ensureTex(this, 'blanket', blanket)).setOrigin(0.5, 1).setScale(2.6, 1.6).setDepth(-500);
    // Obere Bildhälfte beleben: funkelnde Sterne, Lichtreflexe auf dem Rhein, eine Möwe auf Nachtflug
    twinkle(this, { n: 18, y: [34, 62], depth: -900 });
    twinkle(this, { n: 16, x: [110, 480], y: [150, 182], color: 0xffd25e, w: 4, depth: -900 });
    gulls(this, { n: 1, y: [36, 60], depth: -400, alpha: 0.6 });
    this.layer = this.add.container(0, 0);
    this.listen();
  }

  protected onState(s: GameState) {
    if (s.mini?.kind !== 'wrap') return;
    const w = s.mini.state;
    const key = JSON.stringify([Math.ceil(w.endsIn / 1000), w.sub, Object.values(w.players).map((p) => [p.step, p.mistakes, p.lastGrab?.seq])]);
    if (key === this.key) return;
    this.key = key;
    this.layer.removeAll(true);
    this.layer.add(panel(this, 100, 36, 280, 28));
    this.layer.add(ink(this, WORLD.W / 2, 46, `Wraps mit Sriracha-Mayo · ${Math.ceil(w.endsIn / 1000)}s`, { color: RED_INK }));

    const entries = Object.entries(w.players);
    const n = entries.length;
    const spacing = n <= 2 ? 200 : Math.min(160, 440 / n);
    const small = n > 2;
    // Töne: richtige Zutat = Plopp, daneben = Fehler-Ton, fertig = Münze
    for (const [id, p] of entries) {
      const prev = this.wrapFx.get(id);
      if (prev && p.step > prev.step) sfx(p.step >= WRAP_RECIPE.length ? 'coin' : 'pop', { pitch: 1 + p.step * 0.06 });
      if (prev && p.mistakes > prev.mistakes) sfx('error', { vol: 0.6 });
      this.wrapFx.set(id, { step: p.step, mistakes: p.mistakes });
    }
    if (w.sub === 'over' && this.key && !this.wrapFx.has('_over')) (this.wrapFx.set('_over', { step: 0, mistakes: 0 }), sfx('win'));
    entries.forEach(([id, p], i) => {
      const cx = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;

      const name = tagName(playerById(id)?.name ?? '?');
      const forName = tagName(playerById(w.forWhom[id])?.name ?? '?');
      const steps = WRAP_RECIPE.slice(0, p.step);
      const stackKey = ensureTex(this, `wrap_${steps.join('-') || 'empty'}`, () => wrapStack(steps));
      // Ab 5 Spielern werden Karten und Teller schmaler, damit sie sich nicht überlappen (bis 12 Spieler)
      const narrow = spacing < 96;
      this.layer.add(this.add.image(cx, 236, stackKey).setOrigin(0.5, 1).setScale(small ? (spacing < 60 ? 1 : 2) : 3));
      const pw = small ? Math.max(narrow ? 30 : 90, Math.floor(spacing) - (narrow ? 3 : 6)) : 160;
      this.layer.add(panel(this, Math.round(cx - pw / 2), 70, pw, 52));
      this.layer.add(fitText(ink(this, cx, 78, small ? name : `${name} → ${forName}`), pw - 8));
      const next = WRAP_RECIPE[p.step];
      if (next) {
        if (small) this.layer.add(this.add.image(cx, 104, ensureTex(this, `ing_${next}`, () => ingredient(next))).setScale(1.5));
        else {
          this.layer.add(this.add.image(cx - 50, 104, ensureTex(this, `ing_${next}`, () => ingredient(next))).setScale(1.5));
          this.layer.add(ink(this, cx + 8, 100, INGREDIENT_NAMES[next].slice(0, 12)));
        }
      } else {
        this.layer.add(ink(this, cx, 100, narrow ? 'OK' : 'Fertig!', { color: '#2f7d32' }));
      }
      if (p.mistakes) this.layer.add(txt(this, cx, 244, narrow ? `${p.mistakes}x` : small ? `${p.mistakes}x daneben` : `${p.mistakes}x daneben gegriffen`, { color: '#ffb0a8' }));
      if (p.lastGrab && !p.lastGrab.ok) {
        const ic = this.add.image(cx + 30, 150, ensureTex(this, `ing_${p.lastGrab.item}`, () => ingredient(p.lastGrab!.item))).setScale(2);
        this.layer.add(ic);
        this.tweens.add({ targets: ic, y: 200, angle: 180, alpha: 0, duration: 900 });
      }
    });
    if (w.sub === 'over') this.layer.add(txt(this, WORLD.W / 2, 150, 'Guten Appetit!', { size: 16, color: C.gold }));
  }
}

// ================================================================== Sternbilder

const SKY = { x: 96, y: 8, w: 288, h: 192 };

export class StarsScene extends StateScene {
  private lines!: Phaser.GameObjects.Graphics;
  private starLayer!: Phaser.GameObjects.Container;
  private label!: Phaser.GameObjects.Text;
  private couple: Phaser.GameObjects.Container[] = [];
  private starKey = '';
  private lastFound = 0;
  private lastWrong = 0;

  constructor() {
    super('stars');
  }

  create() {
    this.starKey = '';
    this.lastFound = 0;
    this.lastWrong = 0;
    this.couple = [];
    background(this, 'starsky', WORLD.W, WORLD.H, (p) => {
      paintNightSky(p, 0, 0, WORLD.W, 214, 91);
      paintSkyline(p, 214, 92);
      paintRiver(p, 214, 30, 93);
      paintBoulders(p, 0, 244, WORLD.W, 26, 94);
    });
    this.lines = this.add.graphics().setDepth(10);
    this.starLayer = this.add.container(0, 0).setDepth(20);
    this.label = txt(this, WORLD.W / 2, 4, '').setDepth(30);
    this.listen();
  }

  protected onState(s: GameState) {
    if (s.mini?.kind !== 'stars') return;
    const st = s.mini.state;
    if (!this.couple.length) {
      const ids = s.date?.couple ?? s.players.slice(0, 2).map((p) => p.id);
      ids.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const f = figure(this, p.look, WORLD.W / 2 + (i === 0 ? -7 : 7), 262, 2);
        (f.getData('img') as Phaser.GameObjects.Image).setFlipX(i === 1);
        f.setDepth(100 + i);
        this.tweens.add({ targets: f, angle: i === 0 ? 4 : -4, x: f.x + (i === 0 ? 2 : -2), duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.couple.push(f);
      });
      this.time.addEvent({ delay: 1400, loop: true, callback: () => this.floatHeart(WORLD.W / 2 + Phaser.Math.Between(-10, 10), 206) });
    }

    const key = `${st.round}`;
    const pos = (id: number) => {
      const star = st.stars.find((x) => x.id === id)!;
      return { x: SKY.x + star.x * SKY.w, y: SKY.y + star.y * SKY.h };
    };
    if (key !== this.starKey) {
      this.starKey = key;
      this.lastFound = 0;
      this.starLayer.removeAll(true);
      for (const star of st.stars) {
        const p = { x: SKY.x + star.x * SKY.w, y: SKY.y + star.y * SKY.h };
        const glow = this.add.circle(p.x, p.y, star.big ? 5 : 3.5, 0xfff0b4, 0.25);
        const dot = this.add.rectangle(p.x, p.y, star.big ? 3 : 2, star.big ? 3 : 2, 0xfff7dc);
        this.tweens.add({ targets: [glow, dot], alpha: 0.5, duration: 600 + (star.id % 5) * 180, yoyo: true, repeat: -1 });
        this.starLayer.add([glow, dot]);
      }
    }
    this.lines.clear();
    this.lines.lineStyle(2, st.sub === 'done' ? 0xffd25e : 0xf7e4b5, 0.9);
    for (const [a, b] of st.found) {
      const pa = pos(a);
      const pb = pos(b);
      this.lines.lineBetween(pa.x, pa.y, pb.x, pb.y);
    }
    if (st.found.length > this.lastFound) {
      const [a, b] = st.found[st.found.length - 1];
      const pa = pos(a);
      const pb = pos(b);
      this.floatHeart((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    }
    this.lastFound = st.found.length;
    if (st.lastWrong && st.lastWrong.seq !== this.lastWrong) {
      this.lastWrong = st.lastWrong.seq;
      const g = this.add.graphics().setDepth(11);
      const pa = st.stars.find((x) => x.id === st.lastWrong!.a);
      const pb = st.stars.find((x) => x.id === st.lastWrong!.b);
      if (pa && pb) {
        g.lineStyle(2, 0xd8473c, 0.9).lineBetween(SKY.x + pa.x * SKY.w, SKY.y + pa.y * SKY.h, SKY.x + pb.x * SKY.w, SKY.y + pb.y * SKY.h);
        this.tweens.add({ targets: g, alpha: 0, duration: 600, onComplete: () => g.destroy() });
      }
    }
    const t = Math.ceil(st.endsIn / 1000);
    this.label.setText(
      st.sub === 'done'
        ? `${st.name}!`
        : st.sub === 'over'
          ? 'Was für eine Nacht ...'
          : `${st.name} – ${st.hint}   ${st.found.length}/${st.edgeTotal}   ${t}s`,
    );
    this.label.setColor(st.sub === 'done' ? C.gold : '#fff4d6');
  }
}

export const DATE_SCENES = [StoryScene, DescentScene, RhythmScene, WrapScene, StarsScene];
