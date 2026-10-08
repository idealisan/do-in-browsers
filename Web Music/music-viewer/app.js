'use strict';

const $ = (s) => document.querySelector(s);

const els = {
  root: document.documentElement,
  setupView: $('#setupView'),
  playerView: $('#playerView'),
  setupForm: $('#setupForm'),
  titleInput: $('#titleInput'),
  artistInput: $('#artistInput'),
  fieldTitle: $('#fieldTitle'),
  fieldArtist: $('#fieldArtist'),
  startBtn: $('#startBtn'),
  reqList: $('#reqList'),
  coverBtn: $('#coverBtn'),
  coverPreview: $('#coverPreview'),
  coverStatus: $('#coverStatus'),
  fileCover: $('#fileCover'),
  audioBtn: $('#audioBtn'),
  audioLabel: $('#audioLabel'),
  audioStatus: $('#audioStatus'),
  fileAudio: $('#fileAudio'),
  lrcBtn: $('#lrcBtn'),
  lrcLabel: $('#lrcLabel'),
  lrcStatus: $('#lrcStatus'),
  fileLrc: $('#fileLrc'),
  coverFrame: $('#coverFrame'),
  coverImg: $('#coverImg'),
  displayTitle: $('#displayTitle'),
  displayArtist: $('#displayArtist'),
  lyricsScroller: $('#lyricsScroller'),
  spectrum: $('#spectrum'),
  toast: $('#toast'),
  audio: $('#audioEl'),
};

const state = {
  title: '',
  artist: '',
  coverUrl: null,
  audioUrl: null,
  lrc: [],
};

/* =========================================================
   toast
   ========================================================= */
let toastTimer = 0;

function toast(msg, ms = 3400) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 300);
  }, ms);
}

function setStatus(el, text, kind) {
  el.textContent = text;
  if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
}

/* =========================================================
   palette extraction — the whole page takes its colour from
   the album art
   ========================================================= */
const FALLBACK_PALETTE = { hueA: 262, hueB: 190, sat: 78 };

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-4) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function extractPalette(img) {
  const N = 28;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0, N, N);
  } catch {
    return null;
  }
  let data;
  try {
    data = ctx.getImageData(0, 0, N, N).data;
  } catch {
    return null; // tainted canvas
  }

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.07 || l > 0.93 || s < 0.12) continue;
    const key = `${Math.round(h / 25) * 25}|${Math.round(s * 3)}`;
    const b = buckets.get(key) || { n: 0, h: 0, s: 0 };
    b.n++; b.h += h; b.s += s;
    buckets.set(key, b);
  }
  if (!buckets.size) return null;

  const ranked = [...buckets.values()]
    .map((b) => ({ n: b.n, h: b.h / b.n, s: b.s / b.n }))
    .sort((a, b) => b.n * b.s - a.n * a.s);

  const top = ranked[0];
  let second = ranked.find((c) => {
    let dh = Math.abs(c.h - top.h) % 360;
    if (dh > 180) dh = 360 - dh;
    return dh > 28;
  });
  if (!second) {
    second = ranked.find((c) => c !== top);
    if (second) {
      let dh = second.h - top.h;
      if (dh < 0) dh += 360;
      if (dh < 140) second = { ...second, h: (top.h + 180) % 360 };
    }
  }

  return {
    hueA: Math.round(top.h),
    hueB: Math.round((second ? second.h : top.h + 165) % 360),
    sat: Math.round(Math.max(38, Math.min(92, top.s * 100))),
  };
}

