/**
 * A repeating timer that keeps its pace in a background tab.
 *
 * Browsers slow `setInterval` right down in hidden tabs (to once a minute
 * after a few minutes). That's fatal for keep-alives: the matchmaking server
 * or the other player decides we've gone. Timers inside a Worker aren't
 * throttled that way, so the tick comes from one. Falls back to a plain
 * interval where workers aren't available.
 *
 * Returns a function that stops the timer.
 */
export function steadyInterval(ms: number, fn: () => void): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.max(10, Math.round(ms))});`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = () => fn();
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
