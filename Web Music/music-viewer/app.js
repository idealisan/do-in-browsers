'use strict';

const $ = (s) => document.querySelector(s);

const els = {
  setupView: $('#setupView'),
  playerView: $('#playerView'),
  setupForm: $('#setupForm'),
  titleInput: $('#titleInput'),
  artistInput: $('#artistInput'),
  startBtn: $('#startBtn'),
  coverBtn: $('#coverBtn'),
  coverPreview: $('#coverPreview'),
  fileCover: $('#fileCover'),
  audioBtn: $('#audioBtn'),
  audioLabel: $('#audioLabel'),
  fileAudio: $('#fileAudio'),
  lrcBtn: $('#lrcBtn'),
  lrcLabel: $('#lrcLabel'),
  fileLrc: $('#fileLrc'),
  auroraSetup: $('#auroraSetup'),
  auroraPlayer: $('#auroraCanvas'),
  coverFrame: $('#coverFrame'),
  coverImg: $('#coverImg'),
  displayTitle: $('#displayTitle'),
  displayArtist: $('#displayArtist'),
  lyricsScroller: $('#lyricsScroller'),
  audio: $('#audioEl'),
};

const state = {
  title: '',
  artist: '',
  coverUrl: null,
  audioUrl: null,
  lrc: [],
};

/* ================= Aurora ================= */

const BARS = 72;

function idleBars() {
  const a = new Float32Array(BARS);
  const t = performance.now() / 1000;
  for (let i = 0; i < BARS; i++) {
    const w1 = Math.sin(t * 0.42 + i * 0.16);
    const w2 = Math.sin(t * 0.9 - i * 0.055 + 1.7);
    const w3 = Math.sin(t * 0.2 + i * 0.42);
    let v = w1 * 0.5 + w2 * 0.28 + w3 * 0.35;
    v = Math.max(0, v) * 0.55;
    a[i] = v * v;
  }
  return a;
}

