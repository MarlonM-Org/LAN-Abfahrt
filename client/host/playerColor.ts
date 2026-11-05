import { playerColor, type PlayerColor } from '../../shared/players';
import { playerById } from './store';

/**
 * Spielerfarbe des Abends für eine Spieler-ID (`PlayerPublic.color`, vom Raum beim Beitritt vergeben).
 * `fallback` greift nur, wenn der Spieler nicht (mehr) in der Liste steht – z. B. die Reihenfolge im Spiel.
 */
export const pcol = (id: string | null | undefined, fallback = 0): PlayerColor => playerColor(playerById(id)?.color ?? fallback);
