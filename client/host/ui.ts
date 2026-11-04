import Phaser from 'phaser';
import { FONT } from './store';
import { Pix } from '../art/pix';
import { panelPix, tagPix } from '../art/objects';

export const INK = '#3d2414';
export const LIGHT = '#fff4d6';
export const GOLD = '#ffd25e';
export const RED_INK = '#a8342a';
export const BLUE_INK = '#2d64a8';
export const GREEN_INK = '#2f7d32';

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { size?: 8 | 16 | 24; color?: string; origin?: [number, number]; wrap?: number; align?: string; shadow?: boolean } = {},
) {
  const t = scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: `${opts.size ?? 8}px`,
    color: opts.color ?? LIGHT,
    align: opts.align ?? 'center',
    lineSpacing: 4,
    wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
  });
  t.setOrigin(...(opts.origin ?? [0.5, 0]));
  if (opts.shadow !== false) t.setShadow(1, 1, '#2d1b12', 0, false, true);
  return t;
}

/** Text in Tinte (für Pergament-Flächen) */
export function ink(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { size?: 8 | 16 | 24; color?: string; origin?: [number, number]; wrap?: number; align?: string } = {},
) {
  return txt(scene, x, y, text, { ...opts, color: opts.color ?? INK, shadow: false });
}

/** Erzeugt eine Textur einmalig aus Pixel-Art */
export function ensureTex(scene: Phaser.Scene, key: string, make: () => Pix | HTMLCanvasElement): string {
  if (!scene.textures.exists(key)) {
    const src = make();
    scene.textures.addCanvas(key, src instanceof Pix ? src.canvas : src);
  }
  return key;
}

/** Holzrahmen-Panel mit Pergament (Größe in Welt-Pixeln) */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, variant: 'paper' | 'dark' = 'paper') {
  const key = ensureTex(scene, `panel_${w}_${h}_${variant}`, () => panelPix(w, h, variant));
  return scene.add.image(x, y, key).setOrigin(0, 0);
}

/** Namensschild unter Figuren */
export function nameTag(scene: Phaser.Scene, x: number, y: number, name: string, color = INK) {
  const w = Math.max(20, name.length * 8 + 6);
  const key = ensureTex(scene, `tag_${w}`, () => tagPix(w));
  const c = scene.add.container(x, y);
  c.add(scene.add.image(0, 0, key).setOrigin(0.5, 0));
  c.add(ink(scene, 0, 2, name, { color }));
  return c;
}

/** Hintergrund einmalig malen und als Bild einfügen */
export function background(scene: Phaser.Scene, key: string, w: number, h: number, paint: (p: Pix) => void) {
  const k = ensureTex(scene, `bg_${key}`, () => {
    const p = new Pix(w, h);
    paint(p);
    return p;
  });
  return scene.add.image(0, 0, k).setOrigin(0, 0).setDepth(-1000);
}

/** Sprite aus Pixel-Art einfügen (Ursprung unten mittig – für Tiefensortierung) */
export function prop(scene: Phaser.Scene, key: string, make: () => Pix, x: number, y: number) {
  const img = scene.add.image(x, y, ensureTex(scene, key, make)).setOrigin(0.5, 1);
  img.setDepth(y);
  return img;
}

/** Lokaler Countdown aus dem Server-Wert "endsIn" (ms). */
export class Countdown {
  private endsAt = 0;

  set(endsInMs: number) {
    this.endsAt = performance.now() + endsInMs;
  }

  get remaining() {
    return Math.max(0, this.endsAt - performance.now());
  }

  get seconds() {
    return Math.ceil(this.remaining / 1000);
  }
}

export const PLACE_COLORS = ['#c98a10', '#6e6a62', '#a5602a', INK];
