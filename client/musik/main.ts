/**
 * Musik-Werkstatt (/musik.html): Piano-Roll + Schlagzeug-Raster, Transport, Bibliothek,
 * MIDI-Import/Export, Einsingen und Zuordnung zu TV-Szenen. Gleicher Synth wie auf dem TV.
 */
import '@fontsource/press-start-2p/400.css';
import {
  ASSIGN_SCENES, CHANNELS, type ChannelId, NOTE_NAMES, STEPS_PER_BAR, STYLES, type Song, type SongInfo, WAVES,
  emptySong, slugId, validateSong,
} from '../../shared/music';
import { BUILTIN_IDS } from '../../shared/musicBuiltin';
import { assignScene, deleteSong, getSong, listSongs, saveSong } from '../music/api';
import { songToMidi } from '../music/midi';
import { SongPlayer, Synth } from '../music/player';
import { DrumGrid } from './drumgrid';
import { Singer } from './einsingen';
import { openMidiImport } from './midiImport';
import { PianoRoll } from './pianoroll';
import { Store } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new Store();
let synth: Synth | null = null;
let player: SongPlayer | null = null;
let singer: Singer | null = null;
let library: SongInfo[] = [];
let libFilter: string | null = null;

/** AudioContext erst nach einer Nutzeraktion anlegen */
function audio() {
  if (!synth) {
    synth = new Synth();
    synth.setMasterVolume(Number(($('master') as HTMLInputElement).value));
    player = new SongPlayer(synth);
    singer = new Singer(store, synth, player);
    singer.onPhase = onSingPhase;
  }
  synth.resume();
  return { synth, player: player!, singer: singer! };
}

// ------------------------------------------------------------------ Status

let statusTimer: number | undefined;
function status(msg: string, kind: 'ok' | 'err' | '' = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
  clearTimeout(statusTimer);
  if (kind !== 'err') statusTimer = window.setTimeout(() => (el.textContent = ''), 4000);
}

// ------------------------------------------------------------------ Editor-Flächen

const roll = new PianoRoll(
  store,
  (midi) => audio().synth.preview(midi, store.song[store.channel]),
  (bar) => {
    store.cursorBar = bar;
    store.touch();
  },
);
$('roll').append(roll.wrap);
const drums = new DrumGrid(store, (row) => {
  const { synth } = audio();
  const t = synth.now;
  if (row === 'kick') synth.kick(t);
  else if (row === 'snare') synth.snare(t);
  else synth.hat(t);
});
$('drums').append(drums.wrap);
// Horizontal gemeinsam scrollen
roll.wrap.addEventListener('scroll', () => (drums.wrap.scrollLeft = roll.wrap.scrollLeft));
drums.wrap.addEventListener('scroll', () => (roll.wrap.scrollLeft = drums.wrap.scrollLeft));

// ------------------------------------------------------------------ Kopf & Transport

const title = $<HTMLInputElement>('title');
const author = $<HTMLInputElement>('author');
const styleSel = $<HTMLSelectElement>('style');
const keyRoot = $<HTMLSelectElement>('keyRoot');
const keyMode = $<HTMLSelectElement>('keyMode');
const bpm = $<HTMLInputElement>('bpm');
const swing = $<HTMLInputElement>('swing');
const bars = $<HTMLInputElement>('bars');
const loop = $<HTMLInputElement>('loop');
const snap = $<HTMLInputElement>('snap');
const master = $<HTMLInputElement>('master');
const wave = $<HTMLSelectElement>('wave');
const chVol = $<HTMLInputElement>('chVol');
const env = $<HTMLSelectElement>('env');
const chMute = $<HTMLInputElement>('chMute');
const drumVol = $<HTMLInputElement>('drumVol');
const drumMute = $<HTMLInputElement>('drumMute');

for (const s of STYLES) styleSel.append(new Option(s.name, s.id));
NOTE_NAMES.forEach((n, i) => keyRoot.append(new Option(n, String(i))));
for (const w of WAVES) wave.append(new Option(w.name, w.id));
for (const sc of ASSIGN_SCENES) $<HTMLSelectElement>('assignScene').append(new Option(sc.name, sc.id));
master.value = localStorage.getItem('lan-abfahrt.werkstatt.volume') ?? '0.8';

