import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { BAND, BAND_INFO, BAND_INSTS, type BandInst, type BandPart, type BandState, bandBarMs, bandBeatMs, bandSong, bandStepMs } from '../../shared/band';
import { BAND_PROPS, BAND_PROP_AT, BAND_STAGE, lightCone, noteGlyph, paintBandStage, readyBadge } from '../art/band';
import { palm } from '../art/objects';
import { SongPlayer, midiHz } from '../music/player';
import { toLocalPerf } from '../timesync';
import { bus, getState, playerById } from './store';
import { avatarSprite, playAvatar } from './textures';
import { GOLD, NameTags, RED_INK, background, ensureTex, ink, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say } from './speech';
import { pcol } from './playerColor';
import { audioReady, audioSynth, duckMusic, getMusicVolume, onMusicChange } from './music';
import { sway } from './ambient';
import { randomLook } from '../../shared/avatar';

const S = BAND_STAGE;
const PARTS: BandPart[] = ['lead', 'bass', 'harmony', 'kick', 'snare', 'hat'];
/** Reihenfolge auf der Bühne: Rhythmusgruppe hinten, Melodie + Shaker vorne */
const STAGE_RANK: BandInst[] = ['drums', 'bass', 'chords', 'melody', 'shaker'];
const LIGHT_COLORS = [0xff7ab0, 0xffd25e, 0x5fd0ff, 0x9ad65a, 0xc58cff];

interface Member {
  id: string;
  inst: BandInst;
  x: number;
  /** Fußpunkt */
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  prop: Phaser.GameObjects.Image;
  check: Phaser.GameObjects.Image;
  seq: number;
  fxAt: number;
}

interface BandAudio {
  player: SongPlayer;
  bus: GainNode;
  parts: Record<BandPart, { gain: GainNode; filter: BiquadFilterNode }>;
  seq: number;
}

/**
 * Wandelt eine performance.now()-Zeit in AudioContext-Zeit um – so, dass der Ton dann aus dem Lautsprecher
 * kommt: `getOutputTimestamp()` kennt die Ausgabe-Verzögerung des Browsers (Puffer, Bluetooth …). Was der
 * Fernseher selbst noch draufpackt (HDMI-Tonverarbeitung), kann keine Webseite messen – das fangen die
 * Handys mit ihrer Selbst-Kalibrierung auf.
 */
function perfToAudio(ctx: AudioContext, perf: number): number {
  const naive = ctx.currentTime + (perf - performance.now()) / 1000;
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime !== undefined) {
      const t = ts.contextTime + (perf - ts.performanceTime) / 1000;
      if (naive - t >= -0.01 && naive - t < 0.5) return t;
    }
  } catch {
    /* ältere Browser */
  }
  const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return naive - Math.min(0.3, Math.max(0, lat));
}

/** Strand-Band am TV: Bühne bei Sonnenuntergang, bis zu 12 wippende Musiker, Groove der Band, Stimmung im Publikum */
export class BandScene extends Phaser.Scene {
  private juice!: Juice;
  private tags!: NameTags;
  private members = new Map<string, Member>();
  private layoutKey = '';
  private latest: BandState | null = null;
  private playSeq = 0;
  private playStart = 0;
  private audio: BandAudio | null = null;
  private hud!: Phaser.GameObjects.Container;
  private hudKey = '';
  private meter!: Phaser.GameObjects.Graphics;
  private grooveText!: Phaser.GameObjects.Text;
  private bigText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private cones: Phaser.GameObjects.Image[] = [];
  private bulbs: Phaser.GameObjects.Rectangle[] = [];
  private crowd: { s: Phaser.GameObjects.Sprite; y: number; ph: number }[] = [];
  private lastBar = -1;
  private energyShown = 60;
  private lastBeat = -99;
  private finalDone = false;
  private overDone = false;
  private sub = '';
  private formKey = '';
  private offMusic: (() => void) | null = null;

  constructor() {
    super('band');
  }

