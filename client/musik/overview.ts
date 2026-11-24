/**
 * Startseite der Werkstatt: „Wo läuft was?“ – jede Szene (Standard, Phasen, Minispiele in
 * Arcade-Reihenfolge) mit aktivem Song, Anhören, Song wechseln, Kopie anlegen und Bearbeiten.
 * Darunter die eigenen Songs. Zeichnet nur DOM; Laden/Speichern/Navigation macht main.ts.
 */
import { ARCADE_GROUPS, MINI_INFO } from '../../shared/games';
import type { MiniKind } from '../../shared/types';
import {
  ASSIGN_SCENES, type Assignment, STYLES, type SceneSource, type SongInfo, defaultSongForScene, sceneSource, styleName,
} from '../../shared/music';

export interface SceneRow {
  id: string;
  name: string;
  icon: string;
  group: string;
}

/** Alle Szenen in Anzeige-Reihenfolge: Standard + Phasen, dann die Minispiele wie in der Arcade */
export function sceneRows(): SceneRow[] {
  const rows: SceneRow[] = [
    { id: 'standard', name: 'Standard', icon: '⭐', group: 'Allgemein' },
    { id: 'lobby', name: 'Lobby', icon: '🏠', group: 'Allgemein' },
    { id: 'board', name: 'Spielbrett', icon: '🎲', group: 'Allgemein' },
    { id: 'results', name: 'Ergebnisse', icon: '🏆', group: 'Allgemein' },
    { id: 'story', name: 'Date Night – Geschichte', icon: '💕', group: 'Allgemein' },
  ];
  const seen = new Set(rows.map((r) => r.id));
  const add = (k: string, group: string) => {
    if (seen.has(k) || !(k in MINI_INFO)) return;
    seen.add(k);
    const info = MINI_INFO[k as MiniKind];
    rows.push({ id: k, name: info.title, icon: info.icon, group });
  };
  for (const g of ARCADE_GROUPS) for (const k of g.kinds) add(k, g.title);
  for (const sc of ASSIGN_SCENES) add(sc.id, 'Weitere');
  return rows;
}

export const sceneName = (id: string) => sceneRows().find((r) => r.id === id)?.name ?? ASSIGN_SCENES.find((s) => s.id === id)?.name ?? id;

/** Szenen (ohne „standard“), in denen ein Song gerade fest läuft */
export function scenesPlaying(songId: string, assign: Assignment, songs: SongInfo[]): string[] {
  return sceneRows()
    .filter((r) => r.id !== 'standard')
    .filter((r) => {
      const src = sceneSource(r.id, assign, songs);
      return src.kind === 'song' && src.id === songId;
    })
    .map((r) => r.id);
}

/** „Kart-Rennen“, „Kart-Rennen und Auto-Fußball“, „Kart-Rennen und 3 weiteren Szenen“ */
export function sceneList(ids: string[], first?: string): string {
  const order = first && ids.includes(first) ? [first, ...ids.filter((x) => x !== first)] : ids;
  const names = order.map(sceneName);
  if (names.length <= 2) return names.join(' und ');
  return `${names[0]} und ${names.length - 1} weiteren Szenen`;
}

