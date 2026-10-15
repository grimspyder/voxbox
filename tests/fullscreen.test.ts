// Fullscreen across both backends.
//
// This is the regression test for the Android defect: the old handler called
// `document.documentElement.requestFullscreen()` and discarded the rejection.
// The Android WebView refuses that call (Capacitor's WebChromeClient hides the
// custom view immediately), so the FULLSCREEN button did nothing and said
// nothing. These tests pin the replacement behaviour:
//
//  - inside the shell the native plugin is used and the browser API is NOT,
//  - in a browser the browser API is used,
//  - a platform with neither reports ok:false rather than pretending to work,
//  - the same control leaves fullscreen when it is already active.
//
// The real system bars are verified on a device (android-runtime-verification);
// what is tested here is the decision logic, which needs no device.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = { value: false };
vi.mock('@/lib/setup/capabilities', () => ({ isNativeShell: () => native.value }));

const plugin = {
  isSupported: vi.fn(),
  enter: vi.fn(),
  exit: vi.fn(),
  isActive: vi.fn(),
};
vi.mock('@/lib/native/fullscreenPlugin', () => ({ Fullscreen: plugin }));

const requestFullscreen = vi.fn();
const exitFullscreenDom = vi.fn();
let fullscreenElement: Element | null = null;

/** A browser that offers the Fullscreen API. */
function installWebFullscreen(enabled: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { value: enabled, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', {
    get: () => fullscreenElement,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: requestFullscreen,
    configurable: true,
  });
  Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreenDom, configurable: true });
}

async function loadFullscreen() {
  return import('@/lib/native/fullscreen');
}

beforeEach(() => {
  vi.clearAllMocks();
  native.value = false;
  fullscreenElement = null;
  installWebFullscreen(true);
  plugin.isSupported.mockResolvedValue({ supported: true });
  plugin.isActive.mockResolvedValue({ active: false });
  plugin.enter.mockResolvedValue({ active: true });
  plugin.exit.mockResolvedValue({ active: false });
});

describe('fullscreen backend selection', () => {
  it('uses the native shell plugin inside the app and never the WebView API', async () => {
    native.value = true;
    const { enterFullscreen, fullscreenBackend } = await loadFullscreen();

    expect(await fullscreenBackend()).toBe('native');
    const result = await enterFullscreen();

    expect(result).toEqual({ ok: true, active: true, backend: 'native' });
    expect(plugin.enter).toHaveBeenCalledTimes(1);
    // The WebView route is the broken one: it must not be touched in the shell.
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('uses the browser API outside the shell', async () => {
    const { enterFullscreen, fullscreenBackend } = await loadFullscreen();

    expect(await fullscreenBackend()).toBe('web');
    requestFullscreen.mockResolvedValue(undefined);
    const result = await enterFullscreen();

    expect(result.backend).toBe('web');
    expect(result.ok).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(plugin.enter).not.toHaveBeenCalled();
  });

  it('reports unsupported instead of silently doing nothing', async () => {
    // Shell whose plugin is missing, on a WebView without the browser API: the
    // exact combination that produced a dead button with no explanation.
    native.value = true;
    plugin.isSupported.mockRejectedValue(new Error('plugin not implemented'));
    installWebFullscreen(false);
    const { toggleFullscreen, fullscreenBackend } = await loadFullscreen();

    expect(await fullscreenBackend()).toBe('unsupported');
    expect(await toggleFullscreen()).toEqual({ ok: false, active: false, backend: 'unsupported' });
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('reports a rejected shell call rather than claiming success', async () => {
    native.value = true;
    plugin.enter.mockRejectedValue(new Error('no activity'));
    const { enterFullscreen } = await loadFullscreen();

    expect(await enterFullscreen()).toEqual({ ok: false, active: false, backend: 'native' });
  });
});

describe('fullscreen toggle', () => {
  it('leaves fullscreen when the shell already reports it is active', async () => {
    native.value = true;
    plugin.isActive.mockResolvedValue({ active: true });
    const { toggleFullscreen } = await loadFullscreen();

    const result = await toggleFullscreen();

    expect(plugin.exit).toHaveBeenCalledTimes(1);
    expect(plugin.enter).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, active: false, backend: 'native' });
  });

  it('leaves fullscreen in a browser whose document element is fullscreen', async () => {
    fullscreenElement = document.documentElement;
    exitFullscreenDom.mockResolvedValue(undefined);
    const { toggleFullscreen } = await loadFullscreen();

    const result = await toggleFullscreen();

    expect(exitFullscreenDom).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, active: false, backend: 'web' });
  });

  it('enters fullscreen when the shell reports it is not active', async () => {
    native.value = true;
    const { toggleFullscreen } = await loadFullscreen();

    expect(await toggleFullscreen()).toEqual({ ok: true, active: true, backend: 'native' });
    expect(plugin.enter).toHaveBeenCalledTimes(1);
  });
});
