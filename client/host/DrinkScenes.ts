import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import { Pix, rng } from '../art/pix';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GREEN_INK, RED_INK, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { BusfahrerScene } from './BusfahrerScene';

/** Gemütliche Strandbar am Abend */
function paintBar(p: Pix) {
  const r = rng(301);
  p.rect(0, 0, WORLD.W, 150, '#6e4126');
  for (let x = 0; x < WORLD.W; x += 14) p.vline(x, 0, 150, '#5a3420').vline(x + 1, 0, 150, '#8a5532');
  // Regale mit Flaschen
  for (const y of [40, 76]) {
    p.rect(20, y, 440, 4, C.woodLight).rect(20, y + 4, 440, 2, C.woodDarker);
    for (let x = 26; x < 456; x += 9 + Math.floor(r() * 5)) {
      const col = [C.green, '#7a3b2e', C.gold, '#3f6fb0', '#c9e8f0', C.red][Math.floor(r() * 6)];
      const h = 12 + Math.floor(r() * 8);
      p.rect(x, y - h, 5, h, col).rect(x + 1, y - h - 4, 3, 4, col).px(x + 1, y - h + 2, '#ffffff');
    }
  }
  // Lichterkette
  for (let x = 0; x < WORLD.W; x += 2) {
    const y = 10 + Math.sin((x / WORLD.W) * Math.PI * 4) * 5 + 5;
    p.px(x, y, '#2d1b12');
    if (x % 24 === 0) p.rect(x - 1, y + 1, 3, 3, [C.gold, C.pink, '#8fd3ff', C.green][(x / 24) % 4]);
  }
  paintWoodFloor(p, 0, 150, WORLD.W, WORLD.H - 150, 302);
  // Theke
  p.rect(0, 120, WORLD.W, 30, C.woodDark);
  p.rect(0, 118, WORLD.W, 4, C.woodLight);
  for (let x = 0; x < WORLD.W; x += 30) p.vline(x, 122, 28, C.woodDarker);
}

abstract class DrinkScene extends Phaser.Scene {
  protected layer!: Phaser.GameObjects.Container;
  protected juice!: Juice;
  private key = '';

  protected base() {
    this.key = '';
    background(this, 'bar', WORLD.W, WORLD.H, paintBar);
    this.layer = this.add.container(0, 0);
    this.juice = new Juice(this, { depth: 500 });
    const fn = (s: GameState) => {
      const k = this.stateKey(s);
      if (k === this.key) return;
      const first = this.key === '';
      this.key = k;
      this.layer.removeAll(true);
      if (!first) this.onChange(s);
      this.draw(s);
    };
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) fn(s);
  }

  protected abstract stateKey(s: GameState): string;
  protected abstract draw(s: GameState): void;
  /** Töne/Juice bei einer Zustandsänderung (nicht beim ersten Bild) */
  protected onChange(_s: GameState): void {}

  /** Spielerreihe vor der Theke */
  protected row(ids: string[], label: (id: string) => { text: string; color?: string } | null, y = 222) {
    const n = ids.length;
    const spacing = Math.min(60, 440 / Math.max(1, n));
    // Viele Spieler (ab 10): Namensschilder abwechselnd versetzt und kurze Labels, damit nichts überlappt
    const crowded = spacing < 48;
    // Ergebnis-Schilder: feste Breite pro Figur (nicht je nach Text unterschiedlich breit)
    const signW = Math.max(18, Math.min(56, (crowded ? 2 * spacing : spacing) - 4));
    ids.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      this.layer.add(figure(this, p.look, x, y, 2));
      // Name ohne „Bot “, Schrift auf Schildbreite verkleinert statt abgeschnitten
      this.layer.add(nameTag(this, x, y + 4 + (crowded && i % 2 ? 11 : 0), p.name, undefined, (crowded ? 2 * spacing : spacing) - 4));
      const l = label(id);
      const text = l && crowded ? l.text.replace(/ Schlucke?$/, '') : l?.text;
      if (l && text) {
        const sy = y - 66 - (crowded && i % 2 ? 11 : 0);
        this.layer.add(this.add.rectangle(x, sy + 5, signW, 12, 0xf7e4b5).setStrokeStyle(1, 0x8d5629));
        const t = fitText(ink(this, x, sy, text, { color: l.color }), signW - 4, 0.5);
        t.setY(sy + 5 - t.displayHeight / 2 + 0.5);
        this.layer.add(t);
      }
    });
  }

  protected header(title: string, line: string) {
    this.layer.add(panel(this, 40, 26, 400, 70));
    this.layer.add(ink(this, WORLD.W / 2, 34, title, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 50, line, { size: line.length > 40 ? 8 : 16, wrap: 370 }));
  }
}

