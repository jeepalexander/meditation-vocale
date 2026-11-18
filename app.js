/* Méditation vocale — application installable (PWA)
   Tout est stocké sur l'appareil : textes et audios dans IndexedDB, réglages dans localStorage. */
'use strict';

const BUILTIN_TEXT = `En pratique.

Soufflez un bon coup, souriez et procédez ainsi, si le cœur vous en dit.

Projetez-vous dans la pièce de votre habitation, celle que vous souhaitez. Faites un choix même si plusieurs se présentent à vous. Chaque chose en son temps.

Imaginez-vous avec toute votre équipe lumineuse.

Ce n'est pas important si vous vous y reprenez à plusieurs fois ou que vous ne voyez pas très clairement. Le principal est toujours l'intention ! « C'est l'intention qui compte ! »

Visualisez une porte, un vortex, un portail ou toute autre ouverture que vous aurez envie d'imaginer. Ce n'est pas important si votre réalisation change de forme en cours de route ! L'important est l'ouverture !

Prenez le temps qu'il vous faut, reprenez-vous-y à plusieurs fois si vous en avez envie, projetez-vous dans d'autres pièces, sur le toit, dans les alentours… Créez autant d'ouvertures avec autant de couleurs que vous le souhaitez.

Dès que vous commencez à douter, videz-vous la tête. Si vous avez du mal à vous vider la tête, stoppez et reprenez plus tard. Tout ce que vous réaliserez sera exactement ce que vous devez faire. Ne vous jugez pas trop sévèrement et si vous attendez beaucoup de vous, libérez à fond vos inspirations et laissez-vous créer !`;

const BUILTIN = { id:'builtin-en-pratique', title:'En pratique — ouvrir des portails', text: BUILTIN_TEXT, builtin:true, created:0 };
const NEURAL = [];   // plus de voix intégrées : l'audio de qualité est importé depuis le Mac

const $ = id => document.getElementById(id);
const synth = window.speechSynthesis || null;

/* ---------- Réglages ---------- */
const KEY = 'mv-settings-v1';
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) {}
function persist(){ try { localStorage.setItem(KEY, JSON.stringify(store)); } catch(e) {} }

