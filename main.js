/* ═══════════════════════════════════════════════════════════
   ConvoSim — main.js  (Plotly.js edition)
   6-panel: x(τ), h(τ), h(t−τ) flipped, x·h product,
             y(t) output, |Y(f)| magnitude spectrum
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────────── */
const T_MIN    = -8;
const T_MAX    =  8;
const N_SAMP   = 1600;           // samples for continuous mode
const DT       = (T_MAX - T_MIN) / N_SAMP;
const DISC_N   = 40;             // discrete stem count

/* ── PLOTLY THEME SHARED (Light Mode) ──────────────────── */
const PLY_LAYOUT_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { family: 'JetBrains Mono, monospace', color: '#64748b', size: 10 },
  margin: { l: 36, r: 10, t: 4, b: 30 },
  showlegend: false,
  xaxis: {
    gridcolor: 'rgba(0,0,0,0.05)',
    zerolinecolor: 'rgba(0,0,0,0.12)',
    zerolinewidth: 1.5,
    tickcolor: 'rgba(0,0,0,0.1)',
    linecolor: 'rgba(0,0,0,0.05)',
    tickfont: { size: 9 },
    range: [T_MIN, T_MAX],
  },
  yaxis: {
    gridcolor: 'rgba(0,0,0,0.05)',
    zerolinecolor: 'rgba(0,0,0,0.12)',
    zerolinewidth: 1.5,
    tickcolor: 'rgba(0,0,0,0.1)',
    linecolor: 'rgba(0,0,0,0.05)',
    tickfont: { size: 9 },
  },
  hovermode: 'x unified',
  hoverlabel: {
    bgcolor: '#ffffff',
    bordercolor: '#e2e8f0',
    font: { family: 'JetBrains Mono, monospace', color: '#0f172a', size: 10 },
  },
};

const PLY_CONFIG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'lasso2d', 'select2d'],
  displaylogo: false,
};

const COLORS = {
  x:    '#0284c7', // Sky 600
  h:    '#ea580c', // Orange 600
  flip: '#7c3aed', // Violet 600
  mul:  '#db2777', // Pink 600
  y:    '#059669', // Emerald 600
  spec: '#d97706', // Amber 600
  grid: 'rgba(0,0,0,0.05)',
  cur:  'rgba(79, 70, 229, 0.85)', // Indigo
};

/* ── STATE ─────────────────────────────────────────────── */
const state = {
  mode: 'continuous',
  t: T_MIN,
  playing: false,
  speed: 1,
  initialized: false,

  x: { type: 'rect', amp: 1, width: 2, shift: 0, freq: 1, drawSamples: null },
  h: { type: 'rect', amp: 1, width: 2, shift: 0, freq: 1, drawSamples: null },

  tAxis: null,
  xArr: null,
  hArr: null,
  yFull: null,
};

/* ═══════════════════════════════════════════════════════════
   SIGNAL ENGINE
   ═══════════════════════════════════════════════════════════ */

function evalSignal(params, t) {
  const { type, amp, width, shift, freq, drawSamples } = params;
  const t0 = t - shift;

  if (type === 'draw' && drawSamples) {
    const N = drawSamples.length;
    const idx = Math.round(((t - T_MIN) / (T_MAX - T_MIN)) * (N - 1));
    if (idx < 0 || idx >= N) return 0;
    return drawSamples[idx] * amp;
  }

  switch (type) {
    case 'rect':
      return (t0 >= -width / 2 && t0 < width / 2) ? amp : 0;
    case 'step':
      return t0 >= 0 ? amp : 0;
    case 'impulse':
      return Math.abs(t0) < 0.12 ? amp / 0.24 : 0;
    case 'exp':
      return t0 >= 0 ? amp * Math.exp(-t0 * (3 / Math.max(width, 0.1))) : 0;
    case 'triangle': {
      const hw = width / 2;
      if (t0 < -hw || t0 > hw) return 0;
      return amp * (1 - Math.abs(t0) / hw);
    }
    case 'sine':
      return amp * Math.sin(2 * Math.PI * freq * t0);
    default: return 0;
  }
}

function buildArr(params, tArr) {
  return tArr.map(t => evalSignal(params, t));
}

function buildFlipped(t, tArr) {
  return tArr.map(tau => evalSignal(state.h, t - tau));
}

function buildMul(t, tArr, xArr) {
  return tArr.map((tau, i) => xArr[i] * evalSignal(state.h, t - tau));
}

