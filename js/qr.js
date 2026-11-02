/* qr.js — a small, dependency-free QR code encoder (byte mode, versions 1–40).
 *
 * Follows ISO/IEC 18004: data is packed in byte mode, split into blocks with
 * Reed–Solomon error correction, laid out around the function patterns, and the
 * mask with the lowest penalty score is chosen. Output is a module matrix that
 * `qrSvg()` turns into a crisp, scalable SVG.
 */

const ECL = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = [1, 0, 3, 2];          // L, M, Q, H as written in the format info

// [ecl][version] — error-correction codewords per block, and number of blocks.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver, ecl) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];

/** Bytes that fit in byte mode at this version and error-correction level. */
export function capacity(ver, ecl = 'M') {
  const e = ECL[ecl];
  const countBits = ver < 10 ? 8 : 16;
  return Math.floor((dataCodewords(ver, e) * 8 - 4 - countBits) / 8);
}
export const MAX_QR_BYTES = capacity(40, 'L');   // 2953

/* ---------- Reed–Solomon over GF(256), polynomial 0x11D ---------- */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < divisor.length; i++) r[i] ^= gfMul(divisor[i], factor);
  }
  return r;
}

/* ---------- encoding ---------- */

/**
 * Encode text as a QR code.
 * @param {string} text
 * @param {{ecl?: 'L'|'M'|'Q'|'H', minEcl?: 'L'|'M'|'Q'|'H'}} [opts]
 *   ecl is the preferred level; when the text does not fit at any version it
 *   steps down towards minEcl (default L) before giving up.
 * @returns {{size:number, version:number, ecl:string, modules:boolean[][]}}
 * @throws if the text is too long for any QR code.
 */
export function encodeQR(text, { ecl = 'M', minEcl = 'L' } = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const order = ['H', 'Q', 'M', 'L'];
  for (let li = order.indexOf(ecl); li <= order.indexOf(minEcl); li++) {
    const level = order[li];
    for (let ver = 1; ver <= 40; ver++) {
      if (bytes.length <= capacity(ver, level)) return build(bytes, ver, ECL[level], level);
    }
  }
  throw new Error(`Too long for a QR code (${bytes.length} bytes; the maximum is ${MAX_QR_BYTES}).`);
}

function build(bytes, ver, e, eclName) {
  // 1. Bit stream: mode, length, data, terminator, padding.
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  const capBits = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // 2. Split into blocks, add error correction, interleave.
  const numBlocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]); });
  }

  // 3. Lay out the matrix.
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  const align = alignmentPositions(ver, size);
  const last = align.length - 1;
  align.forEach((ay, i) => align.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));

  drawFormat(0);                                   // reserve the format area
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit); setFn(b, a, bit);
    }
  }

  // Zig-zag the codewords into the free modules.
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!isFn[y][x] && bi < codewords.length * 8) {
          modules[y][x] = ((codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1;
          bi++;
        }
      }
    }
  }

  // 4. Try all eight masks, keep the one with the lowest penalty.
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const score = penalty(modules);
    if (score < bestScore) { bestScore = score; best = m; }
    applyMask(m);                                  // XOR again to undo
  }
  applyMask(best); drawFormat(best);
  return { size, version: ver, ecl: eclName, modules };

  function drawFormat(mask) {
    const dataBits = (FORMAT_BITS[e] << 3) | mask;
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((dataBits << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);                      // the always-dark module
  }
  function applyMask(m) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isFn[y][x]) continue;
      let inv;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv) modules[y][x] = !modules[y][x];
    }
  }
}

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Standard penalty rules: long runs, 2×2 blocks, finder look-alikes, dark balance. */
function penalty(m) {
  const size = m.length;
  let score = 0, dark = 0;
  const finderLike = /10111010000|00001011101/g;
  const lines = [];
  for (let y = 0; y < size; y++) {
    let row = '', col = '';
    for (let x = 0; x < size; x++) { row += m[y][x] ? 1 : 0; col += m[x][y] ? 1 : 0; if (m[y][x]) dark++; }
    lines.push(row, col);
  }
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) || []) score += run.length - 2;
    score += 40 * ((line.match(finderLike) || []).length);
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
  return score + Math.max(0, k) * 10;
}

/**
 * SVG markup-free rendering: returns an <svg> element. Always dark-on-white
 * with a 4-module quiet zone, whatever the app theme — scanners need contrast.
 */
export function qrSvg(qr, { label = 'QR code' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const quiet = 4;
  const dim = qr.size + quiet * 2;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(dim)); bg.setAttribute('height', String(dim)); bg.setAttribute('fill', '#fff');
  let d = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}

/** Draw onto a canvas (for "Save image"). */
export function qrCanvas(qr, scale = 8) {
  const quiet = 4;
  const dim = (qr.size + quiet * 2) * scale;
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, dim, dim);
  g.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.modules[y][x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
  return c;
}