function applyPalette(p) {
  const pal = p || FALLBACK_PALETTE;
  els.root.style.setProperty('--hue-a', pal.hueA);
  els.root.style.setProperty('--hue-b', pal.hueB);
  els.root.style.setProperty('--c-sat', `${pal.sat}%`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', `hsl(${pal.hueA} 42% 7%)`);
}

/* =========================================================
   spectrum — the reactive strip along the bottom
   ========================================================= */
const BARS = 64;

function idleBars() {
  const a = new Float32Array(BARS);
  const t = performance.now() / 1000;
  for (let i = 0; i < BARS; i++) {
    const w1 = Math.sin(t * 0.5 + i * 0.21);
    const w2 = Math.sin(t * 1.1 - i * 0.09 + 1.7);
    const w3 = Math.sin(t * 0.27 + i * 0.5);
    let v = (w1 * 0.5 + w2 * 0.26 + w3 * 0.34) * 0.5 + 0.16;
    a[i] = Math.max(0, Math.min(1, v)) ** 1.6;
  }
  return a;
}

class Spectrum {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sm = new Float32Array(BARS);
    this.source = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.hueA = 262;
    this.hueB = 190;
    this.resize();
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  setPalette(hueA, hueB) {
    this.hueA = hueA;
    this.hueB = hueB;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  setSource(fn) {
    this.source = fn;
  }

  tick() {
    this.draw();
    requestAnimationFrame(this.tick);
  }

  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, Math.abs(h));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, [rr, rr, 0, 0]);
    } else {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;

    const target = this.source ? this.source() : idleBars();
    for (let i = 0; i < BARS; i++) {
      this.sm[i] += (target[i] - this.sm[i]) * 0.28;
    }

    const active = !!this.source;
    const gap = 3;
    const colW = w / BARS;
    const barW = Math.max(1.5, colW - gap);
    const base = h;
    const maxH = h * 0.94;
    const r = Math.min(barW / 2, 4);

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < BARS; i++) {
      const v = Math.max(0, Math.min(1, this.sm[i]));
      const bh = Math.max(1.5, Math.pow(v, 1.25) * maxH);
      const x = i * colW + gap / 2;
      const y = base - bh;
      const mix = i / BARS;
      const hue = this.hueA + (this.hueB - this.hueA) * mix + (this.hueB < this.hueA ? 360 : 0);
      const alpha = active ? 0.45 + v * 0.5 : 0.22 + v * 0.22;

      const g = ctx.createLinearGradient(0, y, 0, base);
      g.addColorStop(0, `hsla(${hue}, 95%, 78%, ${alpha})`);
      g.addColorStop(0.62, `hsla(${hue - 8}, 92%, 62%, ${alpha * 0.88})`);
      g.addColorStop(1, `hsla(${hue - 22}, 88%, 50%, ${alpha * 0.55})`);
      ctx.fillStyle = g;
      this.roundRect(ctx, x, y, barW, bh, r);
      ctx.fill();

      if (active && bh > 4) {
        ctx.shadowColor = `hsla(${hue}, 95%, 64%, .6)`;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // melt the top of the bars into the background
    ctx.globalCompositeOperation = 'destination-out';
    const melt = ctx.createLinearGradient(0, 0, 0, h * 0.95);
    melt.addColorStop(0, 'rgba(0,0,0,1)');
    melt.addColorStop(0.4, 'rgba(0,0,0,0)');
    melt.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = melt;
    ctx.fillRect(0, 0, w, h * 0.42);
    ctx.globalCompositeOperation = 'source-over';
  }
}

const spectrum = new Spectrum(els.spectrum);

/* =========================================================
   audio graph
   ========================================================= */
let actx = null;
let analyserNode = null;
let barsFn = null;

function ensureGraph() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    analyserNode = actx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.82;
    const gain = actx.createGain();
    gain.gain.value = 1;
    const src = actx.createMediaElementSource(els.audio);
    src.connect(analyserNode);
    analyserNode.connect(gain);
    gain.connect(actx.destination);

    const freq = new Uint8Array(analyserNode.frequencyBinCount);
    barsFn = () => {
      analyserNode.getByteFrequencyData(freq);
      const out = new Float32Array(BARS);
      const span = Math.floor(freq.length * 0.78);
      for (let i = 0; i < BARS; i++) {
        const idx = Math.floor(Math.pow(i / BARS, 1.35) * span);
        const tilt = 0.55 + 1.9 * (i / BARS);
        // gamma < 1 lifts quiet passages so the strip stays legible
        out[i] = Math.min(1, Math.pow((freq[idx] / 255) * tilt, 0.7));
      }
      return out;
    };
  } catch (err) {
    console.warn('Web Audio unavailable — spectrum stays idle', err);
  }
}

