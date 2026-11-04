import type Phaser from 'phaser';
import type { Look } from '../../shared/types';
import { AV_H, AV_W, drawAvatar } from '../../shared/avatar';
import { ball, bottle } from '../art/objects';
import { ensureTex } from './ui';

export function ensureAvatar(scene: Phaser.Scene, look: Look): string {
  const key = `av2_${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}`;
  return ensureTex(scene, key, () => {
    const c = document.createElement('canvas');
    c.width = AV_W;
    c.height = AV_H;
    drawAvatar(c.getContext('2d')!, look);
    return c;
  });
}

/** Figur mit Bodenschatten als Container (Ursprung = Füße) */
export function figure(scene: Phaser.Scene, look: Look, x: number, y: number, scale = 1) {
  const c = scene.add.container(x, y);
  c.add(scene.add.ellipse(0, -1 * scale, 12 * scale, 4 * scale, 0x000000, 0.22));
  const img = scene.add.image(0, 0, ensureAvatar(scene, look)).setOrigin(0.5, 1).setScale(scale);
  c.add(img);
  c.setData('img', img);
  return c;
}

export const ensureBottle = (scene: Phaser.Scene) => ensureTex(scene, 'bottle2', bottle);
export const ensureBall = (scene: Phaser.Scene) => ensureTex(scene, 'ball2', ball);

/** Kopf-Porträt (16 × 15) für Listen und Anzeigetafeln */
export function ensurePortrait(scene: Phaser.Scene, look: Look): string {
  const key = `pt_${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}`;
  return ensureTex(scene, key, () => {
    const full = document.createElement('canvas');
    full.width = AV_W;
    full.height = AV_H;
    drawAvatar(full.getContext('2d')!, look);
    const c = document.createElement('canvas');
    c.width = AV_W;
    c.height = 15;
    c.getContext('2d')!.drawImage(full, 0, 0, AV_W, 15, 0, 0, AV_W, 15);
    return c;
  });
}
