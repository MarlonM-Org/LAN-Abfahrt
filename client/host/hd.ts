/**
 * Render-Auflösung ×2 (960 × 540) bei unveränderter Welt (480 × 270).
 *
 * Alle Szenen, `shared/` und der Server rechnen weiter in 480 × 270. Die Leinwand ist doppelt so
 * groß; am Ende jeder Kamera-Matrix wird ×2 skaliert. Dadurch bleibt der Pixel-Look (Nearest-Filter,
 * Pixelschrift wird nur vergrößert), aber Figuren bewegen sich auf halben Welt-Pixeln und Drehungen
 * (Karts, Wackelturm-Teile, Smash ×1,5) haben doppelt so viele Stufen. Kein Szenen-Code muss das wissen:
 *
 * - `cameras.add()` ohne Größe (also auch `cameras.main`) liefert weiter 480 × 270-Kameras; Kamera-Zoom,
 *   `centerOn`, `setBounds`, `worldView`, `scrollFactor`, Zusatzkameras mit Bildschirm-Koordinaten
 *   (Smash-HUD, Bogen-Wrap, Igel-HUD) verhalten sich wie bei ×1.
 * - Scissor/Viewport, Hintergrundfüllung und Flash/Fade der Kameras liegen in Leinwand-Pixeln und werden
 *   hier mitskaliert (WebGL- und Canvas-Renderer).
 * - `roundPixels` ist bei ×2 aus (sonst rastet Phaser die Objekte vor dem Zoom auf ganze Welt-Pixel).
 *
 * Umschalten: `tv.html?hd=1|2` oder in der Laptop-Steuerung; gespeichert in localStorage.
 */
import Phaser from 'phaser';

export type HdFactor = 1 | 2;
const KEY = 'tv.hd';

/** Gewählter Faktor: URL-Parameter > localStorage > Standard (×2 auf dem Desktop/TV, ×1 am kleinen Touch-Gerät) */
export function hdFactor(): HdFactor {
  const q = new URLSearchParams(location.search).get('hd');
  if (q === '1' || q === '2') {
    try {
      localStorage.setItem(KEY, q);
    } catch {
      /* privater Modus */
    }
    return Number(q) as HdFactor;
  }
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1' || v === '2') return Number(v) as HdFactor;
  } catch {
    /* privater Modus */
  }
  return navigator.maxTouchPoints > 0 && Math.max(screen.width, screen.height) < 1200 ? 1 : 2;
}

/** Faktor merken und die TV-Seite neu laden (die Spielgröße steht beim Start fest) */
export function setHdFactor(f: HdFactor) {
  try {
    localStorage.setItem(KEY, String(f));
  } catch {
    /* privater Modus */
  }
  const u = new URL(location.href);
  u.searchParams.set('hd', String(f));
  location.href = u.toString();
}

type Cam = Phaser.Cameras.Scene2D.Camera & { _x: number; _y: number; _width: number; _height: number };

/** Vor `new Phaser.Game({ width: WORLD.W * f, height: WORLD.H * f })` aufrufen */
export function installHd(f: HdFactor) {
  if (f === 1) return;

  // 1) Kameras ohne Größe bleiben 480 × 270 (statt der Leinwandgröße); kein Einrasten auf ganze Welt-Pixel
  const CM = Phaser.Cameras.Scene2D.CameraManager.prototype;
  const add = CM.add;
  CM.add = function (this: Phaser.Cameras.Scene2D.CameraManager, x = 0, y = 0, w?: number, h?: number, makeMain?: boolean, name?: string) {
    const cam = add.call(this, x, y, w ?? this.scene.sys.scale.width / f, h ?? this.scene.sys.scale.height / f, makeMain, name);
    cam.setRoundPixels(false);
    return cam;
  };

  // 2) Kamera-Matrix (Welt → Leinwand) am Ende ×f – nach Zoom, Schwenk und Shake
  const Cam = Phaser.Cameras.Scene2D.Camera.prototype;
  const pre = Cam.preRender;
  Cam.preRender = function (this: Phaser.Cameras.Scene2D.Camera) {
    pre.call(this);
    // `matrix` ist in den Typen privat – zur Laufzeit die TransformMatrix der Kamera
    const m = (this as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix.matrix;
    for (let i = 0; i < 6; i++) m[i] *= f;
  };

  // 3) Viewport, Hintergrund und Flash/Fade zeichnen die Renderer mit x/y/width/height der Kamera in Leinwand-Pixeln
  const scaled = <T>(camera: Phaser.Cameras.Scene2D.Camera, fn: () => T): T => {
    const c = camera as Cam;
    c._x *= f;
    c._y *= f;
    c._width *= f;
    c._height *= f;
    try {
      return fn();
    } finally {
      c._x /= f;
      c._y /= f;
      c._width /= f;
      c._height /= f;
    }
  };
  const GL = Phaser.Renderer.WebGL.WebGLRenderer.prototype;
  const glPre = GL.preRenderCamera;
  const glPost = GL.postRenderCamera;
  GL.preRenderCamera = function (this: Phaser.Renderer.WebGL.WebGLRenderer, camera) {
    scaled(camera, () => glPre.call(this, camera));
  };
  GL.postRenderCamera = function (this: Phaser.Renderer.WebGL.WebGLRenderer, camera) {
    scaled(camera, () => glPost.call(this, camera));
  };
  const CV = Phaser.Renderer.Canvas.CanvasRenderer.prototype;
  const cvRender = CV.render;
  CV.render = function (this: Phaser.Renderer.Canvas.CanvasRenderer, scene, children, camera) {
    scaled(camera, () => cvRender.call(this, scene, children, camera));
  };
}
