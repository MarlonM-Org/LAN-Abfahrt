/**
 * Schlagzeug-Raster auf Canvas: drei Zeilen (Kick, Snare, HiHat) × Sechzehntel, gleiche
 * Spaltenbreite wie die Piano-Roll. Klick schaltet, Ziehen malt (setzt alle auf den Zustand
 * der ersten Zelle).
 */
import { STEPS_PER_BAR } from '../../shared/music';
import { CELL_W, KEYS_W } from './pianoroll';
import type { Store } from './store';

const ROWS: { id: 'kick' | 'snare' | 'hat'; name: string; color: string }[] = [
  { id: 'kick', name: 'Kick', color: '#a8342a' },
  { id: 'snare', name: 'Snare', color: '#d8a03c' },
  { id: 'hat', name: 'HiHat', color: '#3fa7b5' },
];
export const DRUM_ROW_H = 22;

export class DrumGrid {
  readonly wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private labels: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private paint: { row: 'kick' | 'snare' | 'hat'; on: boolean; done: Set<number> } | null = null;
  playhead = -1;

  constructor(
    private store: Store,
    private onHit: (row: 'kick' | 'snare' | 'hat') => void,
  ) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'drum-wrap';
    this.labels = document.createElement('canvas');
    this.labels.className = 'roll-keys';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roll-grid';
    this.wrap.append(this.labels, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.bind();
    store.on(() => this.draw());
  }

  private cell(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { step: Math.floor((e.clientX - r.left) / CELL_W), row: ROWS[Math.floor((e.clientY - r.top) / DRUM_ROW_H)]?.id };
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const { step, row } = this.cell(e);
      if (!row || step < 0 || step >= this.store.total) return;
      c.setPointerCapture(e.pointerId);
      const on = e.button === 2 ? false : !this.store.song.drums[row].includes(step);
      this.paint = { row, on, done: new Set([step]) };
      this.set(row, step, on);
      if (on) this.onHit(row);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.paint) return;
      const { step } = this.cell(e);
      if (step < 0 || step >= this.store.total || this.paint.done.has(step)) return;
      this.paint.done.add(step);
      this.set(this.paint.row, step, this.paint.on);
    });
    const up = () => {
      if (!this.paint) return;
      this.paint = null;
      this.store.commitDrag();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  private set(row: 'kick' | 'snare' | 'hat', step: number, on: boolean) {
    this.store.dragEdit((s) => {
      const list = s.drums[row];
      const i = list.indexOf(step);
      if (on && i < 0) list.push(step);
      if (!on && i >= 0) list.splice(i, 1);
    });
  }

  draw() {
    const s = this.store;
    const total = s.total;
    const w = total * CELL_W, h = ROWS.length * DRUM_ROW_H;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.labels.height !== h) {
      this.labels.width = KEYS_W;
      this.labels.height = h;
    }
    const g = this.ctx;
    g.fillStyle = '#f2dfb3';
    g.fillRect(0, 0, w, h);
    for (let st = 0; st < total; st++) {
      if (Math.floor(st / 4) % 2 === 1) {
        g.fillStyle = '#eacf98';
        g.fillRect(st * CELL_W, 0, CELL_W, h);
      }
    }
    for (let st = 0; st <= total; st++) {
      g.fillStyle = st % STEPS_PER_BAR === 0 ? '#5e3518' : st % 4 === 0 ? '#b8894f' : '#dcbf86';
      g.fillRect(st * CELL_W - (st % STEPS_PER_BAR === 0 ? 1 : 0), 0, st % STEPS_PER_BAR === 0 ? 2 : 1, h);
    }
    ROWS.forEach((r, i) => {
      g.fillStyle = '#b8894f';
      g.fillRect(0, (i + 1) * DRUM_ROW_H - 1, w, 1);
      g.fillStyle = r.color;
      for (const st of s.song.drums[r.id]) {
        g.fillRect(st * CELL_W + 3, i * DRUM_ROW_H + 4, CELL_W - 6, DRUM_ROW_H - 8);
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillRect(st * CELL_W + 3, i * DRUM_ROW_H + 4, CELL_W - 6, 3);
        g.fillStyle = r.color;
      }
    });
    if (this.playhead >= 0) {
      g.fillStyle = 'rgba(168,52,42,0.85)';
      g.fillRect(this.playhead * CELL_W, 0, 2, h);
    }
    const l = this.labels.getContext('2d')!;
    l.font = '8px "Press Start 2P", monospace';
    l.textBaseline = 'middle';
    ROWS.forEach((r, i) => {
      l.fillStyle = '#fff6dc';
      l.fillRect(0, i * DRUM_ROW_H, KEYS_W, DRUM_ROW_H);
      l.fillStyle = r.color;
      l.fillRect(0, i * DRUM_ROW_H, 4, DRUM_ROW_H);
      l.fillStyle = '#3d2414';
      l.fillText(r.name, 8, i * DRUM_ROW_H + DRUM_ROW_H / 2 + 1);
      l.fillStyle = '#8d5629';
      l.fillRect(0, (i + 1) * DRUM_ROW_H - 1, KEYS_W, 1);
    });
    l.fillStyle = '#5e3518';
    l.fillRect(KEYS_W - 2, 0, 2, h);
  }

  setPlayhead(step: number) {
    if (step === this.playhead) return;
    this.playhead = step;
    this.draw();
  }
}
