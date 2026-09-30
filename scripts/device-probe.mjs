#!/usr/bin/env node
/**
 * Reads the live DOM and capability flags out of the app's WebView over the
 * Chrome DevTools Protocol, via `adb forward`.
 *
 * Why this exists: a blank screen on a device tells you nothing, and logcat
 * only carries console output if something bothered to log it. This attaches to
 * the real WebView and asks it questions, which is the difference between
 * "looks broken" and "the Web Speech API is absent in this engine".
 *
 * Usage:
 *   1. adb forward tcp:9222 localabstract:webview_devtools_remote_<app pid>
 *   2. node scripts/device-probe.mjs [port]
 *
 * Requires Node 22+ (built-in WebSocket). Dev tool only; not part of the app.
 */
const port = process.argv[2] ?? '9222';

const PROBES = [
  ['title', 'document.title'],
  ['url', 'location.href'],
  ['bodyLength', 'document.body ? document.body.innerHTML.length : -1'],
  ['visibleText', '(document.body ? document.body.innerText : "").replace(/\\s+/g, " ").slice(0, 400)'],
  ['rootChildren', 'document.body ? document.body.children.length : -1'],
  ['buttons', '[...document.querySelectorAll("button")].map(b => (b.innerText||"").trim().slice(0,24))'],
  ['styledDisplay', '(() => { const d = document.querySelector(".kitt-display"); return d ? Math.round(d.getBoundingClientRect().width) + "x" + Math.round(d.getBoundingClientRect().height) : null; })()'],
  ['caps', `(() => ({
    speechSynthesis: "speechSynthesis" in window,
    speechSynthesisVoices: typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().length : -1,
    SpeechRecognition: "SpeechRecognition" in window,
    webkitSpeechRecognition: "webkitSpeechRecognition" in window,
    MediaSource: typeof MediaSource !== "undefined",
    mp3ViaMediaSource: typeof MediaSource !== "undefined" ? MediaSource.isTypeSupported("audio/mpeg") : false,
    AudioContext: typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined",
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    wakeLock: "wakeLock" in navigator,
    isSecureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    capacitor: typeof window.Capacitor !== "undefined" ? (window.Capacitor.isNativePlatform?.() ?? "present") : false
  }))()`],
];

const list = await (await fetch(`http://localhost:${port}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('No debuggable page found. Is the app running with WebView debugging enabled?');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
  });
}

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg);
    pending.delete(msg.id);
  }
});

ws.addEventListener('error', (e) => {
  console.error('websocket error', e.message ?? e);
  process.exit(1);
});

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

console.log(`attached: ${page.title} @ ${page.url}\n`);
for (const [label, expression] of PROBES) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
  const value = res.result?.result?.value;
  const err = res.result?.exceptionDetails;
  console.log(`${label}: ${err ? 'ERROR ' + (err.exception?.description ?? err.text) : JSON.stringify(value, null, label === 'caps' ? 1 : 0)}`);
}

ws.close();
