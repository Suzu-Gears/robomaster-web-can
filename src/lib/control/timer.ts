export function resolveIntervalMs(intervalMs: number): number {
  return Math.max(10, intervalMs || 10);
}

export function restartControlLoop(
  timer: number | null,
  intervalMs: number,
  callback: () => void | Promise<void>,
): number {
  if (timer) clearInterval(timer);
  return window.setInterval(() => {
    void callback();
  }, resolveIntervalMs(intervalMs));
}

export function stopControlLoop(timer: number | null): null {
  if (timer) clearInterval(timer);
  return null;
}

export function startRenderLoop(
  shouldContinue: () => boolean,
  onFrame: (time: number) => void,
): void {
  requestAnimationFrame(function loop(time: number) {
    if (!shouldContinue()) return;
    onFrame(time);
    requestAnimationFrame(loop);
  });
}
