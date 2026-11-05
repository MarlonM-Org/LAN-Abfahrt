/**
 * MIDI-Import-Dialog: Datei lesen, Stimmen anzeigen, je Kanal (Melodie/Bass/Begleitung/Schlagzeug)
 * eine Stimme wählen, dann in den aktuellen Song übernehmen (Tempo + Takte kommen aus der Datei).
 */
import { MAX_BARS, type Song } from '../../shared/music';
import { type MidiFile, midiToSong, parseMidi } from '../music/midi';
import { noteName } from '../../shared/music';

export function openMidiImport(file: File, base: Song, onDone: (song: Song, notes: string[]) => void, onError: (msg: string) => void) {
  file.arrayBuffer().then((buf) => {
    let midi: MidiFile;
    try {
      midi = parseMidi(buf);
    } catch (e) {
      onError(`MIDI-Import: ${(e as Error).message}`);
      return;
    }
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    const guess = (pred: (p: MidiFile['parts'][number], i: number) => boolean) => {
      const i = midi.parts.findIndex(pred);
      return i >= 0 ? i : null;
    };
    const drums = guess((p) => p.drums);
    const melodic = midi.parts.map((p, i) => ({ p, i })).filter(({ p }) => !p.drums);
    const avg = (i: number) => {
      const n = midi.parts[i].notes;
      return n.reduce((a, x) => a + x.midi, 0) / Math.max(1, n.length);
    };
    const sorted = [...melodic].sort((a, b) => avg(b.i) - avg(a.i));
    const lead = sorted[0]?.i ?? null;
    const bass = sorted.length > 1 ? sorted[sorted.length - 1].i : null;
    const harmony = sorted.length > 2 ? sorted[1].i : null;
    const sel = (label: string, value: number | null, onlyDrums = false) => {
      const s = document.createElement('select');
      s.append(new Option('– leer lassen –', ''));
      midi.parts.forEach((p, i) => {
        if (onlyDrums && !p.drums && midi.parts.some((x) => x.drums)) return;
        const n = p.notes;
        const range = n.length ? `${noteName(Math.min(...n.map((x) => x.midi)))}–${noteName(Math.max(...n.map((x) => x.midi)))}` : '';
        s.append(new Option(`${p.name} · ${n.length} Noten${p.drums ? '' : ` · ${range}`}`, String(i)));
      });
      s.value = value === null ? '' : String(value);
      const row = document.createElement('label');
      row.className = 'row';
      row.append(label, s);
      return { row, s };
    };
    const L = sel('Melodie', lead), B = sel('Bass', bass), H = sel('Begleitung', harmony), D = sel('Schlagzeug', drums, true);
    const info = document.createElement('p');
    info.className = 'hint';
    info.textContent = `${file.name}: Format ${midi.format}, ${midi.parts.length} Stimme(n), ${midi.bpm} BPM, ${midi.ticksPerBeat} Ticks/Viertel, ${midi.timeSig.num}/${midi.timeSig.den}. Noten werden auf Sechzehntel gerundet, höchstens ${MAX_BARS} Takte.`;
    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.textContent = 'Importieren';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Abbrechen';
    const box = document.createElement('div');
    box.className = 'modal';
    const h = document.createElement('h2');
    h.textContent = 'MIDI importieren';
    const actions = document.createElement('div');
    actions.className = 'row end';
    actions.append(cancel, ok);
    box.append(h, info, L.row, B.row, H.row, D.row, actions);
    dlg.append(box);
    document.body.append(dlg);
    const close = () => dlg.remove();
    cancel.addEventListener('click', close);
    dlg.addEventListener('click', (e) => e.target === dlg && close());
    ok.addEventListener('click', () => {
      const v = (s: HTMLSelectElement) => (s.value === '' ? null : Number(s.value));
      try {
        const r = midiToSong(midi, { lead: v(L.s), bass: v(B.s), harmony: v(H.s), drums: v(D.s) }, base);
        close();
        onDone(r.song, r.notes);
      } catch (e) {
        onError((e as Error).message);
      }
    });
  }, () => onError('Datei konnte nicht gelesen werden'));
}
