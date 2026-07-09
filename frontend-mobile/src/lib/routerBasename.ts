/** React Router basename từ Vite base (vd. /m/ → /m, / → '') */
export function routerBasename(): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base === '/') return '';
  return base.replace(/\/$/, '');
}