class Aurora {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.baseHue = opts.baseHue ?? 256;
    this.sm = new Float32Array(BARS);
    this.source = null;
    this.w = 0;
    this.h = 0;
    this.resize();
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.resize()).observe(canvas);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this._loop();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  setSource(fn) {
    this.source = fn;
  }

  _loop = () => {
    this.draw();
    requestAnimationFrame(this._loop);
  };

  draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;

    const target = this.source ? this.source() : idleBars();
    for (let i = 0; i < BARS; i++) {
      this.sm[i] += (target[i] - this.sm[i]) * 0.3;
    }

    const t = performance.now() / 1000;
    const colW = w / BARS;
    const top = h * 0.08;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < BARS; i++) {
      let v = this.sm[i];
      v = Math.max(0, Math.min(1, v));
      const bh = Math.pow(v, 1.2) * (h - top);
      const x = i * colW;
      const y = h - bh;
      const hue = this.baseHue + Math.sin(t * 0.25 + i * 0.09) * 14 + (i * 0.5);
      const g = ctx.createLinearGradient(0, y, 0, h);
      g.addColorStop(0, `hsla(${hue}, 95%, 72%, ${0.5 + v * 0.5})`);
      g.addColorStop(0.55, `hsla(${hue - 18}, 95%, 62%, ${0.22 * v + 0.05})`);
      g.addColorStop(1, `hsla(${hue - 34}, 95%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, colW + 0.6, bh + 1);
    }

    ctx.globalCompositeOperation = 'source-over';
    const fade = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    fade.addColorStop(0, 'rgba(6, 7, 17, 0.9)');
    fade.addColorStop(1, 'rgba(6, 7, 17, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h * 0.5);
  }
}

const setupAurora = new Aurora(els.auroraSetup, { baseHue: 222 });
const playerAurora = new Aurora(els.auroraPlayer, { baseHue: 262 });

/* ================= Audio graph ================= */

let actx = null;
let analyserNode = null;
let gainNode = null;
let barsFn = null;

function ensureGraph() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    analyserNode = actx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.84;
    gainNode = actx.createGain();
    gainNode.gain.value = 1;
    const src = actx.createMediaElementSource(els.audio);
    src.connect(analyserNode);
    analyserNode.connect(gainNode);
    gainNode.connect(actx.destination);

    const freq = new Uint8Array(analyserNode.frequencyBinCount);
    barsFn = () => {
      analyserNode.getByteFrequencyData(freq);
      const out = new Float32Array(BARS);
      const span = Math.floor(freq.length * 0.75);
      for (let i = 0; i < BARS; i++) {
        const idx = Math.floor(Math.pow(i / BARS, 1.4) * span);
        out[i] = (freq[idx] / 255) * (0.45 + 1.5 * (i / BARS));
      }
      return out;
    };
  } catch (err) {
    console.warn('Web Audio unavailable, aurora will stay idle', err);
  }
}

function resumeAudio() {
  ensureGraph();
  if (actx && actx.state === 'suspended') {
    actx.resume().catch(() => {});
  }
}

/* ================= Playback (click anywhere) ================= */

function togglePlay() {
  if (!els.audio.src) return;
  resumeAudio();
  if (els.audio.paused) {
    els.audio.play().catch(() => {});
  } else {
    els.audio.pause();
  }
}

els.playerView.addEventListener('click', togglePlay);

els.audio.addEventListener('play', () => {
  document.body.classList.add('playing');
  if (barsFn) playerAurora.setSource(barsFn);
  updateLyric(els.audio.currentTime);
});
els.audio.addEventListener('pause', () => {
  document.body.classList.remove('playing');
  playerAurora.setSource(null);
});
els.audio.addEventListener('ended', () => {
  document.body.classList.remove('playing');
});

els.audio.addEventListener('timeupdate', () => {
  updateLyric(els.audio.currentTime);
});

/* ================= Lyrics ================= */

let lines = [];
let curIdx = -1;

function parseLrc(text) {
  const meta = {};
  const out = [];
  const rows = text.split(/\r?\n/);
  for (const row of rows) {
    const timeRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const tags = [...row.matchAll(timeRe)];
    if (tags.length) {
      const lyric = row.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
      if (lyric) {
        for (const tag of tags) {
          const min = Number(tag[1]);
          const sec = Number(tag[2]);
          const msRaw = (tag[3] || '0').padEnd(3, '0');
          const time = min * 60 + sec + Number(msRaw) / 1000;
          out.push({ time, text: lyric });
        }
      }
      continue;
    }
    const mTags = [...row.matchAll(/\[(\w+):([^\]]*)\]/g)];
    for (const m of mTags) {
      meta[m[1].toLowerCase()] = m[2].trim();
    }
  }
  out.sort((a, b) => a.time - b.time);
  return { meta, lrc: out };
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
    if (t >= state.lrc[i].time) {
      idx = i;
      break;
    }
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
  const scroller = els.lyricsScroller;
  const wrapH = scroller.clientHeight;
  const contentH = scroller.scrollHeight;
  if (idx < 0 || wrapH <= 0) {
    scroller.style.transform = '';
    return;
  }
  const el = lines[idx];
  let ty;
  if (contentH <= wrapH) {
    ty = (wrapH - contentH) / 2;
  } else {
    const lineCenter = el.offsetTop + el.offsetHeight / 2;
    ty = Math.max(-(contentH - wrapH), wrapH / 2 - lineCenter);
  }
  scroller.style.transform = 'translateY(' + Math.round(ty) + 'px)';
}

/* ================= Setup / upload ================= */

function validate() {
  const ok = !!state.audioUrl && !!state.coverUrl && state.lrc.length > 0 &&
    !!els.titleInput.value.trim() && !!els.artistInput.value.trim();
  els.startBtn.disabled = !ok;
}

function bindFile(btn, input, onChange) {
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    onChange(f);
    input.value = '';
  });
}

bindFile(els.coverBtn, els.fileCover, (f) => {
  if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  state.coverUrl = URL.createObjectURL(f);
  els.coverPreview.src = state.coverUrl;
  els.coverBtn.classList.add('done');
  els.coverImg.src = state.coverUrl;
  els.coverFrame.classList.add('has-cover');
  validate();
});

bindFile(els.audioBtn, els.fileAudio, (f) => {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(f);
  els.audio.src = state.audioUrl;
  els.audioLabel.textContent = f.name;
  els.audioBtn.classList.add('done');
  validate();
});

bindFile(els.lrcBtn, els.fileLrc, (f) => {
  const reader = new FileReader();
  reader.onload = () => {
    const { meta, lrc } = parseLrc(String(reader.result));
    state.lrc = lrc;
    els.lrcLabel.textContent = f.name;
    els.lrcBtn.classList.add('done');
    if (meta.ti && !els.titleInput.value) els.titleInput.value = meta.ti;
    if (meta.ar && !els.artistInput.value) els.artistInput.value = meta.ar;
    validate();
  };
  reader.readAsText(f);
});

els.titleInput.addEventListener('input', validate);
els.artistInput.addEventListener('input', validate);

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.title = els.titleInput.value.trim();
  state.artist = els.artistInput.value.trim();
  els.displayTitle.textContent = state.title;
  els.displayArtist.textContent = state.artist;
  renderLyrics();
  switchView('player');
  els.audio.load();
  updateLyric(0);
});

function switchView(name) {
  els.setupView.classList.toggle('active', name === 'setup');
  els.playerView.classList.toggle('active', name === 'player');
}

window.addEventListener('beforeunload', () => {
  if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
});

validate();