function resumeAudio() {
  ensureGraph();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}

/* =========================================================
   playback
   ========================================================= */
function togglePlay() {
  if (!els.audio.src) return;
  resumeAudio();
  if (els.audio.paused) {
    const p = els.audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        console.warn('play() rejected', err);
        toast('无法播放这个音频，换一个 mp3 / m4a / wav 试试');
      });
    }
  } else {
    els.audio.pause();
  }
}

els.playerView.addEventListener('click', togglePlay);

els.audio.addEventListener('play', () => {
  document.body.classList.add('playing');
  if (barsFn) spectrum.setSource(barsFn);
});
els.audio.addEventListener('pause', () => {
  document.body.classList.remove('playing');
  spectrum.setSource(null);
});
els.audio.addEventListener('ended', () => {
  document.body.classList.remove('playing');
  spectrum.setSource(null);
});

els.audio.addEventListener('error', () => {
  const code = els.audio.error ? els.audio.error.code : 0;
  const reasons = {
    1: '音频加载被中止',
    2: '音频读取失败，可能是文件被移动了',
    3: '音频解码失败，文件可能已损坏',
    4: '浏览器不支持这个音频格式',
  };
  toast(reasons[code] || '音频加载失败', 4200);
  document.body.classList.remove('playing');
  spectrum.setSource(null);
});

els.audio.addEventListener('timeupdate', () => {
  updateLyric(els.audio.currentTime);
});

/* =========================================================
   lyrics
   ========================================================= */
let lines = [];
let curIdx = -1;

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TIME_STRIP_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
const META_RE = /\[(\w+):([^\]]*)\]/g;

function parseLrc(text) {
  const meta = {};
  const out = [];
  for (const row of text.split(/\r?\n/)) {
    const tags = [...row.matchAll(TIME_RE)];
    if (tags.length) {
      const lyric = row.replace(TIME_STRIP_RE, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      if (lyric) {
        for (const tag of tags) {
          const ms = (tag[3] || '0').padEnd(3, '0');
          out.push({ time: Number(tag[1]) * 60 + Number(tag[2]) + Number(ms) / 1000, text: lyric });
        }
      }
      continue;
    }
    for (const m of row.matchAll(META_RE)) meta[m[1].toLowerCase()] = m[2].trim();
  }
  out.sort((a, b) => a.time - b.time);
  return { meta, lrc: out };
}

function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    for (const enc of ['gb18030', 'gbk', 'big5', 'shift_jis']) {
      try { return new TextDecoder(enc).decode(bytes); } catch {}
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeLyrics(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('read-failed'));
    r.onload = () => {
      try { resolve(decodeText(r.result)); } catch (err) { reject(err); }
    };
    r.readAsArrayBuffer(file);
  });
}

function renderLyrics() {
  els.lyricsScroller.innerHTML = '';
  curIdx = -1;
  if (!state.lrc.length) {
    const d = document.createElement('div');
    d.className = 'lyric-placeholder';
    d.textContent = '未上传歌词';
    els.lyricsScroller.appendChild(d);
    lines = [];
    els.lyricsScroller.style.transform = '';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of state.lrc) {
    const d = document.createElement('div');
    d.className = 'lyric-line';
    d.textContent = item.text;
    frag.appendChild(d);
  }
  els.lyricsScroller.appendChild(frag);
  lines = [...els.lyricsScroller.children];
}

function updateLyric(t) {
  if (!state.lrc.length) return;
  let idx = -1;
  for (let i = state.lrc.length - 1; i >= 0; i--) {
    if (t >= state.lrc[i].time) { idx = i; break; }
  }
  if (idx === curIdx) return;
  curIdx = idx;
  lines.forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('pass', i < idx);
  });
  centerOn(idx);
}

