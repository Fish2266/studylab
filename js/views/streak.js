/* views/streak.js — the streak counter and study calendar shown on the library.
 *
 * The heatmap is a row of week columns (Sunday at the top), newest on the
 * right. It renders a full year and lets the container clip the oldest weeks,
 * so a phone shows ~4 months and a laptop shows the whole year with no maths
 * about widths.
 */
import { el, plural } from '../utils.js';
import * as data from '../data.js';

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 0–4 shade for a day's count. */
export function level(n) {
  if (!n) return 0;
  if (n < 10) return 1;
  if (n < 30) return 2;
  if (n < 60) return 3;
  return 4;
}

export function streakCard(now = new Date()) {
  const days = data.getActivity().days;
  const info = data.streakInfo(days, now);

  const headline = info.current
    ? el('div', { class: 'streak__n' }, el('span', { class: 'streak__flame', 'aria-hidden': 'true' }, '🔥'), String(info.current))
    : el('div', { class: 'streak__n streak__n--zero' }, el('span', { class: 'streak__flame', 'aria-hidden': 'true' }, '🔥'), '0');

  const sub = info.current
    ? (info.studiedToday ? '✓ Done for today — see you tomorrow' : 'Study anything today to keep it going')
    : info.totalDays ? 'Study anything today to start a new streak' : 'Study any set to start one';

  const meta = [
    info.today ? `${info.today} studied today` : null,
    info.best > 1 ? `Best ${plural(info.best, 'day')}` : null,
    info.totalDays ? `${plural(info.totalDays, 'day')} total` : null,
  ].filter(Boolean).join(' · ');

  // Brand new: one friendly line instead of a year of empty squares.
  if (!info.totalDays) {
    return el('section', { class: 'streak streak--new card', 'aria-label': 'Study streak' },
      el('div', { class: 'streak__head' }, headline,
        el('div', { class: 'streak__text' },
          el('div', { class: 'streak__title' }, 'Start a study streak'),
          el('div', { class: 'streak__sub' }, 'Study any set today and your calendar starts filling in here.'))));
  }

  return el('section', { class: 'streak card', 'aria-label': 'Study streak' },
    el('div', { class: 'streak__head' },
      headline,
      el('div', { class: 'streak__text' },
        el('div', { class: 'streak__title' }, info.current ? 'day streak' : 'No streak yet'),
        el('div', { class: 'streak__sub' }, sub),
        meta ? el('div', { class: 'streak__meta' }, meta) : null)),
    heatmap(days, now));
}

export function heatmap(days, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = data.dayKey(today);
  // Start on the Sunday WEEKS-1 weeks before this week's Sunday.
  const start = data.addDays(today, -today.getDay() - (WEEKS - 1) * 7);

  const cols = [];
  let studied = 0;
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = data.addDays(start, w * 7);
    // Label the column in which a month begins (the 1st falls inside it).
    const weekEnd = data.addDays(weekStart, 6);
    const label = weekStart.getDate() === 1 ? MONTHS[weekStart.getMonth()]
      : weekStart.getMonth() !== weekEnd.getMonth() ? MONTHS[weekEnd.getMonth()] : '';
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const day = data.addDays(weekStart, d);
      const key = data.dayKey(day);
      if (day > today) { cells.push(el('span', { class: 'heat__cell is-future' })); continue; }
      const n = days[key] || 0;
      if (n) studied++;
      cells.push(el('span', {
        class: `heat__cell l${level(n)}${key === todayKey ? ' is-today' : ''}`,
        title: `${day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${n ? plural(n, 'thing') + ' studied' : 'no study'}`,
      }));
    }
    // Labels near the right edge grow leftwards so "Nov" is not cut off.
    cols.push(el('div', { class: 'heat__col' }, el('span', { class: `heat__month${w >= WEEKS - 2 ? ' is-end' : ''}` }, label), ...cells));
  }

  return el('div', { class: 'heat' },
    el('div', { class: 'heat__scroll', role: 'img', 'aria-label': `Study calendar: studied on ${plural(studied, 'day')} in the last year` },
      el('div', { class: 'heat__days', 'aria-hidden': 'true' },
        el('span', {}, ''), el('span', {}, ''), el('span', {}, 'Mon'), el('span', {}, ''), el('span', {}, 'Wed'), el('span', {}, ''), el('span', {}, 'Fri'), el('span', {}, '')),
      el('div', { class: 'heat__clip' }, el('div', { class: 'heat__grid', 'aria-hidden': 'true' }, ...cols))),
    el('div', { class: 'heat__legend', 'aria-hidden': 'true' },
      'Less', ...[0, 1, 2, 3, 4].map(l => el('span', { class: `heat__cell l${l}` })), 'More'));
}