/* ---------- Stockage (IndexedDB) ---------- */
const DB = (() => {
  let p = null;
  function open(){
    if (!p) p = new Promise((res, rej) => {
      const r = indexedDB.open('meditation-vocale', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath:'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath:'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return p;
  }
  async function tx(storeName, mode, fn){
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id))
  };
})();
async function askPersistentStorage(){
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch(e) {}
}

/* ---------- Bibliothèque ---------- */
let userTexts = [];
function allTexts(){ return [BUILTIN, ...[...userTexts].sort((a,b)=>(b.created||0)-(a.created||0))]; }
function findText(id){ return allTexts().find(t => t.id === id); }
function newId(){ return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

async function loadLibrary(){
  try { userTexts = (await DB.all('texts')) || []; }
  catch(e){ userTexts = []; $('storeNote').textContent = "Attention : le stockage n'est pas disponible dans ce navigateur."; }
  renderLibrary();
}
async function saveText(t){
  const i = userTexts.findIndex(x => x.id === t.id);
  if (i >= 0) userTexts[i] = t; else userTexts.push(t);
  renderLibrary();
  try { await DB.put('texts', t); askPersistentStorage(); }
  catch(e){ $('storeNote').textContent = "L'enregistrement a échoué (espace plein ?)."; }
}
async function removeText(id){
  userTexts = userTexts.filter(x => x.id !== id);
  renderLibrary();
  try { await DB.del('texts', id); await DB.del('audio', id); } catch(e) {}
}

function renderLibrary(){
  const box = $('books'); box.innerHTML = '';
  allTexts().forEach(t => {
    const ps = parse(t.text);
    const el = document.createElement('div');
    el.className = 'book';
    el.innerHTML = `<div class="spine"></div><div class="info"><p class="t"></p><div class="m"></div><div class="ex"></div></div>`;
    el.querySelector('.t').textContent = t.title || 'Sans titre';
    const tags = [];
    if (t.builtin && NEURAL.length) tags.push('★ voix haute qualité');
    if (t.audio) tags.push('🎧 audio importé');
    el.querySelector('.m').textContent = `${ps.length} paragraphe${ps.length>1?'s':''}` + (tags.length ? ' · ' + tags.join(' · ') : '');
    el.querySelector('.ex').textContent = ps.find(p => p.length > 30) || ps[0] || '';
    el.onclick = () => openReader(t.id);
    if (!t.builtin){
      const d = document.createElement('button');
      d.className = 'del'; d.title = 'Supprimer'; d.textContent = '🗑';
      d.onclick = ev => { ev.stopPropagation(); askConfirm(`Supprimer « ${t.title || 'Sans titre'} » de la bibliothèque ?`, () => removeText(t.id)); };
      el.appendChild(d);
    }
    box.appendChild(el);
  });
}

/* ---------- Texte ---------- */
function parse(text){ return (text||'').split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean); }
function sentences(p){ return (p.match(/[^.!?…]+(?:[.!?…]+(?:\s*[»"”])?|$)/g) || [p]).map(s=>s.trim()).filter(Boolean); }
function sentenceCount(text){ return parse(text).reduce((n,p) => n + sentences(p).length, 0); }
function flatIndex(pIdx, sIdx){ let n = 0; for (let i = 0; i < pIdx; i++) n += sentences(paragraphs[i]).length; return n + sIdx; }

/* ---------- Audio importé : découpage phrase par phrase ---------- */
function segmentAudio(buf, sentLens, paraEndSet){
  const sr = buf.sampleRate, frame = Math.max(1, Math.round(sr * 0.01));
  const chans = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
  const nF = Math.floor(buf.length / frame);
  const db = new Float32Array(nF);
  for (let f = 0; f < nF; f++){
    let s = 0; const o = f*frame;
    for (const ch of chans) for (let i = 0; i < frame; i++){ const v = ch[o+i]; s += v*v; }
    db[f] = 10 * Math.log10(s / (frame*chans.length) + 1e-12);
  }
  const sorted = Array.from(db).sort((a,b)=>a-b);
  const pct = q => sorted[Math.min(sorted.length-1, Math.floor(q*sorted.length))];
  const lo = pct(0.08), hi = pct(0.95);
  const thr = lo + (hi - lo) * 0.3;
  let first = 0; while (first < nF && db[first] < thr) first++;
  let last = nF - 1; while (last > first && db[last] < thr) last--;
  const T = f => f * frame / sr;
  const start = T(first), end = T(last + 1);
  const N = sentLens.length;
  if (N <= 1) return [[Math.max(0,start-0.05), end + 0.15]];

  // silences d'au moins 140 ms à l'intérieur de la parole
  const gaps = [];
  let f = first;
  while (f <= last){
    if (db[f] < thr){
      let g = f; while (g <= last && db[g] < thr) g++;
      if (g - f >= 14) gaps.push({ s:T(f), e:T(g), c:(T(f)+T(g))/2, len:T(g)-T(f) });
      f = g;
    } else f++;
  }
  const w = sentLens.map(l => l + 10);
  const tot = w.reduce((a,b)=>a+b, 0);
  const targets = []; let acc = 0;
  for (let k = 0; k < N-1; k++){ acc += w[k]; targets.push(start + (end - start) * acc / tot); }
  const avg = (end - start) / N;
  let cuts;
  if (gaps.length >= N-1){
    // programmation dynamique : N-1 silences, dans l'ordre, proches des positions attendues et plutôt longs
    const G = gaps.length, K = N-1, INF = 1e18;
    const D = Array.from({length:K}, () => new Float64Array(G).fill(INF));
    const B = Array.from({length:K}, () => new Int32Array(G).fill(-1));
    const cost = (k, j) => { const d = (gaps[j].c - targets[k]) / avg; const bonus = paraEndSet.has(k) ? 3 : 1.5; return d*d - bonus * Math.min(gaps[j].len, 2); };
    for (let j = 0; j < G; j++) D[0][j] = cost(0, j);
    for (let k = 1; k < K; k++){
      let bestV = INF, bestJ = -1;
      for (let j = 0; j < G; j++){
        if (j-1 >= 0 && D[k-1][j-1] < bestV){ bestV = D[k-1][j-1]; bestJ = j-1; }
        if (bestJ >= 0) { D[k][j] = bestV + cost(k, j); B[k][j] = bestJ; }
      }
    }
    let j = -1, bv = INF;
    for (let x = 0; x < G; x++) if (D[K-1][x] < bv){ bv = D[K-1][x]; j = x; }
    cuts = new Array(K);
    for (let k = K-1; k >= 0; k--){ cuts[k] = gaps[j]; j = B[k][j]; }
  } else {
    cuts = targets.map(t => ({ s:t, e:t }));
  }
  const segs = [];
  for (let i = 0; i < N; i++){
    const a = i === 0 ? Math.max(0, start - 0.05) : Math.max(0, cuts[i-1].e - 0.08);
    const b = i === N-1 ? end + 0.2 : cuts[i].s + 0.12;
    segs.push([+a.toFixed(3), +b.toFixed(3)]);
  }
  return segs;
}

let importRec = null;     // {id, blob, segments, name, n}
let importURL = null;
async function loadImport(t){
  importRec = null;
  if (importURL){ URL.revokeObjectURL(importURL); importURL = null; }
  if (!t || !t.audio) return;
  try {
    const rec = await DB.get('audio', t.id);
    if (rec && rec.blob){ importRec = rec; importURL = URL.createObjectURL(rec.blob); }
  } catch(e) {}
}
function importValid(){ return importRec && current && importRec.n === sentenceCount(current.text); }

/* ---------- Voix ---------- */
let voices = [];
const audio = new Audio(); audio.preload = 'auto';
try { audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; } catch(e) {}

function loadVoices(){
  voices = synth ? synth.getVoices() : [];
  const fr = voices.filter(v => /^fr/i.test(v.lang));
  const isNice = v => /natural|online|neural|premium|enhanced|amélioré|wavenet|siri/i.test(v.name);
  const list = (fr.length ? fr : voices).slice().sort((a,b) => isNice(b) - isNice(a));
  const sel = $('voice'); const prev = sel.value; sel.innerHTML = '';
  if (current && current.audio){
    const g0 = document.createElement('optgroup'); g0.label = '🎧 Audio importé';
    const o = document.createElement('option'); o.value = 'import';
    o.textContent = '🎧 ' + (current.audio.name || 'Audio importé') + (importValid() ? '' : ' (texte modifié depuis)');
    o.disabled = !importValid(); g0.appendChild(o); sel.appendChild(g0);
  }
  if (current && current.builtin && NEURAL.length){
    const g1 = document.createElement('optgroup'); g1.label = '★ Voix haute qualité';
    NEURAL.forEach(n => { const o = document.createElement('option'); o.value = 'neural:'+n.id; o.textContent = '★ ' + n.label; g1.appendChild(o); });
    sel.appendChild(g1);
  }
  if (list.length){
    const g2 = document.createElement('optgroup'); g2.label = "Voix du téléphone";
    list.forEach(v => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = (isNice(v) ? '◆ ' : '') + `${v.name} (${v.lang})`; g2.appendChild(o); });
    sel.appendChild(g2);
  }
  const usable = [...sel.options].filter(o => !o.disabled).map(o => o.value);
  const bestDevice = list.find(isNice) || list[0];
  let wanted;
  if (current && importValid()) wanted = (store.voiceByText || {})[current.id] || 'import';
  else wanted = store.voiceOther || (bestDevice ? bestDevice.voiceURI : '');
  sel.value = usable.includes(wanted) ? wanted : (usable.includes(prev) ? prev : (usable[0] || ''));
}
function mode(){
  const v = $('voice').value || '';
  if (v === 'import' && importValid()) return 'import';
  if (v.startsWith('neural:') && current && current.builtin) return 'neural';
  return 'device';
}

/* ---------- Écran allumé pendant la lecture ---------- */
let wakeLock = null;
async function keepAwake(on){
  try {
    if (on && !wakeLock && 'wakeLock' in navigator){ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock){ await wakeLock.release(); wakeLock = null; }
  } catch(e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && !paused) keepAwake(true); });

/* ---------- Lecteur ---------- */
let current = null, paragraphs = [], idx = 0;
let playing = false, paused = false, runId = 0, timer = null, watch = null;

async function openReader(id){
  const t = findText(id); if (!t) return;
  stopAll(true);
  current = t; paragraphs = parse(t.text);
  await loadImport(t);
  const pos = (store.pos || {})[id] || 0;
  idx = Math.min(pos, paragraphs.length-1);
  $('readerTitle').textContent = t.title || 'Sans titre';
  $('editBtn').textContent = t.builtin ? 'Dupliquer' : 'Modifier';
  $('audioBtn').textContent = t.audio ? "🎧 Remplacer l'audio" : "🎧 Ajouter l'audio";
  $('audioDelBtn').classList.toggle('hidden', !t.audio);
  $('audioNote').textContent = t.audio
    ? (importValid() ? `Audio « ${t.audio.name} » découpé en ${t.audio.n} phrases.` : "Le texte a été modifié depuis l'import : importe à nouveau l'audio.")
    : "Importe un fichier audio de tout le texte (ZONOS3…) : il sera découpé phrase par phrase.";
  renderList(); render(false); loadVoices();
  setStatus('Appuie sur ▶ pour commencer la lecture.');
  $('libView').classList.add('hidden'); $('readerView').classList.remove('hidden');
  window.scrollTo(0,0);
}
function backToLibrary(){
  stopAll(true);
  $('readerView').classList.add('hidden'); $('libView').classList.remove('hidden');
  renderLibrary();
}

function render(fade=true){
  const p = paragraphs[idx] || '';
  const el = $('para');
  const draw = () => {
    el.innerHTML = '';
    sentences(p).forEach((s,i) => { const span = document.createElement('span'); span.className = 's'; span.dataset.i = i; span.textContent = s + ' '; el.appendChild(span); });
    el.classList.remove('fade');
  };
  if (fade){ el.classList.add('fade'); setTimeout(draw, 300); } else draw();
  $('count').textContent = `${idx+1} / ${paragraphs.length}`;
  $('barFill').style.width = `${((idx+1)/Math.max(1,paragraphs.length))*100}%`;
  $('prevBtn').disabled = idx === 0;
  $('nextBtn').disabled = idx >= paragraphs.length-1;
  [...$('list').children].forEach((b,i)=>b.classList.toggle('cur', i===idx));
  if (current){ store.pos = store.pos || {}; store.pos[current.id] = idx; persist(); }
}
function renderList(){
  const list = $('list'); list.innerHTML = '';
  paragraphs.forEach((p,i) => { const b = document.createElement('button'); b.textContent = `${i+1}. ${p}`; b.onclick = () => goTo(i, playing && !paused); list.appendChild(b); });
}
function setPlayIcon(){ $('playBtn').textContent = (playing && !paused) ? '❚❚' : '▶'; }
function setStatus(t){ $('status').textContent = t; }
function highlight(i){ document.querySelectorAll('#para .s').forEach(s => s.classList.toggle('on', +s.dataset.i === i)); }
function clearTimers(){ if (timer){ clearTimeout(timer); timer = null; } if (watch){ clearInterval(watch); watch = null; } }
function haltAudio(){ if (synth) synth.cancel(); audio.pause(); }
function rateFactor(){ return Math.max(0.5, Math.min(1.6, +$('rate').value / 0.85)); }

function speakParagraph(){
  const m = mode();
  const my = ++runId;
  clearTimers(); haltAudio();
  playing = true; paused = false; setPlayIcon(); keepAwake(true);
  const parts = sentences(paragraphs[idx] || '');
  let i = 0;
  setStatus('Lecture en cours…');
  const after = () => {
    if (my !== runId) return;
    i++;
    timer = setTimeout(next, i < parts.length ? +$('sentGap').value*1000 : 0);
  };
  const failSoft = () => { if (my === runId){ paused = true; setPlayIcon(); setStatus('Appuie sur ▶ pour lancer le son.'); } };
  const next = () => {
    if (my !== runId) return;
    if (i >= parts.length){ highlight(-1); return endParagraph(my); }
    highlight(i);
    if (m === 'neural'){
      audio.src = `audio/${$('voice').value.slice(7)}/${idx}-${i}.mp3`;
      audio.playbackRate = rateFactor();
      audio.onended = after;
      audio.onerror = () => { if (my === runId) after(); };
      const pr = audio.play(); if (pr && pr.catch) pr.catch(failSoft);
    } else if (m === 'import'){
      const seg = importRec.segments[flatIndex(idx, i)];
      if (!seg){ return after(); }
      audio.onended = null; audio.onerror = null;
      if (!audio.src || audio.src !== importURL) audio.src = importURL;
      const go = () => {
        if (my !== runId) return;
        try { audio.currentTime = seg[0]; } catch(e) {}
        audio.playbackRate = rateFactor();
        const pr = audio.play(); if (pr && pr.catch) pr.catch(failSoft);
        watch = setInterval(() => {
          if (my !== runId){ clearInterval(watch); return; }
          if (audio.currentTime >= seg[1] || audio.ended){ clearInterval(watch); watch = null; audio.pause(); after(); }
        }, 25);
      };
      if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once:true });
    } else {
      if (!synth){ playing = false; setPlayIcon(); setStatus("Aucune voix disponible sur ce téléphone."); return; }
      const voice = voices.find(v => v.voiceURI === $('voice').value);
      const u = new SpeechSynthesisUtterance(parts[i]);
      u.lang = voice ? voice.lang : 'fr-FR';
      if (voice) u.voice = voice;
      u.rate = +$('rate').value; u.pitch = +$('pitch').value;
      u.onend = after;
      u.onerror = e => { if (my === runId && e.error !== 'interrupted' && e.error !== 'canceled') after(); };
      synth.speak(u);
    }
  };
  next();
}

function endParagraph(my){
  if (my !== runId) return;
  if ($('auto').checked && idx < paragraphs.length-1){
    const g = +$('gap').value;
    setStatus(g ? `Silence… (${g} s)` : '');
    timer = setTimeout(() => { if (my !== runId) return; idx++; render(); setTimeout(()=>{ if (my===runId) speakParagraph(); }, 350); }, g*1000);
  } else {
    playing = false; setPlayIcon(); keepAwake(false);
    setStatus(idx >= paragraphs.length-1 ? 'Fin de la méditation. 🌿' : 'Paragraphe terminé. ⏭ pour continuer.');
  }
}

function togglePlay(){
  const m = mode();
  if (playing && !paused){
    paused = true;
    if (timer){ clearTimeout(timer); timer = null; pausedInGap = true; } else pausedInGap = false;
    if (m === 'neural' || m === 'import') audio.pause(); else if (synth) synth.pause();
    setPlayIcon(); setStatus('En pause.'); keepAwake(false);
  } else if (playing && paused){
    paused = false; setPlayIcon(); setStatus('Lecture en cours…'); keepAwake(true);
    if (pausedInGap) { speakParagraph(); return; }
    if (m === 'neural' || m === 'import'){
      if (audio.src && !audio.ended && audio.currentTime > 0) audio.play().catch(()=>{}); else speakParagraph();
    } else if (synth && (synth.paused || synth.speaking)) synth.resume();
    else speakParagraph();
  } else speakParagraph();
}
let pausedInGap = false;

function stopAll(silent){
  runId++; clearTimers(); haltAudio();
  playing = false; paused = false; setPlayIcon(); highlight(-1); keepAwake(false);
  if (!silent) setStatus('Lecture arrêtée.');
}
function goTo(i, autoplay){
  if (i < 0 || i >= paragraphs.length) return;
  runId++; clearTimers(); haltAudio();
  playing = false; paused = false; setPlayIcon();
  idx = i; render();
  if (autoplay) setTimeout(speakParagraph, 350); else { setStatus(''); keepAwake(false); }
}

/* ---------- Réglages ---------- */
function bindRange(id, fmt){
  const el = $(id), out = $(id+'Out');
  if (store[id] != null) el.value = store[id];
  const upd = () => { out.textContent = fmt(+el.value); store[id] = el.value; persist(); };
  el.addEventListener('input', upd); upd();
}
bindRange('rate', v => '×' + v.toFixed(2));
bindRange('pitch', v => v.toFixed(2));
bindRange('gap', v => v + ' s');
bindRange('sentGap', v => v + ' s');
if (store.auto != null) $('auto').checked = store.auto;
$('auto').onchange = e => { store.auto = e.target.checked; persist(); };
$('voice').onchange = e => {
  stopAll(true); setStatus('');
  const v = e.target.value;
  if (current && current.audio){ store.voiceByText = store.voiceByText || {}; store.voiceByText[current.id] = v; }
  if (v !== 'import'){ if (current && current.builtin) store.voiceBuiltin = v; else if (!v.startsWith('neural:')) store.voiceOther = v; }
  persist();
};

function applyTheme(){ document.body.classList.toggle('dark', !!store.dark); document.querySelectorAll('.themeBtn').forEach(b => b.textContent = store.dark ? '☀' : '☾'); }
document.querySelectorAll('.themeBtn').forEach(b => b.onclick = () => { store.dark = !store.dark; persist(); applyTheme(); });

/* ---------- Commandes ---------- */
$('playBtn').onclick = togglePlay;
$('stage').onclick = togglePlay;
$('stopBtn').onclick = () => stopAll();
$('replayBtn').onclick = () => goTo(idx, true);
$('prevBtn').onclick = () => goTo(idx-1, playing && !paused);
$('nextBtn').onclick = () => goTo(idx+1, playing && !paused);
$('backBtn').onclick = backToLibrary;
document.addEventListener('keydown', e => {
  if ($('readerView').classList.contains('hidden')) return;
  if (document.querySelector('.modal.open') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') $('nextBtn').click();
  else if (e.key === 'ArrowLeft') $('prevBtn').click();
  else if (e.key === ' '){ e.preventDefault(); togglePlay(); }
});

/* ---------- Import d'audio ---------- */
$('audioBtn').onclick = () => { stopAll(true); $('audioInput').click(); };
$('audioInput').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !current) return;
  $('audioNote').textContent = "Analyse de l'audio…";
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const buf = await new Promise((res, rej) => {
      file.arrayBuffer().then(ab => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }, rej);
    });
    const ps = parse(current.text);
    const lens = [], ends = new Set(); let k = 0;
    ps.forEach(p => { sentences(p).forEach(s => { lens.push(s.length); k++; }); ends.add(k-1); });
    const segs = segmentAudio(buf, lens, ends);
    try { ac.close(); } catch(e2) {}
    let t = current;
    if (t.builtin){ // l'audio d'un texte intégré est rangé dans une copie personnelle
      t = { id:newId(), title:t.title, text:t.text, created:Date.now() };
    }
    const rec = { id:t.id, blob:file, segments:segs, name:file.name.replace(/\.[^.]+$/,''), n:lens.length };
    await DB.put('audio', rec);
    t = { ...t, audio:{ name:rec.name, n:rec.n } };
    await saveText(t);
    store.voiceByText = store.voiceByText || {}; store.voiceByText[t.id] = 'import'; persist();
    await openReader(t.id);
    setStatus(`Audio découpé en ${lens.length} phrases. Appuie sur ▶ pour écouter.`);
  } catch(err){
    $('audioNote').textContent = "Ce fichier audio n'a pas pu être lu. Essaie en MP3 ou en WAV.";
  }
};
$('audioDelBtn').onclick = () => askConfirm("Retirer l'audio importé de ce texte ?", async () => {
  try { await DB.del('audio', current.id); } catch(e) {}
  const t = { ...current }; delete t.audio;
  await saveText(t); await openReader(t.id);
});

