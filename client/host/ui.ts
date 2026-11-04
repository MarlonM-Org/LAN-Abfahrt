import Phaser from 'phaser';
import { FONT } from './store';

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
    color: opts.color ?? '#fff1e8',
    align: opts.align ?? 'center',
    lineSpacing: 4,
    wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
  });
  t.setOrigin(...(opts.origin ?? [0.5, 0]));
  if (opts.shadow !== false) t.setShadow(1, 1, '#1a1c2c', 0, false, true);
  return t;
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

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.8, border = 0xffec27) {
  const g = scene.add.graphics();
  g.fillStyle(0x1a1c2c, alpha).fillRect(x, y, w, h);
  g.lineStyle(1, border).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  return g;
}

export const PLACE_COLORS = ['#ffec27', '#c2c3c7', '#ffa300', '#fff1e8'];
