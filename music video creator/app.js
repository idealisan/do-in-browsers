'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const els = {
  body: document.body,
  setupView: $('#setupView'),
  playerView: $('#playerView'),
  setupForm: $('#setupForm'),
  titleInput: $('#titleInput'),
  artistInput: $('#artistInput'),
  albumInput: $('#albumInput'),
  fieldTitle: $('#fieldTitle'),
  fieldArtist: $('#fieldArtist'),
  startBtn: $('#startBtn'),
  reqList: $('#reqList'),
  orientSeg: $('#orientSeg'),
  glowRange: $('#glowRange'),
  glowOut: $('#glowOut'),

  coverBtn: $('#coverBtn'),
  coverPreview: $('#coverPreview'),
  coverPh: $('#coverPh'),
  fileCover: $('#fileCover'),
  audioBtn: $('#audioBtn'),
  audioLabel: $('#audioLabel'),
  audioHint: $('#audioHint'),
  fileAudio: $('#fileAudio'),
  lrcBtn: $('#lrcBtn'),
  lrcLabel: $('#lrcLabel'),
  lrcHint: $('#lrcHint'),
  fileLrc: $('#fileLrc'),

  stage: $('#stage'),
  coverBox: $('#coverBox'),
  coverImg: $('#coverImg'),
  displayTitle: $('#displayTitle'),
  displayArtist: $('#displayArtist'),
  displayAlbum: $('#displayAlbum'),
  lyricsBox: $('#lyricsBox'),
  lyricsTrack: $('#lyricsTrack'),
  lyricsPh: $('#lyricsPh'),
  hud: $('#hud'),
  hudState: $('#hudState'),
  hudOrient: $('#hudOrient'),
  toast: $('#toast'),
  audio: $('#audioEl'),
};

const PLACEHOLDER = { title: '歌曲名称', artist: '歌手', album: '专辑名' };

const state = {
  title: '', artist: '', album: '',
  coverUrl: null, audioUrl: null,
  lrc: [], orientation: 'landscape',
};

/* =========================================================
   toast
   ========================================================= */
let toastTimer = 0;
function toast(msg, ms = 3200) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 320);
  }, ms);
}

/* =========================================================
   palette — the ambience takes its colour from the cover art
   ========================================================= */
const FALLBACK_PALETTE = { hueA: 262, hueB: 188, sat: 72 };

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-4) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
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
  try { ctx.drawImage(img, 0, 0, N, N); } catch { return null; }
  let data;
  try { data = ctx.getImageData(0, 0, N, N).data; } catch { return null; }

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
    sat: Math.round(Math.max(38, Math.min(88, top.s * 100))),
  };
}

function applyPalette(p) {
  const pal = p || FALLBACK_PALETTE;
  const root = document.documentElement.style;
  root.setProperty('--hue-a', pal.hueA);
  root.setProperty('--hue-b', pal.hueB);
  root.setProperty('--c-sat', `${pal.sat}%`);
  pulse.hueA = pal.hueA;
  pulse.hueB = pal.hueB;
}

/* =========================================================
   audio graph + gentle ambience pulse
   ========================================================= */
let actx = null, analyser = null, barsFn = null;
const pulse = { hueA: 262, hueB: 188, level: 0, target: 0 };

function ensureGraph() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;
    const gain = actx.createGain();
    const src = actx.createMediaElementSource(els.audio);
    src.connect(analyser);
    analyser.connect(gain);
    gain.connect(actx.destination);

    const freq = new Uint8Array(analyser.frequencyBinCount);
    barsFn = () => {
      analyser.getByteFrequencyData(freq);
      // average of the low-mid band, normalised and tamed
      let sum = 0, n = 0;
      for (let i = 1; i < Math.min(40, freq.length); i++) { sum += freq[i]; n++; }
      return n ? Math.min(1, (sum / n) / 190) : 0;
    };
  } catch (err) {
    console.warn('Web Audio unavailable', err);
  }
}