/** Kleine Änderung an Song-Eigenschaften (kein eigener Undo-Schritt für jedes Zeichen im Titel) */
const prop = (fn: (s: Song) => void) => store.edit(fn);
title.addEventListener('change', () => prop((s) => (s.title = title.value.trim() || 'Neuer Song')));
author.addEventListener('change', () => prop((s) => (s.author = author.value.trim())));
styleSel.addEventListener('change', () => prop((s) => (s.style = styleSel.value as Song['style'])));
keyRoot.addEventListener('change', () => prop((s) => (s.key.root = Number(keyRoot.value))));
keyMode.addEventListener('change', () => prop((s) => (s.key.minor = keyMode.value === '1')));
bpm.addEventListener('change', () => prop((s) => (s.bpm = Math.max(40, Math.min(260, Math.round(Number(bpm.value) || 120))))));
swing.addEventListener('input', () => {
  $('swingVal').textContent = `${Math.round(Number(swing.value) * 100)} %`;
});
swing.addEventListener('change', () => prop((s) => (s.swing = Number(swing.value))));
bars.addEventListener('change', () => prop((s) => (s.bars = Math.max(1, Math.min(16, Math.round(Number(bars.value) || 4))))));
snap.addEventListener('change', () => (store.snapScale = snap.checked));
master.addEventListener('input', () => {
  localStorage.setItem('lan-abfahrt.werkstatt.volume', master.value);
  synth?.setMasterVolume(Number(master.value));
});
wave.addEventListener('change', () => prop((s) => (s[store.channel].wave = wave.value as Song['lead']['wave'])));
chVol.addEventListener('change', () => prop((s) => (s[store.channel].volume = Number(chVol.value))));
env.addEventListener('change', () => prop((s) => (s[store.channel].env = env.value as 'hold' | 'pluck')));
chMute.addEventListener('change', () => {
  store.mute[store.channel] = chMute.checked;
  store.touch();
});
drumVol.addEventListener('change', () => prop((s) => (s.drums.volume = Number(drumVol.value))));
drumMute.addEventListener('change', () => {
  store.mute.drums = drumMute.checked;
  store.touch();
});

// Kanal-Tabs
const tabs = $('tabs');
const TAB_COLORS: Record<ChannelId, string> = { lead: '#e8613c', bass: '#3f8fe0', harmony: '#5fa437' };
for (const c of CHANNELS) {
  const b = document.createElement('button');
  b.className = 'tab';
  b.dataset.ch = c.id;
  b.textContent = c.name;
  b.style.setProperty('--tab', TAB_COLORS[c.id]);
  b.addEventListener('click', () => {
    store.setChannel(c.id);
    roll.scrollToMidi(c.id === 'bass' ? 45 : 70);
  });
  tabs.append(b);
}

// Transport
function togglePlay() {
  const { player } = audio();
  if (singer?.active) return;
  if (player.playing) {
    player.stop();
  } else {
    player.play(store.song, { loop: loop.checked, from: store.cursorBar * STEPS_PER_BAR, mute: store.mute, onEnd: () => updatePlayButton() });
  }
  updatePlayButton();
}
function updatePlayButton() {
  const p = player?.playing ?? false;
  $('play').textContent = p ? '❚❚ Pause' : '▶ Play';
  $('play').classList.toggle('on', p);
}
$('play').addEventListener('click', togglePlay);
$('stop').addEventListener('click', () => {
  player?.stop();
  updatePlayButton();
});
$('undo').addEventListener('click', () => store.undo());
$('redo').addEventListener('click', () => store.redo());
$('copyBar').addEventListener('click', () => {
  store.copyBar();
  status(`Takt ${store.cursorBar + 1} kopiert`, 'ok');
});
$('pasteBar').addEventListener('click', () => store.pasteBar());
$('clearBar').addEventListener('click', () => store.clearBar());

