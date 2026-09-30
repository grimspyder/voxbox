// Optional on-device conversation transcript.
//
// When "Save conversation history" is on, the transcript is written to this
// device's local storage so it survives a reload. It is never uploaded to the
// Vox server and never sent to a provider except as the ordinary conversation
// context the user is actively continuing. Turning the option off or clearing
// history removes it completely.

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

const HISTORY_KEY = 'kitt.history.v1';
const MAX_TURNS = 60;

export function loadHistory(): HistoryTurn[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is HistoryTurn => {
        const turn = t as Partial<HistoryTurn>;
        return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string';
      })
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

export function saveHistory(turns: HistoryTurn[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* storage full or unavailable — history simply is not persisted */
  }
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* nothing to do */
  }
}

/** A short summary for the privacy screen, so the copy matches behaviour. */
export function historyStorageLocation(): string {
  return 'this device only (local app storage, key ' + HISTORY_KEY + ')';
}