function resumeAudio() {
  ensureGraph();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}

function pulseLoop() {
  pulse.target = barsFn && !els.audio.paused ? barsFn() : 0;
  pulse.level += (pulse.target - pulse.level) * 0.08;
  document.documentElement.style.setProperty('--pulse', (1 + pulse.level * 0.06).toFixed(3));
  requestAnimationFrame(pulseLoop);
}
requestAnimationFrame(pulseLoop);

/* =========================================================
   playback
   ========================================================= */
let pendingAutoplay = false; // start only once the floating HUD has faded out
let userControlled = false;

function startPlayback() {
  resumeAudio();
  const p = els.audio.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => toast('无法播放这个音频，试试换个 mp3 / m4a / wav'));
  }
}

function togglePlay() {
  if (!els.audio.src) {
    toast('还没有音乐，点「编辑」上传一个音频文件吧');
    return;
  }
  userControlled = true;   // manual input cancels the delayed autoplay
  pendingAutoplay = false;
  if (els.audio.paused) startPlayback();
  else els.audio.pause();
}

/* R: rewind to the start and pause, so the next P begins from the beginning */
function resetPlayback() {
  userControlled = true;
  pendingAutoplay = false;
  if (!els.audio.src) return;
  els.audio.pause();
  try { els.audio.currentTime = 0; } catch { /* not seekable yet */ }
  curIdx = -1;
  updateLyric(0);
  centerOn(Math.max(0, curIdx));
  showHud();
}

function updatePlayIcon(playing) {
  const path = els.hudState.querySelector('path');
  path.setAttribute('d', playing ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5l11 7-11 7z');
}

els.audio.addEventListener('play', () => updatePlayIcon(true));
els.audio.addEventListener('pause', () => updatePlayIcon(false));
els.audio.addEventListener('ended', () => updatePlayIcon(false));
els.audio.addEventListener('error', () => {
  toast('这个音频打不开，换一个 mp3 / m4a / wav 试试', 4200);
});
els.audio.addEventListener('timeupdate', () => updateLyric(els.audio.currentTime));

/* =========================================================
   LRC — parse, decode, render, scroll
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
      const lyric = row
        .replace(TIME_STRIP_RE, '')
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
        .trim();
      if (lyric) {
        for (const tag of tags) {
          const ms = (tag[3] || '0').padEnd(3, '0');
          out.push({
            time: Number(tag[1]) * 60 + Number(tag[2]) + Number(ms) / 1000,
            text: lyric,
          });
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
      try { return new TextDecoder(enc).decode(bytes); } catch { /* next */ }
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

/* Landscape layout follows the actual width of the loaded lyrics: short lines
   get a narrower lyric column so the whole composition stays balanced. */
function adjustLandscapeLayout() {
  if (state.orientation !== 'landscape') return;
  const stageW = els.stage.clientWidth;
  if (!stageW) return;

  let lyricCol = 47; // default split, also used when there are no lyrics
  if (state.lrc.length && lines.length) {
    const cs = getComputedStyle(lines[0]);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let maxW = 0;
    for (const item of state.lrc) maxW = Math.max(maxW, ctx.measureText(item.text).width);
    lyricCol = (maxW * 1.42) / stageW * 100; // active line is scaled + breathing room
    lyricCol = Math.max(36, Math.min(58, lyricCol));
  }
  const coverCol = Math.max(22, Math.min(33, 80 - lyricCol));
  els.lyricsBox.classList.toggle('is-compact', lyricCol <= 44 && state.lrc.length > 0);
  els.stage.style.setProperty('--lyric-col', `${lyricCol.toFixed(1)}cqw`);
  els.stage.style.setProperty('--cover-col', `${coverCol.toFixed(1)}cqw`);
}

