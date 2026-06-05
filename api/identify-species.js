// api/identify-species.js — Vercel serverless proxy for PlantNet /v2/identify/all
//
// The PLANTNET_API_KEY is injected as a server-side environment variable.
// It is never returned to the client or logged.
//
// Local dev:
//   1. Add PLANTNET_API_KEY=<your-key> to .env.local (file is .gitignored)
//   2. Run:  npx vercel dev   (starts both the Vite frontend + this function)
//   Without vercel dev the function is unavailable; the UI falls back to
//   manual species entry.
//
// Client contract:
//   POST /api/identify-species
//   Content-Type: application/json
//   Body: { images: [{data: string (base64), mimeType: string, organ: string}],
//           nbResults?: number }
//
//   Responses:
//   200  { bestMatch, results[], predictedOrgans, remainingIdentificationRequests, version }
//   400  { error: 'bad_request', message }
//   429  { error: 'quota_exceeded', message, remainingIdentificationRequests }
//   502  { error: 'plantnet_error' | 'proxy_error', message }

export const config = {
  api: {
    bodyParser: { sizeLimit: '14mb' },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'proxy_not_configured',
      message: 'PLANTNET_API_KEY is not set. See api/identify-species.js for setup.',
    });
  }

  const { images, nbResults = 8 } = req.body ?? {};

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'bad_request', message: 'images array required' });
  }
  if (images.length > 5) {
    return res.status(400).json({ error: 'bad_request', message: 'max 5 images' });
  }

  // ── Build multipart form for PlantNet ─────────────────────────────────────
  const form = new FormData();
  for (const img of images) {
    if (!img.data) continue;
    const buf  = Buffer.from(img.data, 'base64');
    const mime = img.mimeType ?? 'image/jpeg';
    const ext  = mime === 'image/png' ? 'png' : 'jpg';
    const blob = new Blob([buf], { type: mime });
    form.append('images', blob, `capture.${ext}`);
    form.append('organs', img.organ ?? 'auto');
  }

  const url = new URL('https://my-api.plantnet.org/v2/identify/all');
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('include-related-images', 'true');
  url.searchParams.set('nb-results', String(Math.min(nbResults, 20)));
  url.searchParams.set('lang', 'en');
  url.searchParams.set('no-reject', 'true');

  let plantnetRes;
  try {
    plantnetRes = await fetch(url.toString(), { method: 'POST', body: form });
  } catch (err) {
    return res.status(502).json({ error: 'proxy_error', message: String(err.message) });
  }

  if (plantnetRes.status === 429) {
    const body = await plantnetRes.json().catch(() => ({}));
    return res.status(429).json({
      error: 'quota_exceeded',
      message: 'Daily PlantNet identification quota reached. Try again tomorrow, or enter species manually.',
      remainingIdentificationRequests: body.remainingIdentificationRequests ?? 0,
    });
  }

  if (!plantnetRes.ok) {
    const body = await plantnetRes.json().catch(() => ({}));
    return res.status(502).json({ error: 'plantnet_error', status: plantnetRes.status, details: body });
  }

  const data = await plantnetRes.json();

  // Return a trimmed, structured response — never forward raw object that could
  // contain internal PlantNet metadata we don't intend to expose.
  return res.status(200).json({
    bestMatch: data.bestMatch ?? null,
    results: (data.results ?? []).map((r) => ({
      score: r.score,
      species: {
        scientificName: r.species?.scientificName ?? '',
        scientificNameWithoutAuthor: r.species?.scientificNameWithoutAuthor ?? '',
        commonNames: r.species?.commonNames ?? [],
        genus: r.species?.genus?.scientificName ?? '',
        family: r.species?.family?.scientificName ?? '',
      },
      // Up to 3 reference images for visual confirmation in the UI
      images: (r.images ?? []).slice(0, 3).map((img) => ({
        url: img.url?.s ?? img.url?.m ?? null,
        organ: img.organ ?? '',
        citation: img.citation ?? '',
      })),
    })),
    predictedOrgans: data.predictedOrgans ?? [],
    remainingIdentificationRequests: data.remainingIdentificationRequests ?? null,
    version: data.version ?? null,
  });
}
