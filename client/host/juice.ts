/**
 * Gemeinsamer „Juice“-Baukasten für die TV-Szenen: Shake, Flash, Hit-Stop, Zeitlupe,
 * Zoom-Stoß, Partikel (echte Phaser-Emitter), schwebende Texte, Banner und Töne.
 *
 * Pro Szene in `create()` neu anlegen (Szenen werden wiederverwendet):
 *
 *   this.juice = new Juice(this, { layer: this.fxL, hud: this.hud });
 *   this.juice.burst(x, y, 'splash');
 *   this.juice.sfx('splash', { x });
 *
 * Hit-Stop und Zeitlupe wirken nur auf die Darstellung (Tweens, Timer, Partikel) – die
 * Positionen kommen ja vom Server. Szenen, die selbst interpolieren, können `frozen`
 * abfragen und in der Zeit die Figuren stehen lassen.
 */
import Phaser from 'phaser';
import { ensureTex, txt } from './ui';
import { type SfxName, type SfxOpts, sfx } from './sfx';

export type BurstPreset = 'puff' | 'sand' | 'splash' | 'confetti' | 'spark' | 'smoke' | 'wood' | 'fire';
export type FloatStyle = 'dmg' | 'heal' | 'gold' | 'info' | 'water';

export interface JuiceOpts {
  /** Container für Partikel und schwebende Texte (sonst direkt in die Szene, Tiefe `depth`) */
  layer?: Phaser.GameObjects.Container;
  /** Container für Banner (z. B. eigene HUD-Kamera) */
  hud?: Phaser.GameObjects.Container;
  /** Tiefe für Partikel/Texte ohne `layer` */
  depth?: number;
  /** Die Szene setzt den Kamera-Zoom selbst (Smash) – dann `zoom` mit einrechnen statt die Kamera zu tweenen */
  manualZoom?: boolean;
}

const FLOAT_COLORS: Record<FloatStyle, string> = { dmg: '#ff8a7a', heal: '#9ad65a', gold: '#ffd25e', info: '#fff4d6', water: '#93d3f3' };

/** Einheitliche Shake-Stufen statt handgewählter Zahlen: [Dauer ms, Stärke] */
const SHAKE: Record<1 | 2 | 3, [number, number]> = { 1: [100, 0.003], 2: [180, 0.007], 3: [320, 0.014] };

type Cfg = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;
const PRESETS: Record<BurstPreset, { tex: string; n: number; cfg: Cfg }> = {
  puff: {
    tex: 'jx_soft', n: 8,
    cfg: { speed: { min: 15, max: 45 }, angle: { min: 0, max: 360 }, lifespan: { min: 300, max: 520 }, scale: { start: 0.9, end: 0.2 }, alpha: { start: 0.9, end: 0 }, gravityY: -20, tint: [0xffffff, 0xf4efe2, 0xe6dccb] },
  },
  sand: {
    tex: 'jx_px', n: 10,
    cfg: { speed: { min: 30, max: 90 }, angle: { min: 200, max: 340 }, lifespan: { min: 350, max: 600 }, gravityY: 260, alpha: { start: 1, end: 0.2 }, tint: [0xf1d49a, 0xdfb878, 0xc99b5a] },
  },
  splash: {
    tex: 'jx_dot', n: 14,
    cfg: { speed: { min: 50, max: 130 }, angle: { min: 210, max: 330 }, lifespan: { min: 450, max: 700 }, gravityY: 380, scale: { start: 1, end: 0.4 }, alpha: { start: 1, end: 0.3 }, tint: [0xeaf8ff, 0x93d3f3, 0x7fd4ff, 0x3f8fe0] },
  },
  confetti: {
    tex: 'jx_bit', n: 40,
    cfg: { speed: { min: 60, max: 170 }, angle: { min: 235, max: 305 }, lifespan: { min: 1200, max: 1900 }, gravityY: 110, rotate: { min: 0, max: 360 }, alpha: { start: 1, end: 0.6 }, tint: [0xe0503f, 0x3f8fe0, 0xffd25e, 0x46b04a, 0xf07aa8, 0x9b5fc0, 0xf4efe2] },
  },
  spark: {
    tex: 'jx_px', n: 10,
    cfg: { speed: { min: 70, max: 180 }, angle: { min: 0, max: 360 }, lifespan: { min: 180, max: 320 }, scale: { start: 1, end: 0 }, tint: [0xffffff, 0xffd25e, 0xfff1b0], blendMode: 'ADD' },
  },
  smoke: {
    tex: 'jx_soft', n: 6,
    cfg: { speed: { min: 6, max: 24 }, angle: { min: 240, max: 300 }, lifespan: { min: 800, max: 1300 }, gravityY: -25, scale: { start: 0.6, end: 1.8 }, alpha: { start: 0.55, end: 0 }, tint: [0x6e6a62, 0x8a857c, 0xa7a39a] },
  },
  wood: {
    tex: 'jx_bit', n: 10,
    cfg: { speed: { min: 50, max: 120 }, angle: { min: 200, max: 340 }, lifespan: { min: 500, max: 850 }, gravityY: 380, rotate: { min: 0, max: 360 }, tint: [0x8d5629, 0xa5602a, 0xc98a4a, 0x5e3518] },
  },
  fire: {
    tex: 'jx_dot', n: 12,
    cfg: { speed: { min: 30, max: 110 }, angle: { min: 0, max: 360 }, lifespan: { min: 250, max: 450 }, scale: { start: 1.3, end: 0.2 }, tint: [0xffd25e, 0xf0973a, 0xe0503f, 0xfff1b0], blendMode: 'ADD' },
  },
};