function renderLyrics() {
  els.lyricsTrack.innerHTML = '';
  els.lyricsTrack.style.transition = 'none'; // place the first line instantly
  requestAnimationFrame(() => { els.lyricsTrack.style.transition = ''; });
  lines = [];
  curIdx = -1;
  els.lyricsBox.classList.toggle('has-lyrics', state.lrc.length > 0);
  if (!state.lrc.length) {
    els.lyricsTrack.style.transform = '';
    adjustLandscapeLayout();
    return;
  }
  const frag = document.createDocumentFragment();
  state.lrc.forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'lyric-line';
    d.textContent = item.text;
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      els.audio.currentTime = item.time;
      if (els.audio.paused) togglePlay();
    });
    frag.appendChild(d);
  });
  els.lyricsTrack.appendChild(frag);
  lines = [...els.lyricsTrack.children];
  adjustLandscapeLayout();
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
  if (!lines.length) return;
  const vp = els.lyricsTrack.parentElement;
  const viewH = vp.clientHeight;
  const contentH = els.lyricsTrack.scrollHeight;
  if (idx < 0 || idx >= lines.length || viewH <= 0) {
    els.lyricsTrack.style.transform = '';
    return;
  }
  if (contentH <= viewH) {
    els.lyricsTrack.style.transform = `translateY(${Math.round((viewH - contentH) / 2)}px)`;
    return;
  }
  const el = lines[idx];
  const lineCenter = el.offsetTop + el.offsetHeight / 2;
  const desired = viewH / 2 - lineCenter;
  const ty = Math.max(-(contentH - viewH), Math.min(desired, viewH * 0.16));
  els.lyricsTrack.style.transform = `translateY(${Math.round(ty)}px)`;
}

window.addEventListener('resize', () => { adjustLandscapeLayout(); centerOn(curIdx); });

/* =========================================================
   text fields (both editor + inline in the player)
   ========================================================= */
const TEXT_INPUTS = {
  title: els.titleInput, artist: els.artistInput, album: els.albumInput,
};
const TEXT_DISPLAY = {
  title: els.displayTitle, artist: els.displayArtist, album: els.displayAlbum,
};

function renderText(field) {
  const value = state[field];
  const el = TEXT_DISPLAY[field];
  el.textContent = value || PLACEHOLDER[field];
  el.classList.toggle('is-placeholder', !value);
}

function setText(field, value) {
  state[field] = value;
  TEXT_INPUTS[field].value = value;
  renderText(field);
  validate();
}

function beginInlineEdit(el) {
  if (el.querySelector('input')) return;
  const field = el.dataset.field;
  const input = document.createElement('input');
  input.className = 'inline-input';
  input.value = state[field];
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) setText(field, input.value.trim());
    else renderText(field);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', () => finish(true));
}

$$('.meta .inline').forEach((el) => {
  el.addEventListener('click', (e) => { e.stopPropagation(); beginInlineEdit(el); });
});

['title', 'artist', 'album'].forEach((field) => {
  TEXT_INPUTS[field].addEventListener('input', () => {
    state[field] = TEXT_INPUTS[field].value.trim();
    renderText(field);
    const wrapper = TEXT_INPUTS[field].closest('.field');
    if (wrapper) wrapper.classList.remove('invalid');
    validate();
  });
});

/* =========================================================
   validation
   ========================================================= */
function missingFields() {
  const missing = [];
  if (!state.title) missing.push({ label: '歌曲名称', node: els.fieldTitle });
  if (!state.artist) missing.push({ label: '歌手', node: els.fieldArtist });
  if (!state.audioUrl) missing.push({ label: '音乐', node: els.audioBtn });
  return missing;
}

function validate() {
  const missing = missingFields();
  const ready = missing.length === 0;
  els.startBtn.dataset.ready = String(ready);
  if (ready) {
    els.reqList.textContent = '都齐了，进入录制画面吧';
    els.reqList.dataset.kind = 'ready';
  } else {
    els.reqList.textContent = `还差：${missing.map((m) => m.label).join('、')}`;
    delete els.reqList.dataset.kind;
  }
  return ready;
}

