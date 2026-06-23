// ausmap.js — a 3D map of Australia built from simplified SVG geography,
// extruded for depth and tilted in CSS perspective. States are filled by a
// caller-supplied colour function, so the same map shows state governments,
// seat holdings, or live election-night results.

const NS = 'http://www.w3.org/2000/svg';

// Simplified state/territory outlines on a 0..1000 × 0..800 canvas.
// Borders follow the real (largely straight-line) interior boundaries.
export const AUS_PATHS = {
  WA:  'M150,300 L165,420 L160,540 L300,575 L420,530 L420,200 L360,175 L300,195 L240,235 L185,255 Z',
  NT:  'M420,200 L420,407 L583,407 L583,175 L520,150 L470,160 Z',
  SA:  'M420,407 L420,520 L470,560 L500,540 L535,575 L565,545 L639,560 L639,407 Z',
  QLD: 'M583,407 L583,175 L612,205 L648,212 L662,150 L668,130 L705,205 L765,300 L825,385 L860,432 L872,458 L639,461 L639,407 Z',
  NSW: 'M639,461 L639,550 L700,575 L760,600 L805,613 L850,540 L872,458 Z',
  VIC: 'M639,550 L700,575 L760,600 L805,613 L770,640 L710,650 L660,635 L645,600 L639,560 Z',
  TAS: 'M700,675 L760,665 L780,700 L765,735 L720,740 L700,710 Z',
};
export const AUS_CENTROIDS = {
  WA: [275, 400], NT: [500, 300], SA: [525, 478], QLD: [705, 300],
  NSW: [770, 522], VIC: [712, 612], TAS: [738, 705], ACT: [815, 578],
};
const ORDER = ['WA', 'NT', 'SA', 'QLD', 'NSW', 'VIC', 'TAS'];

function darken(hex, amt = 0.4) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#888888');
  if (!m) return '#555';
  const r = Math.round(parseInt(m[1], 16) * (1 - amt));
  const g = Math.round(parseInt(m[2], 16) * (1 - amt));
  const b = Math.round(parseInt(m[3], 16) * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

// Build the map. Returns { el, update(colorOf) } so colours can change live.
export function buildAusMap({ colorOf, labelOf, onClick, depth = 16 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'ausmap3d';
  const tilt = document.createElement('div');
  tilt.className = 'ausmap-tilt';
  wrap.appendChild(tilt);
  const color = (c) => colorOf?.(c) || '#8a8f94';

  // headless / no-SVG fallback
  if (typeof document.createElementNS !== 'function') return { el: wrap, update() {} };

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 800');
  svg.setAttribute('class', 'ausmap-svg');
  tilt.appendChild(svg);

  // extruded sides (drawn first, deepest at the bottom)
  for (const code of ORDER) {
    const side = darken(color(code), 0.5);
    for (let d = depth; d >= 1; d--) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', AUS_PATHS[code]);
      p.setAttribute('transform', `translate(0 ${d})`);
      p.setAttribute('fill', side);
      svg.appendChild(p);
    }
  }

  // top faces + labels
  const tops = {};
  for (const code of ORDER) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', AUS_PATHS[code]);
    p.setAttribute('fill', color(code));
    p.setAttribute('stroke', '#ffffff');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('class', 'ausmap-face');
    if (onClick) p.addEventListener('click', () => onClick(code));
    svg.appendChild(p);
    tops[code] = p;

    const [lx, ly] = AUS_CENTROIDS[code];
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', lx); t.setAttribute('y', ly);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'ausmap-label');
    t.textContent = labelOf ? labelOf(code) : code;
    svg.appendChild(t);
  }

  // ACT marker (too small to draw to scale)
  const [ax, ay] = AUS_CENTROIDS.ACT;
  const act = document.createElementNS(NS, 'circle');
  act.setAttribute('cx', ax + 18); act.setAttribute('cy', ay);
  act.setAttribute('r', 7); act.setAttribute('fill', color('ACT'));
  act.setAttribute('stroke', '#fff'); act.setAttribute('stroke-width', '2');
  if (onClick) act.addEventListener('click', () => onClick('ACT'));
  svg.appendChild(act);
  tops.ACT = act;
  const actLabel = document.createElementNS(NS, 'text');
  actLabel.setAttribute('x', ax + 30); actLabel.setAttribute('y', ay + 4);
  actLabel.setAttribute('class', 'ausmap-label small');
  actLabel.textContent = 'ACT';
  svg.appendChild(actLabel);

  return {
    el: wrap,
    update(newColorOf) {
      for (const code of [...ORDER, 'ACT']) {
        const c = newColorOf?.(code) || '#8a8f94';
        tops[code].setAttribute('fill', c);
      }
    },
  };
}
