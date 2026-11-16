/* Service worker propre à « Méditation vocale » : son cache porte un nom unique,
   et sa portée se limite au dossier de l'application. */
const CACHE = 'meditation-vocale-v1';
const FILES = [
  './',
  'index.html',
  'app.js',
  'ocr.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'lang/fra.traineddata.gz',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'audio/kokoro/0-0.mp3',
  'audio/kokoro/1-0.mp3',
  'audio/kokoro/2-0.mp3',
  'audio/kokoro/2-1.mp3',
  'audio/kokoro/2-2.mp3',
  'audio/kokoro/3-0.mp3',
  'audio/kokoro/4-0.mp3',
  'audio/kokoro/4-1.mp3',
  'audio/kokoro/4-2.mp3',
  'audio/kokoro/5-0.mp3',
  'audio/kokoro/5-1.mp3',
  'audio/kokoro/5-2.mp3',
  'audio/kokoro/6-0.mp3',
  'audio/kokoro/6-1.mp3',
  'audio/kokoro/7-0.mp3',
  'audio/kokoro/7-1.mp3',
  'audio/kokoro/7-2.mp3',
  'audio/kokoro/7-3.mp3',
  'audio/pierre/0-0.mp3',
  'audio/pierre/1-0.mp3',
  'audio/pierre/2-0.mp3',
  'audio/pierre/2-1.mp3',
  'audio/pierre/2-2.mp3',
  'audio/pierre/3-0.mp3',
  'audio/pierre/4-0.mp3',
  'audio/pierre/4-1.mp3',
  'audio/pierre/4-2.mp3',
  'audio/pierre/5-0.mp3',
  'audio/pierre/5-1.mp3',
  'audio/pierre/5-2.mp3',
  'audio/pierre/6-0.mp3',
  'audio/pierre/6-1.mp3',
  'audio/pierre/7-0.mp3',
  'audio/pierre/7-1.mp3',
  'audio/pierre/7-2.mp3',
  'audio/pierre/7-3.mp3',
  'audio/siwis/0-0.mp3',
  'audio/siwis/1-0.mp3',
  'audio/siwis/2-0.mp3',
  'audio/siwis/2-1.mp3',
  'audio/siwis/2-2.mp3',
  'audio/siwis/3-0.mp3',
  'audio/siwis/4-0.mp3',
  'audio/siwis/4-1.mp3',
  'audio/siwis/4-2.mp3',
  'audio/siwis/5-0.mp3',
  'audio/siwis/5-1.mp3',
  'audio/siwis/5-2.mp3',
  'audio/siwis/6-0.mp3',
  'audio/siwis/6-1.mp3',
  'audio/siwis/7-0.mp3',
  'audio/siwis/7-1.mp3',
  'audio/siwis/7-2.mp3',
  'audio/siwis/7-3.mp3'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('meditation-vocale-') && k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.headers.has('range')) { e.respondWith(rangeResponse(req)); return; }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('./') : Response.error()))
  );
});

// Safari lit l'audio par morceaux (requêtes « Range ») : on les sert depuis le cache pour le hors-ligne
async function rangeResponse(req){
  const url = req.url.split('#')[0];
  let res = await caches.match(url, { ignoreSearch: true });
  if (!res) { try { return await fetch(req); } catch(e) { return Response.error(); } }
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const size = buf.byteLength;
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (!m || !m[1]) { if (m && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; } }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
