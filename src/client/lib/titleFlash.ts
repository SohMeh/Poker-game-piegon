// Flashes the tab title ("Your turn!") until stopped.
let timer: ReturnType<typeof setInterval> | null = null;
let base = typeof document !== 'undefined' ? document.title : '';

export function setBaseTitle(title: string): void {
  base = title;
  if (!timer) document.title = title;
}

export function flashTitle(message: string): void {
  stopTitleFlash();
  let on = true;
  document.title = message;
  timer = setInterval(() => {
    on = !on;
    document.title = on ? message : base;
  }, 900);
}

export function stopTitleFlash(): void {
  if (timer) clearInterval(timer);
  timer = null;
  document.title = base;
}
