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
  root.style.setProperty('--accent-h', String(settings.accentHue ?? 245));
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
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', rgb));
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
