/**
 * Parallax-Hintergründe: 2–3 Ebenen (Himmel fern, Kulisse mittel, Boden nah), die sich unterschiedlich
 * schnell bewegen. Zwei Betriebsarten:
 *
 * - `camera`: die Szene bewegt/zoomt ihre Hauptkamera (Smash, Igel) – die Ebenen bekommen `setScrollFactor`.
 *   Ebenen in Weltgröße reichen, solange der Faktor ≤ 0.5 bleibt und die Kamera innerhalb der Welt bleibt.
 * - `manual`: die Kamera steht (Volley, Bogen mit Wrap-Kameras) – die Ebenen sind TileSprites, deren Textur
 *   mit dem Blickpunkt (`lookAt`, z. B. Ball oder Schwerpunkt der Spieler) leicht gegenläufig verschoben wird.
 *
 *   const px = new Parallax(this, { mode: 'manual', strength: 0.15 });
 *   px.add(this.add.image(0, 0, farKey).setOrigin(0), 0.2);   // camera-Modus
 *   px.tile(farKey, 0.2);                                       // manual-Modus
 *   px.lookAt(ball.x, ball.y);                                  // pro Frame (wird geglättet)
 */
import Phaser from 'phaser';

export interface ParallaxOpts {
  mode?: 'camera' | 'manual';
  /** manual: wie stark der Blickpunkt die Ebenen versetzt (virtueller Kameraweg pro Pixel Abstand zur Mitte) */
  strength?: number;
  /** manual: Weltmitte (Standard 240/135) und ob auch senkrecht versetzt wird */
  cx?: number;
  cy?: number;
  vertical?: boolean;
  /** Breite/Höhe der TileSprites (manual) */
  w?: number;
  h?: number;
  /** Container, in den neue Ebenen wandern (z. B. bgL in Szenen mit HUD-Kamera) */
  layer?: Phaser.GameObjects.Container;
  /** manual: Blickpunkt pro Frame abfragen (statt `lookAt` aus dem update() der Szene) */
  focus?: () => { x: number; y: number } | null;
}

type Layer = { go: Phaser.GameObjects.TileSprite; f: number };

export class Parallax {
  private tiles: Layer[] = [];
  private focus: { x: number; y: number };
  private shown: { x: number; y: number };
  readonly mode: 'camera' | 'manual';

  constructor(
    readonly scene: Phaser.Scene,
    readonly opts: ParallaxOpts = {},
  ) {
    this.mode = opts.mode ?? 'camera';
    this.focus = { x: opts.cx ?? 240, y: opts.cy ?? 135 };
    this.shown = { ...this.focus };
    if (this.mode === 'manual') {
      const tick = () => this.tick();
      scene.events.on(Phaser.Scenes.Events.POST_UPDATE, tick);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, tick));
    }
  }

  /** camera-Modus: vorhandenes Objekt als Ebene mit Faktor f (0 = ganz fern, 1 = Spielebene) */
  add<T extends Phaser.GameObjects.Components.ScrollFactor>(go: T, f: number): T {
    go.setScrollFactor(f);
    return go;
  }

  /** Ebene aus einer Textur: im manual-Modus ein TileSprite, sonst ein Bild mit Scroll-Faktor */
  tile(key: string, f: number, depth?: number) {
    const w = this.opts.w ?? 480;
    const h = this.opts.h ?? 270;
    const go = this.scene.add.tileSprite(0, 0, w, h, key).setOrigin(0, 0);
    if (depth !== undefined) go.setDepth(depth);
    if (this.mode === 'camera') go.setScrollFactor(f);
    else this.tiles.push({ go, f });
    this.opts.layer?.add(go);
    return go;
  }

  /** manual-Modus: Blickpunkt setzen (wird weich nachgezogen) */
  lookAt(x: number, y: number) {
    this.focus = { x, y };
  }

  private tick() {
    const o = this.opts;
    const f = o.focus?.();
    if (f) this.focus = f;
    this.shown.x += (this.focus.x - this.shown.x) * 0.06;
    this.shown.y += (this.focus.y - this.shown.y) * 0.06;
    const k = o.strength ?? 0.15;
    const dx = (this.shown.x - (o.cx ?? 240)) * k;
    const dy = o.vertical ? (this.shown.y - (o.cy ?? 135)) * k : 0;
    for (const { go, f } of this.tiles) {
      // Ferne Ebenen laufen dem Blickpunkt (gegenüber der Spielebene) hinterher
      go.tilePositionX = -(1 - f) * dx;
      go.tilePositionY = -(1 - f) * dy;
    }
  }
}
