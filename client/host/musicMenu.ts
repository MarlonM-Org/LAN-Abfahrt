/**
 * „♪ Musik“-Menü auf dem TV: Lautstärke/Stumm, Bibliothek mit Vorhören, Szenen-Zuordnung
 * und Sprung in die Musik-Werkstatt. Eigenständiges DOM-Overlay (eigener Container, Taste M),
 * damit es sich nicht mit anderen TV-Overlays in die Quere kommt.
 */
import { ASSIGN_SCENES, STYLES, styleName } from '../../shared/music';
import { assignScene } from '../music/api';
import {
  getAssign, getCurrentSongId, getFxVolume, getMusicVolume, getScene, getSongs, getVolume, isMuted, isPreviewing,
  onMusicChange, previewSong, setFxVolume, setMusicVolume, setMuted, setVolume, stopPreview, unlockMusic,
} from './music';
import { isSpeechOn, say, setSpeechOn, speechSupported } from './speech';
import { sfx } from './sfx';

const CSS = `
#musik-menu-root { position: fixed; inset: 0; pointer-events: none; z-index: 40; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
#musik-menu-root * { box-sizing: border-box; }
#musik-btn { pointer-events: auto; position: absolute; left: 2vh; bottom: 2vh; padding: 1.1vh 1.6vh; font: 1.4vh 'Press Start 2P', monospace; color: #3d2414; background: #f7e4b5; border: 0.4vh solid #8d5629; box-shadow: 0 0 0 0.3vh #2d1b12, 0.4vh 0.4vh 0 0.3vh #2d1b12; cursor: pointer; }
#musik-btn:hover { background: #fff6dc; }
#musik-btn.hidden { display: none; }
#musik-overlay { pointer-events: auto; position: absolute; inset: 0; background: rgba(45, 27, 18, 0.72); display: flex; align-items: center; justify-content: center; }
#musik-overlay.hidden { display: none; }
#musik-panel { width: min(92vw, 1100px); max-height: 92vh; display: flex; flex-direction: column; background: #f7e4b5; color: #3d2414; border: 0.6vh solid #8d5629; box-shadow: 0 0 0 0.4vh #2d1b12, 0 1vh 0 0.4vh #2d1b12; font-size: 15px; line-height: 1.5; }
#musik-panel h2, #musik-panel h3 { font-family: 'Press Start 2P', monospace; font-weight: normal; margin: 0; }
#musik-panel h2 { font-size: 16px; padding: 14px 18px; background: #b8783f; color: #fff6dc; text-shadow: 2px 2px #5e3518; display: flex; justify-content: space-between; align-items: center; }
#musik-panel h2 button { font: 12px 'Press Start 2P', monospace; background: #f7e4b5; color: #3d2414; border: 3px solid #5e3518; padding: 6px 10px; cursor: pointer; }
#musik-panel h3 { font-size: 11px; color: #7a5a3a; margin-bottom: 8px; }
#musik-body { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 18px; overflow: auto; }
.mm-box { background: #fff6dc; border: 3px solid #d39a5c; padding: 12px; }
.mm-box.wide { grid-column: 1 / -1; }
.mm-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap; }
.mm-row label { min-width: 150px; }
.mm-row input[type=range] { flex: 1; accent-color: #a8342a; min-width: 120px; }
.mm-val { width: 48px; text-align: right; color: #7a5a3a; }
.mm-btn { font: 11px 'Press Start 2P', monospace; background: #f0b13a; color: #3d2414; border: 3px solid #8d5629; padding: 7px 10px; cursor: pointer; box-shadow: 2px 2px 0 #2d1b12; }
.mm-btn:hover { background: #f7c75a; }
.mm-btn.on { background: #a8342a; color: #fff6dc; }
.mm-btn.small { font-size: 9px; padding: 5px 8px; }
.mm-btn.quiet { background: #e6c88a; }
.mm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.mm-chip { font-size: 13px; padding: 2px 10px; border: 2px solid #8d5629; background: #f7e4b5; cursor: pointer; border-radius: 2px; }
.mm-chip.on { background: #3d2414; color: #fff6dc; }
.mm-list { max-height: 34vh; overflow: auto; border: 2px solid #d39a5c; background: #f7e4b5; }
.mm-song { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #e6c88a; }
.mm-song.playing { background: #ffe9a6; }
.mm-song .t { font-weight: bold; }
.mm-song .s { font-size: 12px; color: #7a5a3a; }
.mm-badge { display: inline-block; font-size: 11px; color: #fff6dc; padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
.mm-assign { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 14px; max-height: 30vh; overflow: auto; }
.mm-assign label { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: 13px; }
.mm-assign select { font: 13px ui-monospace, monospace; max-width: 55%; background: #fff6dc; border: 2px solid #8d5629; padding: 2px 4px; color: #3d2414; }
.mm-now { font-size: 13px; color: #7a5a3a; }
.mm-foot { padding: 10px 18px 16px; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; font-size: 12px; color: #7a5a3a; }
`;