/* ── CONVOLUTION (numerical integration) ───────────────── */
function computeConvolution(tArr, xArr) {
  const N = tArr.length;
  return Float64Array.from({ length: N }, (_, i) => {
    const t = tArr[i];
    let sum = 0;
    for (let j = 0; j < N; j++) {
      sum += xArr[j] * evalSignal(state.h, t - tArr[j]);
    }
    return sum * DT;
  });
}

/* ── FFT (Cooley-Tukey, power-of-2 length) ─────────────── */
function fft(data) {
  const N = data.length;
  if (N <= 1) return data;
  
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for(let i=0; i<N; i++) { re[i] = data[i].re; im[i] = data[i].im; }

  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i+j], ui = im[i+j];
        const vr = re[i+j+len/2]*cr - im[i+j+len/2]*ci;
        const vi = re[i+j+len/2]*ci + im[i+j+len/2]*cr;
        re[i+j]          = ur + vr; im[i+j]          = ui + vi;
        re[i+j+len/2]    = ur - vr; im[i+j+len/2]    = ui - vi;
        const ncr = cr*wr - ci*wi;
        ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
  return Array.from({length: N}, (_, i) => ({re: re[i], im: im[i]}));
}

function computeSpectrum(signal) {
  const n = signal.length;
  if ((n & (n - 1)) !== 0) return { mag: new Float64Array(n/2), fAxis: new Float64Array(n/2) }; 
  const complex = fft(Array.from(signal).map(v => ({ re: v, im: 0 })));
  const mag = complex.slice(0, n/2).map(c => Math.sqrt(c.re*c.re + c.im*c.im) / n);
  const fAxis = mag.map((_, i) => i / (n * DT));
  return { mag, fAxis };
}

/** ── NEW: INVERSE FFT ── **/
function ifft(complex) {
  const n = complex.length;
  const conj = complex.map(c => ({ re: c.re, im: -c.im }));
  const transformed = fft(conj);
  return transformed.map(c => ({ re: c.re / n, im: -c.im / n }));
}

/** ── NEW: FFT-BASED CONVOLUTION (CONVOLUTION THEOREM) ── **/
function computeFFTConvolution(x, h) {
  const N_PAD = 2048;
  const xPad = Array(N_PAD).fill(0);
  const hPad = Array(N_PAD).fill(0);
  
  for(let i=0; i<x.length; i++) xPad[i] = x[i];
  for(let i=0; i<h.length; i++) hPad[i] = h[i];

  const X = fft(xPad.map(v => ({ re: v, im: 0 })));
  const H = fft(hPad.map(v => ({ re: v, im: 0 })));

  const Yf = X.map((Xc, i) => {
    const Hc = H[i];
    return {
      re: Xc.re * Hc.re - Xc.im * Hc.im,
      im: Xc.re * Hc.im + Xc.im * Hc.re
    };
  });

  const yComplex = ifft(Yf);
  return yComplex.slice(0, x.length).map(c => c.re * DT * (N_PAD / x.length));
}

/* ── build uniform time axis ───────────────────────────── */
function buildTimeAxis() {
  const arr = new Float64Array(N_SAMP + 1);
  for (let i = 0; i <= N_SAMP; i++) arr[i] = T_MIN + i * DT;
  return arr;
}

/* ── downSample for Plotly (improves perf) ─────────────── */
function down(arr, factor = 2) {
  const out = [];
  for (let i = 0; i < arr.length; i += factor) out.push(arr[i]);
  return out;
}

/* ── autorange Y ───────────────────────────────────────── */
function yRange(...arrs) {
  let mn = Infinity, mx = -Infinity;
  for (const a of arrs) {
    for (const v of a) {
      if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    }
  }
  if (!isFinite(mn)) return [-1, 2];
  const pad = Math.max((mx - mn) * 0.25, 0.5);
  return [mn - pad, mx + pad];
}

/* ═══════════════════════════════════════════════════════════
   PLOTLY RENDERING
   ═══════════════════════════════════════════════════════════ */

function layout(yRng, xTitle = 'τ', yTitle = '') {
  return {
    ...PLY_LAYOUT_BASE,
    xaxis: { ...PLY_LAYOUT_BASE.xaxis, title: { text: xTitle, font: { size: 9 } }, range: [T_MIN, T_MAX] },
    yaxis: { ...PLY_LAYOUT_BASE.yaxis, title: { text: yTitle, font: { size: 9 } }, range: yRng ?? undefined },
  };
}

