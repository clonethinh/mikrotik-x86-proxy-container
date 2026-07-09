export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('empty');

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through
    }
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand copy failed');
  } finally {
    document.body.removeChild(ta);
  }
}