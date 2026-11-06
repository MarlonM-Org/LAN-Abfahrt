/**
 * Kamera-Regie für TV-Szenen: weiche Fahrt auf ein Ziel (Figur, Mittelpunkt eines Duells, Ziellinie),
 * zurück zur Übersicht, kurz halten, Zoom-Stoß – alles relativ zum Basis-Zoom der Szene, damit eine
 * global höhere Render-Auflösung (Kamera-Zoom ×2) unverändert funktioniert.
 *
 * Dazu eine HUD-Kamera: alles, was innerhalb von `rig.hud(() => …)` entsteht, sieht nur sie (fest, ungezoomt);
 * alles andere nur die Hauptkamera. So bleiben Tafeln, Banner und Rangliste an Ort und Stelle, wenn die
 * Welt heranfährt. Objekte, die beim Anlegen des Rigs schon da sind, zählen zur Welt.
 *
 *   const rig = new CameraRig(this, { w: WORLD.W, h: WORLD.H });
 *   rig.hud(() => { this.hud = this.add.container(0, 0); … });
 *   rig.follow(token, 1.3);          // Figur heranholen (Zoom relativ zum Basis-Zoom)
 *   rig.hold(900);                   // aktuellen Ausschnitt kurz stehen lassen …
 *   rig.overview();                  // … und erst danach zurück zur Übersicht
 */
import Phaser from 'phaser';

type Target = { x: number; y: number } | (() => { x: number; y: number } | null);

export interface RigOpts {
  /** Weltgröße – Kamera bleibt innerhalb */
  w: number;
  h: number;
  /** Trägheit der Fahrt (Anteil pro 16 ms, Standard 0.08) */
  lerp?: number;
  /** HUD-Kamera anlegen (Standard ja) */
  hud?: boolean;
}

export class CameraRig {
  readonly cam: Phaser.Cameras.Scene2D.Camera;
  readonly hudCam: Phaser.Cameras.Scene2D.Camera | null = null;
  /** Basis-Zoom der Szene (z. B. 2 bei doppelter Render-Auflösung) – wird im ersten Frame übernommen */
  base: number;
  private ready = false;
  private target: Target | null = null;
  private zoomWant = 1;
  private cur: { x: number; y: number; z: number };
  private lerp: number;
  private holdUntil = 0;
  private pending: (() => void) | null = null;
  private punchZ = 1;
  private punchTween: Phaser.Tweens.Tween | null = null;
  private building = false;
  private cutNext = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly opts: RigOpts,
  ) {
    const cam = scene.cameras.main;
    this.cam = cam;
    this.base = cam.zoom;
    this.lerp = opts.lerp ?? 0.08;
    this.cur = { x: opts.w / 2, y: opts.h / 2, z: 1 };
    cam.setBounds(0, 0, opts.w, opts.h);
    if (opts.hud !== false) {
      const hud = scene.cameras.add(0, 0, cam.width, cam.height).setZoom(cam.zoom);
      hud.centerOn(opts.w / 2, opts.h / 2);
      // Alles Bisherige gehört zur Welt
      for (const go of scene.children.list) hud.ignore(go);
      this.hudCam = hud;
    }
    const onAdded = (go: Phaser.GameObjects.GameObject) => {
      if (this.building) cam.ignore(go);
      else this.hudCam?.ignore(go);
    };
    const tick = (_t: number, dt: number) => this.tick(dt);
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, tick);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, tick);
      this.punchTween?.stop();
    });
  }

  /** HUD-Objekte anlegen: alles, was in `fn` entsteht, zeigt nur die HUD-Kamera */
  hud<T>(fn: () => T): T {
    const was = this.building;
    this.building = true;
    try {
      return fn();
    } finally {
      this.building = was;
    }
  }

  /** Auf ein Ziel fahren (Objekt mit x/y oder Funktion, die eins liefert); zoom relativ zum Basis-Zoom */
  follow(target: Target, zoom = 1.3, o: { cut?: boolean } = {}) {
    this.command(() => {
      this.target = target;
      this.zoomWant = zoom;
      if (o.cut) this.cutNext = true;
    });
  }

  /** Zurück zur Gesamtansicht */
  overview(o: { cut?: boolean } = {}) {
    this.command(() => {
      this.target = null;
      this.zoomWant = 1;
      if (o.cut) this.cutNext = true;
    });
  }

  /** Aktuellen Ausschnitt `ms` lang stehen lassen – Befehle in der Zeit werden danach ausgeführt (der letzte gewinnt) */
  hold(ms: number) {
    this.holdUntil = Math.max(this.holdUntil, performance.now() + ms);
  }

  get holding() {
    return performance.now() < this.holdUntil;
  }

  /** Aktueller Zoom relativ zum Basis-Zoom */
  get zoom() {
    return this.cur.z;
  }

  /** Mittelpunkt des aktuellen Ausschnitts (Welt) */
  get center() {
    return { x: this.cur.x, y: this.cur.y };
  }

  /** Kurzer Zoom-Stoß 1 → 1 + amount → 1 (unabhängig von Juice.zoomPunch, das die Kamera direkt anfasst) */
  punch(amount = 0.08, ms = 220) {
    this.punchTween?.stop();
    this.punchZ = 1 + amount;
    this.punchTween = this.scene.tweens.addCounter({
      from: 1 + amount,
      to: 1,
      duration: ms,
      ease: 'Quad.Out',
      onUpdate: (tw) => (this.punchZ = tw.getValue() ?? 1),
      onComplete: () => (this.punchZ = 1),
    });
  }

  private command(fn: () => void) {
    if (this.holding) this.pending = fn;
    else fn();
  }

  private tick(dt: number) {
    const cam = this.cam;
    if (!this.ready) {
      // Basis-Zoom erst im ersten Frame übernehmen (falls die Szene ihn nach create() noch setzt)
      this.ready = true;
      this.base = cam.zoom;
      this.hudCam?.setSize(cam.width, cam.height).setZoom(this.base).centerOn(this.opts.w / 2, this.opts.h / 2);
    }
    if (this.pending && !this.holding) {
      const fn = this.pending;
      this.pending = null;
      fn();
    }
    const t = this.target ? (typeof this.target === 'function' ? this.target() : this.target) : null;
    const want = t ? { x: t.x, y: t.y, z: this.zoomWant } : { x: this.opts.w / 2, y: this.opts.h / 2, z: 1 };
    if (this.cutNext) {
      this.cutNext = false;
      this.cur = { ...want };
    } else {
      const k = 1 - Math.pow(1 - this.lerp, Math.min(4, dt / 16.67));
      this.cur.x += (want.x - this.cur.x) * k;
      this.cur.y += (want.y - this.cur.y) * k;
      this.cur.z += (want.z - this.cur.z) * k;
    }
    cam.setZoom(this.base * this.cur.z * this.punchZ);
    cam.centerOn(this.cur.x, this.cur.y);
  }
}
