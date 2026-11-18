/* Relais Cloudflare pour « Méditation vocale ».
   Transmet la demande de voix à Mistral et autorise uniquement l'application à lire la réponse.
   Rien n'est stocké : la clé Mistral vient du téléphone, à chaque demande. */
const APP = 'https://jeepalexander.github.io';
const CORS = {
  'Access-Control-Allow-Origin': APP,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST' || req.headers.get('Origin') !== APP) {
      return new Response('Accès refusé', { status: 403, headers: CORS });
    }
    const r = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.get('Authorization') || '' },
      body: await req.text()
    });
    return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  }
};