/** Kleine weiße Partikel-Texturen (werden per Tint eingefärbt) */
function ensureParticleTextures(scene: Phaser.Scene) {
  const make = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) => () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    paint(g);
    return c;
  };
  ensureTex(scene, 'jx_px', make(2, 2, (g) => g.fillRect(0, 0, 2, 2)));
  ensureTex(scene, 'jx_bit', make(3, 2, (g) => g.fillRect(0, 0, 3, 2)));
  ensureTex(scene, 'jx_dot', make(4, 4, (g) => (g.fillRect(1, 0, 2, 4), g.fillRect(0, 1, 4, 2))));
  ensureTex(scene, 'jx_soft', make(6, 6, (g) => (g.fillRect(2, 0, 2, 6), g.fillRect(0, 2, 6, 2), g.fillRect(1, 1, 4, 4))));
}

export class Juice {
  private emitters = new Map<BurstPreset, Phaser.GameObjects.Particles.ParticleEmitter>();
  private frozenUntil = 0;
  private slowUntil = 0;
  private slowFactor = 1;
  private applied = 1;
  private bannerObjs: Phaser.GameObjects.GameObject[] = [];
  private punchTween: Phaser.Tweens.Tween | null = null;
  private zoomBase: number | null = null;
  /** Zoom-Faktor des Zoom-Stoßes (bei `manualZoom` von der Szene mit einrechnen) */
  zoom = 1;