export interface OverviewHandlers {
  listen(scene: string, src: SceneSource, btn: HTMLButtonElement): void;
  listenSong(id: string, btn: HTMLButtonElement): void;
  assign(scene: string, value: string | null): void;
  copy(scene: string): void;
  edit(scene: string): void;
  editSong(id: string): void;
  deleteSong(id: string): void;
  restore(id: string): void;
  filter(text: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function btn(label: string, cls: string, title = '') {
  const b = el('button', `btn ${cls}`, label);
  if (title) b.title = title;
  return b;
}

export class Overview {
  songs: SongInfo[] = [];
  assign: Assignment = {};
  query = '';

  constructor(
    private list: HTMLElement,
    private own: HTMLElement,
    private h: OverviewHandlers,
  ) {}

  private info(id: string) {
    return this.songs.find((s) => s.id === id);
  }
  private title(id: string) {
    return this.info(id)?.title ?? id;
  }

  /** Herkunft eines Songs als kurzes Etikett */
  origin(id: string): { label: string; cls: string } {
    const s = this.info(id);
    if (!s) return { label: '?', cls: '' };
    if (s.builtin) return { label: 'eingebaut', cls: 'tag-builtin' };
    if (s.overrides) return { label: 'eingebaut · angepasst', cls: 'tag-override' };
    return { label: 'eigen', cls: 'tag-own' };
  }

  private usage(id: string) {
    return scenesPlaying(id, this.assign, this.songs).length;
  }

  render() {
    const q = this.query.trim().toLowerCase();
    this.list.replaceChildren();
    let group = '';
    let shown = 0;
    for (const row of sceneRows()) {
      const src = sceneSource(row.id, this.assign, this.songs);
      const songTitle = src.kind === 'song' ? this.title(src.id) : src.kind === 'style' ? styleName(src.style) : '';
      if (q && !`${row.name} ${row.id} ${songTitle}`.toLowerCase().includes(q)) continue;
      if (row.group !== group) {
        group = row.group;
        this.list.append(el('h3', 'ov-group', group));
      }
      this.list.append(this.sceneRow(row, src));
      shown++;
    }
    if (!shown) this.list.append(el('div', 'ov-empty', `Nichts gefunden für „${this.query}“.`));
    this.renderOwn(q);
  }

  private sceneRow(row: SceneRow, src: SceneSource) {
    const r = el('div', 'ov-row');
    r.dataset.scene = row.id;
    const icon = el('span', 'ov-icon', row.icon);
    const name = el('div', 'ov-name');
    name.append(el('b', '', row.name));
    if (row.id === 'standard') name.append(el('small', '', 'gilt für alle Szenen ohne eigene Wahl'));

    // Was läuft?
    const now = el('div', 'ov-now');
    if (src.kind === 'song') {
      const o = this.origin(src.id);
      now.append(el('span', 'ov-song', `♪ ${this.title(src.id)}`), el('span', `tag ${o.cls}`, o.label));
      const n = this.usage(src.id);
      if (n > 1) {
        const c = el('button', 'ov-count', `läuft in ${n} Szenen`);
        c.title = 'Alle Szenen mit diesem Song zeigen';
        c.addEventListener('click', () => this.h.filter(this.title(src.id)));
        now.append(c);
      }
    } else if (src.kind === 'style') {
      const st = STYLES.find((x) => x.id === src.style);
      const tag = el('span', 'tag tag-style', `Stil: ${st?.name ?? src.style}`);
      tag.style.background = st?.color ?? '';
      now.append(tag, el('span', 'ov-sub', `wechselt reihum (${src.ids.length} Songs)`));
    } else if (src.kind === 'none') {
      now.append(el('span', 'ov-song quiet', '🔇 Stille'));
    } else {
      now.append(el('span', 'ov-song quiet', 'eingebauter Song je Szene'));
    }
    if (src.via === 'standard') now.append(el('span', 'ov-sub', '(von Standard)'));

    // Knöpfe
    const listen = btn('▶', 'ov-play', 'Anhören');
    listen.disabled = src.kind === 'none' || src.kind === 'perScene';
    listen.addEventListener('click', () => this.h.listen(row.id, src, listen));
    const sel = this.switcher(row.id);
    const copy = btn('Kopie & bearbeiten', '', 'Kopie des laufenden Songs anlegen, bearbeiten und hier abspielen');
    const edit = btn('Direkt bearbeiten', 'primary', 'Den laufenden Song direkt bearbeiten');
    const editable = src.kind === 'song';
    copy.disabled = edit.disabled = !editable;
    if (!editable) copy.title = edit.title = 'Erst einen bestimmten Song wählen';
    copy.addEventListener('click', () => this.h.copy(row.id));
    edit.addEventListener('click', () => this.h.edit(row.id));
    const acts = el('div', 'ov-acts');
    acts.append(listen, sel, copy, edit);
    r.append(icon, name, now, acts);
    return r;
  }

  /** „Song wechseln“: eingebaute, eigene, Stile, Stille, zurück auf Standard */
  private switcher(scene: string) {
    const sel = el('select', 'ov-switch');
    sel.title = 'Song wechseln';
    const cur = this.assign[scene] ?? '';
    const opt = (parent: HTMLElement, value: string, label: string) => {
      const o = new Option(`${value === cur ? '✓ ' : ''}${label}`, value);
      parent.append(o);
      return o;
    };
    const head = new Option('Song wechseln …', '__head__');
    head.disabled = true;
    head.selected = true;
    sel.append(head);
    if (scene === 'standard') opt(sel, '', 'Eingebaute Songs je Szene');
    else if (this.assign.standard) opt(sel, '', `Wie Standard`);
    else opt(sel, '', `Eingebaut: ${this.title(defaultSongForScene(scene))}`);
    const gB = el('optgroup') as HTMLOptGroupElement;
    gB.label = 'Eingebaute Songs';
    for (const s of this.songs.filter((x) => x.builtin)) opt(gB, s.id, `${s.title}${this.songs.some((o) => o.overrides === s.id) ? ' (angepasst)' : ''}`);
    const gO = el('optgroup') as HTMLOptGroupElement;
    gO.label = 'Eigene Songs';
    for (const s of this.songs.filter((x) => !x.builtin && !x.overrides)) opt(gO, s.id, s.title);
    const gS = el('optgroup') as HTMLOptGroupElement;
    gS.label = 'Stil (wechselt reihum)';
    for (const st of STYLES) {
      const n = this.songs.filter((x) => x.style === st.id).length;
      if (n) opt(gS, `style:${st.id}`, `${st.name} (${n})`);
    }
    sel.append(gB);
    if (gO.childElementCount) sel.append(gO);
    sel.append(gS);
    opt(sel, 'none', '🔇 Stille');
    sel.addEventListener('change', () => {
      const v = sel.value;
      sel.value = '__head__';
      this.h.assign(scene, v || null);
    });
    return sel;
  }

  private renderOwn(q: string) {
    this.own.replaceChildren();
    const mine = this.songs.filter((s) => !s.builtin && (!q || s.title.toLowerCase().includes(q)));
    if (!mine.length) {
      this.own.append(el('div', 'ov-empty', q ? 'Keine eigenen Songs passen zur Suche.' : 'Noch keine eigenen Songs – „Kopie & bearbeiten“ bei einer Szene legt den ersten an.'));
      return;
    }
    for (const s of mine) {
      const r = el('div', 'ov-row own');
      r.dataset.song = s.id;
      const name = el('div', 'ov-name');
      name.append(el('b', '', s.title));
      if (s.overrides) name.append(el('span', 'tag tag-override', 'ersetzt das eingebaute Original'));
      name.append(el('small', '', `${styleName(s.style)} · ${s.bpm} BPM · ${s.bars} Takte${s.author ? ` · von ${s.author}` : ''}`));
      const where = scenesPlaying(s.id, this.assign, this.songs);
      const now = el('div', 'ov-now');
      now.append(el('span', 'ov-sub', where.length ? `läuft in: ${sceneList(where)}` : 'läuft gerade nirgends'));
      const listen = btn('▶', 'ov-play', 'Anhören');
      listen.addEventListener('click', () => this.h.listenSong(s.id, listen));
      const edit = btn('Bearbeiten', 'primary');
      edit.addEventListener('click', () => this.h.editSong(s.id));
      const del = s.overrides ? btn('↺ Original', '', 'Original wiederherstellen') : btn('Löschen', 'danger');
      del.addEventListener('click', () => (s.overrides ? this.h.restore(s.id) : this.h.deleteSong(s.id)));
      const acts = el('div', 'ov-acts');
      acts.append(listen, edit, del);
      r.append(el('span', 'ov-icon', '♪'), name, now, acts);
      this.own.append(r);
    }
  }
}
