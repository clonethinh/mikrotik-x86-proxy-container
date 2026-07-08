/** RouterOS REST often returns status="" for running containers (no healthcheck). */
export function isContainerRunning(status: string | null | undefined): boolean {
  const s = (status || '').toLowerCase();
  return ['running', 'r', 'healthy', 'h', ''].includes(s) || s.includes('good');
}