/* ---------- Voix Marie (Mistral, Voxtral TTS d'origine) ---------- */
const MISTRAL_MODEL = 'voxtral-mini-tts-2603';
const MISTRAL_URL = 'https://api.mistral.ai/v1/audio/speech';
const MISTRAL_VOICES = [
  ['fr_marie_curious', 'Marie — curieuse'], ['fr_marie_neutral', 'Marie — neutre'], ['fr_marie_sad', 'Marie — douce (triste)'],
  ['fr_marie_happy', 'Marie — joyeuse'], ['fr_marie_excited', 'Marie — enthousiaste']
];
const MKEY = 'mv-mistral-v1';
let mistral = {};
try { mistral = JSON.parse(localStorage.getItem(MKEY) || '{}'); } catch(e) {}
function saveMistral(){ try { localStorage.setItem(MKEY, JSON.stringify(mistral)); } catch(e) {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fillMistralForm(){
  const sel = $('mVoice'); sel.innerHTML = '';
  MISTRAL_VOICES.forEach(([id, label]) => { const o = document.createElement('option'); o.value = id; o.textContent = label; sel.appendChild(o); });
  sel.value = mistral.voice || 'fr_marie_curious';
  $('mKey').value = mistral.key || '';
  $('mProxy').value = mistral.proxy || '';
  $('mNote').classList.add('hidden');
}
$('mistralBtn').onclick = () => { stopAll(true); fillMistralForm(); $('mistralModal').classList.add('open'); };
$('mCancel').onclick = () => $('mistralModal').classList.remove('open');
$('mGo').onclick = async () => {
  mistral.key = $('mKey').value.trim();
  mistral.proxy = $('mProxy').value.trim().replace(/\/+$/, '');
  mistral.voice = $('mVoice').value;
  saveMistral();
  if (!mistral.key){ showMNote('Colle d\'abord ta clé Mistral.'); return; }
  if (mistral.proxy && !/^https:\/\//.test(mistral.proxy)){ showMNote('L\'adresse du relais doit commencer par https://'); return; }
  $('mistralModal').classList.remove('open');
  await generateMistral();
};
function showMNote(t){ const n = $('mNote'); n.textContent = t; n.classList.remove('hidden'); }

class MistralError extends Error { constructor(code, msg){ super(msg); this.code = code; } }

async function mistralSpeech(text){
  const body = JSON.stringify({ model: MISTRAL_MODEL, input: text, voice_id: mistral.voice || 'fr_marie_curious', response_format: 'mp3' });
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mistral.key };
  const urls = mistral.proxy ? [mistral.proxy] : [MISTRAL_URL];
  for (let attempt = 0; attempt < 5; attempt++){
    let res;
    try { res = await fetch(urls[0], { method: 'POST', headers, body }); }
    catch(e){ throw new MistralError(mistral.proxy ? 'proxy' : 'cors', e.message); }
    if (res.status === 429){ await sleep(2500 * (attempt + 1)); continue; }
    if (!res.ok){
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new MistralError(res.status === 401 ? 'key' : (res.status === 402 ? 'billing' : 'http'), `${res.status} ${detail}`);
    }
    const data = await res.json();
    if (!data.audio_data) throw new MistralError('http', 'réponse sans audio');
    const bin = atob(data.audio_data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  throw new MistralError('rate', 'trop de demandes');
}

function decodeAudio(ac, ab){
  return new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
}
function toMono(buf){
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++){ const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}
function encodeWav(samples, sr){
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2){ const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

async function generateMistral(){
  if (!current) return;
  const note = $('audioNote');
  const ps = parse(current.text);
  if (!navigator.onLine){ note.textContent = 'Il faut une connexion internet pour générer la voix.'; return; }
  const btns = [$('mistralBtn'), $('audioBtn')]; btns.forEach(b => b.disabled = true);
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac; try { ac = new AC({ sampleRate: 24000 }); } catch(e) { ac = new AC(); }
  try {
    const parts = [], segs = []; let total = 0, n = 0;
    const sr = ac.sampleRate, pause = Math.round(sr * 1.0);
    for (let i = 0; i < ps.length; i++){
      note.textContent = `✦ Voix Marie : paragraphe ${i+1} sur ${ps.length}…`;
      const buf = await decodeAudio(ac, await mistralSpeech(ps[i]));
      const lens = sentences(ps[i]).map(s => s.length);
      const local = segmentAudio(buf, lens, new Set([lens.length - 1]));
      const offset = total / sr;
      local.forEach(([a, b]) => segs.push([+(a + offset).toFixed(3), +(b + offset).toFixed(3)]));
      n += lens.length;
      const mono = toMono(buf);
      parts.push(mono); total += mono.length;
      if (i < ps.length - 1){ parts.push(new Float32Array(pause)); total += pause; }
      if (!mistral.proxy) await sleep(300);
    }
    const all = new Float32Array(total); let o = 0;
    for (const p of parts){ all.set(p, o); o += p.length; }
    const blob = encodeWav(all, sr);
    let t = current;
    if (t.builtin) t = { id:newId(), title:t.title, text:t.text, created:Date.now() };
    const label = (MISTRAL_VOICES.find(v => v[0] === mistral.voice) || [0, 'Marie'])[1];
    const rec = { id:t.id, blob, segments:segs, name:label, n };
    await DB.put('audio', rec);
    t = { ...t, audio:{ name:rec.name, n } };
    await saveText(t);
    store.voiceByText = store.voiceByText || {}; store.voiceByText[t.id] = 'import'; persist();
    await openReader(t.id);
    setStatus(`Voix ${label} prête (${n} phrases). Appuie sur ▶ pour écouter.`);
  } catch(e){
    const c = e && e.code;
    note.textContent =
      c === 'cors' ? "Mistral refuse les demandes venant directement d'une page web. Il faut configurer le relais (voir l'aide dans ✦ Voix Marie)." :
      c === 'proxy' ? "Le relais ne répond pas. Vérifie son adresse dans ✦ Voix Marie." :
      c === 'key' ? "Clé Mistral refusée. Vérifie-la dans ✦ Voix Marie." :
      c === 'billing' ? "Mistral demande d'activer la facturation pour cette voix (console.mistral.ai)." :
      c === 'rate' ? "Trop de demandes d'un coup. Réessaie dans une minute." :
      "La génération a échoué : " + (e && e.message ? e.message : 'erreur inconnue');
  } finally {
    try { ac.close(); } catch(e) {}
    btns.forEach(b => b.disabled = false);
  }
}

/* ---------- Confirmation ---------- */
let confirmCb = null;
function askConfirm(text, cb){ $('confirmText').textContent = text; confirmCb = cb; $('confirmModal').classList.add('open'); }
$('confirmNo').onclick = () => $('confirmModal').classList.remove('open');
$('confirmYes').onclick = () => { $('confirmModal').classList.remove('open'); if (confirmCb) confirmCb(); };

/* ---------- Ajout / modification ---------- */
let editingId = null;
let pages = [];   // {blob, img, rot, crop, el}
let busy = false;

function openEditor(opts){
  editingId = opts.id || null;
  $('editHeading').textContent = opts.heading;
  $('titleInput').value = opts.title || '';
  $('editor').value = opts.text || '';
  $('photoZone').classList.toggle('hidden', !opts.photo);
  pages = []; renderPages();
  $('ocrNote').classList.add('hidden');
  $('editModal').classList.add('open');
  if (opts.photo && typeof OCR !== 'undefined') OCR.warm().catch(()=>{});
}
$('addPhotoCard').onclick = () => openEditor({ heading:'Nouveau texte depuis une photo', photo:true });
$('addTextCard').onclick = () => openEditor({ heading:'Nouveau texte' });
$('editBtn').onclick = () => {
  stopAll(true);
  if (current.builtin) openEditor({ heading:'Dupliquer le texte', title: current.title + ' (copie)', text: current.text });
  else openEditor({ heading:'Modifier le texte', id: current.id, title: current.title, text: current.text });
};
$('cancelBtn').onclick = () => { $('editModal').classList.remove('open'); };
$('saveBtn').onclick = async () => {
  const text = $('editor').value.trim();
  if (!text){ $('editor').focus(); return; }
  const title = $('titleInput').value.trim() || (parse(text)[0] || 'Sans titre').slice(0, 60);
  const existing = editingId && userTexts.find(x => x.id === editingId);
  const t = { id: editingId || newId(), title, text, created: existing ? existing.created : Date.now() };
  if (existing && existing.audio) t.audio = existing.audio;
  $('editModal').classList.remove('open');
  await saveText(t);
  openReader(t.id);
};

$('camBtn').onclick = () => $('camInput').click();
$('galBtn').onclick = () => $('galInput').click();
$('camInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('galInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };

async function addFiles(files){
  for (const f of [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name))){
    const pg = { blob:f, img:null, rot:0, crop:null, detecting:true };
    pages.push(pg); renderPages();
    try {
      pg.img = await OCR.loadImage(f);
      renderPages();
      pg.rot = await OCR.bestRotation(f);
    } catch(e) {}
    pg.detecting = false; renderPages();
  }
}

function renderPages(){
  const box = $('pages'); box.innerHTML = '';
  pages.forEach((pg, i) => {
    const d = document.createElement('div'); d.className = 'page';
    d.innerHTML = `<div class="bar2"><span>Page ${i+1}${pg.detecting ? ' · recherche du sens de lecture…' : ' · trace un cadre autour du texte'}</span>
      <span><button class="icon-btn rot" title="Tourner">↻</button> <button class="icon-btn rm" title="Retirer">✕</button></span></div>
      <div class="cropwrap"><canvas></canvas><div class="cropbox hidden"></div></div>`;
    d.querySelector('.rot').onclick = () => { pg.rot = (pg.rot + 90) % 360; pg.crop = null; renderPages(); };
    d.querySelector('.rm').onclick = () => { pages.splice(i,1); renderPages(); };
    if (pg.img){
      const prev = OCR.canvasFor(pg.img, pg.rot, 900);
      const cv = d.querySelector('canvas'); cv.width = prev.width; cv.height = prev.height;
      cv.getContext('2d').drawImage(prev, 0, 0);
      attachCrop(d.querySelector('.cropwrap'), d.querySelector('.cropbox'), pg);
    }
    box.appendChild(d);
  });
  $('ocrBtn').disabled = busy || !pages.length || pages.some(p => p.detecting || !p.img);
}
function attachCrop(wrap, boxEl, pg){
  const show = () => {
    if (!pg.crop){ boxEl.classList.add('hidden'); return; }
    boxEl.classList.remove('hidden');
    Object.assign(boxEl.style, { left:pg.crop.x*100+'%', top:pg.crop.y*100+'%', width:pg.crop.w*100+'%', height:pg.crop.h*100+'%' });
  };
  let start = null;
  const pt = e => { const r = wrap.getBoundingClientRect(); return { x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)), y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)) }; };
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); wrap.setPointerCapture(e.pointerId); start = pt(e); pg.crop = { x:start.x, y:start.y, w:0, h:0 }; show(); });
  wrap.addEventListener('pointermove', e => { if (!start) return; const p = pt(e); pg.crop = { x:Math.min(start.x,p.x), y:Math.min(start.y,p.y), w:Math.abs(p.x-start.x), h:Math.abs(p.y-start.y) }; show(); });
  const end = () => { if (!start) return; start = null; if (pg.crop && (pg.crop.w < 0.08 || pg.crop.h < 0.08)) pg.crop = null; show(); };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  show();
}