// Abspielkopf
function tick() {
  const step = player?.playing ? player.currentStep() : -1;
  roll.setPlayhead(step);
  drums.setPlayhead(step);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Live-Änderungen während des Abspielens übernehmen
store.on((what) => {
  if (what === 'song' && player?.playing) player.setSong(store.song);
  render();
});

// ------------------------------------------------------------------ Tastatur

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (e.key === ' ' && !typing) {
    e.preventDefault();
    togglePlay();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    e.preventDefault();
    store.deleteSelection();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
    e.preventDefault();
    store.redo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !typing) {
    e.preventDefault();
    store.copyBar();
    status(`Takt ${store.cursorBar + 1} kopiert`, 'ok');
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing) {
    e.preventDefault();
    store.pasteBar();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save();
  } else if (e.key === 'Escape') {
    $('libraryDlg').hidden = true;
    document.querySelector('.menu')?.remove();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && e.altKey) {
    e.preventDefault();
    store.cursorBar = Math.max(0, Math.min(store.song.bars - 1, store.cursorBar + (e.key === 'ArrowRight' ? 1 : -1)));
    store.touch();
  }
});

// ------------------------------------------------------------------ Speichern / Laden

async function save(asNew = false): Promise<boolean> {
  const s = store.song;
  if (asNew || BUILTIN_IDS.has(s.id)) {
    const name = window.prompt('Unter welchem Titel speichern?', BUILTIN_IDS.has(s.id) ? `${s.title} (meins)` : s.title);
    if (name === null) return false;
    store.edit((song) => {
      song.title = name.trim() || song.title;
      song.id = slugId(song.title);
    });
  }
  const v = validateSong(store.song);
  if (!v.ok) {
    status(v.error, 'err');
    return false;
  }
  try {
    const saved = await saveSong(v.song);
    store.song.updated = saved.updated;
    store.markSaved();
    status(`Gespeichert: ${saved.title}`, 'ok');
    await refreshLibrary();
    return true;
  } catch (e) {
    status(`Speichern fehlgeschlagen: ${(e as Error).message}`, 'err');
    return false;
  }
}
$('save').addEventListener('click', () => void save());
$('saveAs').addEventListener('click', () => void save(true));
$('new').addEventListener('click', () => {
  if (store.dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
  const s = emptySong(`song-${Date.now().toString(36)}`, 'Neuer Song');
  s.author = author.value;
  store.load(s, false);
  status('Neuer Song', 'ok');
});
$('delete').addEventListener('click', async () => {
  const s = store.song;
  if (BUILTIN_IDS.has(s.id)) return status('Eingebaute Songs kann man nicht löschen', 'err');
  if (!library.some((x) => x.id === s.id)) return status('Dieser Song ist noch nicht gespeichert', 'err');
  if (!window.confirm(`„${s.title}“ wirklich löschen?`)) return;
  try {
    await deleteSong(s.id);
    status('Gelöscht', 'ok');
    await refreshLibrary();
    store.load(emptySong(`song-${Date.now().toString(36)}`), false);
  } catch (e) {
    status((e as Error).message, 'err');
  }
});

async function refreshLibrary() {
  library = await listSongs();
  renderLibrary();
}
async function loadFromLibrary(id: string) {
  if (store.dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
  try {
    const song = await getSong(id);
    store.load(song, true);
    $('libraryDlg').hidden = true;
    status(`Geladen: ${song.title}${BUILTIN_IDS.has(id) ? ' (eingebaut – zum Speichern bekommt er einen neuen Namen)' : ''}`, 'ok');
    roll.scrollToMidi(70);
  } catch (e) {
    status((e as Error).message, 'err');
  }
}
function renderLibrary() {
  const chips = $('libChips');
  chips.replaceChildren();
  const chip = (label: string, id: string | null) => {
    const c = document.createElement('span');
    c.className = `chip ${libFilter === id ? 'on' : ''}`;
    c.textContent = label;
    c.addEventListener('click', () => {
      libFilter = id;
      renderLibrary();
    });
    chips.append(c);
  };
  chip('Alle', null);
  for (const s of STYLES) chip(s.name, s.id);
  const list = $('libList');
  list.replaceChildren();
  for (const s of library.filter((x) => !libFilter || x.style === libFilter)) {
    const st = STYLES.find((x) => x.id === s.style);
    const item = document.createElement('div');
    item.className = 'lib-item';
    const info = document.createElement('div');
    info.innerHTML = `<span class="t"></span><span class="badge"></span><div class="s"></div>`;
    (info.querySelector('.t') as HTMLElement).textContent = s.title;
    const badge = info.querySelector('.badge') as HTMLElement;
    badge.textContent = st?.name ?? s.style;
    badge.style.background = st?.color ?? '#7a5a3a';
    (info.querySelector('.s') as HTMLElement).textContent = `${s.bpm} BPM · ${s.bars} Takte${s.builtin ? ' · eingebaut' : s.author ? ` · von ${s.author}` : ''}`;
    const hear = document.createElement('button');
    hear.className = 'btn';
    hear.textContent = '▶';
    hear.title = 'Anhören';
    hear.addEventListener('click', async () => {
      const { player } = audio();
      if (player.playing && player.current?.id === s.id) {
        player.stop();
        hear.textContent = '▶';
        return;
      }
      player.play(await getSong(s.id), { loop: true });
      list.querySelectorAll('button').forEach((b) => b.textContent === '■' && (b.textContent = '▶'));
      hear.textContent = '■';
    });
    const load = document.createElement('button');
    load.className = 'btn primary';
    load.textContent = 'Laden';
    load.addEventListener('click', () => {
      player?.stop();
      updatePlayButton();
      void loadFromLibrary(s.id);
    });
    item.append(info, hear, load);
    list.append(item);
  }
}
$('library').addEventListener('click', () => {
  $('libraryDlg').hidden = false;
  void refreshLibrary();
});
$('libClose').addEventListener('click', () => {
  $('libraryDlg').hidden = true;
  player?.stop();
  updatePlayButton();
});
$('libraryDlg').addEventListener('click', (e) => {
  if (e.target === $('libraryDlg')) $('libClose').click();
});

// ------------------------------------------------------------------ MIDI & Export

$('midiBtn').addEventListener('click', () => $('midiFile').click());
$<HTMLInputElement>('midiFile').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  openMidiImport(
    f,
    { ...structuredClone(store.song), title: store.song.title === 'Neuer Song' ? f.name.replace(/\.midi?$/i, '') : store.song.title },
    (song, notes) => {
      store.edit((s) => Object.assign(s, song));
      status(['MIDI importiert.', ...notes].join(' '), notes.length ? '' : 'ok');
      roll.scrollToMidi(70);
    },
    (msg) => status(msg, 'err'),
  );
});
function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('export').addEventListener('click', (e) => {
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu';
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  m.style.left = `${r.left}px`;
  m.style.top = `${r.bottom + 4}px`;
  const item = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      m.remove();
      fn();
    });
    m.append(b);
  };
  item('Als JSON (Song-Format v2)', () => download(`${store.song.id}.json`, JSON.stringify(store.song, null, 2), 'application/json'));
  item('Als MIDI (.mid)', () => download(`${store.song.id}.mid`, songToMidi(store.song), 'audio/midi'));
  document.body.append(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
});

