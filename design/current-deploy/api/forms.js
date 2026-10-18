// Vercel serverless function: POST /api/forms (from wastely.ca) and GET /api/forms (from the CRM).
// Env vars (Vercel → Project → Settings → Environment Variables):
//   CRM_KEY            any long random string; typed into CRM → Team → Integrations → Website forms
//   ALLOWED_ORIGINS    optional, comma-separated; default https://wastely.ca,https://www.wastely.ca
//   KV_REST_API_URL / KV_REST_API_TOKEN   set automatically when you add "Upstash for Redis" from Vercel → Storage
//   (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also work)

const LIST = 'wastely:forms';
const MAX = 1000;

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Storage not configured');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

module.exports = async (req, res) => {
  const allowed = (process.env.ALLOWED_ORIGINS || 'https://wastely.ca,https://www.wastely.ca').split(',').map(s => s.trim());
  const origin = req.headers.origin || '';
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'POST') {
      if (origin && !allowed.includes(origin)) return res.status(403).json({ ok: false });
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b || typeof b.fields !== 'object' || !b.fields) return res.status(400).json({ ok: false, error: 'Missing fields' });
      if (b.fields._gotcha) return res.status(200).json({ ok: true }); // honeypot: pretend success
      const fields = {};
      for (const [k, v] of Object.entries(b.fields).slice(0, 40)) {
        if (k.startsWith('_')) continue;
        fields[String(k).slice(0, 80)] = String(v == null ? '' : v).slice(0, 4000);
      }
      const rec = {
        id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        form: String(b.form || 'Website form').slice(0, 60),
        page: String(b.page || '').slice(0, 300),
        submittedAt: new Date().toISOString(),
        fields
      };
      await redis(['LPUSH', LIST, JSON.stringify(rec)]);
      await redis(['LTRIM', LIST, 0, MAX - 1]);
      return res.status(200).json({ ok: true, id: rec.id });
    }

    if (req.method === 'GET') {
      if (!process.env.CRM_KEY || req.headers['x-crm-key'] !== process.env.CRM_KEY) return res.status(401).json({ ok: false });
      const rows = await redis(['LRANGE', LIST, 0, MAX - 1]);
      const submissions = (rows || []).map(r => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, submissions });
    }

    return res.status(405).json({ ok: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
