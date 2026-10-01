// Reporting an AI response, from the user's side.
//
// Play requires a way to report offensive or inappropriate generated content
// without leaving the app (brief §53), and it requires the user to be told what
// will be sent before it is sent (§55). The wording below is that disclosure, and
// it is kept next to the payload it describes so the two cannot drift apart.
import { apiUrl, apiHeaders } from '../config/apiBase';

export const REPORT_REASONS = [
  { id: 'harmful', label: 'Harmful or dangerous advice' },
  { id: 'sexual', label: 'Sexual content' },
  { id: 'hate', label: 'Hateful or harassing content' },
  { id: 'violence', label: 'Violence' },
  { id: 'self-harm', label: 'Self-harm or suicide' },
  { id: 'illegal', label: 'Illegal activity' },
  { id: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export interface ReportDraft {
  reason: ReportReason | '';
  note: string;
  response: string;
  provider: string;
}

/** The longest response worth attaching; matches the server's own cap. */
export const MAX_REPORTED_RESPONSE = 4000;

export function isReadyToSend(draft: ReportDraft): boolean {
  return draft.reason !== '' && draft.response.trim().length > 0;
}

/**
 * Plain-language statement of what the report contains. Shown before sending, and
 * the reason it is a function rather than a constant: it must name the provider
 * actually in use.
 */
export function disclosureLines(draft: ReportDraft): { sent: string[]; notSent: string[] } {
  return {
    sent: [
      'The KITT response you chose, quoted in full',
      draft.note.trim() ? 'Your note' : 'Your note (empty, so nothing is added)',
      `Which AI service produced it (${draft.provider || 'not connected'})`,
      'The app version',
    ],
    notSent: [
      'Your API key — it is never included, and anything key-shaped is stripped before sending',
      'Your microphone audio — it is not recorded for this, and not attached',
      'The rest of your conversation',
      'Anything else on your device',
    ],
  };
}

export interface ReportOutcome {
  ok: boolean;
  message: string;
}

export async function submitReport(draft: ReportDraft): Promise<ReportOutcome> {
  if (!isReadyToSend(draft)) {
    return { ok: false, message: 'Choose a reason first, so the report is actionable.' };
  }
  try {
    const res = await fetch(apiUrl('/api/report'), {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        reason: draft.reason,
        note: draft.note.slice(0, 500),
        response: draft.response.slice(0, MAX_REPORTED_RESPONSE),
        provider: draft.provider,
      }),
    });
    if (res.ok) {
      return { ok: true, message: 'Thank you — your report was sent for safety review.' };
    }
    let message = 'Your report could not be sent.';
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* keep the generic message */
    }
    return { ok: false, message };
  } catch {
    return { ok: false, message: 'Your report could not be sent. Check your connection and try again.' };
  }
}