$('ocrBtn').onclick = async () => {
  if (!pages.length || busy) return;
  busy = true; renderPages();
  const note = $('ocrNote'); note.classList.remove('hidden');
  OCR._onProgress = m => { if (m.status === 'recognizing text' && m.progress > 0) note.textContent = note.dataset.step + ` ${Math.round(m.progress*100)} %`; };
  try {
    const text = await OCR.transcribe(pages.map(p => p.blob), {
      rotations: pages.map(p => p.rot), crops: pages.map(p => p.crop),
      onStep: s => { note.dataset.step = s; note.textContent = s; }
    });
    const prev = $('editor').value.trim();
    $('editor').value = prev ? prev + '\n\n' + text : text;
    if (!$('titleInput').value.trim()){
      const first = parse(text)[0] || '';
      if (first.length < 60) $('titleInput').value = first.replace(/[.:]$/, '');
    }
    note.textContent = text.trim()
      ? 'Transcription terminée. Relis et corrige les erreurs éventuelles, puis enregistre.'
      : "Aucun texte reconnu. Essaie une photo plus nette, bien à plat, ou trace un cadre autour du texte.";
  } catch(e){
    note.textContent = "La transcription n'a pas abouti. Vérifie la photo, ou colle le texte à la main.";
  } finally {
    busy = false; OCR._onProgress = null; renderPages();
  }
};

