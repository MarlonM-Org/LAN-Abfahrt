/** Pixel-Art aus dem Garten: Wassereimer und Wasserpistole (Wasserpistolen-Duell) */
import { C } from './palette';
import { Pix, shade } from './pix';

/** Wassereimer in Teamfarbe */
export function bucket(color: string): Pix {
  const p = new Pix(16, 16);
  p.rect(3, 5, 10, 9, color).rect(4, 14, 8, 1, color);
  p.rect(3, 5, 10, 1, shade(color, 1.3)).vline(11, 6, 8, shade(color, 0.75)).vline(12, 6, 8, shade(color, 0.75));
  p.ellipse(8, 5, 5, 1.6, C.waterLight);
  p.px(6, 5, C.foam);
  // Henkel
  p.px(3, 3, '#a0a0a8').px(4, 2, '#a0a0a8').hline(5, 1, 6, '#a0a0a8').px(11, 2, '#a0a0a8').px(12, 3, '#a0a0a8');
  // Wasserbomben am Rand
  p.disc(14, 13, 1.6, C.pink);
  p.outline(C.outline);
  return p;
}

/** Wasserpistole (Power-up) */
export function waterPistol(): Pix {
  const p = new Pix(16, 12);
  // Tank
  p.rect(5, 1, 6, 4, C.waterLight).hline(5, 1, 6, C.foam);
  // Körper
  p.rect(1, 5, 14, 3, C.orange).hline(1, 5, 14, '#ffb867');
  p.rect(13, 6, 3, 1, '#2d64a8');
  // Griff
  p.rect(3, 8, 4, 4, C.orange).vline(6, 8, 4, '#c06a1f');
  p.px(8, 8, '#c06a1f').px(8, 9, '#c06a1f');
  p.outline(C.outline);
  return p;
}
