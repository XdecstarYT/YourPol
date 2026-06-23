// charts.js — lightweight canvas charts (line, sparkline, donut) for the data
// dashboards. No dependencies; crisp on high-DPI screens.

function setup(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// series: [{ label, color, data:[numbers] }]; all share the x index.
export function lineChart(canvas, series, opts = {}) {
  const w = opts.width || 560, h = opts.height || 220, pad = 34;
  const ctx = setup(canvas, w, h);
  ctx.clearRect(0, 0, w, h);
  const all = series.flatMap((s) => s.data);
  if (!all.length) return;
  let min = opts.min ?? Math.min(...all), max = opts.max ?? Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const n = Math.max(...series.map((s) => s.data.length));
  const X = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad - 8);
  const Y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad - 14);

  // grid + axis labels
  ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.fillStyle = '#8a97aa';
  ctx.font = '10px Inter, sans-serif'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const yv = min + (max - min) * (g / 4); const y = Y(yv);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 8, y); ctx.stroke();
    ctx.fillText(Math.round(yv), 4, y + 3);
  }

  for (const s of series) {
    ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    s.data.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // soft fill under the last series only when single
    if (series.length === 1) {
      ctx.lineTo(X(s.data.length - 1), h - pad); ctx.lineTo(X(0), h - pad); ctx.closePath();
      ctx.fillStyle = s.color + '22'; ctx.fill();
    }
  }
  // legend
  let lx = pad;
  ctx.font = '11px Inter, sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color; ctx.fillRect(lx, 6, 10, 10);
    ctx.fillStyle = '#5d6b80'; ctx.fillText(s.label, lx + 14, 15);
    lx += 22 + ctx.measureText(s.label).width;
  }
}

// donut: data [{label,value,color}]
export function donut(canvas, data, opts = {}) {
  const size = opts.size || 160; const ctx = setup(canvas, size, size);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 6, ir = r * 0.6;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  let a0 = -Math.PI / 2;
  for (const d of data) {
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = d.color; ctx.fill();
    a0 = a1;
  }
  ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
}