  constructor(
    readonly scene: Phaser.Scene,
    readonly opts: JuiceOpts = {},
  ) {
    ensureParticleTextures(scene);
    this.setScale(1);
    // Zum Ausprobieren in der Browser-Konsole: __juice.burst(240, 135, 'confetti')
    (window as unknown as { __juice?: Juice }).__juice = this;
    const tick = () => this.tick();
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
      this.setScale(1);
      this.emitters.clear();
    });
  }

  /** Läuft gerade ein Hit-Stop? (Szenen mit eigener Interpolation lassen die Figuren dann stehen) */
  get frozen() {
    return performance.now() < this.frozenUntil;
  }

  // ---------------------------------------------------------------- Kamera

  shake(level: 1 | 2 | 3 = 1) {
    const [ms, k] = SHAKE[level];
    this.scene.cameras.main.shake(ms, k, level >= 2);
  }

  flash(color = 0xffffff, ms = 180) {
    this.scene.cameras.main.flash(ms, (color >> 16) & 255, (color >> 8) & 255, color & 255, true);
  }

  /** Kurzer Zoom-Stoß 1 → 1 + amount → 1 */
  zoomPunch(amount = 0.05, ms = 220) {
    const scene = this.scene;
    this.punchTween?.stop();
    if (this.opts.manualZoom) {
      this.zoom = 1 + amount;
      this.punchTween = scene.tweens.addCounter({ from: 1 + amount, to: 1, duration: ms, ease: 'Quad.Out', onUpdate: (tw) => (this.zoom = tw.getValue() ?? 1), onComplete: () => (this.zoom = 1) });
      return;
    }
    const cam = scene.cameras.main;
    const base = this.zoomBase ?? cam.zoom;
    this.zoomBase = base;
    cam.setZoom(base * (1 + amount));
    this.punchTween = scene.tweens.add({
      targets: cam, zoom: base, duration: ms, ease: 'Quad.Out',
      onComplete: () => {
        cam.setZoom(base);
        this.zoomBase = null;
      },
    });
  }

  // ---------------------------------------------------------------- Zeit

  /** Darstellung kurz anhalten (Tweens, Timer, Partikel) */
  hitStop(ms = 70) {
    this.frozenUntil = Math.max(this.frozenUntil, performance.now() + ms);
    this.tick();
  }

  /** Zeitlupe der Darstellung (factor < 1 = langsamer) */
  slowMo(factor = 0.4, ms = 600) {
    this.slowFactor = Math.max(0.05, factor);
    this.slowUntil = performance.now() + ms;
    this.tick();
  }

  private tick() {
    const now = performance.now();
    const s = now < this.frozenUntil ? 0 : now < this.slowUntil ? this.slowFactor : 1;
    if (s !== this.applied) this.setScale(s);
  }

  private setScale(s: number) {
    this.applied = s;
    this.scene.tweens.timeScale = s;
    this.scene.time.timeScale = s;
    for (const e of this.emitters.values()) e.timeScale = s;
  }

  // ---------------------------------------------------------------- Partikel & Texte

  burst(x: number, y: number, preset: BurstPreset, n?: number) {
    let em = this.emitters.get(preset);
    if (!em || !em.active) {
      const p = PRESETS[preset];
      em = this.scene.add.particles(0, 0, p.tex, { ...p.cfg, emitting: false });
      em.timeScale = this.applied;
      if (this.opts.layer) this.opts.layer.add(em);
      else em.setDepth(this.opts.depth ?? 1900);
      this.emitters.set(preset, em);
    }
    em.explode(Math.max(1, Math.round(n ?? PRESETS[preset].n)), x, y);
  }

  /** Schwebender Text (steigt auf und blendet aus); `style` oder direkt eine Farbe ('#rrggbb') */
  float(x: number, y: number, text: string, style: FloatStyle | string = 'info') {
    const color = style.startsWith('#') ? style : FLOAT_COLORS[style as FloatStyle] ?? FLOAT_COLORS.info;
    const t = txt(this.scene, Phaser.Math.Clamp(x, 24, 456), Math.max(4, y), text, { color });
    if (this.opts.layer) this.opts.layer.add(t);
    else t.setDepth((this.opts.depth ?? 1900) + 1);
    t.setScale(0.6);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, y: t.y - 14, alpha: 0, delay: 450, duration: 600, onComplete: () => t.destroy() });
    return t;
  }

  /** Großes Banner in der Bildmitte (ersetzt die eigenen Banner der Szenen nach und nach) */
  banner(text: string, sub = '', ms = 1100) {
    for (const o of this.bannerObjs) o.destroy();
    const scene = this.scene;
    const big = txt(scene, 240, 92, text, { size: 24, color: '#ffd25e' });
    const small = txt(scene, 240, 124, sub, { size: 8 });
    this.bannerObjs = [big, small];
    for (const o of this.bannerObjs) {
      if (this.opts.hud) this.opts.hud.add(o);
      else (o as Phaser.GameObjects.Text).setDepth(5000);
    }
    big.setScale(1.6);
    scene.tweens.add({ targets: big, scale: 1, duration: 250, ease: 'Back.Out' });
    scene.tweens.add({ targets: [big, small], alpha: 0, delay: ms, duration: 300, onComplete: () => (big.destroy(), small.destroy()) });
  }

  // ---------------------------------------------------------------- Ton

  sfx(name: SfxName, opts?: SfxOpts) {
    return sfx(name, opts);
  }
}
