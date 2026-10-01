// "Report this response" sheet.
//
// Two things this must do, per the brief: stay inside the app (§53), and tell the
// user exactly what will be submitted before it is submitted (§55). The button
// that sends is therefore the confirmation step, and the disclosure sits directly
// above it rather than behind a link.
'use client';

import { useMemo, useState } from 'react';
import {
  REPORT_REASONS,
  ReportDraft,
  ReportReason,
  disclosureLines,
  isReadyToSend,
  submitReport,
} from '@/lib/safety/report';

interface Props {
  response: string;
  provider: string;
  onClose: () => void;
}

const btn: React.CSSProperties = {
  background: '#151515',
  border: '1px solid #3a3a3a',
  color: '#ccc',
  padding: '12px 16px',
  borderRadius: 6,
  fontFamily: 'monospace',
  letterSpacing: '0.08em',
  fontSize: 13,
  cursor: 'pointer',
  minHeight: 48,
};
const primary: React.CSSProperties = { ...btn, background: '#3a0d0d', borderColor: '#ff1a1a', color: '#ffdede' };
const input: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #333',
  color: '#ddd',
  padding: '10px 12px',
  borderRadius: 6,
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 15,
};

export default function ReportResponse({ response, provider, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const draft: ReportDraft = useMemo(
    () => ({ reason, note, response, provider }),
    [reason, note, response, provider],
  );
  const disclosure = disclosureLines(draft);

  const send = async () => {
    setSending(true);
    setOutcome(await submitReport(draft));
    setSending(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Report a Vox response"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.94)',
        zIndex: 70,
        overflowY: 'auto',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', color: '#ccc' }}>
        <h2 style={{ fontFamily: 'monospace', letterSpacing: '0.2em', color: '#ff5050', fontSize: 16 }}>
          REPORT A RESPONSE
        </h2>

        {outcome ? (
          <div>
            <p
              role="status"
              style={{ color: outcome.ok ? '#7bd87b' : '#ff9a3c', fontSize: 14, lineHeight: 1.6, marginTop: 12 }}
            >
              {outcome.message}
            </p>
            <button style={{ ...btn, marginTop: 16 }} onClick={onClose}>
              CLOSE
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>Which response are you reporting?</p>
            <blockquote
              style={{
                margin: '8px 0 0',
                padding: '10px 12px',
                borderLeft: '2px solid #3a3a3a',
                background: '#0a0a0a',
                color: '#bbb',
                fontSize: 13,
                lineHeight: 1.6,
                maxHeight: 140,
                overflowY: 'auto',
              }}
            >
              {response.length > 600 ? `${response.slice(0, 600)}…` : response}
            </blockquote>

            <label style={{ display: 'block', fontSize: 11, color: '#888', margin: '16px 0 6px', letterSpacing: '0.08em' }}>
              WHAT IS WRONG WITH IT?
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REPORT_REASONS.map((option) => (
                <label
                  key={option.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 12px',
                    border: `1px solid ${reason === option.id ? '#ff1a1a' : '#2a2a2a'}`,
                    borderRadius: 6,
                    background: reason === option.id ? '#1c0a0a' : '#101010',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={reason === option.id}
                    onChange={() => setReason(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>

            <label style={{ display: 'block', fontSize: 11, color: '#888', margin: '16px 0 6px', letterSpacing: '0.08em' }}>
              ANYTHING TO ADD? (OPTIONAL)
            </label>
            <textarea
              style={{ ...input, minHeight: 80 }}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the developer"
            />
            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{500 - note.length} characters left</p>

            <div style={{ marginTop: 18, padding: 12, border: '1px solid #2a2a2a', borderRadius: 6, background: '#0a0a0a' }}>
              <p style={{ fontSize: 12, color: '#bbb', marginBottom: 8 }}>
                This will send the selected Vox response and your optional note to the developer for safety review. It
                contains:
              </p>
              <ul style={{ margin: '0 0 10px 18px', fontSize: 12, color: '#999', lineHeight: 1.7 }}>
                {disclosure.sent.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>It does not contain:</p>
              <ul style={{ margin: '0 0 0 18px', fontSize: 12, color: '#999', lineHeight: 1.7 }}>
                {disclosure.notSent.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 32px' }}>
              <button style={primary} disabled={sending || !isReadyToSend(draft)} onClick={() => void send()}>
                {sending ? 'SENDING…' : 'SEND REPORT'}
              </button>
              <button style={btn} onClick={onClose}>
                CANCEL
              </button>
            </div>
            {!isReadyToSend(draft) && (
              <p style={{ fontSize: 11, color: '#666', marginTop: -24 }}>Choose a reason to enable sending.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
