// Vercel serverless function — lives at /api/parse-hours.js in your project.
// Keeps your Anthropic API key on the server only; the browser never sees it.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY — check Vercel environment variables.' });
  }

  const { items, knownTags } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No content provided to parse.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const tagHint = Array.isArray(knownTags) && knownTags.length
    ? `Known case tags already in use on this account: ${knownTags.join(', ')}. If an entry clearly matches one of these, use it exactly as written. Otherwise leave "tag" as an empty string — never invent a new tag name.`
    : 'No existing case tags were provided. Leave "tag" as an empty string for every entry unless the source document explicitly labels a case/matter name.';

  const systemPrompt = `You extract billable time entries from messy source material — scanned pages, photos of handwritten notes, or pasted text from PDFs. For each distinct entry you find, extract:
- date: in YYYY-MM-DD format. Assume the current year is ${new Date().getFullYear()} if no year is given. If a date is genuinely ambiguous or missing, use null rather than guessing.
- hours: a plain number (e.g. 2.5). If only a time range is given (e.g. "9:00-11:30"), compute the duration.
- description: a short, faithful summary of the work described — don't invent detail that isn't there.
- tag: ${tagHint}

Respond with ONLY a JSON array of objects with exactly these four keys: date, hours, description, tag. No prose, no markdown fences, no explanation — just the raw JSON array. If you can't confidently extract any entries at all, respond with an empty array [].`;

  const content = items.map(item => {
    if (item.type === 'image') {
      return { type: 'image', source: { type: 'base64', media_type: item.mediaType || 'image/jpeg', data: item.content } };
    }
    return { type: 'text', text: item.content };
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${errText.slice(0, 300)}` });
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'No text response from the model.' });

    let parsed;
    try {
      const cleaned = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'Could not parse the model\'s response as JSON.', raw: textBlock.text.slice(0, 500) });
    }

    if (!Array.isArray(parsed)) return res.status(502).json({ error: 'Model response was not a JSON array.' });

    const entries = parsed.map(e => ({
      date: typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
      hours: (() => { const n = Number(e.hours); return Number.isFinite(n) && n > 0 ? n : 0; })(),
      description: typeof e.description === 'string' ? e.description.slice(0, 300) : '',
      tag: typeof e.tag === 'string' ? e.tag.trim().toUpperCase().slice(0, 40) : ''
    }));

    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: 'Request to Anthropic failed: ' + e.message });
  }
}
