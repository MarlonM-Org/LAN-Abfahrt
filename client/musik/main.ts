/**
 * Musik-Werkstatt (/musik.html): Piano-Roll + Schlagzeug-Raster, Transport, Bibliothek,
 * MIDI-Import/Export, Einsingen und Zuordnung zu TV-Szenen. Gleicher Synth wie auf dem TV.
 */
import '@fontsource/press-start-2p/400.css';
import {
  ASSIGN_SCENES, type Assignment, CHANNELS, type ChannelId, MAX_BARS, NOTE_NAMES, STEPS_PER_BAR, STYLES, type Song, type SongInfo, WAVES,
  type SceneSource, emptySong, overrideIdFor, sceneSource, slugId, styleName, validateSong,
} from '../../shared/music';
import { BUILTIN_IDS } from '../../shared/musicBuiltin';
import { assignScene, deleteSong, getAssignment, getSong, listSongs, saveSong } from '../music/api';
import { songToMidi } from '../music/midi';
import { SongPlayer, Synth } from '../music/player';
import { DrumGrid } from './drumgrid';
import { Singer } from './einsingen';
import { openMidiImport } from './midiImport';
import { Overview, sceneList, sceneName, sceneRows, scenesPlaying } from './overview';
import { PianoRoll } from './pianoroll';
import { Store } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new Store();
let synth: Synth | null = null;
let player: SongPlayer | null = null;
let singer: Singer | null = null;
let library: SongInfo[] = [];
let assignment: Assignment = {};

/**
 * Woher kommt der Song im Editor? `scene`: aus welcher Szene der Übersicht man kam;
 * `mode`: 'copy' = neue Kopie (wird beim ersten Speichern der Szene zugeordnet),
 * 'direct' = vorhandenen Song bearbeiten, 'new' = leerer Song.
 */
interface EditCtx {
  scene: string | null;
  mode: 'copy' | 'direct' | 'new';
}
let ctx: EditCtx = { scene: null, mode: 'new' };
/** Hash, zu dem der Editor gerade gehört (für „ungespeichert – wirklich weg?“ beim Zurück) */
let shownHash = '';

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
bars.addEventListener('change', () => prop((s) => (s.bars = Math.max(1, Math.min(MAX_BARS, Math.round(Number(bars.value) || 4))))));
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
  if (asNew) {
    const name = window.prompt('Als neuer Song – Titel?', `${s.title} (Kopie)`);
    if (name === null) return false;
    store.edit((song) => {
      song.title = name.trim() || song.title;
      song.id = uniqueId(slugId(song.title));
      delete song.overrides;
    });
    if (asNew && ctx.scene) ctx.mode = 'copy';
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
    // Neue Kopie gleich der Szene zuordnen, aus der man kam
    if (ctx.mode !== 'direct' && ctx.scene) await assignScene(ctx.scene, saved.id);
    ctx.mode = 'direct';
    setHash(editHash(ctx.scene, saved.overrides ?? saved.id), true);
    await refreshLibrary();
    const where = scenesPlaying(saved.id, assignment, library);
    status(where.length ? `Gespeichert – läuft jetzt in ${sceneList(where, ctx.scene ?? undefined)}` : `Gespeichert: ${saved.title} (läuft noch nirgends)`, 'ok');
    render();
    return true;
  } catch (e) {
    status(`Speichern fehlgeschlagen: ${(e as Error).message}`, 'err');
    return false;
  }
}
/** Freie ID: „turbo-runde-kopie“, „turbo-runde-kopie-2“, … */
function uniqueId(base: string) {
  let id = base, n = 2;
  while (library.some((x) => x.id === id)) id = `${base.slice(0, 44)}-${n++}`;
  return id;
}
$('save').addEventListener('click', () => void save());
$('saveAs').addEventListener('click', () => void save(true));
/** Überschreibung löschen → der eingebaute Song läuft wieder überall, wo er vorher lief */
async function restoreOriginal(id: string) {
  const info = library.find((x) => x.id === id);
  const base = info?.overrides;
  if (!info || !base) return;
  if (!window.confirm(`Deine Änderungen an „${info.title}“ verwerfen und das Original wiederherstellen?`)) return;
  try {
    stopListening();
    await deleteSong(id);
    await refreshLibrary();
    const where = scenesPlaying(base, assignment, library);
    status(`Original wiederhergestellt${where.length ? ` – läuft wieder in ${sceneList(where, ctx.scene ?? undefined)}` : ''}`, 'ok');
    // Im Editor: frischer Entwurf vom Original
    if (!$('editorView').hidden && store.song.id === id) {
      const { song } = await loadForEdit(base);
      store.load(song, true);
    }
  } catch (e) {
    status((e as Error).message, 'err');
  }
}
$('restore').addEventListener('click', () => void restoreOriginal(store.song.id));

