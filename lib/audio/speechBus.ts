// One audio channel, several speakers.
//
// The assistant and the traffic-alert layer both use the device's voice. When a
// speed warning arrives mid-answer, something has to decide who yields. The
// decision is: the warning wins, always. A limit announcement that plays after
// the assistant finishes a sentence is a warning the driver hears too late.
//
// This module is the tiny registry that makes that possible without the traffic
// code importing the conversation engine (which would drag the LLM, mic and
// recorder into a speed check).
type Interrupt = () => void;

const interrupts = new Set<Interrupt>();

/** Register a way to silence a speech owner. Returns an unregister function. */
export function registerSpeechOwner(fn: Interrupt): () => void {
  interrupts.add(fn);
  return () => {
    interrupts.delete(fn);
  };
}

/**
 * Silence every registered speaker. Called before a traffic alert speaks.
 * Failures are swallowed: one broken speaker must not stop the warning.
 */
export function interruptAllSpeech(): void {
  for (const fn of interrupts) {
    try {
      fn();
    } catch {
      /* best-effort: a dead audio context is not a reason to stay silent */
    }
  }
}
