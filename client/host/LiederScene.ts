import Phaser from 'phaser';
import type { GameState, LiederState, PlayerPublic } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LIEDER_COLORS, liederOptions } from '../../shared/lieder';
import { Pix } from '../art/pix';
import { bus, getState, hostMini, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { audioCtx, audioMusic, audioOut, audioReady, duckMusic, getMusicVolume, getVolume, isMuted, previewSong, stopPreview } from './music';

const W = WORLD.W;
const H = WORLD.H;
const BARS = 18;
/** Antwortfelder unten */
const OPT_TOP = 152;
const OPT_BOTTOM = 264;
const REC_X = 78;
const REC_Y = 100;

/**
 * Guess the Song: Strandbar-Disco bei Nacht – Plattenteller links, Equalizer rechts, unten die Antwortfelder
 * (gleiche Farben wie am Handy). Der TV spielt auch den Ton: eingebaute 8-Bit-Songs über den eigenen Synth,
 * eigene Dateien über WebAudio (Equalizer hört mit), Hörproben direkt per <audio>.
 */
export class LiederScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private eq!: Phaser.GameObjects.Graphics;
  private record!: Phaser.GameObjects.Image;
  private arm!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private stateKey = '';
  private timerY = 0;
  private juice!: Juice;
  private spinSpeed = 0;
  private eqOn = false;
  private levels = new Float32Array(BARS);
  private answeredN = 0;
  private spoken = '';
  // ---- Ton
  private audioToken = '';
  private el: HTMLAudioElement | null = null;
  private node: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private synthId: string | null = null;
  private start = 0;
  private playing = false;
  private loadFailed = false;

  constructor() {
    super('lieder');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.timerY = 0;
    this.spinSpeed = 0;
    this.eqOn = false;
    this.levels = new Float32Array(BARS);
    this.answeredN = 0;
    this.spoken = '';
    this.audioToken = '';
    this.el = null;
    this.node = null;
    this.gain = null;
    this.analyser = null;
    this.freq = null;
    this.synthId = null;
    this.playing = false;
    this.loadFailed = false;
    this.juice = new Juice(this, { depth: 900 });

    background(this, 'lieder', W, H, (p) => {
      // Nachthimmel über der Strandbar
      const sky = ['#120a26', '#1b1033', '#24123f', '#2f1650', '#3a1d5c'];
      sky.forEach((c, i) => p.rect(0, i * 30, W, 30, c));
      for (let i = 0; i < 46; i++) p.px((i * 97) % W, (i * 37) % 120, i % 5 ? '#6f5aa8' : '#e9d7ff');
      // Tanzfläche (Karomuster)
      for (let y = 150; y < H; y += 12) for (let x = 0; x < W; x += 12) p.rect(x, y, 12, 12, ((x + y) / 12) % 2 ? '#2a1846' : '#33205a');
      p.hline(0, 150, W, '#7a4fc0');
    });
    // Lichterkette
    for (let i = 0; i < 24; i++) {
      const bulb = this.add.rectangle(10 + i * 20, 2, 3, 3, [0xffd25e, 0xf07aa8, 0x6fd3ff][i % 3]).setDepth(-600);
      this.tweens.add({ targets: bulb, alpha: 0.25, duration: 300 + (i % 4) * 110, yoyo: true, repeat: -1 });
    }
    // Scheinwerfer
    for (let i = 0; i < 3; i++) {
      const beam = this.add.triangle(80 + i * 160, 0, 0, 0, -38, 240, 38, 240, [0xf07aa8, 0x6fd3ff, 0xffd25e][i], 0.07).setOrigin(0.5, 0).setDepth(-500);
      this.tweens.add({ targets: beam, angle: { from: -18, to: 18 }, duration: 2600 + i * 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    this.record = this.add.image(REC_X, REC_Y, ensureTex(this, 'ls_record', recordPix)).setDepth(400).setVisible(false);
    this.arm = this.add.graphics().setDepth(401);
    this.eq = this.add.graphics().setDepth(400);
    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.stopAudio();
      duckMusic(false);
      this.layer.removeAll(true);
    });
    const s = getState();
    if (s) this.render(s);
  }

  update(_t: number, dt: number) {
    // Timer
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac > 0 && this.timerY) {
      this.timerBar.fillStyle(0x120a26).fillRect(99, this.timerY - 1, 282, 6);
      this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(100, this.timerY, 280 * frac, 4);
    }
    // Plattenteller
    if (this.record.visible) this.record.rotation += (this.spinSpeed * dt) / 1000;
    this.drawEq(dt);
  }

  // ---------------------------------------------------------------- Zustand

  private render(s: GameState) {
    if (s.mini?.kind !== 'lieder') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}`;
    const fresh = tKey !== this.timerKey;
    if (fresh) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
    } else if (st.endsIn < this.countdown.remaining - 400) this.countdown.set(st.endsIn);
    this.audio(st);
    const key = JSON.stringify([tKey, st.picked, st.answered, st.audio?.token ?? '', st.note, s.players.map((p) => p.connected), audioReady()]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.sounds(st, fresh);

    this.layer.removeAll(true);
    this.timerY = 0;
    const deck = st.sub === 'prep' || st.sub === 'play' || st.sub === 'reveal';
    this.record.setVisible(deck);
    this.arm.clear();
    this.eqOn = st.sub === 'play';
    if (deck) this.drawArm(st.sub !== 'prep');
    this.spinSpeed = st.sub === 'play' || st.sub === 'reveal' ? 3.2 : st.sub === 'prep' ? 0.6 : 0;
    if (st.sub === 'pick') this.renderPick(s, st);
    else if (st.sub === 'genres') this.renderGenres(st);
    else if (st.sub === 'prep') this.renderPrep(st);
    else if (st.sub === 'play') this.renderPlay(st);
    else if (st.sub === 'reveal') this.renderReveal(st, fresh);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, W / 2, 112, st.note ?? 'Das war Guess the Song!', { color: RED_INK }));
      this.layer.add(ink(this, W / 2, 130, st.note ? 'MP3s nach data/lieder/ legen' : 'Gleich gibt’s die Auswertung ...'));
    }
  }

  /** Neue Runde: Plattenkratzer · getippt: Tick · Auflösung: Jubel bzw. Tusch */
  private sounds(st: LiederState, fresh: boolean) {
    if (fresh) {
      if (st.sub === 'pick' || st.sub === 'genres') sfx('select');
      if (st.sub === 'prep') sfx('whoosh', { pitch: 0.7 });
      if (st.sub === 'over') sfx('fanfare');
    } else if (st.sub === 'play' && st.answered.length > this.answeredN) sfx('tick', { pitch: 1 + st.answered.length * 0.05, vol: 0.6 });
    this.answeredN = st.answered.length;
    if (st.sub === 'prep' && fresh && this.spoken !== `p${st.round}`) {
      this.spoken = `p${st.round}`;
      const g = st.genres.find((x) => x.id === st.genre);
      const owner = playerById(st.owner);
      if (g) say(`Song ${st.round}: ${g.name}${owner ? `, von ${spokenName(owner.name)}` : ''}.`, { rate: 1.1 });
    }
  }

  // ---------------------------------------------------------------- Ton

  /** Ton zum Zustand: in `prep` laden (dann `ready` an den Server), in `play` starten, danach ausblenden */
  private audio(st: LiederState) {
    const a = st.audio;
    if (st.sub === 'pick' || st.sub === 'genres') {
      duckMusic(false);
      return;
    }
    if (st.sub === 'over') {
      this.stopAudio();
      duckMusic(false);
      return;
    }
    if (a && a.token !== this.audioToken) this.loadSong(a.token, a.kind, a.start);
    if (st.sub === 'prep' && this.playing) this.stopAudio();
    if (st.sub === 'prep') duckMusic(true);
    if (st.sub === 'play' && !this.playing && a?.token === this.audioToken) this.play();
  }

  private loadSong(token: string, kind: 'synth' | 'datei' | 'vorschau', start: number) {
    this.stopAudio();
    this.audioToken = token;
    this.loadFailed = false;
    this.start = start;
    const url = `/api/lieder/ton/${encodeURIComponent(token)}`;
    if (kind === 'synth') {
      void fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { synth?: string }) => {
          if (this.audioToken !== token) return;
          if (!j.synth) throw new Error('kein Song');
          this.synthId = j.synth;
          hostMini('ready', { token });
        })
        .catch(() => this.audioToken === token && this.failed(token));
      return;
    }
    const el = new Audio();
    el.preload = 'auto';
    // Eigene Dateien kommen vom eigenen Server → über WebAudio (Lautstärke-Regler, Equalizer). Hörproben liegen
    // bei Deezer: ohne CORS-Freigabe bliebe eine WebAudio-Quelle stumm, deshalb direkt abspielen.
    const viaWebAudio = kind === 'datei' && !!audioCtx();
    let readySent = false;
    const ready = () => {
      if (readySent || this.audioToken !== token) return;
      readySent = true;
      hostMini('ready', { token });
    };
    el.addEventListener('loadedmetadata', () => {
      if (this.audioToken !== token) return;
      // Kurzes Lied → Ausschnitt aus dem ersten Drittel
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      if (d && this.start > d - 25) this.start = Math.max(0, Math.round(d * 0.3));
      if (this.start) el.currentTime = this.start;
    });
    el.addEventListener('canplay', ready);
    el.addEventListener('error', () => this.audioToken === token && this.failed(token));
    el.src = url;
    if (viaWebAudio) {
      const ctx = audioCtx()!;
      try {
        this.node = ctx.createMediaElementSource(el);
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.75;
        this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        this.node.connect(this.gain).connect(this.analyser);
        this.analyser.connect(audioOut()!);
      } catch {
        this.node = null;
      }
    }
    el.load();
    this.el = el;
  }

  private failed(token: string) {
    this.loadFailed = true;
    hostMini('error', { token });
  }

  private play() {
    this.playing = true;
    if (this.synthId) {
      duckMusic(false);
      void previewSong(this.synthId);
      // Equalizer hört beim Synth auf dem Musik-Bus mit
      const ctx = audioCtx();
      const bus = audioMusic();
      if (ctx && bus) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.7;
        this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        bus.connect(this.analyser);
      }
      return;
    }
    const el = this.el;
    if (!el) return;
    duckMusic(true);
    const ctx = audioCtx();
    if (this.node && this.gain && ctx) {
      const v = Math.min(1.5, getMusicVolume() || 1);
      this.gain.gain.cancelScheduledValues(ctx.currentTime);
      this.gain.gain.setValueAtTime(0, ctx.currentTime);
      this.gain.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.6);
    } else el.volume = isMuted() ? 0 : Math.min(1, getVolume() * (getMusicVolume() || 1));
    void el.play().catch(() => this.failed(this.audioToken));
  }

  private stopAudio() {
    this.playing = false;
    if (this.synthId) {
      stopPreview();
      this.synthId = null;
    }
    const el = this.el;
    const node = this.node;
    const gain = this.gain;
    const analyser = this.analyser;
    this.el = null;
    this.node = null;
    this.gain = null;
    this.analyser = null;
    this.freq = null;
    const ctx = audioCtx();
    if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    // Kurz ausblenden, dann wirklich anhalten
    window.setTimeout(() => {
      el?.pause();
      if (el) {
        el.removeAttribute('src');
        el.load();
      }
      node?.disconnect();
      gain?.disconnect();
      try {
        audioMusic()?.disconnect(analyser!);
      } catch {
        /* war nicht verbunden */
      }
      analyser?.disconnect();
    }, el ? 450 : 0);
  }

  // ---------------------------------------------------------------- Plattenteller & Equalizer

  private drawArm(down: boolean) {
    const g = this.arm;
    const bx = REC_X + 44;
    const by = REC_Y - 34;
    g.fillStyle(0x9aa0b0).fillCircle(bx, by, 5);
    g.lineStyle(3, 0xc9ced8);
    const tx = down ? REC_X + 14 : REC_X + 34;
    const ty = down ? REC_Y + 10 : REC_Y + 18;
    g.lineBetween(bx, by, tx, ty);
    g.fillStyle(0x2d1b12).fillRect(tx - 3, ty - 2, 6, 5);
  }

  private drawEq(dt: number) {
    const g = this.eq;
    g.clear();
    if (!this.eqOn) return;
    const x0 = 168;
    const base = 128;
    const bw = 14;
    const gap = 2;
    const maxH = 66;
    const t = this.time.now / 1000;
    let data: Uint8Array | null = null;
    if (this.analyser && this.freq) {
      this.analyser.getByteFrequencyData(this.freq);
      data = this.freq;
    }
    for (let i = 0; i < BARS; i++) {
      let v: number;
      if (data) {
        // Untere Hälfte des Spektrums (da spielt die Musik), leicht logarithmisch verteilt
        const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / BARS, 1.4) * data.length * 0.7) + 1);
        v = data[idx] / 255;
      } else {
        // Hörprobe ohne Mithören: tanzende Balken
        v = this.playing ? 0.35 + 0.3 * Math.sin(t * 6 + i * 0.9) * Math.sin(t * 2.3 + i * 0.37) + 0.25 * Math.random() : 0.05;
      }
      this.levels[i] += (Math.max(0, Math.min(1, v)) - this.levels[i]) * Math.min(1, dt / 70);
      const h = Math.round((this.levels[i] * maxH) / 4) * 4;
      const x = x0 + i * (bw + gap);
      for (let y = 0; y < h; y += 4) {
        const f = y / maxH;
        g.fillStyle(f > 0.75 ? 0xe04a3f : f > 0.5 ? 0xf0b13a : 0x46b04a).fillRect(x, base - y - 3, bw, 3);
      }
      g.fillStyle(0x7a4fc0).fillRect(x, base + 1, bw, 2);
    }
  }

  // ---------------------------------------------------------------- Genre-Wahl

  private renderPick(s: GameState, st: LiederState) {
    this.layer.add(panel(this, 16, 8, 448, 44));
    this.layer.add(ink(this, W / 2, 15, '🎶 Guess the Song', { size: 16, color: RED_INK }));
    this.layer.add(fitText(ink(this, W / 2, 36, `Wählt am Handy ${st.perPlayer === 1 ? 'euer Genre' : `je ${st.perPlayer} Genres`} – reihum kommt eins von jedem dran!`), 432));
    this.timerY = 56;
    // Genre-Kacheln
    const cols = st.genres.length <= 6 ? 3 : 4;
    const cw = cols === 3 ? 140 : 108;
    const chh = 18;
    const x0 = W / 2 - (cols * cw + (cols - 1) * 4) / 2;
    st.genres.forEach((g, i) => {
      const x = x0 + (i % cols) * (cw + 4);
      const y = 66 + Math.floor(i / cols) * (chh + 4);
      this.layer.add(this.add.rectangle(x, y, cw, chh, 0x2a1846, 0.9).setOrigin(0, 0).setStrokeStyle(1, 0x7a4fc0));
      const t = txt(this, x + cw / 2, y + 5, `${g.icon} ${g.name}`, { size: 8 });
      fitText(t, cw - 6);
      this.layer.add(t);
    });
    const rowsUsed = Math.ceil(st.genres.length / cols);
    if (st.note) this.layer.add(txt(this, W / 2, 70 + rowsUsed * 22, st.note, { size: 8, color: '#bfa8ff' }));
    // Spieler
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => !!p);
    const n = players.length;
    const spacing = Math.min(58, 430 / Math.max(1, n));
    players.forEach((p, i) => {
      const x = W / 2 + (i - (n - 1) / 2) * spacing;
      const y = 236;
      const done = st.picked.includes(p.id);
      const f = figure(this, p.look, x, y, 2);
      if (!done) f.setAlpha(p.connected ? 0.6 : 0.3);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, y + 3, p.name, done ? GREEN_INK : INK, spacing - 2));
      if (done) this.layer.add(checkMark(this, x, y - 58, 2));
    });
  }

  private renderGenres(st: LiederState) {
    const n = st.players.length;
    const rowH = Math.min(22, Math.floor(184 / Math.max(1, n)));
    const h = 46 + n * rowH;
    const top = Math.max(8, Math.round((H - h) / 2));
    this.layer.add(panel(this, 16, top, 448, h + (h % 2)));
    this.layer.add(ink(this, W / 2, top + 9, `Die Genres – ${st.rounds} Songs`, { color: RED_INK }));
    const per = st.perPlayer;
    const chipW = Math.floor((448 - 120 - 12) / per) - 4;
    st.players.forEach((id, i) => {
      const p = playerById(id);
      const y = top + 26 + i * rowH;
      if (p) this.layer.add(this.add.image(32, y + 7, ensurePortrait(this, p.look)));
      this.layer.add(fitText(ink(this, 44, y + 3, tagName(p?.name ?? '?'), { origin: [0, 0] }), 84));
      (st.picks?.[id] ?? []).forEach((gid, k) => {
        const g = st.genres.find((x) => x.id === gid);
        const x = 136 + k * (chipW + 4);
        const chip = this.add.container(x, y);
        chip.add(this.add.rectangle(0, 0, chipW, Math.min(16, rowH - 3), 0x2a1846).setOrigin(0, 0).setStrokeStyle(1, 0x7a4fc0));
        chip.add(fitText(txt(this, chipW / 2, Math.min(16, rowH - 3) / 2 - 4, g ? `${g.icon} ${g.name}` : '?', { size: 8 }), chipW - 4));
        this.layer.add(chip);
        chip.setAlpha(0);
        this.tweens.add({ targets: chip, alpha: 1, duration: 220, delay: 150 + (i * per + k) * 90 });
      });
    });
    const first = playerById(st.plan?.[0]?.owner);
    const g0 = st.genres.find((x) => x.id === st.plan?.[0]?.genre);
    if (first) this.layer.add(fitText(ink(this, W / 2, top + h - 16, `Los geht’s mit einem Genre von ${tagName(first.name)}${g0 ? `: ${g0.name}` : ''}!`, { color: RED_INK }), 424));
  }

  // ---------------------------------------------------------------- Runde

  /** Kopf: „Song 3/8 · Genre von Ben“ + Genre groß */
  private header(st: LiederState) {
    const g = st.genres.find((x) => x.id === st.genre);
    const owner = playerById(st.owner);
    this.layer.add(panel(this, 16, 6, 448, 44));
    this.layer.add(ink(this, W / 2, 12, `Song ${st.round}/${st.rounds}${owner ? ` · Genre von ${tagName(owner.name)}` : ''}`, { color: RED_INK }));
    this.layer.add(fitText(ink(this, W / 2, 26, g ? `${g.icon} ${g.name}` : '?', { size: 16 }), 420));
    if (owner) this.layer.add(this.add.image(36, 28, ensurePortrait(this, owner.look)).setScale(2));
  }

  private renderPrep(st: LiederState) {
    this.header(st);
    const big = txt(this, (168 + 466) / 2, 84, '🎧 Ohren auf!', { size: 16, color: GOLD });
    this.layer.add(big);
    this.tweens.add({ targets: big, scale: 1.1, duration: 420, yoyo: true, repeat: -1 });
    const sub = !audioReady()
      ? 'Ton aus? Einmal ins TV-Fenster klicken!'
      : st.note ?? (st.audio ? 'Gleich geht’s los ...' : 'Lied wird gesucht ...');
    this.layer.add(txt(this, (168 + 466) / 2, 112, sub, { size: 8, color: !audioReady() || st.note ? '#ffb3a8' : '#e9d7ff', wrap: 280 }));
    this.layer.add(txt(this, W / 2, OPT_TOP + 40, `${liederOptions(st.round, st.rounds)} Antworten am Handy – schnell sein lohnt sich!`, { size: 8, color: '#bfa8ff' }));
  }

  private renderPlay(st: LiederState) {
    this.header(st);
    this.timerY = 54;
    this.renderOptions(st, false, false);
    this.renderAnswered(st);
    if (!audioReady() || this.loadFailed) this.layer.add(txt(this, 316, 64, this.loadFailed ? 'Ton hakt ...' : 'Ton aus? Ins TV-Fenster klicken!', { size: 8, color: '#ffb3a8' }));
    if (st.credit) this.layer.add(txt(this, 466, 140, st.credit, { size: 8, color: '#bfa8ff', origin: [1, 0] }).setScale(0.75));
  }

  /** Wer hat schon getippt? Porträts unter dem Equalizer */
  private renderAnswered(st: LiederState) {
    const n = st.players.length;
    const step = Math.min(22, 296 / Math.max(1, n));
    st.players.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = 176 + i * step;
      const done = st.answered.includes(id);
      const img = this.add.image(x, 140, ensurePortrait(this, p.look)).setAlpha(done ? 1 : 0.35);
      this.layer.add(img);
      if (done) {
        this.layer.add(checkMark(this, x + 9, 133, 1));
        if (st.answered[st.answered.length - 1] === id) this.tweens.add({ targets: img, scale: { from: 1.6, to: 1 }, duration: 240, ease: 'Back.Out' });
      }
    });
  }

  /** Antwortfelder 2 Spalten × 2–4 Zeilen; in der Auflösung mit Porträts derer, die so getippt haben */
  private renderOptions(st: LiederState, reveal: boolean, fresh: boolean) {
    const n = st.options.length;
    const rows = Math.ceil(n / 2);
    const gap = 4;
    const rowH = Math.min(30, Math.floor((OPT_BOTTOM - OPT_TOP - (rows - 1) * gap) / rows));
    const cw = 222;
    const byOpt = new Map<number, string[]>();
    if (reveal) for (const [id, i] of Object.entries(st.choices ?? {})) byOpt.set(i, [...(byOpt.get(i) ?? []), id]);
    st.options.forEach((title, i) => {
      const x = i % 2 === 0 ? 14 : W - 14 - cw;
      const y = OPT_TOP + Math.floor(i / 2) * (rowH + gap);
      const right = reveal && st.answer?.index === i;
      const col = Phaser.Display.Color.HexStringToColor(LIEDER_COLORS[i % LIEDER_COLORS.length]).color;
      const c = this.add.container(x, y);
      c.add(this.add.rectangle(0, 0, cw, rowH, col).setOrigin(0, 0).setStrokeStyle(right ? 3 : 2, right ? 0xffd25e : 0x120a26));
      c.add(this.add.rectangle(2, rowH - 4, cw - 4, 2, 0x000000, 0.25).setOrigin(0, 0));
      const who = byOpt.get(i) ?? [];
      const room = cw - 10 - (who.length ? Math.min(who.length, 6) * 15 + 4 : 0) - (right ? 14 : 0);
      const t = txt(this, 6 + (right ? 14 : 0), rowH / 2, title, { size: 8, origin: [0, 0.5], align: 'left', wrap: room });
      if (t.height > rowH - 4) t.setScale(Math.max(0.6, (rowH - 4) / t.height));
      if (t.displayWidth > room) t.setScale(Math.max(0.55, room / t.width));
      c.add(t);
      if (right) c.add(checkMark(this, 10, rowH / 2, 1, 0xffd25e));
      // Porträts (bis 6, dann +n)
      who.slice(0, 6).forEach((id, k) => {
        const p = playerById(id);
        if (p) c.add(this.add.image(cw - 10 - k * 15, rowH / 2, ensurePortrait(this, p.look)));
      });
      if (who.length > 6) c.add(txt(this, cw - 10 - 6 * 15, rowH / 2 - 4, `+${who.length - 6}`, { size: 8 }));
      if (reveal && !right) c.setAlpha(0.42);
      this.layer.add(c);
      if (fresh && !reveal) {
        c.setScale(0.6).setAlpha(0);
        this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 220, delay: i * 60, ease: 'Back.Out' });
      }
      if (fresh && right) this.tweens.add({ targets: c, scaleX: 1.04, scaleY: 1.12, duration: 200, yoyo: true, repeat: 1 });
    });
  }

  private renderReveal(st: LiederState, fresh: boolean) {
    const a = st.answer;
    this.layer.add(panel(this, 16, 6, 448, 50));
    this.layer.add(ink(this, W / 2, 11, `Song ${st.round}/${st.rounds} · Das war:`, { color: RED_INK }));
    const title = fitText(ink(this, W / 2, 23, a?.title ?? '?', { size: 16 }), 424, 0.5);
    this.layer.add(title);
    this.layer.add(fitText(ink(this, W / 2, 42, [a?.artist, a?.year].filter(Boolean).join(' · ')), 424));
    if (fresh) {
      const sc = title.scale;
      title.setScale(sc * 0.2);
      this.tweens.add({ targets: title, scale: sc, duration: 360, ease: 'Back.Out' });
    }
    this.renderOptions(st, true, fresh);
    this.renderBoard(st, fresh);
    if (st.credit) this.layer.add(txt(this, 466, 140, st.credit, { size: 8, color: '#bfa8ff', origin: [1, 0] }).setScale(0.75));
    if (fresh) this.revealFx(st);
  }

  /** Mini-Rangliste rechts neben dem Plattenteller */
  private renderBoard(st: LiederState, fresh: boolean) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0)).slice(0, 6);
    const x0 = 176;
    ranked.forEach((id, i) => {
      const p = playerById(id);
      const y = 62 + i * 14;
      this.layer.add(txt(this, x0, y, `${i + 1}.`, { size: 8, origin: [0, 0], color: i === 0 ? GOLD : '#e9d7ff' }));
      if (p) this.layer.add(this.add.image(x0 + 28, y + 3, ensurePortrait(this, p.look)));
      this.layer.add(fitText(txt(this, x0 + 40, y, tagName(p?.name ?? '?'), { size: 8, origin: [0, 0] }), 120));
      this.layer.add(txt(this, x0 + 210, y, String(st.points[id] ?? 0), { size: 8, origin: [1, 0] }));
      const gain = st.gain?.[id] ?? 0;
      if (gain) {
        const g = txt(this, x0 + 250, y, `+${gain}${st.first === id ? '⚡' : ''}`, { size: 8, origin: [1, 0], color: '#7fe07f' });
        this.layer.add(g);
        if (fresh) {
          g.setAlpha(0);
          this.tweens.add({ targets: g, alpha: 1, duration: 260, delay: 400 + i * 100 });
        }
      }
    });
  }

  private revealFx(st: LiederState) {
    const right = Object.entries(st.gain ?? {}).filter(([, v]) => v > 0);
    if (right.length) {
      sfx('coin', { pitch: 1.1 });
      sfx('cheer', { delay: 0.1, vol: 0.6 });
      const i = st.answer?.index ?? 0;
      const rows = Math.ceil(st.options.length / 2);
      const rowH = Math.min(30, Math.floor((OPT_BOTTOM - OPT_TOP - (rows - 1) * 4) / rows));
      this.time.delayedCall(200, () => this.juice.burst(i % 2 === 0 ? 125 : W - 125, OPT_TOP + Math.floor(i / 2) * (rowH + 4) + rowH / 2, 'confetti', 36));
    } else sfx('lose', { vol: 0.6 });
    if (this.spoken !== `r${st.round}` && st.answer) {
      this.spoken = `r${st.round}`;
      const first = playerById(st.first);
      say(`${st.answer.title}${st.answer.artist && st.answer.artist !== 'LAN-Abfahrt' ? ` von ${st.answer.artist}` : ''}.${first ? ` Am schnellsten: ${spokenName(first.name)}.` : ' Keiner hat’s erkannt!'}`);
    }
  }
}

/** Schallplatte (72 × 72) mit Rillen, rotem Etikett und Glanz */
function recordPix() {
  const p = new Pix(72, 72);
  const c = 36;
  p.disc(c, c, 35.5, '#0b0b0d');
  for (const [r, col] of [
    [33, '#18181c'],
    [32, '#0b0b0d'],
    [29, '#1c1c22'],
    [28, '#0b0b0d'],
    [25, '#18181c'],
    [24, '#0b0b0d'],
    [21, '#1c1c22'],
    [20, '#0b0b0d'],
  ] as [number, string][])
    p.disc(c, c, r, col);
  p.disc(c, c, 13, '#c0392b');
  p.disc(c, c, 11, '#e05a48');
  p.rect(c - 6, c - 4, 12, 2, '#ffd25e');
  p.rect(c - 4, c + 3, 8, 1, '#fff4d6');
  p.disc(c, c, 2, '#0b0b0d');
  // Glanz
  for (let i = 0; i < 9; i++) {
    p.px(c - 26 + i, c - 20 + Math.round(i * 0.4), '#3a3a46');
    p.px(c + 18 + i * 0.6, c + 22 - i, '#2e2e38');
  }
  return p;
}

/** Gezeichneter Haken (die Pixel-Schrift hat kein ✓) */
function checkMark(scene: Phaser.Scene, x: number, y: number, scale = 1, color = 0x7fe07f) {
  const g = scene.add.graphics({ x, y });
  const px = (cx: number, cy: number) => g.fillRect((cx - 3) * scale, (cy - 3) * scale, scale, scale);
  g.fillStyle(0x120a26);
  for (const [cx, cy] of [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1], [0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0]]) {
    g.fillRect((cx - 3) * scale - scale, (cy - 3) * scale, scale * 3, scale * 2);
  }
  g.fillStyle(color);
  for (const [cx, cy] of [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]]) {
    px(cx, cy);
    px(cx, cy - 1);
  }
  return g;
}
