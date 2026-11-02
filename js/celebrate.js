/* celebrate.js — confetti for the moment a whole set is mastered.
 *
 * `checkMastered()` is pure bookkeeping: it notices the transition from "not
 * every term mastered" to "every term mastered" (stamping `progress.masteredAt`)
 * so the party happens once — and again later only if the set slipped back
 * (new terms, or a miss) and was re-mastered.
 */
import { truncate } from './utils.js';
import { toast } from './ui.js';

/** Terms that can be studied: both sides filled in. */
const studyable = (set) => set.terms.filter(t => String(t.term).trim() && String(t.definition).trim());

/** @returns {boolean} true exactly when the set has just become fully mastered. */
export function checkMastered(set, progress) {
  const terms = studyable(set);
  const all = terms.length > 0 && terms.every(t => progress.cards[t.id] && progress.cards[t.id].status === 'mastered');
  if (all && !progress.masteredAt) { progress.masteredAt = Date.now(); return true; }
  if (!all && progress.masteredAt) delete progress.masteredAt;
  return false;
}

/** Check, and if this is the moment, throw the party. Returns whether it did. */
export function celebrateIfMastered(set, progress) {
  if (!checkMastered(set, progress)) return false;
  confetti();
  toast(`🎉 You mastered every term in “${truncate(set.title, 40)}”!`, { type: 'good', timeout: 5200 });
  return true;
}

const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** A short burst of confetti from both bottom corners. No-op with reduced motion. */
export function confetti({ count = 160, duration = 2600 } = {}) {
  if (reducedMotion() || typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) { canvas.remove(); return; }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const hue = Number(getComputedStyle(document.documentElement).getPropertyValue('--accent-h')) || 245;
  const colors = [`hsl(${hue} 80% 60%)`, '#ffc94a', '#ff6b8b', '#3fd6a0', '#56b8ff', `hsl(${(hue + 60) % 360} 85% 62%)`];
  const W = innerWidth, H = innerHeight;
  const parts = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const angle = (left ? -60 : -120) + (Math.random() - 0.5) * 40;   // degrees, up and inwards
    const speed = 9 + Math.random() * 9 + Math.min(6, H / 160);
    return {
      x: left ? -10 : W + 10, y: H * 0.85,
      vx: Math.cos(angle * Math.PI / 180) * speed, vy: Math.sin(angle * Math.PI / 180) * speed,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      c: colors[i % colors.length], delay: Math.random() * 180,
    };
  });

  const t0 = performance.now();
  let last = t0;
  const frame = (now) => {
    const dt = Math.min(2.5, (now - last) / 16.7);
    last = now;
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    const fade = t > duration - 500 ? Math.max(0, (duration - t) / 500) : 1;
    for (const p of parts) {
      if (t < p.delay) continue;
      p.vy += 0.32 * dt;
      p.vx *= 0.992; p.vy *= 0.992;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.globalAlpha = fade;
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);   // flutter
      g.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else { removeEventListener('resize', resize); canvas.remove(); }
  };
  requestAnimationFrame(frame);
}
