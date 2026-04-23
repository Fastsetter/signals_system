// api/presets.js
export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(200).json({
    signals: ['rect', 'step', 'impulse', 'exp', 'triangle', 'sine'],
    modes: ['continuous', 'discrete'],
    tRange: [-8, 8],
  });
}
