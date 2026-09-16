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

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', root.dataset.theme === 'dark' ? '#0f1116' : '#ffffff');

  const btn = document.getElementById('btn-theme');
  if (btn) {
    const label = `Theme: ${THEME_LABEL[currentPreference]}. Switch to ${THEME_LABEL[nextTheme(currentPreference)].toLowerCase()}`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', `${label} (T)`);
  }
}

export const THEME_LABEL = { system: 'Match my device', light: 'Light', dark: 'Dark' };

/** Keep "system" in step with the OS while the app is open. */
export function watchSystemTheme() {
  if (!media) return;
  const onChange = () => {
    if (currentPreference === 'system') document.documentElement.dataset.theme = resolve('system');
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else if (media.addListener) media.addListener(onChange);
}

export function nextTheme(theme) {
  return theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
}