function cursorShape(t) {
  return [{
    type: 'line',
    x0: t, x1: t, y0: 0, y1: 1,
    xref: 'x', yref: 'paper',
    line: { color: COLORS.cur, width: 1.8, dash: 'dot' },
  }];
}

/* discrete stems helper */
function stemsTrace(tArr, yArr, color, name, factor = 4) {
  const xs = [], ys = [];
  const step = Math.max(1, Math.floor(tArr.length / DISC_N));
  for (let i = 0; i < tArr.length; i += step) {
    xs.push(tArr[i], tArr[i], tArr[i], null);
    ys.push(0,       yArr[i], null,    null);
  }
  return [
    { x: xs, y: ys, mode: 'lines', line: { color, width: 1.5 }, hoverinfo: 'skip', name },
    {
      x: down(Array.from(tArr), step),
      y: down(Array.from(yArr), step),
      mode: 'markers', marker: { color, size: 5 },
      name, hovertemplate: `τ=%{x:.3f}<br>${name}=%{y:.4f}<extra></extra>`,
    },
  ];
}

function contTrace(tArr, yArr, color, name, dash = 'solid', fill = null, fillColorRGBA = null) {
  const tr = {
    x: down(Array.from(tArr)),
    y: down(Array.from(yArr)),
    mode: 'lines',
    line: { color, width: 2, dash },
    name,
    hovertemplate: `τ=%{x:.3f}<br>${name}=%{y:.4f}<extra></extra>`,
  };
  if (fill && fillColorRGBA) {
    tr.fill = fill;
    tr.fillcolor = fillColorRGBA;
  }
  return tr;
}

/* ── initialized flag per div ───────────────────────────── */
const inited = { 'plot-x': false, 'plot-h': false, 'plot-f': false,
                 'plot-m': false, 'plot-y': false, 'plot-spec': false };

function plotOrUpdate(divId, data, lay) {
  if (inited[divId]) {
    Plotly.react(divId, data, lay, PLY_CONFIG);
  } else {
    Plotly.newPlot(divId, data, lay, PLY_CONFIG);
    inited[divId] = true;
  }
}

