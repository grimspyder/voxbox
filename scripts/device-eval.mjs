#!/usr/bin/env node
/**
 * Evaluates one JavaScript expression inside the app's WebView on a connected
 * device and prints the result.
 *
 * Companion to scripts/device-probe.mjs: that one answers a fixed set of
 * questions about the running app, this one lets you ask an arbitrary one —
 * which is how a Capacitor plugin gets exercised on real hardware without
 * building UI for it.
 *
 * Usage:
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<app pid>
 *   node scripts/device-eval.mjs "await window.Capacitor.Plugins.SecureStore.isAvailable()"
 *
 * The expression is wrapped in an async function before evaluation, because CDP's
 * Runtime.evaluate does not accept top-level `await` — it wants a value or a
 * promise, so `await` only works inside a function body.
 *
 * Requires Node 22+ (built-in WebSocket).
 */
const port = process.env.CDP_PORT ?? '9222';
const expression = process.argv.slice(2).join(' ');

if (!expression) {
  console.error('Usage: node scripts/device-eval.mjs "<javascript expression>"');
  process.exit(1);
}

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('No debuggable page. Is the app running, and the port forwarded?');
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
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 20000);
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
  console.error('websocket error:', e.message ?? e);
  process.exit(1);
});

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

async function evaluate(source) {
  return send('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true });
}

// Expressions are wrapped so `await` works (CDP has no top-level await). A
// statement-style argument (one containing `;`) will not parse as an expression,
// so fall back to a plain function body rather than failing at the caller.
let res = await evaluate(`(async () => { return (${expression}); })()`);
if (res.result?.exceptionDetails?.exception?.description?.includes('SyntaxError')) {
  res = await evaluate(`(async () => { ${expression} })()`);
}
const details = res.result?.exceptionDetails;
if (details) {
  console.error('threw:', details.exception?.description ?? details.text);
  process.exitCode = 1;
} else {
  const value = res.result?.result?.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
}

ws.close();
