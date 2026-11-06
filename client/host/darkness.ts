import Phaser from 'phaser';
import { WORLD } from '../../shared/flunky';

/**
 * Dunkelheit als Overlay: eine RenderTexture wird jedes Frame dunkel gefüllt, und alles,
 * was Licht hat (Lichtkegel, beleuchtete Räume ...), wird mit einer Radierer-Grafik herausradiert.
 * Gemeinsam für Geisterjagd und den Stromausfall im Verräter-Spiel.
 *
 *   const e = dark.begin(0x060818, 0.94); // Füllen + Radierer leeren
 *   e.fillStyle(0xffffff, 0.8).fillCircle(x, y, 15); // Alpha = wie stark aufgehellt wird
 *   dark.end(); // Herausradieren
 */
export class Darkness {
  readonly rt: Phaser.GameObjects.RenderTexture;
  readonly eraser: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number, w = WORLD.W, h = WORLD.H) {
    this.rt = scene.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(depth);
    this.eraser = scene.make.graphics({}, false);
  }

  /** Dunkel füllen und den Radierer für dieses Frame leeren */
  begin(color: number, alpha: number): Phaser.GameObjects.Graphics {
    this.rt.clear();
    this.rt.fill(color, alpha);
    this.eraser.clear();
    return this.eraser;
  }

  /** Alles, was seit begin() auf den Radierer gemalt wurde, aus der Dunkelheit herausnehmen */
  end() {
    this.rt.erase(this.eraser);
  }
}
