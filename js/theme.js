/* theme.js — apply appearance settings to the document root. */

export const ACCENTS = [
  { hue: 245, name: 'Indigo' },
  { hue: 275, name: 'Violet' },
  { hue: 212, name: 'Blue' },
  { hue: 178, name: 'Teal' },
  { hue: 145, name: 'Green' },
  { hue: 32, name: 'Amber' },
  { hue: 350, name: 'Rose' },
];

/* ---------- readable accents ----------
 * The accent is one hue at fixed saturation/lightness, so white text on it is
 * fine for Indigo but unreadable for Teal or Green (under 2:1). For the light
 * theme, pick per hue: white text if it reads (≥ 4.5:1), otherwise dark text,
 * otherwise deepen the accent until white reads. Same for the accent-coloured
 * text used on pale accent backgrounds. Dark theme already uses dark-on-light.
 */
const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};
const luminance = ([r, g, b]) => {
  const c = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
export const contrast = (a, b) => { const A = luminance(a), B = luminance(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };

/** @returns {{l:number, fg:string, textL:number}} lightness %, button text colour, accent-text lightness % */
export function accentTones(hue, sat = 62) {
  const WHITE = [1, 1, 1], AA = 4.5;
  const dark = hslToRgb(hue, 60, 12);
  let l = 58, fg = '#fff';
  if (contrast(WHITE, hslToRgb(hue, sat, l)) < AA) {
    if (contrast(dark, hslToRgb(hue, sat, l)) >= AA) fg = `hsl(${hue} 60% 12%)`;
    else while (l > 30 && contrast(WHITE, hslToRgb(hue, sat, l)) < AA) l--;
  }
  // accent-coloured text must read on the pale accent background and on white
  let textL = 42;
  const soft = hslToRgb(hue, sat, 96);
  while (textL > 20 && (contrast(hslToRgb(hue, sat, textL), soft) < AA || contrast(hslToRgb(hue, sat, textL), WHITE) < AA)) textL--;
  return { l, fg, textL };
}

const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let currentPreference = 'system';

function resolve(theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  return media && media.matches ? 'dark' : 'light';
}

/** The tab icon is generated from the accent hue, so it matches the app. */
function applyFavicon(hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64" rx="14" fill="hsl(${hue} 62% 56%)"/>`
    + `<rect x="13" y="17" width="31" height="23" rx="4" fill="#fff" opacity=".5"/>`
    + `<rect x="20" y="24" width="31" height="23" rx="4" fill="#fff"/></svg>`;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function applyAppearance(settings) {
  const root = document.documentElement;
  currentPreference = settings.theme || 'system';
  root.dataset.theme = resolve(currentPreference);
  // The settings live in IndexedDB, which only resolves well after the first
  // paint. Mirroring the preference here lets the inline script in the head
  // set the theme and the status bar synchronously on the next visit.
  try { localStorage.setItem('studylab:theme', currentPreference); } catch { /* private mode */ }
  root.style.setProperty('--accent-h', String(settings.accentHue ?? 245));
  const tones = accentTones(settings.accentHue ?? 245);
  root.style.setProperty('--accent-l', tones.l + '%');
  root.style.setProperty('--accent-fg', tones.fg);
  root.style.setProperty('--accent-text-l', tones.textL + '%');
  applyFavicon(settings.accentHue ?? 245);
  root.style.setProperty('--fs-scale', String(settings.fontScale ?? 1));
  root.dataset.readfont = settings.readFont || 'sans';
  if (settings.reduceMotion) root.dataset.motion = 'reduced'; else delete root.dataset.motion;

  applyThemeColor();

  const btn = document.getElementById('btn-theme');
  if (btn) {
    const label = `Theme: ${THEME_LABEL[currentPreference]}. Switch to ${THEME_LABEL[nextTheme(currentPreference)].toLowerCase()}`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', `${label} (T)`);
  }
}

/**
 * iOS paints the status bar / Dynamic Island area and Safari's chrome with
 * `theme-color`. Hard-coding it meant a white bar above an off-white page, so
 * read the live --c-bg token instead and the bar can never drift from the
 * background it sits against.
 *
 * The meta element is replaced rather than edited: Safari does not reliably
 * repaint the bar when an existing meta's `content` changes under it, but it
 * always picks up a freshly inserted one.
 */
export function applyThemeColor() {
  const root = document.documentElement;
  const token = getComputedStyle(root).getPropertyValue('--c-bg').trim();
  if (!token) return;
  // A custom property computes to its raw text ("hsl(240 20% 97%)"), which the
  // meta will not take. Round-trip it through a real colour declaration.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:' + token;
  (document.body || root).appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  if (!rgb) return;

  for (const stale of document.querySelectorAll('meta[name="theme-color"]')) stale.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = rgb;
  document.head.appendChild(meta);
}

export const THEME_LABEL = { system: 'Match my device', light: 'Light', dark: 'Dark' };

/** Keep "system" in step with the OS while the app is open. */
export function watchSystemTheme() {
  if (!media) return;
  const onChange = () => {
    if (currentPreference !== 'system') return;
    document.documentElement.dataset.theme = resolve('system');
    applyThemeColor();        // the bar has to follow the page across the flip
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else if (media.addListener) media.addListener(onChange);
}

export function nextTheme(theme) {
  return theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
}