/* ── FULL RENDER ────────────────────────────────────────── */
function renderAll() {
  const t     = state.t;
  const tArr  = state.tAxis;
  const xArr  = state.xArr;
  const yFull = state.yFull;
  if (!tArr || !xArr || !yFull) return;

  const flipped = buildFlipped(t, tArr);
  const mulArr  = buildMul(t, tArr, xArr);

  // overlap area
  let area = 0;
  for (const v of mulArr) area += v * DT;
  const overlapPill = document.getElementById('overlap-pill');
  if (overlapPill) {
    if (Math.abs(area) > 1e-6) overlapPill.classList.add('visible');
    else overlapPill.classList.remove('visible');
  }

  // y partial (built up to cursor)
  const yPartial = Array.from(yFull).map((v, i) => tArr[i] <= t ? v : null);

  const isDisc = state.mode === 'discrete';
  const tA = Array.from(tArr);

  /* ──── Panel 1: x(τ) ────────────────────────────────── */
  plotOrUpdate('plot-x',
    isDisc ? stemsTrace(tArr, xArr, COLORS.x, 'x(τ)')
           : [contTrace(tA, xArr, COLORS.x, 'x(τ)')],
    layout(yRange(xArr))
  );

  /* ──── Panel 2: h(τ) ────────────────────────────────── */
  plotOrUpdate('plot-h',
    isDisc ? stemsTrace(tArr, state.hArr, COLORS.h, 'h(τ)')
           : [contTrace(tA, Array.from(state.hArr), COLORS.h, 'h(τ)')],
    layout(yRange(state.hArr))
  );

  /* ──── Panel 3: h(t−τ) flipped & shifted ───────────── */
  {
    const yr3 = yRange(xArr, flipped);
    const data3 = isDisc
      ? [
          ...stemsTrace(tArr, xArr,    COLORS.x,    'x(τ)',    4),
          ...stemsTrace(tArr, flipped, COLORS.flip,  'h(t−τ)', 4),
        ]
      : [
          contTrace(tA, Array.from(xArr), COLORS.x, 'x(τ)', 'dot'),
          contTrace(tA, flipped, COLORS.flip, 'h(t−τ)'),
          // shaded overlap fill
          {
            x: down(tA),
            y: down(mulArr.map(v => v > 0 ? v : 0)),
            mode: 'lines', line: { color: 'transparent' },
            fill: 'tozeroy', fillcolor: 'rgba(167,139,250,0.22)',
            hoverinfo: 'skip', name: 'Overlap+',
          },
          {
            x: down(tA),
            y: down(mulArr.map(v => v < 0 ? v : 0)),
            mode: 'lines', line: { color: 'transparent' },
            fill: 'tozeroy', fillcolor: 'rgba(244,114,182,0.15)',
            hoverinfo: 'skip', name: 'Overlap−',
          },
        ];
    plotOrUpdate('plot-f', data3, {
      ...layout(yr3),
      shapes: cursorShape(t),
    });
  }

  /* ──── Panel 4: Multiplication x(τ)·h(t−τ) ─────────── */
  {
    const yr4 = yRange(mulArr);
    const data4 = isDisc
      ? stemsTrace(tArr, mulArr, COLORS.mul, 'x·h')
      : [
          contTrace(tA, mulArr, COLORS.mul, 'x(τ)·h(t−τ)'),
          {
            x: down(tA), y: down(Array.from(mulArr)),
            mode: 'lines', line: { color: 'transparent' },
            fill: 'tozeroy', fillcolor: 'rgba(244,114,182,0.20)',
            hoverinfo: 'skip', name: 'Area',
          },
        ];
    plotOrUpdate('plot-m', data4, {
      ...layout(yr4),
      shapes: cursorShape(t),
      annotations: [{
        x: 0.98, y: 0.96, xref: 'paper', yref: 'paper',
        text: `Area = ${area.toFixed(4)}`,
        showarrow: false, font: { color: COLORS.mul, size: 9, family: 'JetBrains Mono' },
        xanchor: 'right',
      }],
    });
  }

  /* ──── Panel 5: y(t) ────────────────────────────────── */
  {
    const yr5 = yRange(yFull);
    const data5 = isDisc
      ? stemsTrace(tArr, yFull, COLORS.y, 'y(t)')
      : [
          // full y (faded)
          { x: down(tA), y: down(Array.from(yFull)), mode: 'lines',
            line: { color: 'rgba(52,211,153,0.18)', width: 1 }, hoverinfo: 'skip', name: 'y(t) full' },
          // built-up y
          { x: down(tA), y: down(yPartial), mode: 'lines',
            line: { color: COLORS.y, width: 2 }, connectgaps: false,
            name: 'y(t)', hovertemplate: 't=%{x:.3f}<br>y=%{y:.4f}<extra></extra>' },
          // current point
          { x: [t], y: [yFull[Math.round((t - T_MIN) / DT)] || 0],
            mode: 'markers', marker: { color: COLORS.y, size: 8, symbol: 'circle' },
            name: 'y(t*)', hovertemplate: 't=%{x:.3f}<br>y=%{y:.4f}<extra></extra>' },
        ];
    plotOrUpdate('plot-y', data5, {
      ...layout(yr5, 't'),
      shapes: cursorShape(t),
    });
  }

  /* ──── Panel 6: |Y(f)| spectrum ─────────────────────── */
  {
    const { mag, fAxis } = computeSpectrum(yFull);
    const fMax = Math.min(10, fAxis[fAxis.length - 1]);  // show up to 10 Hz
    const fCutIdx = fAxis.findIndex(f => f > fMax) || fAxis.length;
    const fSlice = Array.from(fAxis.slice(0, fCutIdx));
    const mSlice = Array.from(mag.slice(0, fCutIdx));
    const peakMag = Math.max(...mSlice);

    plotOrUpdate('plot-spec',
      [
        {
          x: fSlice, y: mSlice,
          type: isDisc ? 'bar' : 'scatter',
          mode: isDisc ? undefined : 'lines',
          line: { color: COLORS.spec, width: 2 },
          marker: { color: COLORS.spec, opacity: 0.8 },
          fill: isDisc ? undefined : 'tozeroy',
          fillcolor: 'rgba(250,204,21,0.12)',
          name: '|Y(f)|',
          hovertemplate: 'f=%{x:.2f} Hz<br>|Y|=%{y:.4f}<extra></extra>',
        },
      ],
      {
        ...layout(undefined, 'f (Hz)', '|Y(f)|'),
        xaxis: { ...PLY_LAYOUT_BASE.xaxis, range: [0, fMax], title: { text: 'f (Hz)', font: { size: 9 } } },
        annotations: [{
          x: 0.98, y: 0.96, xref: 'paper', yref: 'paper',
          text: `Peak: ${peakMag.toFixed(4)}`,
          showarrow: false, font: { color: COLORS.spec, size: 9, family: 'JetBrains Mono' },
          xanchor: 'right',
        }],
      }
    );

    // update info bar spec value
    document.getElementById('infoSpec').textContent = peakMag.toFixed(4);
  }

  /* ──── Info bar ──────────────────────────────────────── */
  const tIdx = Math.min(Math.round((t - T_MIN) / DT), yFull.length - 1);
  const yVal = yFull[tIdx];
  document.getElementById('infoT').textContent    = t.toFixed(3);
  document.getElementById('tValDisplay').textContent = t.toFixed(2);
  document.getElementById('infoY').textContent    = isFinite(yVal) ? yVal.toFixed(4) : '—';
  document.getElementById('infoArea').textContent = area.toFixed(4);
}