/* ---------- Sauvegarde / restauration ---------- */
$('exportBtn').onclick = () => {
  const data = { app:'meditation-vocale', version:1, exported:new Date().toISOString(), texts:userTexts.map(({audio, ...t}) => t) };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meditation-vocale-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $('storeNote').textContent = 'Sauvegarde créée (textes seulement, sans les audios importés).';
};
$('importBtn').onclick = () => $('importInput').click();
$('importInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data.texts) ? data.texts : [];
    let n = 0;
    for (const t of list){
      if (!t || typeof t.text !== 'string') continue;
      const id = userTexts.some(x => x.id === t.id) ? newId() : (t.id || newId());
      await saveText({ id, title: String(t.title || 'Sans titre'), text: t.text, created: t.created || Date.now() });
      n++;
    }
    $('storeNote').textContent = `${n} texte${n>1?'s':''} restauré${n>1?'s':''}.`;
  } catch(err){ $('storeNote').textContent = "Ce fichier n'est pas une sauvegarde valide."; }
};

/* ---------- Installation ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  const n = $('installNote'); n.classList.remove('hidden');
  n.innerHTML = '<button class="icon-btn primary" id="installBtn">Installer l\'application</button>';
  $('installBtn').onclick = async () => { installEvt.prompt(); try { await installEvt.userChoice; } catch(x) {} installEvt = null; n.classList.add('hidden'); };
});
(function iosHint(){
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone){
    const n = $('installNote'); n.classList.remove('hidden');
    n.textContent = "Pour installer : bouton Partager ⬆︎ puis « Sur l'écran d'accueil ».";
  }
})();

/* ---------- Démarrage ---------- */
applyTheme();
loadLibrary();
loadVoices();
if (synth) synth.onvoiceschanged = loadVoices;
if ('serviceWorker' in navigator && location.protocol !== 'file:'){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