$('delete').addEventListener('click', async () => {
  const s = store.song;
  if (s.overrides) return void restoreOriginal(s.id);
  if (BUILTIN_IDS.has(s.id)) return status('Eingebaute Songs kann man nicht löschen', 'err');
  if (!library.some((x) => x.id === s.id)) return status('Dieser Song ist noch nicht gespeichert', 'err');
  if (!window.confirm(`„${s.title}“ wirklich löschen?`)) return;
  try {
    await deleteSong(s.id);
    status(`„${s.title}“ gelöscht`, 'ok');
    store.markSaved();
    go('');
  } catch (e) {
    status((e as Error).message, 'err');
  }
});

async function refreshLibrary() {
  [library, assignment] = await Promise.all([listSongs(), getAssignment()]);
  overview.songs = library;
  overview.assign = assignment;
  if (!$('overview').hidden) overview.render();
}
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
  ($('delete') as HTMLButtonElement).disabled = BUILTIN_IDS.has(s.id) || !library.some((x) => x.id === s.id);
  $('restore').hidden = !(s.overrides && library.some((x) => x.id === s.id));
  document.title = `${store.dirty ? '● ' : ''}${s.title} – Musik-Werkstatt`;
  renderCrumbs();
  $('chName').textContent = `· ${CHANNELS.find((c) => c.id === store.channel)?.name ?? ''}`;
  $<HTMLInputElement>('singBars').max = String(s.bars);
  $<HTMLInputElement>('singFrom').max = String(s.bars);
}

/** Brotkrumen „Kart-Rennen · Turbo-Runde (Kopie)“ + Etikett + wo der Song läuft */
function renderCrumbs() {
  const s = store.song;
  const row = ctx.scene ? sceneRows().find((r) => r.id === ctx.scene) : null;
  const crumb = $<HTMLAnchorElement>('crumbScene');
  crumb.textContent = row ? `${row.icon} ${row.name}` : 'Eigene Songs';
  $('crumbSong').textContent = s.title;
  const stored = library.some((x) => x.id === s.id);
  const tag = $('crumbTag');
  const [label, cls] = s.overrides
    ? [stored ? 'eingebaut · angepasst' : 'eingebaut', stored ? 'tag-override' : 'tag-builtin']
    : ctx.mode === 'copy' && !stored ? ['neue Kopie', 'tag-own'] : !stored ? ['neu', 'tag-own'] : ['eigen', 'tag-own'];
  tag.textContent = label;
  tag.className = `tag ${cls}`;
  $('dirty').hidden = !store.dirty;
  const where = stored ? scenesPlaying(s.id, assignment, library) : [];
  $('where').textContent = where.length
    ? `läuft in ${sceneList(where, ctx.scene ?? undefined)}`
    : !stored && ctx.scene && ctx.mode !== 'direct'
      ? `Speichern → läuft in ${sceneName(ctx.scene)}`
      : s.overrides && !stored && scenesPlaying(s.overrides, assignment, library).length
        ? `Speichern → läuft statt des Originals in ${sceneList(scenesPlaying(s.overrides, assignment, library), ctx.scene ?? undefined)}`
        : 'läuft noch nirgends – in der Übersicht zuordnen';
}
$('crumbScene').addEventListener('click', (e) => {
  e.preventDefault();
  $('back').click();
});

// Mehr-Menü (Einsingen, MIDI, Klang, Takt-Werkzeuge …) – Zustand pro Gerät merken
function setMore(open: boolean) {
  $('more').hidden = !open;
  $('moreBtn').textContent = open ? 'Mehr ▴' : 'Mehr ▾';
  $('moreBtn').setAttribute('aria-expanded', String(open));
  $('moreBtn').classList.toggle('on', open);
  try {
    localStorage.setItem('lan-abfahrt.werkstatt.mehr', open ? '1' : '0');
  } catch {
    /* egal */
  }
}
$('moreBtn').addEventListener('click', () => setMore($('more').hidden));
try {
  setMore(localStorage.getItem('lan-abfahrt.werkstatt.mehr') === '1');
} catch {
  setMore(false);
}

