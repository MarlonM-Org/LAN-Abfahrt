/**
 * Piano-Roll auf Canvas: Zeilen = Halbtöne (C1 … C7), Spalten = Sechzehntel.
 * Linksklick auf leer: Note setzen und beim Ziehen verlängern · Note ziehen: verschieben ·
 * rechter Rand: Länge ändern · Rechtsklick/Entf: löschen · Umschalt+Klick: Mehrfachauswahl ·
 * Klick auf die Taktleiste: Cursor/Startposition.
 */
import { type ChannelId, STEPS_PER_BAR, type SongNote, inScale, noteName, snapToScale } from '../../shared/music';
import type { Store } from './store';

export const CELL_W = 22;
export const ROW_H = 14;
export const KEYS_W = 56;
export const RULER_H = 22;
export const MIDI_TOP = 96; // C7
export const MIDI_BOTTOM = 24; // C1
const ROWS = MIDI_TOP - MIDI_BOTTOM + 1;

const COLORS: Record<ChannelId, string> = { lead: '#e8613c', bass: '#3f8fe0', harmony: '#5fa437' };
const BLACK = new Set([1, 3, 6, 8, 10]);

type Drag =
  | { kind: 'add'; index: number; startStep: number }
  | { kind: 'move'; indices: number[]; startStep: number; startMidi: number; orig: SongNote[]; moved: boolean }
  | { kind: 'resize'; index: number; orig: SongNote };

export class PianoRoll {
  readonly wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private keys: HTMLCanvasElement;
  private ruler: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private kctx: CanvasRenderingContext2D;
  private rctx: CanvasRenderingContext2D;
  private drag: Drag | null = null;
  private hoverStep = -1;
  private hoverMidi = -1;
  /** Abspielkopf in Schritten (−1 = aus) */
  playhead = -1;

  constructor(
    private store: Store,
    private onPreview: (midi: number) => void,
    private onCursor: (bar: number) => void,
  ) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'roll-wrap';
    const corner = document.createElement('div');
    corner.className = 'roll-corner';
    this.ruler = document.createElement('canvas');
    this.ruler.className = 'roll-ruler';
    this.keys = document.createElement('canvas');
    this.keys.className = 'roll-keys';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roll-grid';
    this.wrap.append(corner, this.ruler, this.keys, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.kctx = this.keys.getContext('2d')!;
    this.rctx = this.ruler.getContext('2d')!;
    this.bind();
    store.on(() => this.draw());
  }

  private get total() {
    return this.store.total;
  }

  /** Zeile → MIDI (y relativ zum Noten-Canvas) */
  private midiAt(y: number) {
    return MIDI_TOP - Math.floor(y / ROW_H);
  }
  private yOf(midi: number) {
    return (MIDI_TOP - midi) * ROW_H;
  }

  scrollToMidi(midi: number) {
    this.wrap.scrollTop = Math.max(0, this.yOf(midi) - this.wrap.clientHeight / 2);
  }