let root: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;
let btn: HTMLButtonElement | null = null;
let filter: string | null = null;

const h = (tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
};

export function setupMusicMenu() {
  if (root) return;
  document.head.append(h('style', {}, CSS));
  root = h('div', { id: 'musik-menu-root' }) as HTMLDivElement;
  btn = h('button', { id: 'musik-btn', title: 'Musik-Menü (M)' }, '♪ Musik') as HTMLButtonElement;
  btn.addEventListener('click', () => toggleMusicMenu(true));
  overlay = h('div', { id: 'musik-overlay', class: 'hidden' }) as HTMLDivElement;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) toggleMusicMenu(false);
  });
  root.append(btn, overlay);
  document.body.append(root);
  onMusicChange((kind) => {
    updateButton();
    if (!isMusicMenuOpen()) return;
    if (kind === 'volume') updateMute();
    else render();
  });
  updateButton();
}

/** Knopf nur in der Lobby zeigen (das Menü selbst geht per M überall) */
export function musicMenuScene(scene: string) {
  btn?.classList.toggle('hidden', scene !== 'lobby');
}

export function isMusicMenuOpen() {
  return !!overlay && !overlay.classList.contains('hidden');
}

export function toggleMusicMenu(open = !isMusicMenuOpen()) {
  if (!overlay) return;
  if (open) {
    unlockMusic();
    overlay.classList.remove('hidden');
    render();
  } else {
    overlay.classList.add('hidden');
    stopPreview();
  }
}

function updateButton() {
  if (!btn) return;
  btn.textContent = isMuted() ? '♪ Musik (aus)' : '♪ Musik';
}