/* =========================================================
   file intake (click + drag & drop)
   ========================================================= */
const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(f.name);

function pickCover(f) {
  els.coverBtn.classList.remove('error');
  if (!isImage(f)) {
    els.coverBtn.classList.add('error');
    toast('封面需要图片文件，比如 png / jpg / webp');
    return;
  }
  const url = URL.createObjectURL(f);
  const probe = new Image();
  probe.onload = () => {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = url;
    els.coverPreview.src = url;
    els.coverPreview.hidden = false;
    els.coverBtn.classList.add('has-image', 'done');
    els.coverPh.style.display = 'none';
    els.coverImg.src = url;
    els.coverImg.hidden = false;
    els.coverBox.classList.add('has-image');
    applyPalette(extractPalette(probe) || FALLBACK_PALETTE);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    els.coverBtn.classList.add('error');
    toast('这张封面无法解码，换一张试试');
  };
  probe.src = url;
}

function pickAudio(f) {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(f);
  els.audio.src = state.audioUrl;
  els.audio.load();
  els.audioLabel.textContent = f.name;
  els.audioBtn.classList.add('done');
  els.audioBtn.classList.remove('error', 'invalid');
  els.audioHint.textContent = '已选择音频';
  els.audio.removeEventListener('loadedmetadata', onAudioMeta);
  els.audio.addEventListener('loadedmetadata', onAudioMeta, { once: true });
  els.audio.removeEventListener('error', onAudioFail);
  els.audio.addEventListener('error', onAudioFail, { once: true });
  validate();
}

function onAudioMeta() {
  const d = els.audio.duration;
  if (!d || !isFinite(d)) return;
  const m = Math.floor(d / 60), s = Math.round(d % 60);
  els.audioHint.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function onAudioFail() {
  els.audioBtn.classList.remove('done');
  els.audioBtn.classList.add('error');
  els.audioHint.textContent = '无法解码，换个文件';
}

function pickLrc(f) {
  decodeLyrics(f)
    .then((text) => {
      const { meta, lrc } = parseLrc(text);
      state.lrc = lrc;
      els.lrcLabel.textContent = f.name;
      if (meta.ti && !state.title) setText('title', meta.ti);
      if (meta.ar && !state.artist) setText('artist', meta.ar);
      if (meta.al && !state.album) setText('album', meta.al);
      renderLyrics();
      if (lrc.length) {
        els.lrcBtn.classList.add('done');
        els.lrcBtn.classList.remove('error');
        els.lrcHint.textContent = `已解析 ${lrc.length} 行`;
      } else {
        els.lrcBtn.classList.remove('done');
        els.lrcBtn.classList.add('error');
        els.lrcHint.textContent = '未找到 [mm:ss] 时间轴，不会滚词';
        toast('歌词没有时间轴，播放时不滚词，但不影响播放');
      }
    })
    .catch(() => {
      state.lrc = [];
      renderLyrics();
      els.lrcBtn.classList.remove('done');
      els.lrcBtn.classList.add('error');
      els.lrcHint.textContent = '读取失败，但不影响播放';
    });
}

function bindDropzone(btn, input, handler) {
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (f) handler(f);
    input.value = '';
  });
  ['dragover', 'dragenter'].forEach((evt) => btn.addEventListener(evt, (e) => {
    e.preventDefault(); btn.classList.add('is-over');
  }));
  btn.addEventListener('dragleave', (e) => {
    if (btn.contains(e.relatedTarget)) return;
    btn.classList.remove('is-over');
  });
  btn.addEventListener('drop', (e) => {
    e.preventDefault();
    btn.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handler(f);
  });
}

bindDropzone(els.coverBtn, els.fileCover, pickCover);
bindDropzone(els.audioBtn, els.fileAudio, pickAudio);
bindDropzone(els.lrcBtn, els.fileLrc, pickLrc);

