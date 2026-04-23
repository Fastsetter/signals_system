/**
 * ConvoSim — Express Server
 * Serves the static Convolution Simulator app.
 * Deployable to Render, Railway, Fly.io, Heroku, etc.
 */

'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3080;

/* ── Static files (index.html, style.css, main.js) ─── */
app.use(express.static(path.join(__dirname), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  },
}));

/* ── Health check ─── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ── API: signal presets ─── */
app.get('/api/presets', (_req, res) => {
  res.json({
    signals: ['rect', 'step', 'impulse', 'exp', 'triangle', 'sine'],
    modes:   ['continuous', 'discrete'],
    tRange:  [-8, 8],
  });
});

/* ── Catch-all → serve index.html ─── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start server ─── */
const server = app.listen(PORT, () => {
  console.log(`\n🌊  ConvoSim running at http://localhost:${PORT}\n`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Presets: http://localhost:${PORT}/api/presets\n`);
});

server.on('error', (err) => {
  console.error('\n❌ Server Error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`   Port ${PORT} is already in use. Resetting...`);
  }
});

module.exports = app;
