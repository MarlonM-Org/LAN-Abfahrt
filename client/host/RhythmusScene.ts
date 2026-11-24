import Phaser from 'phaser';
import type { GameState, Look } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { AV_H, AV_W, drawAvatar } from '../../shared/avatar';
import { RH, type RhNote, type RhythmState, rhBeatMs, rhSong, rhythmusNoten, trefferQuote } from '../../shared/rhythmus';
import * as O from '../art/objects';
import type { Pix } from '../art/pix';
import { paintBoulders, paintBridgeUnderside, paintNightSky, paintPillar, paintRiver, paintSkyline, sittingFrom } from '../art/rhine';
import { bus, getState, hostMini, playerById } from './store';
import { audioSynth, duckMusic, getMusicVolume } from './music';
import { toLocalPerf } from '../timesync';
import { GOLD, RED_INK, background, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { ensurePortrait } from './textures';
import { pcol } from './playerColor';
import { Soundcheck, TonUhr, spieleSong } from './rhythmusTon';
import type { SongPlayer } from '../music/player';

const PINK_INK = '#b0306a';
const LANE_COLORS = [0xe46e98, 0xf0b13a, 0x4fb3e8, 0x7cc04a];
const MARK_TEXT: Record<string, [string, string]> = { p: ['PERFEKT', '#ffd25e'], g: ['GUT', '#9ad65a'], x: ['DANEBEN', '#ff8a7a'] };

function avatarCanvas(look: Look) {
  const c = document.createElement('canvas');
  c.width = AV_W;
  c.height = AV_H;
  drawAvatar(c.getContext('2d')!, look);
  return c;
}

/** Rhein bei Nacht unter der Brücke (wie die übrigen Date-Night-Kapitel) */
function rhineBackground(p: Pix) {
  paintNightSky(p, 0, 0, WORLD.W, 130);
  paintSkyline(p, 120);
  paintRiver(p, 120, 70);
  paintBridgeUnderside(p, 34);
  paintPillar(p, 20, 34, 34, 150);
  paintBoulders(p, 0, 186, WORLD.W, 84, 77);
}

interface Highway {
  id: string;
  x: number;
  w: number;
  y0: number;
  hitY: number;
  chart: RhNote[];
}

/**
 * Das erste Gespräch am TV. Drei Ansichten:
 * - Soundcheck (`ready`): Klick + Blitz im Takt, wer schon eingemessen ist, Ton-Versatz des Raums; Taste K / Knopf
 *   „Neu einmessen“ am Laptop.
 * - Story (Date Night): das Paar auf den Steinen am Rhein, Sprechblase, Sympathie – links und rechts die Notenbahn
 *   jedes der beiden.
 * - Wettkampf: eine Notenbahn pro Spieler (bis 8) mit Trefferquote darüber und Porträt darunter.
 * Der TV zeichnet die Noten zur echten Songzeit (Bild und Ton laufen beide über dieselbe Strecke zum Fernseher –
 * bei AirPlay sind beide gleich verzögert); den Ton-Versatz wenden nur die Handys an.
 */
export class RhythmScene extends Phaser.Scene {
  private latest: RhythmState | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private hudKey = '';
  private bigText!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Container;
  private phraseIdx = -1;
  private seats = new Map<string, Phaser.GameObjects.Image>();
  private seatTags: Phaser.GameObjects.Container[] = [];
  private pctTexts = new Map<string, Phaser.GameObjects.Text>();
  private portraits = new Map<string, Phaser.GameObjects.Image>();
  private lastSeq = new Map<string, number>();
  private highways: Highway[] = [];
  private layoutKey = '';
  // Ton
  private uhr: TonUhr | null = null;
  private out: GainNode | null = null;
  private check: Soundcheck | null = null;
  private checkAt = 0;
  private player: SongPlayer | null = null;
  private songSeq = 0;

  constructor() {
    super('rhythm');
  }

  create() {
    this.latest = null;
    this.hudKey = '';
    this.layoutKey = '';
    this.phraseIdx = -1;
    this.seats = new Map();
    this.seatTags = [];
    this.pctTexts = new Map();
    this.portraits = new Map();
    this.lastSeq = new Map();
    this.highways = [];
    this.uhr = null;
    this.out = null;
    this.check = null;
    this.checkAt = 0;
    this.player = null;
    this.songSeq = 0;
    background(this, 'rhine-gespraech', WORLD.W, WORLD.H, rhineBackground);
    this.add.circle(400, 70, 14, 0xfff7c9).setDepth(-900);
    this.add.circle(405, 66, 12, 0x18204a).setDepth(-899);
    for (let i = 0; i < 14; i++) {
      const s = this.add.rectangle(Phaser.Math.Between(60, WORLD.W), Phaser.Math.Between(126, 184), 3, 1, 0xffd77a).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 0.8, duration: 700, yoyo: true, repeat: -1, delay: i * 210, repeatDelay: 1400 });
    }
    this.g = this.add.graphics().setDepth(900);
    this.fx = this.add.graphics().setDepth(1002);
    this.hud = this.add.container(0, 0).setDepth(1001);
    this.bubble = this.add.container(0, 0).setDepth(1000);
    this.bigText = txt(this, WORLD.W / 2, 84, '', { size: 24, color: GOLD }).setDepth(1500);
    this.info = txt(this, WORLD.W / 2, 258, '').setDepth(1001);
    // Laptop: K = neu einmessen (der Server nimmt das nur von TV-Seiten im Heimnetz an)
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && !e.repeat && !(e.target as HTMLElement | null)?.closest?.('input, textarea')) hostMini('kalibrieren');
    };
    window.addEventListener('keydown', onKey);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', fn);
      window.removeEventListener('keydown', onKey);
      this.stopAudio(true);
      duckMusic(false);
    });
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Ton

  private ensureOut(): boolean {
    const synth = audioSynth();
    if (!synth || synth.ctx.state !== 'running') return false;
    if (!this.out) {
      this.uhr = new TonUhr(synth.ctx);
      this.out = synth.ctx.createGain();
      this.out.gain.value = Math.min(1.5, getMusicVolume() || 1);
      this.out.connect(synth.master);
    }
    return true;
  }

  private syncAudio(r: RhythmState) {
    if (!this.ensureOut()) return;
    const synth = audioSynth()!;
    if (r.sub === 'ready') {
      if (this.player) {
        this.player.stop();
        this.player = null;
        this.songSeq = 0;
      }
      if (!this.check || this.checkAt !== r.kalAt) {
        this.check?.stop();
        this.check = new Soundcheck(synth, this.uhr!, this.out!, r.kalAt, r.kalBeat);
        this.checkAt = r.kalAt;
      }
      duckMusic(true);
    } else {
      this.check?.stop();
      this.check = null;
      this.checkAt = 0;
    }
    if (r.sub === 'play' && this.songSeq !== r.playSeq) {
      const now = performance.now() - toLocalPerf(r.startAt);
      if (now < r.duration - 500) {
        this.player?.stop();
        this.player = spieleSong(synth, this.uhr!, this.out!, rhSong(), r.startAt);
        if (this.player) this.songSeq = r.playSeq;
        duckMusic(true);
      }
    }
    if (r.sub === 'over') duckMusic(false);
  }

  private stopAudio(hard: boolean) {
    this.check?.stop();
    this.check = null;
    this.player?.stop();
    this.player = null;
    const out = this.out;
    this.out = null;
    if (out) {
      out.gain.setTargetAtTime(0, out.context.currentTime, hard ? 0.02 : 0.4);
      window.setTimeout(() => out.disconnect(), hard ? 150 : 2500);
    }
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'rhythm') return;
    const r = s.mini.state;
    this.latest = r;
    this.syncAudio(r);
    this.layout(r);
    this.buildHud(r);
    // Treffer-Effekte
    for (const id of r.order) {
      const last = r.players[id]?.last;
      if (!last || this.lastSeq.get(id) === last.seq) continue;
      const first = !this.lastSeq.has(id);
      this.lastSeq.set(id, last.seq);
      if (first || r.sub !== 'play') continue;
      this.hitFx(r, id, last.m);
    }
  }

  /** Bahnen + Sitzplätze (ändert sich nur mit Modus/Spielern) */
  private layout(r: RhythmState) {
    const key = JSON.stringify([r.wettkampf, r.order]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const s of this.seats.values()) s.destroy();
    this.seats.clear();
    for (const t of this.seatTags) t.destroy();
    this.seatTags = [];
    for (const p of this.portraits.values()) p.destroy();
    this.portraits.clear();
    for (const t of this.pctTexts.values()) t.destroy();
    this.pctTexts.clear();
    this.highways = [];
    const song = rhSong();
    if (!r.wettkampf) {
      // Story: das Paar sitzt auf den Steinen, die Bahnen am Rand
      r.order.forEach((id, i) => {
        const p = playerById(id);
        const facing = i === 0 ? 1 : -1;
        if (p) {
          const key = ensureTex(this, `sit_${id}_${facing}`, () => sittingFrom(avatarCanvas(p.look), facing as 1 | -1));
          const img = this.add.image(WORLD.W / 2 + (i === 0 ? -34 : 34), 214, key).setOrigin(0.5, 1).setScale(2).setDepth(500);
          this.seats.set(id, img);
          this.seatTags.push(this.add.existing(nameTag(this, img.x, 218, p.name.slice(0, 8))).setDepth(501));
        }
        if (i < 2) {
          const x = i === 0 ? 22 : WORLD.W - 22 - 64;
          this.highways.push({ id, x, w: 64, y0: 72, hitY: 204, chart: rhythmusNoten(r.order, id, false, song) });
          const tag = txt(this, x + 32, 216, tagName(p?.name ?? '?'), { color: pcol(id).hex }).setDepth(1001);
          fitText(tag, 64);
          this.seatTags.push(this.add.container(0, 0, [tag]).setDepth(1001));
        }
      });
      return;
    }
    // Wettkampf: eine Bahn pro Spieler
    const n = Math.max(1, r.order.length);
    const gap = n > 5 ? 4 : 8;
    const w = Math.min(96, Math.floor((WORLD.W - 16 - gap * (n - 1)) / n));
    const x0 = Math.round((WORLD.W - (w * n + gap * (n - 1))) / 2);
    r.order.forEach((id, i) => {
      const x = x0 + i * (w + gap);
      this.highways.push({ id, x, w, y0: 40, hitY: 210, chart: rhythmusNoten(r.order, id, true, song) });
      const p = playerById(id);
      if (p) this.portraits.set(id, this.add.image(x + w / 2, 236, ensurePortrait(this, p.look)).setOrigin(0.5, 1).setDepth(1001));
      const tag = txt(this, x + w / 2, 239, tagName(p?.name ?? '?'), { color: pcol(id).hex }).setDepth(1001);
      fitText(tag, w);
      this.seatTags.push(this.add.container(0, 0, [tag]).setDepth(1001));
      this.pctTexts.set(id, txt(this, x + w / 2, 28, '', { color: '#fff4d6' }).setDepth(1001));
    });
  }

  /** Feste Texte je Phase (nur neu bauen, wenn sich etwas ändert) */
  private buildHud(r: RhythmState) {
    const audioOk = !!audioSynth() && audioSynth()!.ctx.state === 'running';
    const chips = r.order.map((id) => {
      const p = r.players[id];
      return [id, p.ready, p.kal.stabil ? p.kal.wert : null, p.kal.n];
    });
    const key = JSON.stringify([r.sub, r.wettkampf, r.versatz, r.versatzQuelle, r.pflicht, audioOk, r.sub === 'ready' ? chips : 0]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.bubble.removeAll(true);
    this.phraseIdx = -1;
    if (r.sub === 'ready') {
      this.hud.add(panel(this, 60, 22, 360, 146));
      this.hud.add(ink(this, WORLD.W / 2, 30, 'SOUNDCHECK', { size: 16, color: RED_INK }));
      this.hud.add(ink(this, WORLD.W / 2, 50, 'Tippt am Handy im Takt zum Klick\n(oder zum Blitz hier).', { wrap: 330 }));
      const v = r.versatzQuelle === 'keiner' ? 'Ton-Versatz: noch nicht gemessen' : `Ton-Versatz: ${r.versatz} ms (${r.versatzQuelle === 'gemessen' ? 'gerade gemessen' : 'gespeichert'})`;
      this.hud.add(ink(this, WORLD.W / 2, 104, v, { color: r.versatzQuelle === 'keiner' ? RED_INK : PINK_INK }));
      // Wer ist wie weit?
      const cw = 84;
      r.order.forEach((id, i) => {
        const p = r.players[id];
        const row = Math.floor(i / 4);
        const inRow = Math.min(4, r.order.length - row * 4);
        const x = WORLD.W / 2 + ((i % 4) - (inRow - 1) / 2) * cw;
        const status = p.ready ? 'OK' : p.kal.stabil && p.kal.wert !== null ? `${p.kal.wert}` : p.kal.n ? `${p.kal.n}/${RH.KAL_MIN}` : '...';
        const t = ink(this, x, 119 + row * 13, `${tagName(playerById(id)?.name ?? '?').slice(0, 6)} ${status}`, { color: p.ready ? '#2f7d32' : '#3d2414' });
        fitText(t, cw - 4);
        this.hud.add(t);
      });
      // Knopf: neu einmessen (Laptop/Maus)
      const btn = ink(this, WORLD.W / 2, 150, '[K] Neu einmessen', { color: '#7a5a3a' }).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => hostMini('kalibrieren'));
      this.hud.add(btn);
      this.info.setText(audioOk ? (r.pflicht ? 'Neu einmessen: alle tippen 8x im Takt' : 'Fertig? Am Handy „Bereit!“') : 'Ton am TV aus – einmal klicken oder Taste drücken!');
      return;
    }
    if (r.sub === 'play' && !r.wettkampf) {
      this.hud.add(panel(this, 130, 36, 220, 30));
      this.hud.add(ink(this, WORLD.W / 2, 42, 'Sympathie', { color: PINK_INK }));
    }
    if (r.sub === 'play' && r.wettkampf) this.hud.add(txt(this, WORLD.W / 2, 4, 'DAS ERSTE GESPRÄCH', { color: '#ffd2e4' }));
    if (r.sub === 'over') {
      const best = Math.max(...r.order.map((id) => this.quote(r, id)));
      this.info.setText(r.wettkampf ? `Vorbei! Beste Trefferquote: ${best} %` : r.sympathy > 70 ? 'Da hat es gefunkt!' : 'Schön war’s trotzdem.');
    } else this.info.setText('');
  }

  private quote(r: RhythmState, id: string) {
    const p = r.players[id];
    const hw = this.highways.find((h) => h.id === id);
    return trefferQuote(p.perfect, p.good, hw?.chart.length ?? p.marks.length);
  }

  private hitFx(r: RhythmState, id: string, m: 1 | 2 | 3) {
    const hw = this.highways.find((h) => h.id === id);
    const ch = m === 3 ? 'p' : m === 2 ? 'g' : 'x';
    if (!r.wettkampf) {
      const seat = this.seats.get(id);
      if (seat && m === 3) {
        const h = this.add.image(seat.x, seat.y - 44, ensureTex(this, 'heart', O.heart)).setDepth(4000);
        this.tweens.add({ targets: h, y: seat.y - 70, x: seat.x + Phaser.Math.Between(-8, 8), alpha: 0, duration: 1200, ease: 'Quad.out', onComplete: () => h.destroy() });
      } else if (seat && m === 1) {
        const t = txt(this, seat.x, seat.y - 46, '...', { color: '#c9c3e6' }).setDepth(4000);
        this.tweens.add({ targets: t, alpha: 0, y: t.y - 10, duration: 700, onComplete: () => t.destroy() });
      }
    }
    if (!hw) return;
    const [text, color] = MARK_TEXT[ch];
    const t = txt(this, hw.x + hw.w / 2, hw.hitY - 22, text, { color }).setDepth(1600);
    if (hw.w < 64) t.setScale(Math.max(0.55, hw.w / 64));
    this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, duration: 600, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- Bild für Bild

  update() {
    this.uhr?.sample();
    const r = this.latest;
    this.g.clear();
    this.fx.clear();
    if (!r) return;
    // Ton erst jetzt freigeschaltet → einsteigen
    if (!this.out && audioSynth()?.ctx.state === 'running') {
      this.syncAudio(r);
      this.hudKey = '';
      this.buildHud(r);
    }
    if (r.sub === 'ready') return this.drawSoundcheck(r);
    const now = r.startAt ? performance.now() - toLocalPerf(r.startAt) : -1e9;
    const beat = rhBeatMs(rhSong());
    // Einzähler
    if (r.sub === 'play' && now < 0 && now > -RH.COUNT_IN * beat - 200) this.bigText.setText(String(Math.min(RH.COUNT_IN, Math.ceil(-now / beat))));
    else this.bigText.setText('');
    for (const hw of this.highways) this.drawHighway(hw, r, now);
    if (!r.wettkampf) this.drawStory(r, now, beat);
    else this.drawWettkampf(r, now, beat);
  }

  private drawSoundcheck(r: RhythmState) {
    this.bigText.setText('');
    // Blitz im Takt des Klicks (Serverzeit → lokale Zeit), jeder 4. Schlag betont
    const sinceKal = performance.now() - toLocalPerf(r.kalAt);
    const k = Math.floor(sinceKal / r.kalBeat);
    const phase = sinceKal - k * r.kalBeat;
    const accent = ((k % 4) + 4) % 4 === 0;
    const a = Math.max(0, 1 - phase / 180);
    this.fx.fillStyle(0x2d1b12, 1).fillCircle(WORLD.W / 2, 85, 13);
    this.fx.fillStyle(accent ? 0xffd25e : 0xf59ab9, 0.25 + 0.75 * a).fillCircle(WORLD.W / 2, 85, 11 + a * 3);
  }

  private drawHighway(hw: Highway, r: RhythmState, now: number) {
    const g = this.g;
    const lanes = RH.LANES;
    const lw = hw.w / lanes;
    const marks = r.players[hw.id]?.marks ?? '';
    const span = hw.hitY - hw.y0;
    const yOf = (t: number) => hw.hitY - ((t - now) / RH.FALL_MS) * span;
    g.fillStyle(0x161c33, 0.78).fillRect(hw.x - 2, hw.y0 - 2, hw.w + 4, span + 14);
    for (let l = 0; l < lanes; l++) g.fillStyle(l % 2 ? 0x222b4c : 0x1d2544, 0.9).fillRect(hw.x + l * lw, hw.y0, lw, span + 10);
    // Taktlinien
    const beat = rhBeatMs(rhSong());
    const first = Math.floor((now - 200) / beat);
    for (let b = first; b < first + Math.ceil(RH.FALL_MS / beat) + 2; b++) {
      const y = yOf(b * beat);
      if (y < hw.y0 || y > hw.hitY) continue;
      g.fillStyle(0xffffff, b % 4 === 0 ? 0.18 : 0.06).fillRect(hw.x, Math.round(y), hw.w, b % 4 === 0 ? 2 : 1);
    }
    // Trefferlinie
    g.fillStyle(0xf7e4b5, 1).fillRect(hw.x, hw.hitY - 1, hw.w, 2);
    const nw = Math.max(5, lw - 3);
    const nh = hw.w < 50 ? 4 : 6;
    for (let i = 0; i < hw.chart.length; i++) {
      const n = hw.chart[i];
      if (n.t - now > RH.FALL_MS + 100) break;
      if (now - n.t > 400) continue;
      const m = marks[i] ?? '.';
      const cx = hw.x + n.lane * lw + lw / 2;
      if (m === 'p' || m === 'g') {
        // Getroffen: kurzes Aufleuchten an der Linie
        const age = now - n.t;
        if (age < 220) g.fillStyle(LANE_COLORS[n.lane], 0.9 * (1 - Math.max(0, age) / 220)).fillRect(cx - lw / 2, hw.hitY - 5, lw, 10);
        continue;
      }
      const y = yOf(n.t);
      if (y < hw.y0 - 4 || y > hw.hitY + 12) continue;
      g.fillStyle(0x2d1b12, 1).fillRect(Math.round(cx - nw / 2 - 1), Math.round(y - nh / 2 - 1), Math.round(nw + 2), nh + 2);
      g.fillStyle(m === 'x' ? 0x6e6a7e : LANE_COLORS[n.lane], 1).fillRect(Math.round(cx - nw / 2), Math.round(y - nh / 2), Math.round(nw), nh);
    }
  }

  private drawStory(r: RhythmState, now: number, beat: number) {
    // Sympathie
    if (r.sub === 'play') {
      this.fx.fillStyle(0x2d1b12).fillRect(150, 53, 180, 8);
      this.fx.fillStyle(0xf6d7e2).fillRect(151, 54, 178, 6);
      this.fx.fillStyle(0xe46e98).fillRect(151, 54, 178 * (r.sympathy / 100), 6);
    }
    // Nicken im Takt
    const onBeat = now >= 0 && now % beat < 110;
    for (const s of this.seats.values()) s.y = 214 + (onBeat && r.sub === 'play' ? 1 : 0);
    // Sprechblase des aktuellen Abschnitts
    const idx = r.sub === 'play' ? r.phrases.findIndex((p) => now >= p.from && now < p.to) : -1;
    if (idx !== this.phraseIdx) {
      this.phraseIdx = idx;
      this.bubble.removeAll(true);
      const ph = r.phrases[idx];
      const seat = ph && this.seats.get(ph.speaker);
      if (ph && seat) {
        const w = Math.max(60, ph.topic.length * 8 + 16);
        this.bubble.add(panel(this, Math.round(seat.x - w / 2), 146, w, 24));
        this.bubble.add(ink(this, seat.x, 154, ph.topic));
        this.bubble.setAlpha(0);
        this.tweens.add({ targets: this.bubble, alpha: 1, duration: 200 });
      }
    }
    if (r.sub === 'play') {
      if (now < 0) this.info.setText('Gleich geht’s los …');
      else if (now > r.duration) this.info.setText('');
      else this.info.setText('Im Takt bleiben!');
    }
  }

  private drawWettkampf(r: RhythmState, now: number, beat: number) {
    if (r.sub === 'play') {
      const prog = Math.max(0, Math.min(1, now / r.duration));
      this.fx.fillStyle(0x2d1b12).fillRect(140, 16, 200, 5);
      this.fx.fillStyle(0xf0b13a).fillRect(141, 17, 198 * prog, 3);
    }
    const quotes = r.order.map((id) => {
      const p = r.players[id];
      const judged = p.perfect + p.good + p.miss;
      return judged ? Math.round(((p.perfect + p.good) / judged) * 100) : 0;
    });
    const best = Math.max(...quotes);
    const onBeat = now >= 0 && now % beat < 110 && r.sub === 'play';
    r.order.forEach((id, i) => {
      const t = this.pctTexts.get(id);
      const p = r.players[id];
      if (t) {
        const judged = p.perfect + p.good + p.miss;
        const shown = r.sub === 'over' ? this.quote(r, id) : quotes[i];
        const hw = this.highways[i];
        // Serie nur bei breiten Bahnen (bis 5 Spieler) – sonst stoßen die Zahlen aneinander
        const combo = p.combo >= 5 && r.sub === 'play' && (hw?.w ?? 0) >= 70 ? ` x${p.combo}` : '';
        t.setText(judged ? `${shown}%${combo}` : '');
        t.setColor(judged && quotes[i] === best && r.order.length > 1 ? GOLD : '#fff4d6');
        if (hw) fitText(t, hw.w - 4);
      }
      const pt = this.portraits.get(id);
      if (pt) pt.y = 236 - (onBeat && p.combo >= 3 ? 1 : 0);
    });
  }
}