// ------------------------------------------------------------------ Einsingen

const singStart = $<HTMLButtonElement>('singStart');
const singStop = $<HTMLButtonElement>('singStop');
const singInfo = $('singInfo');
function onSingPhase(p: 'idle' | 'countin' | 'recording' | 'done', info?: string) {
  singStart.hidden = p === 'countin' || p === 'recording';
  singStop.hidden = !(p === 'countin' || p === 'recording');
  singStart.classList.toggle('rec', false);
  $('proposalRow').hidden = p !== 'done' || !store.proposal?.notes.length;
  singInfo.textContent =
    info ?? (p === 'countin' ? 'Einzähler … 1 – 2 – 3 – 4' : p === 'recording' ? 'Aufnahme läuft – singen!' : p === 'done' ? 'Fertig.' : 'Singe oder summe die Melodie – sie landet als Noten im Zielkanal.');
  if (p === 'idle' || p === 'done') updatePlayButton();
}
singStart.addEventListener('click', () => {
  if (!navigator.mediaDevices?.getUserMedia) return status('Kein Mikrofonzugriff – Seite über http://localhost oder HTTPS öffnen', 'err');
  const { singer, player } = audio();
  player.stop();
  const fromBar = Math.max(1, Math.min(store.song.bars, Number($<HTMLInputElement>('singFrom').value) || 1)) - 1;
  const n = Math.max(1, Math.min(store.song.bars - fromBar, Number($<HTMLInputElement>('singBars').value) || 1));
  const channel = $<HTMLSelectElement>('singChannel').value as ChannelId;
  store.setChannel(channel);
  void singer.start({
    channel,
    fromBar,
    bars: n,
    countIn: $<HTMLInputElement>('singCount').checked,
    click: $<HTMLInputElement>('singClick').checked,
    backing: $<HTMLInputElement>('singBacking').checked,
    snapScale: $<HTMLInputElement>('singSnap').checked,
  });
});
singStop.addEventListener('click', () => void singer?.finish());
$('accept').addEventListener('click', () => {
  store.acceptProposal();
  $('proposalRow').hidden = true;
  singInfo.textContent = 'Übernommen – Noten lassen sich jetzt wie alle anderen bearbeiten.';
});
$('reject').addEventListener('click', () => {
  store.setProposal(null);
  store.setLive(null);
  $('proposalRow').hidden = true;
  singInfo.textContent = 'Verworfen.';
});
store.on(() => {
  // Takt-Cursor als Vorschlag fürs „Ab Takt“, solange nicht aufgenommen wird
  if (!singer?.active && document.activeElement !== $('singFrom')) $<HTMLInputElement>('singFrom').value = String(store.cursorBar + 1);
});