// clicking the placeholders inside the player reuses the same file inputs
els.coverBox.addEventListener('click', (e) => { e.stopPropagation(); els.fileCover.click(); });
els.lyricsPh.addEventListener('click', (e) => { e.stopPropagation(); els.fileLrc.click(); });

['dragover', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    if (!e.target.closest('[data-drop]')) e.preventDefault();
  });
});

/* =========================================================
   orientation, glow, fullscreen
   ========================================================= */
function setOrientation(mode) {
  state.orientation = mode;
  els.stage.classList.toggle('stage--landscape', mode === 'landscape');
  els.stage.classList.toggle('stage--portrait', mode === 'portrait');
  els.hudOrient.textContent = mode === 'landscape' ? '横屏 16:9' : '竖屏 9:16';
  $$('.seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.orient === mode));
  adjustLandscapeLayout();
  requestAnimationFrame(() => centerOn(curIdx));
}

els.orientSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg__btn');
  if (btn) setOrientation(btn.dataset.orient);
});

els.glowRange.addEventListener('input', () => {
  const v = Number(els.glowRange.value);
  els.glowOut.textContent = v;
  document.documentElement.style.setProperty('--glow', (v / 100).toFixed(2));
});
document.documentElement.style.setProperty('--glow', (Number(els.glowRange.value) / 100).toFixed(2));

function toggleFullscreen() {
  const el = els.playerView;
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
  }
}

/* HUD hides itself while recording; any mouse movement brings it back */
let hudTimer = 0;
function showHud() {
  els.hud.classList.remove('hide');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    els.hud.classList.add('hide');
    hudTimer = 0;
    // playback waits until the hint is gone, so it never shows in a recording
    if (pendingAutoplay && !userControlled) {
      pendingAutoplay = false;
      if (els.audio.src) startPlayback();
    }
  }, 2400);
}
els.playerView.addEventListener('mousemove', showHud);

/* =========================================================
   view switching + player interactions
   ========================================================= */
function switchView(name) {
  const toPlayer = name === 'player';
  els.setupView.classList.toggle('active', !toPlayer);
  els.playerView.classList.toggle('active', toPlayer);
  els.body.dataset.view = name;
  if (toPlayer) {
    pendingAutoplay = true;
    userControlled = false;
    els.playerView.focus({ preventScroll: true });
    showHud();
    renderLyrics();
    updateLyric(els.audio.currentTime);
    requestAnimationFrame(() => centerOn(curIdx));
  } else {
    pendingAutoplay = false;
    clearTimeout(hudTimer);
    hudTimer = 0;
    els.hud.classList.remove('hide');
    if (!els.audio.paused) els.audio.pause();
    els.setupView.scrollTop = 0;
  }
}

els.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const missing = missingFields();
  if (missing.length) {
    missing.forEach((m) => m.node.classList.add('invalid'));
    toast(`还差：${missing.map((m) => m.label).join('、')}`);
    setTimeout(() => missing.forEach((m) => m.node.classList.remove('invalid')), 2200);
    return;
  }
  ['title', 'artist', 'album'].forEach((f) => renderText(f));
  switchView('player'); // autoplay is kicked off by showHud() once the HUD hides
});

els.playerView.addEventListener('click', (e) => {
  if (e.target.closest('.hud, .inline, .cover, .lyrics')) return;
  togglePlay();
});

$$('.hud button').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const action = btn.dataset.hud;
    if (action === 'edit') switchView('setup');
    else if (action === 'orient') setOrientation(state.orientation === 'landscape' ? 'portrait' : 'landscape');
    else if (action === 'fullscreen') toggleFullscreen();
  });
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT') return;
  if (!els.playerView.classList.contains('active')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (document.fullscreenElement) return; // let the browser exit fullscreen first
    switchView('setup');
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    resetPlayback();
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  }
});

window.addEventListener('beforeunload', () => {
  if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
});

/* init */
applyPalette(null);
['title', 'artist', 'album'].forEach((f) => renderText(f));
validate();
