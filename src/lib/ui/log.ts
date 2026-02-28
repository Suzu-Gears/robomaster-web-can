export function appendLogLine(
  logElement: HTMLElement | null,
  msg: string,
): void {
  console.log(`Log: ${msg}`);
  if (!logElement) return;

  const line = document.createElement("div");
  line.textContent = `> ${msg}`;
  logElement.appendChild(line);
  logElement.scrollTop = logElement.scrollHeight;
}