/* ── RECOMPUTE ──────────────────────────────────────────── */
function recompute() {
  state.xArr  = buildArr(state.x, state.tAxis);
  state.hArr  = buildArr(state.h, state.tAxis);
  state.yFull = computeConvolution(state.tAxis, state.xArr);
  renderAll();
}

/* ═══════════════════════════════════════════════════════════
   ANIMATION
   ═══════════════════════════════════════════════════════════ */
let animId = null, lastTs = null;

function startAnim() {
  if (state.t >= T_MAX) state.t = T_MIN;
  state.playing = true;
  lastTs = null;
  document.getElementById('btnPlay').textContent = '⏸';
  document.getElementById('btnPlay').classList.add('playing');
  animId = requestAnimationFrame(animLoop);
}

function stopAnim() {
  state.playing = false;
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  document.getElementById('btnPlay').textContent = '▶';
  document.getElementById('btnPlay').classList.remove('playing');
  lastTs = null;
}

function animLoop(ts) {
  if (!state.playing) return;
  if (lastTs === null) lastTs = ts;
  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  state.t += dt * state.speed * 2.8;
  if (state.t > T_MAX) { state.t = T_MAX; stopAnim(); }
  document.getElementById('tSlider').value = state.t;
  renderAll();
  if (state.playing) animId = requestAnimationFrame(animLoop);
}

/* ═══════════════════════════════════════════════════════════
   MOUSE DRAW
   ═══════════════════════════════════════════════════════════ */
function initDrawCanvas(canvasEl, sig, colorHex) {
  const N = N_SAMP + 1;
  if (!sig.drawSamples) sig.drawSamples = new Float32Array(N);
  let drawing = false;

  function pos(e) {
    const r = canvasEl.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      nx: Math.max(0, Math.min(1, (cx - r.left)  / r.width)),
      ny: Math.max(0, Math.min(1, (cy - r.top)   / r.height)),
    };
  }

  function mark(e) {
    const { nx, ny } = pos(e);
    const idx = Math.round(nx * (N - 1));
    sig.drawSamples[idx] = (1 - ny) * 4 - 2;  // map [0,1] → [2,−2]
  }

  function paint() {
    const ctx = canvasEl.getContext('2d');
    const W = canvasEl.width, H = canvasEl.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, W, H);
    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    // signal
    ctx.strokeStyle = colorHex; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const xp = (i / (N - 1)) * W;
      const yp = H - ((sig.drawSamples[i] + 2) / 4) * H;
      i === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
    }
    ctx.stroke();
  }

  canvasEl.addEventListener('mousedown', e => { drawing = true; mark(e); paint(); });
  canvasEl.addEventListener('mousemove', e => { if (drawing) { mark(e); paint(); } });
  canvasEl.addEventListener('mouseup',   () => { drawing = false; recompute(); });
  canvasEl.addEventListener('mouseleave',() => { drawing = false; });
  canvasEl.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; mark(e); paint(); }, { passive: false });
  canvasEl.addEventListener('touchmove',  e => { e.preventDefault(); if (drawing) { mark(e); paint(); } }, { passive: false });
  canvasEl.addEventListener('touchend',   () => { drawing = false; recompute(); });
  paint();
}

/* ═══════════════════════════════════════════════════════════
   UI WIRING
   ═══════════════════════════════════════════════════════════ */
function bindSlider(id, valId, sigKey, paramKey, fmt) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!el) return;
  vl.textContent = fmt(state[sigKey][paramKey]);
  el.addEventListener('input', () => {
    state[sigKey][paramKey] = parseFloat(el.value);
    vl.textContent = fmt(parseFloat(el.value));
    recompute();
  });
}

