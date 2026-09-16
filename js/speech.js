/* speech.js — optional text-to-speech via the Web Speech API.
 * Degrades to a no-op when the browser has no voices (many Linux builds, some
 * mobile webviews) so callers never need to feature-test.
 */
let voices = [];
let ready = false;

export const supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

function loadVoices() {
  if (!supported) return;
  voices = speechSynthesis.getVoices() || [];
  ready = voices.length > 0;
}
if (supported) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

export function listVoices() { if (!ready) loadVoices(); return voices; }
function pickVoice(lang) {
  if (!lang) return null;
  const all = listVoices();
  return all.find(v => v.lang === lang)
      || all.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
      || null;
}

let current = null;
export function speak(text, { lang = '', rate = 1, onend } = {}) {
  if (!supported || !text) { onend && onend(); return; }
  try {
    cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 600));
    const v = pickVoice(lang);
    if (v) u.voice = v;
    if (lang) u.lang = lang;
    u.rate = Math.min(2, Math.max(0.5, rate));
    if (onend) { u.onend = onend; u.onerror = onend; }
    current = u;
    speechSynthesis.speak(u);
  } catch { onend && onend(); }
}
export function cancel() {
  if (!supported) return;
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  current = null;
}