// Vor dem Verlassen warnen
window.addEventListener('beforeunload', (e) => {
  if (store.dirty) e.preventDefault();
});

// ------------------------------------------------------------------ Übersicht

let listening: HTMLButtonElement | null = null;
function stopListening() {
  if (listening) {
    listening.textContent = '▶';
    listening.classList.remove('on');
  }
  listening = null;
  player?.stop();
  updatePlayButton();
}
async function listen(id: string, btn: HTMLButtonElement, note = '') {
  const { player } = audio();
  if (listening === btn && player.playing) return stopListening();
  stopListening();
  try {
    player.play(await getSong(id), { loop: true });
  } catch (e) {
    return status((e as Error).message, 'err');
  }
  listening = btn;
  btn.textContent = '■';
  btn.classList.add('on');
  status(`♪ ${library.find((x) => x.id === id)?.title ?? id}${note}`);
}

const overview = new Overview($('ovList'), $('ovOwn'), {
  listen(_scene, src: SceneSource, btn) {
    if (src.kind === 'song') void listen(src.id, btn);
    else if (src.kind === 'style') {
      const id = src.ids[Math.floor(Math.random() * src.ids.length)];
      void listen(id, btn, ` – einer von ${src.ids.length} im Stil ${styleName(src.style)}`);
    }
  },
  listenSong: (id, btn) => void listen(id, btn),
  async assign(scene, value) {
    stopListening();
    try {
      assignment = await assignScene(scene, value);
      overview.assign = assignment;
      overview.render();
      flashRow(scene);
      const now = value === null ? 'eingebaut' : value === 'none' ? 'Stille' : value.startsWith('style:') ? `Stil ${styleName(value.slice(6))}` : `„${library.find((x) => x.id === value)?.title ?? value}“`;
      status(`${sceneName(scene)}: jetzt ${now}`, 'ok');
    } catch (e) {
      status((e as Error).message, 'err');
    }
  },
  copy: (scene) => go(`szene=${scene}&kopie=1`),
  edit(scene) {
    const src = sceneSource(scene, assignment, library);
    if (src.kind === 'song') go(editHash(scene, library.find((x) => x.id === src.id)?.overrides ?? src.id));
  },
  editSong: (id) => go(editHash(null, library.find((x) => x.id === id)?.overrides ?? id)),
  restore: (id) => void restoreOriginal(id),
  async deleteSong(id) {
    const s = library.find((x) => x.id === id);
    if (!s || !window.confirm(`„${s.title}“ wirklich löschen?`)) return;
    stopListening();
    try {
      await deleteSong(id);
      await refreshLibrary();
      status('Gelöscht', 'ok');
    } catch (e) {
      status((e as Error).message, 'err');
    }
  },
  filter(text) {
    $<HTMLInputElement>('ovSearch').value = text;
    overview.query = text;
    overview.render();
  },
});
$<HTMLInputElement>('ovSearch').addEventListener('input', (e) => {
  overview.query = (e.target as HTMLInputElement).value;
  overview.render();
});
$('ovNew').addEventListener('click', () => go('neu'));
function flashRow(scene: string) {
  document.querySelector<HTMLElement>(`.ov-row[data-scene="${scene}"]`)?.classList.add('flash');
}

// ------------------------------------------------------------------ Navigation (#szene=…&song=…)