export class NhieScene extends DrinkScene {
  constructor() {
    super('nhie');
  }
  create() {
    this.base();
  }
  protected stateKey(s: GameState) {
    return s.mini?.kind === 'nhie' ? JSON.stringify([s.mini.state.round, s.mini.state.sub, s.mini.state.answered]) : '';
  }
  protected draw(s: GameState) {
    if (s.mini?.kind !== 'nhie') return;
    const n = s.mini.state;
    this.header(`Ich hab noch nie ...   (${n.round}/${n.rounds})`, n.statement.replace(/^\.\.\.\s*/, ''));
    const ids = Object.keys(n.sips);
    if (n.sub === 'question') {
      this.row(ids, (id) => (n.answered.includes(id) ? { text: 'OK!', color: GREEN_INK } : null));
    } else {
      const have = n.have ?? [];
      this.row(ids, (id) => (have.includes(id) ? { text: have.length === 1 ? '+2 Schluck' : '+1 Schluck', color: RED_INK } : { text: 'Nie!', color: GREEN_INK }));
      if (have.length === 1) this.layer.add(txt(this, WORLD.W / 2, 104, `Nur ${tagName(playerById(have[0])?.name ?? '?')} – erzähl!`, { color: C.gold }));
    }
  }
  private answered = 0;
  protected onChange(s: GameState) {
    if (s.mini?.kind !== 'nhie') return;
    const n = s.mini.state;
    if (n.sub === 'question') {
      if (n.answered.length > this.answered) sfx('tick', { pitch: 1 + n.answered.length * 0.05 });
      else sfx('select');
      this.answered = n.answered.length;
      return;
    }
    // Auflösung: Pling, bei nur einem Lacher-Jingle
    this.answered = 0;
    const have = n.have ?? [];
    sfx('coin');
    if (have.length === 1) (sfx('cheer', { delay: 0.2 }), this.juice.burst(WORLD.W / 2, 110, 'confetti', 30));
    else if (have.length) sfx('pop', { delay: 0.15, pitch: 0.8 });
  }
}

export class BombScene extends DrinkScene {
  private sparks?: Phaser.Time.TimerEvent;

  constructor() {
    super('bomb');
  }
  create() {
    this.base();
  }
  protected stateKey(s: GameState) {
    return s.mini?.kind === 'bomb' ? JSON.stringify([s.mini.state.round, s.mini.state.sub, s.mini.state.passSeq]) : '';
  }
  protected draw(s: GameState) {
    if (s.mini?.kind !== 'bomb') return;
    const b = s.mini.state;
    this.header(`Tick-Tack-Bumm · Runde ${b.round}/${b.rounds}`, b.category);
    const ids = Object.keys(b.sips);
    this.row(ids, () => null);
    const n = ids.length;
    const spacing = Math.min(60, 440 / Math.max(1, n));
    const i = ids.indexOf(b.holder);
    const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
    if (b.sub === 'boom') {
      this.juice.shake(3);
      this.juice.flash(0xffb450, 300);
      this.juice.burst(x, 140, 'fire', 24);
      this.juice.burst(x, 140, 'smoke', 10);
      this.layer.add(txt(this, WORLD.W / 2, 110, `BUMM! ${tagName(playerById(b.holder)?.name ?? '?')} trinkt 3!`, { size: 16, color: C.gold }));
      return;
    }
    const bomb = this.add.image(x, 140, ensureTex(this, 'bomb', bombPix)).setScale(2);
    this.layer.add(bomb);
    this.tweens.add({ targets: bomb, scale: 2.2, duration: 220, yoyo: true, repeat: -1 });
    this.layer.add(txt(this, WORLD.W / 2, 104, 'Begriff sagen – weitergeben!', { color: '#fff4d6' }));
  }
  protected onChange(s: GameState) {
    if (s.mini?.kind !== 'bomb') return;
    const b = s.mini.state;
    if (b.sub === 'boom') (sfx('boom'), sfx('cheer', { delay: 0.4, vol: 0.6 }));
    else sfx('tick', { pitch: 1.2 });
  }
}


function bombPix(): Pix {
  const p = new Pix(16, 18);
  p.disc(8, 11, 6.5, '#2d2d3a');
  p.overlayOn(() => p.disc(6, 9, 2.5, '#5a5a70'));
  p.rect(7, 2, 3, 3, '#5a5a70');
  p.px(10, 1, C.gold).px(11, 0, C.orange).px(9, 0, C.red);
  p.outline(C.outline);
  return p;
}

export const DRINK_SCENES = [NhieScene, BusfahrerScene, BombScene];
