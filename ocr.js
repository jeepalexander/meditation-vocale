/* Transcription locale (Tesseract) — tout reste sur l'appareil */
const OCR = (() => {
  let workerP = null;
  function base(){ return new URL('.', location.href).href; }
  function getWorker(onProgress){
    if (!workerP){
      workerP = Tesseract.createWorker('fra', 1, {
        workerPath: base() + 'vendor/tesseract/worker.min.js',
        corePath: base() + 'vendor/tesseract/core',
        langPath: base() + 'lang',
        gzip: true,
        cacheMethod: 'none',
        logger: m => { if (OCR._onProgress) OCR._onProgress(m); }
      }).catch(e => { workerP = null; throw e; });
    }
    return workerP;
  }
  function loadImage(blob){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { res(img); };
      img.onerror = rej;
      img.src = url;
    });
  }
  // Garde les lignes lisibles, écarte le « bruit » (bord de page, ombres, doigts)
  function fromBlocks(data){
    if (!data.blocks) return data.text || '';
    const paras = [];
    for (const b of data.blocks) for (const p of b.paragraphs){
      const lines = p.lines.filter(l => {
        const words = l.words || [];
        const letters = (l.text.match(/\p{L}/gu) || []).length;
        const ratio = letters / Math.max(1, l.text.replace(/\s/g,'').length);
        const good = words.filter(w => w.confidence > 60).length;
        return l.confidence > 45 && ratio > 0.6 && good >= Math.max(1, words.length * 0.4);
      }).map(l => l.text.replace(/\n$/,''));
      if (lines.length) paras.push(lines.join('\n'));
    }
    return paras.join('\n\n');
  }
  function canvasFor(img, rot, maxSide, crop){
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.round(w0*k), h = Math.round(h0*k);
    const c = document.createElement('canvas');
    const swap = rot % 180 !== 0;
    c.width = swap ? h : w; c.height = swap ? w : h;
    const g = c.getContext('2d');
    g.translate(c.width/2, c.height/2);
    g.rotate(rot * Math.PI/180);
    g.drawImage(img, -w/2, -h/2, w, h);
    let out = c;
    if (crop){
      const x = Math.round(crop.x*c.width), y = Math.round(crop.y*c.height);
      const cw = Math.max(10, Math.round(crop.w*c.width)), ch = Math.max(10, Math.round(crop.h*c.height));
      out = document.createElement('canvas'); out.width = cw; out.height = ch;
      out.getContext('2d').drawImage(c, x, y, cw, ch, 0, 0, cw, ch);
    }
    if (maxSide > 1500) binarize(out);
    return out;
  }
  // Seuillage adaptatif (moyenne locale) : efface ombres et dégradés de la photo
  function binarize(c){
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const im = g.getImageData(0,0,W,H), d = im.data;
    const gray = new Float32Array(W*H);
    for (let i=0,j=0;i<d.length;i+=4,j++) gray[j] = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const S = new Float64Array((W+1)*(H+1));
    for (let y=1;y<=H;y++){ let row=0; for (let x=1;x<=W;x++){ row += gray[(y-1)*W+x-1]; S[y*(W+1)+x] = S[(y-1)*(W+1)+x] + row; } }
    const r = Math.max(8, Math.round(Math.min(W,H)/40)), T = 0.12;
    for (let y=0;y<H;y++){ const y0=Math.max(0,y-r), y1=Math.min(H,y+r+1);
      for (let x=0;x<W;x++){ const x0=Math.max(0,x-r), x1=Math.min(W,x+r+1);
        const sum = S[y1*(W+1)+x1]-S[y0*(W+1)+x1]-S[y1*(W+1)+x0]+S[y0*(W+1)+x0];
        const mean = sum/((x1-x0)*(y1-y0)); const v = gray[y*W+x] < mean*(1-T) ? 0 : 255; const k=(y*W+x)*4; d[k]=d[k+1]=d[k+2]=v; } }
    g.putImageData(im,0,0);
  }
  function score(data){
    const words = (data.words || data.blocks && data.blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words))) || []);
    const good = words.filter(w => w.confidence > 70 && /[a-zàâçéèêëîïôûùüÿœ]{3,}/i.test(w.text));
    return good.length + (data.confidence || 0) / 100;
  }
  async function bestRotation(img){
    const w = await getWorker();
    let best = { rot:0, s:-1 };
    for (const rot of [0, 90, 270, 180]){
      const { data } = await w.recognize(canvasFor(img, rot, 1100), {}, { blocks:true });
      const s = score(data);
      if (s > best.s) best = { rot, s };
      if (best.s > 25 && rot === 0) break;
    }
    return best.rot;
  }
  function clean(raw){
    let t = raw.replace(/\r/g,'').replace(/[ \t]+/g,' ');
    t = t.replace(/(\p{L})[-‑–]\s*\n\s*(\p{Ll})/gu, '$1$2');   // mots coupés en fin de ligne
    const lines = t.split('\n').map(l => l.trim());
    const lens = lines.filter(l => l.length > 20).map(l => l.length).sort((a,b)=>a-b);
    const typical = lens.length ? lens[Math.floor(lens.length*0.7)] : 60;
    const paras = []; let cur = '';
    const flush = () => { if (cur.trim()) paras.push(cur.trim()); cur = ''; };
    for (let l of lines){
      if (!l){ flush(); continue; }
      if (/^\d{1,4}$/.test(l)) continue;                      // numéro de page
      if (l.length < 4 && !/[.!?…»]$/.test(l)) continue;       // débris (bord de page voisine)
      const bullet = /^[•·●▪◦*»\-–—]\s+/.test(l) || /^[eo©®]\s+[A-ZÀ-Ý]/.test(l);
      if (bullet){ flush(); l = l.replace(/^([•·●▪◦*»\-–—]|[eo©®])\s+/, ''); }
      cur += (cur ? ' ' : '') + l;
      if (/[.!?…»:]$/.test(l) && l.length < typical * 0.8) flush();   // ligne courte finie par un point : fin de paragraphe
    }
    flush();
    return paras.map(p => p.replace(/\s+([,.])/g,'$1').replace(/\s+([!?;:»])/g,' $1').replace(/«\s*/g,'« ').replace(/ {2,}/g,' ')).join('\n\n');
  }
  async function transcribe(blobs, opts = {}){
    const w = await getWorker();
    const out = [];
    for (let i = 0; i < blobs.length; i++){
      const img = await loadImage(blobs[i]);
      if (opts.onStep) opts.onStep(`Page ${i+1}/${blobs.length} : recherche du sens de lecture…`);
      const rot = (opts.rotations && opts.rotations[i] != null) ? opts.rotations[i] : await bestRotation(img);
      if (opts.onStep) opts.onStep(`Page ${i+1}/${blobs.length} : lecture du texte…`);
      const crop = opts.crops && opts.crops[i];
      const { data } = await w.recognize(canvasFor(img, rot, 2600, crop), {}, { blocks:true, text:true });
      out.push(clean(fromBlocks(data)));
    }
    return out.join('\n\n');
  }
  return { transcribe, bestRotation: async blob => bestRotation(await loadImage(blob)), loadImage, canvasFor, warm: () => getWorker(), clean, _onProgress: null };
})();