function centerOn(idx) {
  const track = els.lyricsScroller;
  const vp = track.parentElement;
  const viewH = vp.clientHeight;
  const contentH = track.scrollHeight;
  if (idx < 0 || idx >= lines.length || viewH <= 0) {
    track.style.transform = '';
    return;
  }
  if (contentH <= viewH) {
    track.style.transform = `translateY(${Math.round((viewH - contentH) / 2)}px)`;
    return;
  }
  const el = lines[idx];
  const lineCenter = el.offsetTop + el.offsetHeight / 2;
  // Push the active line toward the middle, but only so far — a full
  // centre-offset on the very first line leaves an ugly hole above it.
  const desired = viewH / 2 - lineCenter;
  const ty = Math.max(-(contentH - viewH), Math.min(desired, viewH * 0.18));
  track.style.transform = `translateY(${Math.round(ty)}px)`;
}

window.addEventListener('resize', () => centerOn(curIdx));

/* =========================================================
   validation — the CTA is never disabled; it explains instead
   ========================================================= */
function missingFields() {
  const missing = [];
  if (!els.titleInput.value.trim()) missing.push({ label: '标题', node: els.fieldTitle, input: els.titleInput });
  if (!els.artistInput.value.trim()) missing.push({ label: '歌手', node: els.fieldArtist, input: els.artistInput });
  if (!state.audioUrl) missing.push({ label: '音乐', node: els.audioBtn, input: null });
  return missing;
}

function validate() {
  const missing = missingFields();
  const ready = missing.length === 0;
  els.startBtn.dataset.armed = String(ready);
  if (ready) {
    els.reqList.textContent = '都齐了，开始播放吧';
    els.reqList.dataset.kind = 'ready';
  } else {
    els.reqList.textContent = `还差：${missing.map((m) => m.label).join('、')}`;
    delete els.reqList.dataset.kind;
  }
  return ready;
}

function flashMissing() {
  const missing = missingFields();
  if (!missing.length) return;
  missing.forEach((m) => m.node.classList.add('invalid'));
  const first = missing[0];
  if (first.input) first.input.focus({ preventScroll: false });
  setTimeout(() => missing.forEach((m) => m.node.classList.remove('invalid')), 2200);
}

/* =========================================================
   file intake (click + drag & drop)
   ========================================================= */
const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(f.name);

function pickCover(f) {
  els.coverBtn.classList.remove('error');
  if (!isImage(f)) {
    els.coverBtn.classList.add('error');
    setStatus(els.coverStatus, `「${f.name}」不是图片，已忽略`, 'error');
    toast('封面需要图片文件，比如 png / jpg / webp');
    return;
  }
  const url = URL.createObjectURL(f);
  const probe = new Image();
  probe.onload = () => {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = url;
    els.coverPreview.src = url;
    els.coverImg.src = url;
    els.coverBtn.classList.add('done');
    els.coverFrame.classList.add('has-cover');

    const pal = extractPalette(probe) || FALLBACK_PALETTE;
    applyPalette(pal);
    spectrum.setPalette(pal.hueA, pal.hueB);

    setStatus(els.coverStatus, `已选择 ${f.name}`, 'ok');
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    els.coverBtn.classList.add('error');
    setStatus(els.coverStatus, `「${f.name}」无法解码，换一张`, 'error');
    toast('这张封面无法解码');
  };
  probe.src = url;
}

function pickAudio(f) {
  els.audioBtn.classList.remove('error');
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(f);
  els.audio.src = state.audioUrl;
  els.audio.load();
  els.audioLabel.textContent = f.name;
  els.audioBtn.classList.add('done');
  els.audioBtn.classList.remove('invalid');

  els.audio.removeEventListener('loadedmetadata', onAudioMeta);
  els.audio.addEventListener('loadedmetadata', onAudioMeta, { once: true });
  els.audio.removeEventListener('error', onAudioMetaFail);
  els.audio.addEventListener('error', onAudioMetaFail, { once: true });
  setStatus(els.audioStatus, `已选择 ${f.name}`, 'ok');
  validate();
}

function onAudioMeta() {
  const d = els.audio.duration;
  if (!d || !isFinite(d)) return;
  const m = Math.floor(d / 60);
  const s = Math.round(d % 60);
  setStatus(els.audioStatus, `${els.audioLabel.textContent} · ${m}:${String(s).padStart(2, '0')}`, 'ok');
}

