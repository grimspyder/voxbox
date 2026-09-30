// STT: browser Web Speech API (default) or OpenAI Whisper via /api/stt.
import { STTConfig } from '../config/settings';
import { apiUrl, apiHeaders } from '../config/apiBase';

export interface BrowserRecognitionHandlers {
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The Web Speech API has no standard TS typings; `any` is intentional here.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

export class BrowserRecognition {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;

  get supported(): boolean {
    return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start(h: BrowserRecognitionHandlers, continuous = false): void {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      h.onError?.('Browser speech recognition not supported. Use Chrome or Edge, or configure Whisper in Settings.');
      return;
    }
    this.stop();
    const rec: SpeechRecognitionLike = new Ctor();
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let text = '';
      let isFinal = false;
      let confidence = 0;
      let confidenceCount = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alternative = e.results[i][0];
        text += alternative.transcript;
        confidence += typeof alternative.confidence === 'number' ? alternative.confidence : 1;
        confidenceCount += 1;
        if (e.results[i].isFinal) isFinal = true;
      }
      const averageConfidence = confidenceCount ? confidence / confidenceCount : 0;
      // Interim text remains useful for captions, but low-confidence final
      // results are usually environmental noise or an accidental activation.
      if (text && (!isFinal || averageConfidence >= 0.45)) h.onResult(text, isFinal);
    };
    rec.onerror = (e: any) => {
      const code = String(e.error || 'unknown');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        h.onError?.('Speech recognition was blocked. Allow Microphone for this site, then reload. If permission is already allowed, switch Settings → SPEECH to OpenAI Whisper.');
      } else if (code === 'audio-capture') {
        h.onError?.('Speech recognition cannot access the selected microphone. Choose another input in Settings → AUDIO and refresh microphones.');
      } else if (code === 'network') {
        h.onError?.('Browser speech recognition lost its network connection. Try again or use OpenAI Whisper in Settings → SPEECH.');
      } else if (code === 'no-speech') {
        h.onError?.('No speech detected. Check the microphone input meter and speak closer to the selected microphone.');
      } else if (code !== 'aborted') {
        h.onError?.(`Speech recognition error: ${code}`);
      }
    };
    rec.onend = () => {
      this.running = false;
      h.onEnd?.();
    };
    this.rec = rec;
    this.running = true;
    rec.start();
  }

  stop(): void {
    if (this.rec) {
      try { this.rec.stop(); } catch { /* */ }
      this.running = false;
      this.rec = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}

export async function whisperTranscribe(audio: Blob, cfg: STTConfig): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'speech.webm');
  form.append('model', cfg.model || 'whisper-1');
  form.append('language', cfg.language || 'en');
  const res = await fetch(apiUrl('/api/stt'), {
    method: 'POST',
    headers: apiHeaders({ 'x-stt-key': cfg.apiKey }),
    body: form,
  });
  if (!res.ok) {
    let msg = `Transcription error ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return j.text ?? '';
}