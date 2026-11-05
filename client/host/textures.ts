import type Phaser from 'phaser';
import type { Look } from '../../shared/types';
import { AV_H, AV_SHEET_COLS, AV_SHEET_ROWS, AV_W, type AvatarAnim, avatarFrames, drawAvatar, drawAvatarSheet } from '../../shared/avatar';
import { ball, bottle } from '../art/objects';
import { ensureTex } from './ui';

export type { AvatarAnim } from '../../shared/avatar';

const lookKey = (look: Look) => `${look.skin}_${look.hair}_${look.hairStyle}_${look.shirt}_${look.beard ?? 0}`;

export function ensureAvatar(scene: Phaser.Scene, look: Look): string {
  const key = `av2_${lookKey(look)}`;
  return ensureTex(scene, key, () => {
    const c = document.createElement('canvas');
    c.width = AV_W;
    c.height = AV_H;
    drawAvatar(c.getContext('2d')!, look);
    return c;
  });
}

/** Bildraten der Avatar-Animationen (Laufen lässt sich per `timeScale` ans Tempo anpassen) */
const ANIM_FPS: Record<AvatarAnim, number> = { idle: 1, walk: 10, jump: 1, hit: 1, cheer: 4 };

/**
 * Spritesheet mit allen Animations-Frames (Zeilen aus `AV_SHEET_ROWS`) + die Phaser-Animationen
 * `<key>_idle|walk|jump|hit|cheer`. Frame 0 ist das Standbild.
 */
export function ensureAvatarSheet(scene: Phaser.Scene, look: Look): string {
  const key = `avs_${lookKey(look)}`;
  if (!scene.textures.exists(key)) {
    const c = document.createElement('canvas');
    c.width = AV_W * AV_SHEET_COLS;
    c.height = AV_H * AV_SHEET_ROWS.length;
    drawAvatarSheet(c.getContext('2d')!, look);
    const tex = scene.textures.addCanvas(key, c)!;
    for (let r = 0; r < AV_SHEET_ROWS.length; r++) for (let i = 0; i < AV_SHEET_COLS; i++) tex.add(r * AV_SHEET_COLS + i, 0, i * AV_W, r * AV_H, AV_W, AV_H);
  }
  const anims = scene.anims;
  for (const row of AV_SHEET_ROWS) {
    const ak = `${key}_${row.anim}`;
    if (anims.exists(ak)) continue;
    const frames = avatarFrames(row.anim);
    if (row.anim === 'idle') {
      // Blinzeln: lange offen, kurz zu
      anims.create({ key: ak, frames: [{ key, frame: frames[0], duration: 3200 }, { key, frame: frames[1], duration: 130 }], repeat: -1 });
    } else {
      anims.create({ key: ak, frames: frames.map((frame) => ({ key, frame })), frameRate: ANIM_FPS[row.anim], repeat: row.poses.length > 1 ? -1 : 0 });
    }
  }
  return key;
}

/** Avatar als Sprite (Ursprung = Füße), startet blinzelnd im Stand */
export function avatarSprite(scene: Phaser.Scene, look: Look, x = 0, y = 0): Phaser.GameObjects.Sprite {
  const key = ensureAvatarSheet(scene, look);
  const s = scene.add.sprite(x, y, key, 0).setOrigin(0.5, 1);
  s.setData('avKey', key);
  playAvatar(s, 'idle');
  return s;
}

/**
 * Animation wechseln – mehrfach pro Frame aufrufbar, gleiche Animation läuft einfach weiter.
 * Squash & Stretch: Absprung streckt (scaleY 1,15), Landung staucht (0,85), beides federt zurück.
 * `speed` skaliert die Bildrate (z. B. Laufen nach Tempo).
 */
export function playAvatar<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(img: T, anim: AvatarAnim, speed = 1): T {
  const s = img as Phaser.GameObjects.Sprite;
  const key = s.getData('avKey') as string | undefined;
  if (!key || !s.scene || !s.anims) return img;
  s.anims.timeScale = speed;
  const prev = s.getData('avAnim') as AvatarAnim | undefined;
  // Laufen → Stehen erst nach kurzer Ruhe: geglättete Positionen zittern sonst zwischen beiden hin und her
  if (prev === 'walk' && anim === 'idle') {
    const now = s.scene.time.now;
    const since = (s.getData('avStill') as number | undefined) ?? now;
    s.setData('avStill', since);
    if (now - since < 160) return img;
  } else if (anim === 'walk') s.setData('avStill', undefined);
  if (prev === anim) return img;
  s.setData('avStill', undefined);
  s.setData('avAnim', anim);
  if (prev) {
    // Ruhe-Skalierung = scaleX (Squash & Stretch ändert nur scaleY)
    const base = Math.abs(s.scaleX) || 1;
    if (anim === 'jump') squash(s, base, 1.15);
    else if (prev === 'jump') squash(s, base, 0.85);
  }
  s.anims.play(`${key}_${anim}`);
  // Blinzeln nicht bei allen Figuren gleichzeitig
  if (anim === 'idle') s.anims.setProgress(Math.random() * 0.95);
  return img;
}

function squash(s: Phaser.GameObjects.Sprite, base: number, f: number) {
  const scene = s.scene;
  (s.getData('avSquash') as Phaser.Tweens.Tween | undefined)?.remove();
  s.scaleY = base * f;
  s.setData('avSquash', scene.tweens.add({ targets: s, scaleY: base, duration: f > 1 ? 220 : 140, ease: f > 1 ? 'Sine.Out' : 'Back.Out' }));
}

/** Figur-Container aus `figure()` – `play()` wechselt die Animation des Avatars */
export interface Figure extends Phaser.GameObjects.Container {
  play(anim: AvatarAnim, speed?: number): this;
}

/** Figur mit Bodenschatten als Container (Ursprung = Füße) */
export function figure(scene: Phaser.Scene, look: Look, x: number, y: number, scale = 1): Figure {
  const c = scene.add.container(x, y) as Figure;
  c.add(scene.add.ellipse(0, -1 * scale, 12 * scale, 4 * scale, 0x000000, 0.22));
  const img = avatarSprite(scene, look).setScale(scale);
  c.add(img);
  c.setData('img', img);
  c.play = (anim, speed = 1) => {
    playAvatar(img, anim, speed);
    return c;
  };
  return c;
}

export const ensureBottle = (scene: Phaser.Scene) => ensureTex(scene, 'bottle2', bottle);
export const ensureBall = (scene: Phaser.Scene) => ensureTex(scene, 'ball2', ball);

/** Kopf-Porträt (16 × 15) für Listen und Anzeigetafeln */
export function ensurePortrait(scene: Phaser.Scene, look: Look): string {
  const key = `pt_${lookKey(look)}`;
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
