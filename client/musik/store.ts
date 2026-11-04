/**
 * Zustand der Musik-Werkstatt: der Song, Undo/Redo (Schnappschüsse), Auswahl, Zwischenablage
 * für Takte, Abspielposition. Alle Änderungen am Song laufen über `edit()`, damit sie
 * rückgängig gemacht werden können und alle Ansichten benachrichtigt werden.
 */
import { type ChannelId, type Song, type SongNote, STEPS_PER_BAR, emptySong } from '../../shared/music';
import type { PitchFrame } from '../music/pitch';

export type Listener = (what: 'song' | 'ui') => void;

/** Vorschlag aus dem Einsingen (noch nicht übernommen) */
export interface Proposal {
  channel: ChannelId;
  fromStep: number;
  toStep: number;
  notes: SongNote[];
}

interface BarClip {
  lead: SongNote[];
  bass: SongNote[];
  harmony: SongNote[];
  kick: number[];
  snare: number[];
  hat: number[];
}

const MAX_HISTORY = 100;

export class Store {
  song: Song = emptySong();
  /** Song wie zuletzt gespeichert/geladen (für „ungespeichert?“) */
  savedJson = '';
  channel: ChannelId = 'lead';
  /** Ausgewählte Noten des aktiven Kanals (Index in notes) */
  selection = new Set<number>();
  /** Takt, auf dem der Cursor steht (Kopieren/Einfügen, Startposition beim Abspielen) */
  cursorBar = 0;
  /** Skalen-Snap beim Setzen/Verschieben */
  snapScale = false;
  /** Zuletzt gesetzte Notenlänge */
  lastLen = 2;
  mute: Partial<Record<ChannelId | 'drums', boolean>> = {};
  /** Live-Tonhöhenlinie beim Einsingen (Zeit relativ zu Schritt `liveFrom`) */
  live: { from: number; bpm: number; frames: PitchFrame[] } | null = null;
  proposal: Proposal | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private clip: BarClip | null = null;
  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(what: 'song' | 'ui') {
    for (const fn of this.listeners) fn(what);
  }
  /** Nur Ansicht geändert (Auswahl, Cursor …) */
  touch() {
    this.emit('ui');
  }

  get total() {
    return this.song.bars * STEPS_PER_BAR;
  }
  get notes() {
    return this.song[this.channel].notes;
  }
  get dirty() {
    return JSON.stringify(this.song) !== this.savedJson;
  }

  /** Änderung am Song mit Undo-Schnappschuss */
  edit(fn: (song: Song) => void) {
    this.undoStack.push(JSON.stringify(this.song));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    fn(this.song);
    this.normalize();
    this.emit('song');
  }