function setType(sigKey, type) {
  state[sigKey].type = type;
  const slidersEl = document.getElementById(sigKey + 'Sliders');
  const drawEl    = document.getElementById(sigKey + 'DrawZone');
  const freqEl    = document.getElementById(sigKey + 'FreqRow');

  if (type === 'draw') {
    slidersEl.style.display = 'none';
    drawEl.style.display    = 'flex';
    const dc = document.getElementById(sigKey + 'DrawCanvas');
    const color = sigKey === 'x' ? '#38bdf8' : '#fb923c';
    initDrawCanvas(dc, state[sigKey], color);
  } else {
    slidersEl.style.display = 'flex';
    drawEl.style.display    = 'none';
    if (freqEl) freqEl.style.display = (type === 'sine') ? 'grid' : 'none';
  }
  recompute();
}

function initTypeGrid(sigKey) {
  const btns = document.querySelectorAll(`[data-sig="${sigKey}"]`);
  btns.forEach(btn => btn.addEventListener('click', () => {
    btns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setType(sigKey, btn.dataset.type);
  }));
}

function switchMode(mode) {
  state.mode = mode;
  document.getElementById('btnContinuous').classList.toggle('active', mode === 'continuous');
  document.getElementById('btnDiscrete').classList.toggle('active', mode === 'discrete');
  document.getElementById('infoMode').textContent   = mode.charAt(0).toUpperCase() + mode.slice(1);
  document.getElementById('formulaText').textContent = mode === 'continuous'
    ? 'y(t) = ∫ x(τ) · h(t−τ) dτ'
    : 'y[n] = Σ x[k] · h[n−k]';
  renderAll();
}

/* ── INIT ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  state.tAxis = buildTimeAxis();

  // Signal type grids
  initTypeGrid('x');
  initTypeGrid('h');

  // Sliders
  bindSlider('xAmp',   'xAmpVal',   'x', 'amp',   v => v.toFixed(2));
  bindSlider('xWidth', 'xWidthVal', 'x', 'width', v => v.toFixed(1));
  bindSlider('xShift', 'xShiftVal', 'x', 'shift', v => v.toFixed(1));
  bindSlider('xFreq',  'xFreqVal',  'x', 'freq',  v => v.toFixed(1));
  bindSlider('hAmp',   'hAmpVal',   'h', 'amp',   v => v.toFixed(2));
  bindSlider('hWidth', 'hWidthVal', 'h', 'width', v => v.toFixed(1));
  bindSlider('hShift', 'hShiftVal', 'h', 'shift', v => v.toFixed(1));
  bindSlider('hFreq',  'hFreqVal',  'h', 'freq',  v => v.toFixed(1));

  // t slider
  const tSlider = document.getElementById('tSlider');
  tSlider.addEventListener('input', () => {
    if (state.playing) stopAnim();
    state.t = parseFloat(tSlider.value);
    renderAll();
  });

  // Speed
  const speedSlider = document.getElementById('speedSlider');
  speedSlider.addEventListener('input', () => {
    state.speed = parseFloat(speedSlider.value);
    document.getElementById('speedVal').textContent = state.speed.toFixed(1) + '×';
  });

  // Anim controls
  document.getElementById('btnPlay').addEventListener('click', () => {
    state.playing ? stopAnim() : startAnim();
  });
  document.getElementById('btnRewind').addEventListener('click', () => {
    stopAnim(); state.t = T_MIN;
    tSlider.value = T_MIN; renderAll();
  });
  document.getElementById('btnStep').addEventListener('click', () => {
    stopAnim(); state.t = Math.min(state.t + 0.25, T_MAX);
    tSlider.value = state.t; renderAll();
  });

  // Mode
  document.getElementById('btnContinuous').addEventListener('click', () => switchMode('continuous'));
  document.getElementById('btnDiscrete').addEventListener('click',   () => switchMode('discrete'));

  // Clear draw
  document.getElementById('xClearBtn').addEventListener('click', () => {
    state.x.drawSamples && state.x.drawSamples.fill(0);
    initDrawCanvas(document.getElementById('xDrawCanvas'), state.x, '#38bdf8');
    recompute();
  });
  document.getElementById('hClearBtn').addEventListener('click', () => {
    state.h.drawSamples && state.h.drawSamples.fill(0);
    initDrawCanvas(document.getElementById('hDrawCanvas'), state.h, '#fb923c');
    recompute();
  });

  // Help modal
  const modal = document.getElementById('helpModal');
  document.getElementById('helpBtn').addEventListener('click',  () => modal.classList.add('open'));
  document.getElementById('helpClose').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  // Initial computation
  recompute();
});