  create() {
    this.members = new Map();
    this.layoutKey = '';
    this.latest = null;
    this.playSeq = 0;
    this.playStart = 0;
    this.audio = null;
    this.hudKey = '';
    this.cones = [];
    this.bulbs = [];
    this.crowd = [];
    this.lastBar = -1;
    this.energyShown = 60;
    this.lastBeat = -99;
    this.finalDone = false;
    this.overDone = false;
    this.sub = '';
    this.formKey = '';
    this.juice = new Juice(this, { depth: 3000 });
    this.tags = new NameTags(this, 1500);

    background(this, 'band_stage', WORLD.W, WORLD.H, (p) => paintBandStage(p, WORLD.W, WORLD.H));
    const palmL = this.add.image(26, S.SAND + 6, ensureTex(this, 'bd_palmL', () => palm(4))).setOrigin(0.5, 1).setDepth(-900);
    const palmR = this.add.image(458, S.SAND + 8, ensureTex(this, 'bd_palmR', () => palm(9))).setOrigin(0.5, 1).setDepth(-900).setFlipX(true);
    sway(this, [palmL, palmR], { angle: 1.6 });
    // Banner-Schrift + Fackelflammen
    ink(this, 240, S.BEAM + 10, 'STRAND-BAND', { color: RED_INK }).setDepth(-500);
    for (const x of [13, WORLD.W - 11]) {
      const f = this.add.ellipse(x, S.FLOOR - 58, 6, 9, 0xffa040).setDepth(-500);
      this.tweens.add({ targets: f, scaleY: 1.35, scaleX: 0.8, duration: 160, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    // Lichterkette am Balken
    for (let i = 0; i < 24; i++) {
      const bulb = this.add.rectangle(S.LEFT + 4 + i * 16, S.BEAM + 8 + (i % 2), 3, 3, LIGHT_COLORS[i % LIGHT_COLORS.length]).setDepth(-400);
      this.bulbs.push(bulb);
    }
    // Scheinwerfer (additiv, Stärke folgt der Stimmung)
    const coneKey = ensureTex(this, 'bd_cone', lightCone);
    [118, 196, 284, 362].forEach((x, i) => {
      const c = this.add.image(x, S.BEAM + 6, coneKey).setOrigin(0.5, 0).setDepth(900).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.15).setTint(LIGHT_COLORS[i]);
      this.tweens.add({ targets: c, angle: { from: i % 2 ? 14 : -14, to: i % 2 ? -14 : 14 }, duration: 2600 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.cones.push(c);
    });
    // Publikum: Silhouetten vorne im Bild
    for (let i = 0; i < 13; i++) {
      const x = 12 + i * 38 + (i % 2 ? 6 : -4);
      const y = WORLD.H + 26 + (i % 3) * 4;
      const s = avatarSprite(this, randomLook(), x, y).setScale(2).setTint(0x2a1d3d).setDepth(2000).setFlipX(i % 2 === 0);
      this.crowd.push({ s, y, ph: (i * 0.37) % 1 });
    }

    this.hud = this.add.container(0, 0).setDepth(2500);
    this.meter = this.add.graphics().setDepth(2501);
    this.grooveText = txt(this, 240, 17, '', { color: GOLD }).setOrigin(0.5, 0.5).setDepth(2502);
    this.bigText = txt(this, 240, 90, '', { size: 24, color: '#fff4d6' }).setDepth(2600).setOrigin(0.5, 0.5);
    this.hint = txt(this, 240, 248, '', { color: '#fff4d6' }).setDepth(2600);

    this.offMusic = onMusicChange((k) => {
      if (k === 'volume' && this.audio) this.audio.bus.gain.setTargetAtTime(Math.min(1.5, getMusicVolume() || 1), this.audio.bus.context.currentTime, 0.1);
    });
    const onState = (s: GameState) => this.onState(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.offMusic?.();
      this.offMusic = null;
      this.stopAudio(true);
      duckMusic(false);
      this.tags.clear();
    });
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'band') return;
    const st = s.mini.state;
    this.latest = st;
    this.layout(st);
    if (st.sub !== this.sub) {
      const prev = this.sub;
      this.sub = st.sub;
      if (st.sub === 'pick') sfx('select');
      if (st.sub === 'over' && prev === 'play') this.onOver(st);
    }
    if (st.sub === 'play' && st.playSeq !== this.playSeq) {
      this.playSeq = st.playSeq;
      this.playStart = toLocalPerf(st.startAt);
      this.finalDone = false;
      this.startAudio(st);
    }
    this.drawHud(st);
    this.hits(st);
    this.groove(st);
    this.dampen(st);
  }

  /** Musiker aufstellen: Rhythmusgruppe hinten auf dem Podest, ab 7 Spielern in zwei Reihen */
  private layout(st: BandState) {
    const sorted = [...st.order].sort((a, b) => STAGE_RANK.indexOf(st.players[a].inst) - STAGE_RANK.indexOf(st.players[b].inst) || st.order.indexOf(a) - st.order.indexOf(b));
    const key = sorted.map((id) => `${id}:${st.players[id].inst}`).join(',');
    if (key === this.layoutKey) {
      for (const m of this.members.values()) {
        const on = st.sub === 'pick' && !!st.players[m.id]?.ready;
        if (on && !m.check.visible) {
          sfx('pop', { x: m.x, pitch: 1.2 });
          this.tweens.add({ targets: m.check, scale: { from: 3, to: 2 }, duration: 220, ease: 'Back.out' });
        }
        m.check.setVisible(on);
      }
      return;
    }
    this.layoutKey = key;
    for (const m of this.members.values()) (m.sprite.destroy(), m.prop.destroy(), m.check.destroy());
    this.members.clear();
    const n = sorted.length;
    const rows: { ids: string[]; y: number }[] = n <= 6 ? [{ ids: sorted, y: S.FLOOR + 8 }] : [
      { ids: sorted.slice(0, Math.floor(n / 2)), y: S.RISER + 4 },
      { ids: sorted.slice(Math.floor(n / 2)), y: S.FLOOR + 10 },
    ];
    const spacing = n <= 4 ? 80 : n <= 6 ? 60 : 56;
    rows.forEach((row, ri) => {
      const k = row.ids.length;
      const shift = rows.length === 2 && rows[0].ids.length === rows[1].ids.length ? (ri === 0 ? -spacing / 4 : spacing / 4) : 0;
      row.ids.forEach((id, i) => {
        const p = playerById(id);
        const inst = st.players[id].inst;
        const x = Math.round(240 + (i - (k - 1) / 2) * spacing + shift);
        const y = row.y;
        const depth = 100 + y;
        const sprite = avatarSprite(this, p?.look ?? randomLook(), x, y).setScale(2).setDepth(depth);
        const [px, py] = BAND_PROP_AT[inst];
        const prop = this.add.image(x - 16 + px * 2, y - 54 + py * 2, ensureTex(this, `bd_prop_${inst}`, BAND_PROPS[inst])).setOrigin(0, 0).setScale(2).setDepth(depth + 1);
        if (inst === 'shaker') this.tweens.add({ targets: prop, angle: { from: -12, to: 12 }, duration: 140, yoyo: true, repeat: -1 });
        const check = this.add.image(x, y - 62, ensureTex(this, 'bd_ready', readyBadge)).setOrigin(0.5, 1).setScale(2).setDepth(depth + 2).setVisible(st.sub === 'pick' && st.players[id].ready);
        this.members.set(id, { id, inst, x, y, sprite, prop, check, seq: st.players[id].last?.seq ?? 0, fxAt: 0 });
      });
    });
  }

  private drawHud(st: BandState) {
    const ready = st.order.filter((id) => st.players[id].ready).length;
    const key = JSON.stringify([st.sub, st.title, ready, st.order.length, Math.ceil(st.endsIn / 1000), audioReady()]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub === 'pick') {
      this.hud.add(panel(this, 40, 3, 400, 29));
      this.hud.add(ink(this, 240, 8, `Instrument am Handy wählen! · ${ready}/${st.order.length} bereit`, { color: RED_INK }));
      this.hud.add(ink(this, 240, 19, `„${st.title}“ · ${st.bpm} BPM${st.endsIn > 0 ? ` · ${Math.ceil(st.endsIn / 1000)} s` : ''}`, { color: '#7a5a3a' }));
    } else {
      this.hud.add(panel(this, 4, 4, 160, 26));
      this.hud.add(ink(this, 84, 9, st.title.length > 18 ? `${st.title.slice(0, 17)}.` : st.title));
      this.hud.add(panel(this, 172, 4, 136, 26, 'dark'));
      this.hud.add(panel(this, 316, 4, 160, 26));
      this.hud.add(ink(this, 396, 9, 'Stimmung'));
    }
    this.hint.setText(audioReady() ? '' : 'Kein Ton? Einmal ins TV-Bild klicken oder eine Taste drücken!');
  }

  // ---------------------------------------------------------------- Effekte

  /** Treffer der Musiker: Noten steigen auf, Patzer fallen grau herunter */
  private hits(st: BandState) {
    const now = performance.now();
    for (const m of this.members.values()) {
      const last = st.players[m.id]?.last;
      if (!last || last.seq === m.seq) continue;
      m.seq = last.seq;
      if (now - m.fxAt < 90) continue;
      m.fxAt = now;
      const headY = m.y - 58;
      if (last.q === 3) {
        this.juice.burst(m.x, headY, 'spark', 5);
        continue;
      }
      const key = ensureTex(this, 'bd_note', noteGlyph);
      const note = this.add.image(m.x + Phaser.Math.Between(-10, 10), headY, key).setDepth(1800).setScale(last.q === 2 ? 2 : 1.5);
      if (last.q > 0) {
        note.setTint(BAND_INFO[m.inst].color).setAlpha(last.q === 2 ? 1 : 0.75);
        this.tweens.add({ targets: note, y: headY - 26, x: note.x + Phaser.Math.Between(-6, 6), alpha: 0, duration: 800, ease: 'Quad.out', onComplete: () => note.destroy() });
      } else {
        note.setTint(0x8a857c).setAlpha(0.9);
        this.tweens.add({ targets: note, y: headY + 14, angle: 40, alpha: 0, duration: 600, ease: 'Quad.in', onComplete: () => note.destroy() });
      }
    }
  }

  /** Groove der Band: jeder genaue Takt zählt hoch, ein schwacher Takt reißt die Serie */
  private groove(st: BandState) {
    const lb = st.lastBar;
    if (!lb || lb.bar === this.lastBar) return;
    const fresh = this.lastBar >= 0 || lb.bar <= 1;
    this.lastBar = lb.bar;
    if (!fresh || st.sub !== 'play') return;
    if (lb.ok) {
      this.tweens.add({ targets: this.grooveText, scale: { from: 1.5, to: 1 }, duration: 260, ease: 'Back.out' });
      if (st.groove > 0 && st.groove % 8 === 0) {
        sfx('cheer', { vol: 0.5 });
        this.juice.burst(240, S.BEAM + 30, 'confetti', 26);
        this.juice.float(240, 96, `${st.groove} Takte im Groove!`, 'gold');
        this.crowdCheer();
      }
    } else if (st.groove === 0) {
      this.juice.float(240, 96, 'Groove verloren …', '#ff8a7a');
    }
  }

  /** Spur leiser und dumpfer, wenn die Musiker an diesem Instrument danebenhauen */
  private dampen(st: BandState) {
    const a = this.audio;
    if (!a) return;
    const forms = new Map<BandInst, number[]>();
    for (const id of st.order) {
      const p = st.players[id];
      forms.set(p.inst, [...(forms.get(p.inst) ?? []), p.form]);
    }
    const key = JSON.stringify([...forms]);
    if (key === this.formKey) return;
    this.formKey = key;
    const t = a.bus.context.currentTime;
    for (const inst of BAND_INSTS) {
      const list = forms.get(inst);
      const f = list?.length ? list.reduce((x, y) => x + y, 0) / list.length : 1;
      for (const part of BAND_INFO[inst].parts) {
        a.parts[part].gain.gain.setTargetAtTime(0.3 + 0.7 * f, t, 0.12);
        a.parts[part].filter.frequency.setTargetAtTime(400 * Math.pow(45, f), t, 0.12);
      }
    }
  }

  private crowdCheer() {
    for (const c of this.crowd) {
      playAvatar(c.s, 'cheer');
      this.time.delayedCall(900, () => c.s.active && playAvatar(c.s, 'idle'));
    }
  }

  private onOver(st: BandState) {
    if (this.overDone) return;
    this.overDone = true;
    this.bigText.setText('');
    this.juice.banner('Applaus!', `${st.bandAcc} % getroffen · Groove-Serie ${st.bestGroove}`, 2200);
    this.juice.burst(240, 120, 'confetti', 40);
    sfx('cheer');
    say('Applaus für die Strand-Band!');
    this.crowdCheer();
    // Ausklingen lassen, dann leise abräumen
    this.time.delayedCall(1200, () => {
      this.stopAudio(false);
      duckMusic(false);
    });
  }

  // ---------------------------------------------------------------- Ton

  private startAudio(st: BandState) {
    const synth = audioSynth();
    const song = bandSong(st.song);
    if (!synth || !song || synth.ctx.state !== 'running') return;
    this.stopAudio(true);
    const ctx = synth.ctx;
    const out = ctx.createGain();
    out.gain.value = Math.min(1.5, getMusicVolume() || 1);
    out.connect(synth.master);
    const parts = Object.fromEntries(
      PARTS.map((part) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 18000;
        filter.Q.value = 0.7;
        const gain = ctx.createGain();
        filter.connect(gain).connect(out);
        return [part, { gain, filter }];
      }),
    ) as BandAudio['parts'];
    const player = new SongPlayer(synth);
    const start = perfToAudio(ctx, toLocalPerf(st.startAt));
    const beat = bandBeatMs(song) / 1000;
    const step = bandStepMs(song) / 1000;
    const nodes = Object.fromEntries(PARTS.map((p) => [p, parts[p].filter]));
    if (start > ctx.currentTime + 0.05) {
      // Einzähler: vier Stick-Klicks vor Takt 1
      for (let k = BAND.COUNT_IN; k >= 1; k--) {
        const t = start - k * beat;
        if (t > ctx.currentTime) synth.tone(midiHz(k === BAND.COUNT_IN ? 91 : 86), t, 0.05, 'square', 0.07, out);
      }
      player.play(song, { loop: false, startAt: start, out: nodes });
    } else {
      // Später dazugekommen (Ton erst jetzt freigeschaltet): ab dem nächsten Schritt einsteigen
      const from = Math.ceil((ctx.currentTime + 0.12 - start) / step);
      if (from >= song.bars * 16) return;
      player.play(song, { loop: false, from, startAt: start + from * step, out: nodes });
    }
    duckMusic(true);
    this.audio = { player, bus: out, parts, seq: st.playSeq };
    this.formKey = '';
    this.dampen(st);
  }

  private stopAudio(hard: boolean) {
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    a.player.stop();
    const ctx = a.bus.context;
    a.bus.gain.setTargetAtTime(0, ctx.currentTime, hard ? 0.02 : 0.4);
    window.setTimeout(() => a.bus.disconnect(), hard ? 120 : 2500);
  }

  // ---------------------------------------------------------------- Bild für Bild

  update() {
    const st = this.latest;
    if (!st) return;
    const song = bandSong(st.song);
    if (!song) return;
    const beatMs = bandBeatMs(song);
    const playing = st.sub === 'play' && this.playStart > 0;
    const now = playing ? performance.now() - this.playStart : -1e9;
    // Ton nachträglich freigeschaltet → mitten im Song einsteigen
    if (playing && !this.audio && audioSynth()?.ctx.state === 'running' && now < st.duration - 500) this.startAudio(st);

    // Stimmung weich nachziehen
    this.energyShown += (st.energy - this.energyShown) * 0.08;
    const e = this.energyShown / 100;
    const beatPos = playing ? now / beatMs : performance.now() / 600;
    const beat = Math.floor(beatPos);
    const phase = beatPos - beat;
    const onBeat = phase < 0.16;

    // Einzähler am TV (passend zu den Stick-Klicks)
    if (playing && now < 0) {
      const left = Math.ceil(-now / beatMs);
      this.bigText.setText(left <= BAND.COUNT_IN ? String(left) : '');
      this.bigText.setScale(1 + Math.max(0, 0.4 - phase));
    } else if (st.sub === 'play') this.bigText.setText('');

    // Musiker wippen im Takt (wer gut in Form ist, wippt jeden Schlag – wer patzt, sackt grau zusammen)
    for (const m of this.members.values()) {
      const p = st.players[m.id];
      if (!p) continue;
      const form = st.sub === 'pick' ? 1 : p.form;
      const bob = st.sub !== 'over' && (playing ? now >= -BAND.COUNT_IN * beatMs : false) && onBeat && (form >= 0.6 || (form >= 0.35 && beat % 2 === 0));
      const dy = bob ? 2 : 0;
      m.sprite.y = m.y + dy;
      const [px, py] = BAND_PROP_AT[m.inst];
      m.prop.y = m.y - 54 + py * 2 + dy;
      m.prop.x = m.x - 16 + px * 2;
      const grey = st.sub === 'play' && form < 0.35;
      if (grey) m.sprite.setTint(0x9a96a8);
      else m.sprite.clearTint();
    }
    this.tags.update(
      [...this.members.values()].map((m) => ({ id: m.id, x: m.x, y: m.y + 2, name: playerById(m.id)?.name ?? '?', color: pcol(m.id).hex, alpha: 1 })),
    );

    // Licht + Publikum folgen der Stimmung
    if (playing && beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.bulbs.forEach((b, i) => b.setFillStyle(LIGHT_COLORS[(i + beat) % LIGHT_COLORS.length]));
    }
    const pulse = playing && now >= 0 && onBeat ? 0.12 : 0;
    for (const c of this.cones) c.setAlpha(st.sub === 'pick' ? 0.12 : 0.06 + 0.32 * e + pulse * e);
    this.crowd.forEach((c, i) => {
      const jump = playing && now >= 0 && e > 0.55 && (e > 0.8 || (beat + i) % 2 === 0);
      const k = jump ? Math.max(0, Math.sin(Math.min(1, (phase + c.ph * 0.15) * 2) * Math.PI)) : 0;
      c.s.y = c.y - Math.round(k * 6 * e);
    });

    // Schlussakkord: alle hauen gemeinsam drauf
    const finalAt = (song.bars - 1) * bandBarMs(song);
    if (playing && !this.finalDone && now >= finalAt) {
      this.finalDone = true;
      this.juice.flash(0xfff4d6, 220);
      this.juice.shake(2);
      this.juice.burst(240, S.BEAM + 40, 'confetti', 30);
    }

    // HUD: Fortschritt, Groove, Stimmung
    this.meter.clear();
    if (st.sub !== 'pick') {
      const prog = Math.max(0, Math.min(1, now / st.duration));
      this.meter.fillStyle(0x2d1b12).fillRect(14, 20, 140, 5);
      this.meter.fillStyle(0xf0b13a).fillRect(15, 21, 138 * (st.sub === 'over' ? 1 : prog), 3);
      this.meter.fillStyle(0x2d1b12).fillRect(334, 20, 124, 5);
      const col = e > 0.7 ? 0x46b04a : e > 0.4 ? 0xf0b13a : 0xe0503f;
      this.meter.fillStyle(col).fillRect(335, 21, 122 * e, 3);
      const g = st.groove;
      this.grooveText.setText(g >= 2 ? `GROOVE x${g}` : st.sub === 'over' ? `BESTE SERIE ${st.bestGroove}` : 'GROOVE');
      this.grooveText.setColor(g >= 8 ? GOLD : g >= 2 ? '#fff4d6' : '#c9c3e6');
    } else this.grooveText.setText('');
  }
}