function onAudioMetaFail() {
  els.audioBtn.classList.remove('done');
  els.audioBtn.classList.add('error');
  setStatus(els.audioStatus, `「${els.audioLabel.textContent}」无法解码，换一个`, 'error');
  toast('这个音频打不开，换一个 mp3 / m4a / wav 试试');
}

function pickLrc(f) {
  els.lrcBtn.classList.remove('error');
  decodeLyrics(f)
    .then((text) => {
      const { meta, lrc } = parseLrc(text);
      state.lrc = lrc;
      els.lrcLabel.textContent = f.name;
      if (meta.ti && !els.titleInput.value.trim()) els.titleInput.value = meta.ti;
      if (meta.ar && !els.artistInput.value.trim()) els.artistInput.value = meta.ar;

      if (lrc.length) {
        els.lrcBtn.classList.add('done');
        setStatus(els.lrcStatus, `已解析 ${lrc.length} 行 · ${f.name}`, 'ok');
      } else {
        els.lrcBtn.classList.add('error');
        els.lrcLabel.textContent = '未识别到时间轴';
        setStatus(els.lrcStatus, `「${f.name}」里没有 [mm:ss] 时间轴，不会滚词，但不影响播放`, 'error');
        toast('歌词文件没有时间轴，播放时不滚词');
      }
      validate();
    })
    .catch(() => {
      state.lrc = [];
      els.lrcBtn.classList.remove('done');
      els.lrcBtn.classList.add('error');
      els.lrcLabel.textContent = '读取失败';
      setStatus(els.lrcStatus, `「${f.name}」读取失败，但不影响播放`, 'error');
      toast('歌词文件读取失败，可以忽略');
      validate();
    });
}

function bindDropzone(btn, input, handler, validateFile) {
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (f) handler(f);
    input.value = '';
  });

  btn.addEventListener('dragover', (e) => {
    e.preventDefault();
    btn.classList.add('is-over');
  });
  btn.addEventListener('dragenter', (e) => {
    e.preventDefault();
    btn.classList.add('is-over');
  });
  btn.addEventListener('dragleave', (e) => {
    if (btn.contains(e.relatedTarget)) return;
    btn.classList.remove('is-over');
  });
  btn.addEventListener('drop', (e) => {
    e.preventDefault();
    btn.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (validateFile && !validateFile(f)) return;
    handler(f);
  });
}

bindDropzone(els.coverBtn, els.fileCover, pickCover, null);
bindDropzone(els.audioBtn, els.fileAudio, pickAudio, null);
bindDropzone(els.lrcBtn, els.fileLrc, pickLrc, null);

/* block the page from navigating when a file is dropped outside a zone */
['dragover', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    if (!e.target.closest('[data-drop]')) e.preventDefault();
  });
});

els.titleInput.addEventListener('input', () => {
  els.fieldTitle.classList.remove('invalid');
  validate();
});
els.artistInput.addEventListener('input', () => {
  els.fieldArtist.classList.remove('invalid');
  validate();
});

/* =========================================================
   view switching
   ========================================================= */
els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validate()) {
    flashMissing();
    toast(`还差：${missingFields().map((m) => m.label).join('、')}`);
    return;
  }
  state.title = els.titleInput.value.trim();
  state.artist = els.artistInput.value.trim();
  els.displayTitle.textContent = state.title;
  els.displayArtist.textContent = state.artist;

  renderLyrics();
  switchView('player');

  if (els.audio.src) els.audio.load();
  updateLyric(0);
  centerOn(Math.max(0, curIdx));

  resumeAudio();
  els.audio.play().catch(() => {});
});

function switchView(name) {
  const toPlayer = name === 'player';
  els.setupView.classList.toggle('active', !toPlayer);
  els.playerView.classList.toggle('active', toPlayer);
  document.body.dataset.view = name;

  if (toPlayer) {
    els.playerView.focus({ preventScroll: true });
    spectrum.resize();
  } else {
    if (!els.audio.paused) els.audio.pause();
    els.setupView.scrollTop = 0;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.playerView.classList.contains('active')) {
    e.preventDefault();
    switchView('setup');
  }
});

window.addEventListener('beforeunload', () => {
  if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
});

applyPalette(null);
validate();