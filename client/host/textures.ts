import type Phaser from 'phaser';
import type { Look } from '../../shared/types';
import { AV_H, AV_W, drawAvatar } from '../../shared/avatar';

export function ensureAvatar(scene: Phaser.Scene, look: Look): string {
  const key = `av_${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, AV_W, AV_H);
    if (tex) {
      drawAvatar(tex.getContext(), look);
      tex.refresh();
    }
  }
  return key;
}

/** Kleine Pixel-Bierflasche (6 × 16), Ursprung unten mittig verwenden. */
export function ensureBottle(scene: Phaser.Scene): string {
  const key = 'bottle';
  if (scene.textures.exists(key)) return key;
  const rows = [
    '..cc..',
    '..gg..',
    '..gg..',
    '..gg..',
    '.gggg.',
    'gggggg',
    'gwwwwg',
    'gwrrwg',
    'gwrrwg',
    'gwwwwg',
    'gggggg',
    'gggggg',
    'gggggg',
    'gggggg',
    'gggggg',
    '.gggg.',
  ];
  const colors: Record<string, string> = { c: '#c9a227', g: '#2f7d32', w: '#f2efe0', r: '#c0392b' };
  const tex = scene.textures.createCanvas(key, 6, rows.length);
  if (!tex) return key;
  const ctx = tex.getContext();
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  tex.refresh();
  return key;
}

/** Ball (4 × 4) */
export function ensureBall(scene: Phaser.Scene): string {
  const key = 'ball';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff).fillRect(1, 0, 2, 4).fillRect(0, 1, 4, 2);
  g.fillStyle(0xcccccc).fillRect(2, 2, 1, 1);
  g.generateTexture(key, 4, 4);
  g.destroy();
  return key;
}