const editHash = (scene: string | null, id: string) => (scene ? `szene=${scene}&song=${id}` : `song=${id}`);
function setHash(h: string, replace = false) {
  shownHash = h;
  if (replace) history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
  else location.hash = h;
}
/** Zu einem Ziel wechseln (Hash ändern → `route()` erledigt den Rest) */
function go(h: string) {
  if (h === location.hash.slice(1)) void route();
  else location.hash = h;
}
$('back').addEventListener('click', () => {
  if (store.dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return;
  store.markSaved();
  go('');
});

function showOverview() {
  $('editorView').hidden = true;
  $('overview').hidden = false;
  document.title = 'Musik-Werkstatt – Wo läuft was?';
  shownHash = '';
  void refreshLibrary();
}
function showEditor(song: Song, saved: boolean, c: EditCtx) {
  ctx = c;
  store.load(song, saved);
  $('overview').hidden = true;
  $('editorView').hidden = false;
  render();
  roll.scrollToMidi(70);
}

/**
 * Song zum direkten Bearbeiten: eigene Songs wie sie sind; eingebaute als Überschreibung
 * (vorhandene laden, sonst Entwurf mit `overrides` – der TV nimmt ihn nach dem Speichern statt des Originals).
 */
async function loadForEdit(id: string): Promise<{ song: Song; saved: boolean }> {
  if (!BUILTIN_IDS.has(id)) return { song: await getSong(id), saved: true };
  const ov = library.find((x) => x.overrides === id);
  if (ov) return { song: await getSong(ov.id), saved: true };
  const song = await getSong(id);
  song.id = overrideIdFor(id);
  song.overrides = id;
  delete song.updated;
  return { song, saved: true };
}

/** Kopie des Songs, der in der Szene läuft – mit freiem Namen „<Titel> (Kopie)“ */
async function makeCopy(scene: string): Promise<Song | null> {
  const src = sceneSource(scene, assignment, library);
  if (src.kind !== 'song') return null;
  const base = await getSong(src.id);
  const song = structuredClone(base);
  const plain = base.title.replace(/ \(Kopie( \d+)?\)$/, '');
  let title = `${plain} (Kopie)`.slice(0, 60);
  for (let n = 2; library.some((x) => x.title === title); n++) title = `${plain} (Kopie ${n})`.slice(0, 60);
  song.title = title;
  song.id = uniqueId(slugId(title));
  delete song.updated;
  delete song.overrides;
  return song;
}

async function route() {
  const h = location.hash.slice(1);
  // Editor offen mit ungespeicherten Änderungen → erst fragen
  if (!$('editorView').hidden && h !== shownHash && store.dirty) {
    if (!window.confirm('Ungespeicherte Änderungen verwerfen?')) {
      history.replaceState(null, '', shownHash ? `#${shownHash}` : location.pathname);
      return;
    }
    store.markSaved();
  }
  stopListening();
  const p = new URLSearchParams(h);
  const legacy = new URLSearchParams(location.search).get('song');
  shownHash = h;
  const scene = p.get('szene');
  if (scene && !ASSIGN_SCENES.some((x) => x.id === scene)) return go('');
  try {
    if (scene && p.get('kopie')) {
      const song = await makeCopy(scene);
      if (!song) return go('');
      showEditor(song, false, { scene, mode: 'copy' });
      status(`Kopie angelegt – nach dem Speichern läuft sie in ${sceneName(scene)}`);
    } else if (p.get('song') || (!h && legacy)) {
      const { song, saved } = await loadForEdit(p.get('song') ?? legacy!);
      showEditor(song, saved, { scene, mode: 'direct' });
      if (song.overrides && !library.some((x) => x.id === song.id)) status('Eingebauter Song: Speichern ersetzt das Original überall – zurück geht’s mit „Original wiederherstellen“.');
    } else if (p.has('neu')) {
      const s = emptySong(uniqueId(`song-${Date.now().toString(36)}`), 'Neuer Song');
      // Startpunkt: ein einfacher Beat, damit sofort etwas zu hören ist
      s.drums.kick = [0, 8, 16, 24, 32, 40, 48, 56];
      s.drums.snare = [4, 12, 20, 28, 36, 44, 52, 60];
      s.drums.hat = Array.from({ length: 32 }, (_, i) => i * 2 + 1);
      showEditor(s, false, { scene, mode: 'new' });
    } else showOverview();
  } catch (e) {
    status(`Nicht gefunden: ${(e as Error).message}`, 'err');
    showOverview();
  }
}
window.addEventListener('hashchange', () => void route());

// ------------------------------------------------------------------ Start

async function start() {
  await Promise.race([document.fonts.load('8px "Press Start 2P"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
  await refreshLibrary();
  await route();
  // Ersten Klick/Taste zum Freischalten des Tons nutzen
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
void start();

// Für Tests/Debugging in der Konsole
(window as unknown as { __musik: unknown }).__musik = { store, get player() { return player; }, get singer() { return singer; } };