  private hit(step: number, midi: number): { index: number; edge: boolean } | null {
    const notes = this.store.notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.midi === midi && step >= n.step && step < n.step + Math.max(1, Math.ceil(n.len))) {
        return { index: i, edge: Math.ceil(n.len) > 1 && step === n.step + Math.ceil(n.len) - 1 };
      }
    }
    return null;
  }

  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, step: Math.floor(x / CELL_W), midi: this.midiAt(y) };
  }

  private bind() {
    const c = this.canvas;
    this.ruler.addEventListener('pointerdown', (e) => {
      const r = this.ruler.getBoundingClientRect();
      const step = Math.floor((e.clientX - r.left) / CELL_W);
      this.onCursor(Math.max(0, Math.min(this.store.song.bars - 1, Math.floor(step / STEPS_PER_BAR))));
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const s = this.store;
      const { step, midi } = this.pos(e);
      if (step < 0 || step >= this.total || midi < MIDI_BOTTOM || midi > MIDI_TOP) return;
      c.setPointerCapture(e.pointerId);
      const h = this.hit(step, midi);
      if (e.button === 2) {
        if (h) {
          s.edit((song) => song[s.channel].notes.splice(h.index, 1));
          s.selection.clear();
        }
        return;
      }
      if (e.button !== 0) return;
      if (h) {
        const notes = s.notes;
        if (e.shiftKey) {
          if (s.selection.has(h.index)) s.selection.delete(h.index);
          else s.selection.add(h.index);
          s.touch();
          return;
        }
        if (!s.selection.has(h.index)) {
          s.selection.clear();
          s.selection.add(h.index);
        }
        this.onPreview(notes[h.index].midi);
        if (h.edge && s.selection.size === 1) this.drag = { kind: 'resize', index: h.index, orig: { ...notes[h.index] } };
        else {
          const indices = [...s.selection];
          this.drag = { kind: 'move', indices, startStep: step, startMidi: midi, orig: indices.map((i) => ({ ...notes[i] })), moved: false };
        }
        s.touch();
        return;
      }
      // Neue Note
      const pitch = s.snapScale ? snapToScale(midi, s.song.key) : midi;
      const len = Math.min(s.lastLen, this.total - step);
      s.selection.clear();
      s.dragEdit((song) => {
        song[s.channel].notes.push({ step, midi: pitch, len });
      });
      this.drag = { kind: 'add', index: s.notes.length - 1, startStep: step };
      this.onPreview(pitch);
    });
    c.addEventListener('pointermove', (e) => {
      const s = this.store;
      const { step, midi } = this.pos(e);
      if (!this.drag) {
        if (step !== this.hoverStep || midi !== this.hoverMidi) {
          this.hoverStep = step;
          this.hoverMidi = midi;
          const h = step >= 0 && step < this.total ? this.hit(step, midi) : null;
          c.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'cell';
          this.draw();
        }
        return;
      }
      const d = this.drag;
      if (d.kind === 'add') {
        const len = Math.max(1, Math.min(this.total - d.startStep, step - d.startStep + 1));
        s.dragEdit((song) => {
          const n = song[s.channel].notes[d.index];
          if (n) n.len = len;
        });
      } else if (d.kind === 'resize') {
        const len = Math.max(1, Math.min(this.total - d.orig.step, step - d.orig.step + 1));
        s.dragEdit((song) => {
          const n = song[s.channel].notes[d.index];
          if (n) n.len = len;
        });
      } else {
        const dStep = step - d.startStep, dMidi = midi - d.startMidi;
        if (!dStep && !dMidi && !d.moved) return;
        d.moved = true;
        const minStep = Math.min(...d.orig.map((n) => n.step));
        const maxEnd = Math.max(...d.orig.map((n) => n.step + n.len));
        const ds = Math.max(-minStep, Math.min(this.total - maxEnd, dStep));
        const minMidi = Math.min(...d.orig.map((n) => n.midi)), maxMidi = Math.max(...d.orig.map((n) => n.midi));
        const dm = Math.max(MIDI_BOTTOM - minMidi, Math.min(MIDI_TOP - maxMidi, dMidi));
        s.dragEdit((song) => {
          d.indices.forEach((idx, k) => {
            const n = song[s.channel].notes[idx];
            if (!n) return;
            n.step = d.orig[k].step + ds;
            const m = d.orig[k].midi + dm;
            n.midi = s.snapScale && dm ? snapToScale(m, s.song.key) : m;
          });
        });
      }
    });
    const up = () => {
      const s = this.store;
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.kind === 'add') {
        const n = s.notes[d.index];
        if (n) s.lastLen = n.len;
        // Auswahl auf die neue Note – nach dem Sortieren per Suche
        s.commitDrag();
        if (n) {
          const idx = s.notes.findIndex((x) => x.step === n.step && x.midi === n.midi);
          s.selection.clear();
          if (idx >= 0) s.selection.add(idx);
        }
      } else if (d.kind === 'move') {
        if (d.moved) {
          const moved = d.indices.map((i) => s.notes[i]).filter(Boolean).map((n) => ({ ...n }));
          if (d.indices.length === 1) this.onPreview(moved[0]?.midi ?? 0);
          s.commitDrag();
          s.selection.clear();
          for (const m of moved) {
            const idx = s.notes.findIndex((x) => x.step === m.step && x.midi === m.midi);
            if (idx >= 0) s.selection.add(idx);
          }
        } else s.commitDrag();
      } else s.commitDrag();
      s.touch();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.hoverStep = -1;
        this.draw();
      }
    });
  }

  draw() {
    const s = this.store;
    const total = this.total;
    const w = total * CELL_W, h = ROWS * ROW_H;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.keys.height !== h) {
      this.keys.width = KEYS_W;
      this.keys.height = h;
    }
    if (this.ruler.width !== w) {
      this.ruler.width = w;
      this.ruler.height = RULER_H;
    }
    const g = this.ctx;
    const key = s.song.key;
    // Zeilen
    for (let m = MIDI_BOTTOM; m <= MIDI_TOP; m++) {
      const y = this.yOf(m);
      const pc = ((m % 12) + 12) % 12;
      const inKey = inScale(m, key);
      g.fillStyle = pc === key.root ? '#efd9a8' : inKey ? '#faebc7' : BLACK.has(pc) ? '#e4cd98' : '#f2dfb3';
      g.fillRect(0, y, w, ROW_H);
    }
    // Spalten
    for (let st = 0; st <= total; st++) {
      const x = st * CELL_W;
      g.fillStyle = st % STEPS_PER_BAR === 0 ? '#5e3518' : st % 4 === 0 ? '#b8894f' : '#dcbf86';
      g.fillRect(x - (st % STEPS_PER_BAR === 0 ? 1 : 0), 0, st % STEPS_PER_BAR === 0 ? 2 : 1, h);
    }
    for (let m = MIDI_BOTTOM; m <= MIDI_TOP; m++) {
      if (m % 12 === 0) {
        g.fillStyle = '#b8894f';
        g.fillRect(0, this.yOf(m) + ROW_H - 1, w, 1);
      }
    }
    // Cursor-Takt leicht hervorheben
    g.fillStyle = 'rgba(255,233,166,0.35)';
    g.fillRect(s.cursorBar * STEPS_PER_BAR * CELL_W, 0, STEPS_PER_BAR * CELL_W, h);
    // Andere Kanäle als Schatten
    const ids: ChannelId[] = ['bass', 'harmony', 'lead'];
    for (const id of ids) {
      if (id === s.channel) continue;
      g.globalAlpha = 0.28;
      g.fillStyle = COLORS[id];
      for (const n of s.song[id].notes) this.rect(n, 3);
      g.globalAlpha = 1;
    }
    // Vorschlag aus dem Einsingen
    if (s.proposal) {
      g.globalAlpha = 0.6;
      g.fillStyle = '#b0306a';
      g.fillRect(s.proposal.fromStep * CELL_W, 0, (s.proposal.toStep - s.proposal.fromStep) * CELL_W, h);
      g.globalAlpha = 1;
      for (const n of s.proposal.notes) {
        g.fillStyle = '#ffd0e6';
        this.rect(n, 2);
        g.strokeStyle = '#b0306a';
        g.lineWidth = 2;
        g.strokeRect(n.step * CELL_W + 1, this.yOf(n.midi) + 1, n.len * CELL_W - 2, ROW_H - 2);
      }
    }
    // Aktiver Kanal
    const notes = s.notes;
    notes.forEach((n, i) => {
      g.fillStyle = COLORS[s.channel];
      this.rect(n, 1);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(n.step * CELL_W + 1, this.yOf(n.midi) + 1, n.len * CELL_W - 2, 3);
      if (s.selection.has(i)) {
        g.strokeStyle = '#2d1b12';
        g.lineWidth = 2;
        g.strokeRect(n.step * CELL_W + 1, this.yOf(n.midi) + 1, n.len * CELL_W - 2, ROW_H - 2);
      }
    });
    // Live-Tonhöhe
    if (s.live && s.live.frames.length) {
      const stepDur = 60 / s.live.bpm / 4;
      g.strokeStyle = '#b0306a';
      g.lineWidth = 2;
      g.beginPath();
      let pen = false;
      for (const f of s.live.frames) {
        if (f.midi === null || f.midi < MIDI_BOTTOM - 1 || f.midi > MIDI_TOP + 1) {
          pen = false;
          continue;
        }
        const x = (s.live.from + f.t / stepDur) * CELL_W;
        const y = this.yOf(f.midi) + ROW_H / 2;
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.stroke();
    }
    // Hover
    if (this.hoverStep >= 0 && this.hoverStep < total && this.hoverMidi >= MIDI_BOTTOM && this.hoverMidi <= MIDI_TOP && !this.drag) {
      g.strokeStyle = 'rgba(45,27,18,0.5)';
      g.lineWidth = 1;
      g.strokeRect(this.hoverStep * CELL_W + 0.5, this.yOf(this.hoverMidi) + 0.5, CELL_W - 1, ROW_H - 1);
    }
    // Abspielkopf
    if (this.playhead >= 0) {
      g.fillStyle = 'rgba(168,52,42,0.85)';
      g.fillRect(this.playhead * CELL_W, 0, 2, h);
    }
    this.drawKeys();
    this.drawRuler();
  }

  private drawRuler() {
    const s = this.store;
    const g = this.rctx;
    const w = this.ruler.width;
    g.fillStyle = '#b8783f';
    g.fillRect(0, 0, w, RULER_H);
    g.fillStyle = '#ffe9a6';
    g.fillRect(s.cursorBar * STEPS_PER_BAR * CELL_W, 0, STEPS_PER_BAR * CELL_W, RULER_H);
    g.font = '10px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    for (let b = 0; b < s.song.bars; b++) {
      g.fillStyle = b === s.cursorBar ? '#3d2414' : '#fff6dc';
      g.fillText(String(b + 1), b * STEPS_PER_BAR * CELL_W + 6, RULER_H / 2 + 1);
      g.fillStyle = '#5e3518';
      g.fillRect(b * STEPS_PER_BAR * CELL_W, 0, 2, RULER_H);
      g.fillStyle = '#8d5629';
      for (let q = 1; q < 4; q++) g.fillRect((b * STEPS_PER_BAR + q * 4) * CELL_W, RULER_H - 6, 1, 6);
    }
    if (this.playhead >= 0) {
      g.fillStyle = 'rgba(168,52,42,0.85)';
      g.fillRect(this.playhead * CELL_W, 0, 2, RULER_H);
    }
  }

  private rect(n: SongNote, inset: number) {
    this.ctx.fillRect(n.step * CELL_W + inset, this.yOf(n.midi) + inset, Math.max(2, n.len * CELL_W - inset * 2), ROW_H - inset * 2);
  }

  private drawKeys() {
    const g = this.kctx;
    const key = this.store.song.key;
    g.font = '9px "Press Start 2P", monospace';
    g.textBaseline = 'middle';
    for (let m = MIDI_BOTTOM; m <= MIDI_TOP; m++) {
      const y = this.yOf(m);
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = BLACK.has(pc) ? '#3d2414' : '#fff6dc';
      g.fillRect(0, y, KEYS_W, ROW_H);
      g.fillStyle = '#8d5629';
      g.fillRect(0, y + ROW_H - 1, KEYS_W, 1);
      if (pc === key.root) {
        g.fillStyle = '#e8613c';
        g.fillRect(KEYS_W - 5, y + 2, 3, ROW_H - 4);
      }
      if (pc === 0 || this.hoverMidi === m) {
        g.fillStyle = BLACK.has(pc) ? '#fff6dc' : '#3d2414';
        g.fillText(noteName(m), 4, y + ROW_H / 2 + 1);
      }
    }
    g.fillStyle = '#5e3518';
    g.fillRect(KEYS_W - 2, 0, 2, this.keys.height);
  }

  /** Abspielkopf setzen und bei Bedarf hinscrollen */
  setPlayhead(step: number) {
    if (step === this.playhead) return;
    this.playhead = step;
    if (step >= 0) {
      const x = step * CELL_W;
      const left = this.wrap.scrollLeft - KEYS_W, right = left + this.wrap.clientWidth - KEYS_W;
      if (x < left || x > right - CELL_W * 2) this.wrap.scrollLeft = Math.max(0, x - 40);
    }
    this.draw();
  }
}