// ------------------------------------------------------------------ Zuordnung

$('assignBtn').addEventListener('click', async () => {
  if (!(await save())) return;
  const scene = $<HTMLSelectElement>('assignScene').value;
  try {
    await assignScene(scene, store.song.id);
    status(`„${store.song.title}“ läuft jetzt bei: ${ASSIGN_SCENES.find((s) => s.id === scene)?.name}`, 'ok');
  } catch (e) {
    status((e as Error).message, 'err');
  }
});

// ------------------------------------------------------------------ Anzeige aktualisieren

function render() {
  const s = store.song;
  if (document.activeElement !== title) title.value = s.title;
  if (document.activeElement !== author) author.value = s.author;
  styleSel.value = s.style;
  keyRoot.value = String(s.key.root);
  keyMode.value = s.key.minor ? '1' : '0';
  if (document.activeElement !== bpm) bpm.value = String(s.bpm);
  swing.value = String(s.swing);
  $('swingVal').textContent = `${Math.round(s.swing * 100)} %`;
  if (document.activeElement !== bars) bars.value = String(s.bars);
  const ch = s[store.channel];
  wave.value = ch.wave;
  chVol.value = String(ch.volume);
  env.value = ch.env;
  chMute.checked = !!store.mute[store.channel];
  drumVol.value = String(s.drums.volume);
  drumMute.checked = !!store.mute.drums;
  tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('on', t.dataset.ch === store.channel));
  $('cursorBar').textContent = String(store.cursorBar + 1);
  ($('undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !store.canRedo;
  ($('pasteBar') as HTMLButtonElement).disabled = !store.hasClip;
  ($('delete') as HTMLButtonElement).disabled = BUILTIN_IDS.has(s.id);
  document.title = `${store.dirty ? '● ' : ''}${s.title} – Musik-Werkstatt`;
  $<HTMLInputElement>('singBars').max = String(s.bars);
  $<HTMLInputElement>('singFrom').max = String(s.bars);
}

// Vor dem Verlassen warnen
window.addEventListener('beforeunload', (e) => {
  if (store.dirty) e.preventDefault();
});

// ------------------------------------------------------------------ Start

async function start() {
  await Promise.race([document.fonts.load('8px "Press Start 2P"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
  const params = new URLSearchParams(location.search);
  const id = params.get('song');
  await refreshLibrary();
  if (id) {
    try {
      store.load(await getSong(id), true);
    } catch {
      status('Song nicht gefunden', 'err');
    }
  } else {
    const s = emptySong(`song-${Date.now().toString(36)}`, 'Neuer Song');
    // Startpunkt: ein einfacher Beat, damit sofort etwas zu hören ist
    s.drums.kick = [0, 8, 16, 24, 32, 40, 48, 56];
    s.drums.snare = [4, 12, 20, 28, 36, 44, 52, 60];
    s.drums.hat = Array.from({ length: 32 }, (_, i) => i * 2 + 1);
    store.load(s, false);
  }
  render();
  roll.scrollToMidi(70);
  // Ersten Klick/Taste zum Freischalten des Tons nutzen
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
void start();

// Für Tests/Debugging in der Konsole
(window as unknown as { __musik: unknown }).__musik = { store, get player() { return player; }, get singer() { return singer; } };
