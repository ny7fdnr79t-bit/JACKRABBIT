// Vercel serverless function: POST /api/ai — the CRM's built-in assistant.
// Env vars (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  from console.anthropic.com → API keys
//   CRM_KEY            the same key the CRM uses for website forms
//   AI_MODEL           optional, defaults to claude-sonnet-4-5

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.CRM_KEY || req.headers['x-crm-key'] !== process.env.CRM_KEY) return res.status(401).json({ error: 'Access key doesn’t match CRM_KEY.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY isn’t set in Vercel.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { system, messages } = body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'No messages.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-4-5', max_tokens: 2000, system: String(system || ''), messages: messages.slice(-24) })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || 'Anthropic API error ' + r.status });
    res.status(200).json({ text: (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') });
  } catch (e) {
    res.status(500).json({ error: 'Couldn’t reach the AI service.' });
  }
};