  /** Zusammenhängende Änderung (Ziehen): nur beim ersten Aufruf Schnappschuss, dann `commitDrag()` */
  private dragging = false;
  dragEdit(fn: (song: Song) => void) {
    if (!this.dragging) {
      this.undoStack.push(JSON.stringify(this.song));
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this.dragging = true;
    }
    fn(this.song);
    this.emit('song');
  }
  commitDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    // Wenn sich nichts geändert hat, Schnappschuss wieder entfernen
    if (this.undoStack[this.undoStack.length - 1] === JSON.stringify(this.song)) this.undoStack.pop();
    this.normalize();
    this.emit('song');
  }

  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.selection.clear();
    this.emit('song');
  }
  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(JSON.stringify(this.song));
    this.song = JSON.parse(s);
    this.selection.clear();
    this.emit('song');
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Neuen Song laden (ohne Undo-Geschichte) */
  load(song: Song, saved = true) {
    this.song = structuredClone(song);
    this.normalize();
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.proposal = null;
    this.cursorBar = 0;
    if (saved) this.markSaved();
    else this.savedJson = '';
    this.emit('song');
  }
  markSaved() {
    this.savedJson = JSON.stringify(this.song);
    this.emit('ui');
  }

  /** Noten sortieren, außerhalb liegende abschneiden, Schlagzeug-Duplikate entfernen */
  private normalize() {
    const total = this.total;
    for (const id of ['lead', 'bass', 'harmony'] as const) {
      const ch = this.song[id];
      ch.notes = ch.notes
        .filter((n) => n.step >= 0 && n.step < total && n.len > 0)
        .map((n) => (n.step + n.len > total ? { ...n, len: total - n.step } : n))
        .sort((a, b) => a.step - b.step || a.midi - b.midi);
    }
    const d = this.song.drums;
    for (const k of ['kick', 'snare', 'hat'] as const) d[k] = [...new Set(d[k].filter((s) => s >= 0 && s < total))].sort((a, b) => a - b);
    if (this.cursorBar >= this.song.bars) this.cursorBar = this.song.bars - 1;
  }

  setChannel(c: ChannelId) {
    if (c === this.channel) return;
    this.channel = c;
    this.selection.clear();
    this.emit('ui');
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const sel = this.selection;
    this.edit((s) => {
      s[this.channel].notes = s[this.channel].notes.filter((_, i) => !sel.has(i));
    });
    this.selection.clear();
    this.emit('ui');
  }

  // ------------------------------------------------------------------ Takte kopieren

  copyBar(bar = this.cursorBar) {
    const a = bar * STEPS_PER_BAR, b = a + STEPS_PER_BAR;
    const pick = (notes: SongNote[]) => notes.filter((n) => n.step >= a && n.step < b).map((n) => ({ ...n, step: n.step - a }));
    const hits = (x: number[]) => x.filter((s) => s >= a && s < b).map((s) => s - a);
    const s = this.song;
    this.clip = { lead: pick(s.lead.notes), bass: pick(s.bass.notes), harmony: pick(s.harmony.notes), kick: hits(s.drums.kick), snare: hits(s.drums.snare), hat: hits(s.drums.hat) };
    this.emit('ui');
  }
  get hasClip() {
    return !!this.clip;
  }

  /** Takt aus der Zwischenablage an `bar` einfügen (ersetzt den Takt; bei Bedarf wächst der Song) */
  pasteBar(bar = this.cursorBar) {
    const c = this.clip;
    if (!c) return;
    this.edit((s) => {
      if (bar >= s.bars) s.bars = Math.min(16, bar + 1);
      const a = bar * STEPS_PER_BAR, b = a + STEPS_PER_BAR;
      const put = (notes: SongNote[], add: SongNote[]) => [...notes.filter((n) => n.step < a || n.step >= b), ...add.map((n) => ({ ...n, step: n.step + a }))];
      const hit = (x: number[], add: number[]) => [...x.filter((v) => v < a || v >= b), ...add.map((v) => v + a)];
      s.lead.notes = put(s.lead.notes, c.lead);
      s.bass.notes = put(s.bass.notes, c.bass);
      s.harmony.notes = put(s.harmony.notes, c.harmony);
      s.drums.kick = hit(s.drums.kick, c.kick);
      s.drums.snare = hit(s.drums.snare, c.snare);
      s.drums.hat = hit(s.drums.hat, c.hat);
    });
  }

  clearBar(bar = this.cursorBar) {
    const a = bar * STEPS_PER_BAR, b = a + STEPS_PER_BAR;
    this.edit((s) => {
      for (const id of ['lead', 'bass', 'harmony'] as const) s[id].notes = s[id].notes.filter((n) => n.step < a || n.step >= b);
      for (const k of ['kick', 'snare', 'hat'] as const) s.drums[k] = s.drums[k].filter((v) => v < a || v >= b);
    });
  }

  // ------------------------------------------------------------------ Einsingen

  setLive(live: Store['live']) {
    this.live = live;
    this.emit('ui');
  }
  setProposal(p: Proposal | null) {
    this.proposal = p;
    this.emit('ui');
  }
  /** Vorschlag übernehmen: ersetzt im Bereich die Noten des Zielkanals */
  acceptProposal() {
    const p = this.proposal;
    if (!p) return;
    this.edit((s) => {
      const ch = s[p.channel];
      ch.notes = [...ch.notes.filter((n) => n.step < p.fromStep || n.step >= p.toStep), ...p.notes];
    });
    this.proposal = null;
    this.live = null;
    this.emit('ui');
  }
}