/** Nur den Stumm-Knopf aktualisieren (die Regler nicht neu bauen, sonst bricht das Ziehen ab) */
function updateMute() {
  const b = overlay?.querySelector<HTMLButtonElement>('#mm-mute');
  if (!b) return;
  b.textContent = isMuted() ? 'Stumm: AN' : 'Stumm: AUS';
  b.classList.toggle('on', isMuted());
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

function slider(label: string, value: number, max: number, onInput: (v: number) => void) {
  const input = h('input', { type: 'range', min: '0', max: String(max), step: '0.01', value: String(value) }) as HTMLInputElement;
  const val = h('span', { class: 'mm-val' }, pct(value));
  input.addEventListener('input', () => {
    onInput(Number(input.value));
    val.textContent = pct(Number(input.value));
  });
  return h('div', { class: 'mm-row' }, h('label', {}, label), input, val);
}

function render() {
  if (!overlay) return;
  const songs = getSongs();
  const assign = getAssign();
  const current = getCurrentSongId();
  const nowTitle = current ? songs.find((s) => s.id === current)?.title ?? current : 'Stille';

  // --- Lautstärke
  const muteBtn = h('button', { id: 'mm-mute', class: `mm-btn ${isMuted() ? 'on' : ''}` }, isMuted() ? 'Stumm: AN' : 'Stumm: AUS');
  muteBtn.addEventListener('click', () => setMuted(!isMuted()));
  const speechBtn = h('button', { id: 'mm-speech', class: `mm-btn ${isSpeechOn() ? 'on' : ''}` }, isSpeechOn() ? 'Sprecher: AN' : 'Sprecher: AUS');
  speechBtn.addEventListener('click', () => {
    setSpeechOn(!isSpeechOn());
    speechBtn.textContent = isSpeechOn() ? 'Sprecher: AN' : 'Sprecher: AUS';
    speechBtn.classList.toggle('on', isSpeechOn());
    if (isSpeechOn()) say('Sprecher ist an!', { interrupt: true });
  });
  const volBox = h(
    'div', { class: 'mm-box' },
    h('h3', {}, 'Lautstärke'),
    slider('Gesamt', getVolume(), 1, setVolume),
    slider('Musik', getMusicVolume(), 1, setMusicVolume),
    slider('Effekte', getFxVolume(), 1, (v) => {
      setFxVolume(v);
      sfx('select');
    }),
    h('div', { class: 'mm-row' }, speechBtn, h('span', { class: 'mm-now' }, speechSupported() ? 'Ansagen wie „Drei, zwei, eins, los!“ (Lautstärke = Effekte)' : 'Dieser Browser kann keine Sprachausgabe')),
    h('div', { class: 'mm-row' }, muteBtn, h('span', { class: 'mm-now' }, `Läuft gerade: ${nowTitle}${isPreviewing() ? ' (Vorhören)' : ` – Szene „${sceneName(getScene())}“`}`)),
  );

  // --- Bibliothek
  const chips = h('div', { class: 'mm-chips' });
  const chip = (label: string, id: string | null) => {
    const c = h('span', { class: `mm-chip ${filter === id ? 'on' : ''}` }, label);
    c.addEventListener('click', () => {
      filter = id;
      render();
    });
    return c;
  };
  chips.append(chip('Alle', null), ...STYLES.map((s) => chip(s.name, s.id)));
  const list = h('div', { class: 'mm-list' });
  for (const s of songs.filter((x) => !filter || x.style === filter)) {
    const style = STYLES.find((x) => x.id === s.style);
    const play = h('button', { class: `mm-btn small ${current === s.id && isPreviewing() ? 'on' : ''}` }, current === s.id && isPreviewing() ? '■ Stopp' : '▶ Hören');
    play.addEventListener('click', () => {
      if (current === s.id && isPreviewing()) stopPreview();
      else void previewSong(s.id);
    });
    const lobby = h('button', { class: `mm-btn small quiet ${assign.lobby === s.id ? 'on' : ''}` }, assign.lobby === s.id ? '✓ Lobby' : 'Lobby');
    lobby.title = 'Als Lobby-Musik festlegen';
    lobby.addEventListener('click', () => void assignScene('lobby', assign.lobby === s.id ? null : s.id).catch(alertErr));
    const std = h('button', { class: `mm-btn small quiet ${assign.standard === s.id ? 'on' : ''}` }, assign.standard === s.id ? '✓ Standard' : 'Standard');
    std.title = 'Als Standard für alle Szenen ohne eigene Zuordnung';
    std.addEventListener('click', () => void assignScene('standard', assign.standard === s.id ? null : s.id).catch(alertErr));
    const row = h(
      'div', { class: `mm-song ${current === s.id ? 'playing' : ''}` },
      h('div', {}, h('span', { class: 't' }, s.title), h('span', { class: 'mm-badge', style: `background:${style?.color ?? '#7a5a3a'}` }, style?.name ?? s.style),
        h('div', { class: 's' }, `${s.bpm} BPM · ${s.bars} Takte${s.builtin ? ' · eingebaut' : s.author ? ` · von ${s.author}` : ''}`)),
      play, lobby, std,
    );
    list.append(row);
  }
  if (!list.childElementCount) list.append(h('div', { class: 'mm-song' }, 'Noch kein Song in diesem Stil – in der Werkstatt einen bauen!'));
  const libBox = h('div', { class: 'mm-box' }, h('h3', {}, 'Bibliothek'), chips, list);

  // --- Zuordnung
  const grid = h('div', { class: 'mm-assign' });
  for (const sc of ASSIGN_SCENES) {
    const sel = h('select') as HTMLSelectElement;
    const opt = (v: string, label: string) => sel.append(h('option', { value: v }, label));
    opt('', sc.id === 'standard' ? 'Eingebaute Loops' : 'wie Standard');
    opt('none', 'Stille');
    for (const st of STYLES) opt(`style:${st.id}`, `Stil: ${st.name} (wechselnd)`);
    for (const s of songs) opt(s.id, `♪ ${s.title}`);
    sel.value = assign[sc.id] ?? '';
    sel.addEventListener('change', () => void assignScene(sc.id, sel.value || null).catch(alertErr));
    grid.append(h('label', {}, h('span', {}, sc.name), sel));
  }
  const assignBox = h('div', { class: 'mm-box wide' }, h('h3', {}, 'Zuordnung: Welche Musik läuft wo?'), grid);

  const body = h('div', { id: 'musik-body' }, volBox, libBox, assignBox);
  const close = h('button', {}, '✕ Schließen');
  close.addEventListener('click', () => toggleMusicMenu(false));
  const werkstatt = h('button', { class: 'mm-btn' }, '🎹 Musik-Werkstatt öffnen');
  werkstatt.addEventListener('click', () => window.open('/musik.html', '_blank'));
  const panel = h(
    'div', { id: 'musik-panel' },
    h('h2', {}, h('span', {}, '♪ Musik'), close),
    body,
    h('div', { class: 'mm-foot' }, werkstatt, h('span', {}, 'Eigene Songs bauen, einsingen oder als MIDI importieren · M schließt das Menü')),
  );
  overlay.replaceChildren(panel);
}

const sceneName = (id: string) => ASSIGN_SCENES.find((s) => s.id === id)?.name ?? id;
const alertErr = (e: Error) => window.alert(`Konnte Zuordnung nicht speichern: ${e.message}`);
