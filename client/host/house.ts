import type Phaser from 'phaser';
import { ROOMS } from '../../shared/games';
import { DOORS, HOUSE, roomRect } from '../../shared/house';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintTiles, paintWater, paintWoodFloor } from '../art/ground';
import type { Pix } from '../art/pix';
import { background, ensureTex, txt } from './ui';

/** Ferienhaus von oben – gemeinsam für "Mord im Ferienhaus" und "Verräter im Ferienhaus" */
export function paintHouse(p: Pix) {
  p.rect(0, 0, WORLD.W, WORLD.H, C.woodDarker);
  const W = HOUSE.WALL;
  ROOMS.forEach((_, i) => {
    const r = roomRect(i);
    const x = r.x + W, y = r.y + W, w = r.w - 2 * W, h = r.h - 2 * W;
    switch (i) {
      case 0: paintTiles(p, x, y, w, h, '#ece6d3', '#cfc6ad', 9); break; // Küche
      case 1: paintWoodFloor(p, x, y, w, h, 51); break; // Wohnzimmer
      case 2: paintTiles(p, x, y, w, h, '#a8d8ea', '#86c1d9', 8); break; // Bad
      case 3: paintWoodFloor(p, x, y, w, h, 52, '#a96a3a'); break; // Schlafzimmer
      case 4: // Pool
        p.rect(x, y, w, h, C.stoneLight);
        for (let yy = y; yy < y + h; yy += 8) for (let xx = x + ((yy / 8) % 2) * 4; xx < x + w; xx += 8) p.rect(xx, yy, 7, 7, '#d9d5cb');
        paintWater(p, x + 16, y + 22, w - 32, h - 40, 53);
        p.rect(x + 14, y + 20, w - 28, 2, C.white).rect(x + 14, y + h - 20, w - 28, 2, C.stoneDark);
        break;
      case 5: paintGrass(p, x, y, w, h, 54); break; // Garten
    }
  });
  // Türschwellen (hellere Lücke in der Wand)
  for (const d of DOORS) p.rect(d.x, d.y, d.w, d.h, '#6e4521');
}

/** [Raum, Texturname, Malfunktion, x, y relativ zum Raum] */
const FURNITURE: [number, string, () => Pix, number, number][] = [
  [0, 'counter', O.counter, 60, 30],
  [0, 'table', O.table, 100, 84],
  [1, 'sofa', () => O.sofa(), 56, 34],
  [1, 'rugL', () => O.rug(56, 30), 80, 92],
  [1, 'plant', O.plant, 136, 34],
  [2, 'bathtub', O.bathtub, 46, 34],
  [2, 'plant', O.plant, 136, 104],
  [3, 'bed', () => O.bed(), 36, 48],
  [3, 'bed2', () => O.bed(C.red), 70, 48],
  [5, 'grill', O.grill, 120, 42],
  [5, 'bushB', () => O.bush(4, true), 30, 100],
  [5, 'tree1s', () => O.tree(1), 40, 54],
];

/**
 * Haus mit Möbeln und Raumnamen in die Szene setzen.
 * `ySort`: Möbel nach y sortieren (für Spiele, in denen Figuren herumlaufen).
 */
export function addHouse(scene: Phaser.Scene, opts: { ySort?: boolean; labelDepth?: number } = {}) {
  background(scene, 'house', WORLD.W, WORLD.H, paintHouse);
  for (const [room, key, make, dx, dy] of FURNITURE) {
    const r = roomRect(room);
    const img = scene.add.image(r.x + dx, r.y + dy, ensureTex(scene, `m_${key}`, make)).setOrigin(0.5, 1);
    img.setDepth(opts.ySort ? r.y + dy : 10);
  }
  ROOMS.forEach((room, i) => {
    const r = roomRect(i);
    txt(scene, r.x + r.w / 2, r.y + 6, room.name.toUpperCase()).setDepth(opts.labelDepth ?? 20).setAlpha(opts.ySort ? 0.7 : 1);
  });
}
