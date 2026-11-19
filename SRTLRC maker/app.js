'use strict';

const $ = (s) => document.querySelector(s);
const STORE_KEY = 'srtlrc-maker-config-v1';

const els = {
  provider: $('#provider'),
  apiKey: $('#apiKey'),
  toggleKey: $('#toggleKey'),
  accountRow: $('#accountRow'),
  accountId: $('#accountId'),
  modelRow: $('#modelRow'),
  model: $('#model'),
  modelHint: $('#modelHint'),
  refreshModels: $('#refreshModels'),
  endpoint: $('#endpoint'),
  resetEndpoint: $('#resetEndpoint'),
  remember: $('#remember'),
  rememberWarn: $('#rememberWarn'),
  cfNote: $('#cfNote'),

  fileDrop: $('#fileDrop'),
  fileInput: $('#fileInput'),
  fileStatus: $('#fileStatus'),
  fileCard: $('#fileCard'),
  fileIcon: $('#fileIcon'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  clearFile: $('#clearFile'),
  wantSrt: $('#wantSrt'),
  wantLrc: $('#wantLrc'),
  generateBtn: $('#generateBtn'),
  workStatus: $('#workStatus'),

  results: $('#results'),
  resultMeta: $('#resultMeta'),
  resultText: $('#resultText'),
  downloadSrt: $('#downloadSrt'),
  downloadLrc: $('#downloadLrc'),
  copyBtn: $('#copyBtn'),
  copyHint: $('#copyHint'),
  toast: $('#toast'),
};

const DEFAULTS = {
  gemini: {
    model: 'gemini-3.5-flash-lite',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
  },
  cloudflare: {
    model: '@cf/openai/whisper',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/openai/whisper',
  },
};

const PROMPT = `Transcribe the speech in this audio into a subtitle file.

Output ONLY the SRT subtitle content, nothing else. No explanation, no markdown fences.
Rules:
- Use SRT cues: an index number, then a timecode line "HH:MM:SS,mmm --> HH:MM:SS,mmm", then the text, then a blank line.
- Timecodes must be precise and cover the whole audio in order, with no overlaps.
- Split into short natural phrases (one line of lyrics / one sentence per cue). Keep the original language.
- Preserve the exact words you hear. Do not translate or summarize.`;

const cfg = { provider: 'gemini', apiKey: '', accountId: '', model: DEFAULTS.gemini.model, endpoint: DEFAULTS.gemini.endpoint };
let pickedFile = null;
let outputs = { srt: '', lrc: '', raw: '' };
let currentTab = 'srt';
let busy = false;

/* =========================================================
   small helpers
   ========================================================= */
let toastTimer = 0;
function toast(msg, err = false, ms = 3600) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('err', err);
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 320);
  }, ms);
}
const pad = (n, w) => String(n).padStart(w, '0');
const fmtBytes = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

/* =========================================================
   config: defaults, persistence, UI sync
   ========================================================= */
function applyProviderDefaults(force = false) {
  readConfigFromUI();
  const d = DEFAULTS[cfg.provider];
  cfg.model = d.model;
  if (force || !els.endpoint.value || Object.values(DEFAULTS).some((x) => x.endpoint === els.endpoint.value)) {
    cfg.endpoint = d.endpoint;
  }
  setModelValue(cfg.model, cfg.model);
  els.endpoint.value = cfg.endpoint;
  els.accountRow.hidden = cfg.provider !== 'cloudflare';
  els.modelRow.hidden = cfg.provider !== 'gemini';
  els.cfNote.hidden = cfg.provider !== 'cloudflare';
  saveConfig();
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;
    Object.assign(cfg, saved);
    cfg.provider = DEFAULTS[cfg.provider] ? cfg.provider : 'gemini';
    els.provider.value = cfg.provider;
    els.apiKey.value = cfg.apiKey || '';
    els.accountId.value = cfg.accountId || '';
    els.model.value = cfg.model || DEFAULTS[cfg.provider].model;
    els.endpoint.value = cfg.endpoint || DEFAULTS[cfg.provider].endpoint;
    els.remember.checked = true;
    els.rememberWarn.hidden = false;
    els.accountRow.hidden = cfg.provider !== 'cloudflare';
    els.modelRow.hidden = cfg.provider !== 'gemini';
    els.cfNote.hidden = cfg.provider !== 'cloudflare';
    return true;
  } catch { return false; }
}

function readConfigFromUI() {
  cfg.provider = els.provider.value;
  cfg.apiKey = els.apiKey.value.trim();
  cfg.accountId = els.accountId.value.trim();
  cfg.model = els.model.value.trim();
  cfg.endpoint = els.endpoint.value.trim();
}

function saveConfig() {
  readConfigFromUI();
  try {
    if (els.remember.checked) localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage disabled */ }
}

['provider', 'apiKey', 'accountId', 'model', 'endpoint'].forEach((k) => {
  els[k].addEventListener('input', () => { readConfigFromUI(); saveConfig(); });
});
els.provider.addEventListener('change', () => {
  applyProviderDefaults(true);
  fetchModels();
});
els.resetEndpoint.addEventListener('click', () => {
  cfg.endpoint = DEFAULTS[cfg.provider].endpoint;
  els.endpoint.value = cfg.endpoint;
  saveConfig();
  toast('已恢复默认 API 地址');
});
els.remember.addEventListener('change', () => {
  els.rememberWarn.hidden = !els.remember.checked;
  saveConfig();
  toast(els.remember.checked ? '配置已保存到本机' : '已清除本机保存的配置');
});
els.toggleKey.addEventListener('click', () => {
  const show = els.apiKey.type === 'password';
  els.apiKey.type = show ? 'text' : 'password';
  els.toggleKey.textContent = show ? '隐藏' : '显示';
});
/* =========================================================
   model discovery — query the provider's own model list API
   so users never have to type a model id by hand
   ========================================================= */
let modelTimer = 0;
let modelFetchSeq = 0;

function setModelValue(id, label) {
  if (!id) return;
  let opt = [...els.model.options].find((o) => o.value === id);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label || id;
    els.model.appendChild(opt);
  }
  els.model.value = id;
}

function modelStatus(msg, err = false) {
  els.modelHint.textContent = msg;
  els.modelHint.classList.toggle('is-error', err);
}

function syncEndpointForModel() {
  if (cfg.provider === 'gemini') {
    if (/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^:]+:generateContent$/.test(cfg.endpoint)) {
      cfg.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`;
    }
  } else if (/^https:\/\/api\.cloudflare\.com\/.*\/ai\/run\/[^/]+$/.test(cfg.endpoint)) {
    cfg.endpoint = cfg.endpoint.replace(/\/ai\/run\/[^/]+$/, `/ai/run/${cfg.model}`);
  }
}

function modelListUrl() {
  if (cfg.provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/models';
  const base = cfg.endpoint || DEFAULTS.cloudflare.endpoint;
  const origin = (base.match(/^https?:\/\/[^/]+/) || ['https://api.cloudflare.com'])[0];
  if (/api\.cloudflare\.com/.test(origin)) {
    return `${origin}/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/models/search?search=whisper&per_page=100`;
  }
  return `${origin}/models`;
}

function parseGeminiModels(json) {
  const arr = Array.isArray(json.models) ? json.models : [];
  return arr
    .filter((m) => {
      const name = String(m.name || '');
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && /^models\/gemini-/.test(name)
        && !/(tts|image|embedding|live|transcribe|omni|robotics|decision|research|agent|computer-use)/i.test(name);
    })
    .map((m) => {
      const id = String(m.name).replace(/^models\//, '');
      return { id, label: `${m.displayName || id}  ·  ${id}` };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseCloudflareModels(json) {
  const arr = Array.isArray(json.result) ? json.result : [];
  const map = (m) => {
    const task = (m.task && m.task.name) || m.task || '';
    return {
      id: String(m.id || m.name || ''),
      label: `${m.name || m.id || ''}${task ? `  ·  ${task}` : ''}`,
      hay: `${m.id || ''} ${m.name || ''} ${task}`,
    };
  };
  const all = arr.map(map).filter((m) => m.id);
  const speech = all.filter((m) => /whisper|asr|speech|transcri/i.test(m.hay));
  const list = speech.length ? speech : all;
  return list.sort((a, b) => a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label }));
}

function populateModels(list) {
  els.model.innerHTML = '';
  for (const m of list) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    els.model.appendChild(o);
  }
  const preferred = cfg.provider === 'gemini'
    ? ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.6-flash'].find((id) => list.some((m) => m.id === id))
    : null;
  const chosen = cfg.model && list.some((m) => m.id === cfg.model) ? cfg.model : (preferred || list[0].id);
  setModelValue(chosen, chosen);
  cfg.model = chosen;
  syncEndpointForModel();
  els.endpoint.value = cfg.endpoint;
  saveConfig();
}

async function fetchModels() {
  clearTimeout(modelTimer);
  readConfigFromUI();
  if (!cfg.apiKey) { modelStatus('请先填写 API Key 以自动获取模型'); return; }
  if (cfg.provider === 'cloudflare' && !cfg.accountId) { modelStatus('请先填写 Account ID 以自动获取模型'); return; }

  const seq = ++modelFetchSeq;
  els.model.innerHTML = '<option value="">正在查询模型…</option>';
  modelStatus('正在查询可用模型…');
  try {
    const url = modelListUrl();
    const res = await fetch(url, {
      headers: cfg.provider === 'gemini'
        ? { 'x-goog-api-key': cfg.apiKey }
        : { 'X-API-Key': cfg.apiKey, 'X-Account-Id': cfg.accountId },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`接口 ${res.status}：${text.replace(/\s+/g, ' ').slice(0, 160)}`);
    if (seq !== modelFetchSeq) return;
    const list = cfg.provider === 'gemini' ? parseGeminiModels(JSON.parse(text)) : parseCloudflareModels(JSON.parse(text));
    if (!list.length) throw new Error('没有找到可用于生成的模型');
    populateModels(list);
    modelStatus(`已获取 ${list.length} 个可用模型`);
  } catch (err) {
    if (seq !== modelFetchSeq) return;
    const keep = cfg.model;
    els.model.innerHTML = '';
    setModelValue(keep, `${keep}（当前使用）`);
    modelStatus(`获取失败：${err.message}`, true);
  }
}

function scheduleFetchModels() {
  clearTimeout(modelTimer);
  modelTimer = setTimeout(fetchModels, 650);
}

els.refreshModels.addEventListener('click', fetchModels);
els.apiKey.addEventListener('input', scheduleFetchModels);
els.accountId.addEventListener('input', scheduleFetchModels);
els.model.addEventListener('change', () => {
  readConfigFromUI();
  syncEndpointForModel();
  els.endpoint.value = cfg.endpoint;
  saveConfig();
});

if (!loadConfig()) applyProviderDefaults();
if (cfg.apiKey) fetchModels();
else modelStatus('请先填写 API Key 以自动获取模型');

/* =========================================================
   file intake
   ========================================================= */
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const isVideoFile = (f) => /^video\//.test(f.type) || VIDEO_RE.test(f.name);

function pickFile(f) {
  if (!f) return;
  pickedFile = f;
  const video = isVideoFile(f);
  els.fileCard.hidden = false;
  els.fileIcon.textContent = video ? '▣' : '♪';
  els.fileName.textContent = f.name;
  els.fileMeta.textContent = `${video ? '视频' : '音频'} · ${fmtBytes(f.size)}`;
  els.fileStatus.textContent = video ? '视频文件：生成时会自动抽取音频流' : '音频文件：已就绪';
  els.fileDrop.classList.remove('is-over');
  els.results.hidden = true;
}

els.fileDrop.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => { pickFile(els.fileInput.files[0]); els.fileInput.value = ''; });
els.clearFile.addEventListener('click', () => {
  pickedFile = null;
  els.fileCard.hidden = true;
  els.fileStatus.textContent = '还没有选择文件';
});
['dragover', 'dragenter'].forEach((e) => els.fileDrop.addEventListener(e, (ev) => {
  ev.preventDefault(); els.fileDrop.classList.add('is-over');
}));
els.fileDrop.addEventListener('dragleave', (e) => {
  if (els.fileDrop.contains(e.relatedTarget)) return;
  els.fileDrop.classList.remove('is-over');
});
els.fileDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) pickFile(f);
});
['dragover', 'drop'].forEach((e) => window.addEventListener(e, (ev) => {
  if (!ev.target.closest('#fileDrop')) ev.preventDefault();
}));

/* =========================================================
   audio preparation: decode (also extracts video audio),
   resample to 16 kHz mono, encode as a small WAV
   ========================================================= */
function audioBufferToWav(ab) {
  const nch = ab.numberOfChannels;
  const len = ab.length;
  const rate = ab.sampleRate;
  const bytes = 44 + len * nch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, nch, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * nch * 2, true); view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, len * nch * 2, true);
  const chans = [];
  for (let c = 0; c < nch; c++) chans.push(ab.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

async function prepareAudio(file, setStatus) {
  setStatus('读取文件…');
  const buf = await file.arrayBuffer();
  setStatus(isVideoFile(file) ? '正在从视频中抽取音频流…' : '正在解码音频…');
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('当前浏览器不支持 Web Audio，无法解码文件');
  let ctx;
  let decoded;
  try {
    ctx = new AC();
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } catch (err) {
    throw new Error('浏览器无法解码这个文件。请尝试转成 MP3 / WAV 再上传（视频请确认含有音轨）。');
  } finally {
    if (ctx) ctx.close().catch(() => {});
  }
  if (!decoded || !decoded.duration) throw new Error('没有读到有效的音频数据');

  setStatus('统一为 16 kHz 单声道 WAV…');
  const mono = resampleMono(decoded, 16000);
  const buffer = {
    numberOfChannels: 1,
    length: mono.length,
    sampleRate: 16000,
    getChannelData: () => mono,
  };
  return { blob: audioBufferToWav(buffer), duration: decoded.duration };
}

/* Downmix to mono and resample with linear interpolation — no extra APIs,
   deterministic, and works in every browser that can decode the file. */
function resampleMono(ab, targetRate) {
  const srcRate = ab.sampleRate;
  const n = ab.numberOfChannels;
  let src = ab.getChannelData(0);
  if (n > 1) {
    src = new Float32Array(ab.length);
    for (let c = 0; c < n; c++) {
      const ch = ab.getChannelData(c);
      for (let i = 0; i < src.length; i++) src[i] += ch[i] / n;
    }
  }
  const outLen = Math.max(1, Math.floor(ab.duration * targetRate));
  const out = new Float32Array(outLen);
  const ratio = srcRate / targetRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = src[i0] || 0;
    const b = src[i0 + 1] || 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('音频转 Base64 失败'));
    r.readAsDataURL(blob);
  });
}

/* =========================================================
   API calls
   ========================================================= */
async function errorText(res) {
  let t = '';
  try { t = await res.text(); } catch { /* empty */ }
  return t.replace(/\s+/g, ' ').slice(0, 300);
}

async function callGemini(wavBlob) {
  const url = cfg.endpoint || DEFAULTS.gemini.endpoint;
  const data = await blobToBase64(wavBlob);
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: 'audio/wav', data } },
      { text: PROMPT },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify(body),
  });
  const text = await errorText(res);
  if (!res.ok) throw new Error(`Gemini API ${res.status}：${text}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Gemini 返回的不是 JSON：${text.slice(0, 160)}`); }
  const out = (json.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || '')
    .join('\n')
    .trim();
  if (!out) throw new Error(`Gemini 没有返回内容：${text.slice(0, 160)}`);
  return out;
}

function wordsToSrt(words) {
  if (!Array.isArray(words) || !words.length) return '';
  const groups = [];
  let cur = [];
  let groupStart = Number(words[0].start) || 0;
  for (const w of words) {
    const start = Number(w.start) || 0;
    if (cur.length && start - (Number(cur[cur.length - 1].end) || 0) > 0.85) {
      groups.push({ start: groupStart, end: Number(cur[cur.length - 1].end) || start, text: cur.map((x) => x.word).join(' ') });
      cur = [];
      groupStart = start;
    }
    cur.push(w);
  }
  if (cur.length) groups.push({ start: groupStart, end: Number(cur[cur.length - 1].end) || groupStart + 1, text: cur.map((x) => x.word).join(' ') });
  return groups.map((g, i) => `${i + 1}\n${fmtSrtTime(g.start)} --> ${fmtSrtTime(g.end)}\n${g.text}\n`).join('\n');
}

async function callCloudflare(wavBlob) {
  const account = cfg.accountId || '{ACCOUNT_ID}';
  const url = (cfg.endpoint || DEFAULTS.cloudflare.endpoint).replace('{ACCOUNT_ID}', encodeURIComponent(account));
  const direct = /api\.cloudflare\.com/.test(url);
  const headers = direct
    ? { 'Content-Type': 'audio/wav', Authorization: `Bearer ${cfg.apiKey}` }
    : { 'Content-Type': 'audio/wav', 'X-API-Key': cfg.apiKey, 'X-Account-Id': cfg.accountId, 'X-Model': cfg.model };
  const res = await fetch(url, { method: 'POST', headers, body: wavBlob });
  const text = await errorText(res);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`接口返回的不是 JSON：${text.slice(0, 200)}`); }
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map((e) => e.message).join('; ') || text.slice(0, 200);
    throw new Error(`Cloudflare API ${res.status}：${msg}`);
  }
  const r = json.result || {};
  return r.vtt || (Array.isArray(r.words) ? wordsToSrt(r.words) : r.text) || text;
}

/* =========================================================
   parsing + formatting
   ========================================================= */
function tsToSec(s) {
  s = String(s).trim().replace(',', '.');
  const p = s.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return Number(s) || 0;
}
function fmtSrtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms % 3600000 / 60000), 2)}:${pad(Math.floor(ms % 60000 / 1000), 2)},${pad(ms % 1000, 3)}`;
}
function fmtLrcTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  return `[${pad(Math.floor(cs / 6000), 2)}:${pad(Math.floor(cs % 6000 / 100), 2)}.${pad(cs % 100, 2)}]`;
}

function normalizeSeg(start, end, text) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const s = typeof start === 'number' ? start : tsToSec(start);
  let e = typeof end === 'number' ? end : tsToSec(end);
  if (!isFinite(s) || !isFinite(e) || e <= s) e = s + 3;
  return { start: s, end: e, text };
}

function parseTimedText(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (!text) return [];

  // JSON with structured segments
  try {
    const j = JSON.parse(text);
    if (j && Array.isArray(j.segments)) {
      const out = j.segments.map((x) => normalizeSeg(x.start, x.end, x.text || x.content || '')).filter(Boolean);
      if (out.length) return out;
    }
    if (j && typeof j.text === 'string' && j.text.trim() !== text) return parseTimedText(j.text);
  } catch { /* not JSON */ }

  // SRT / VTT blocks
  const stamp = /(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,3}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,3}:\d{2}[.,]\d{1,3})/;
  if (stamp.test(text)) {
    const out = [];
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const idx = lines.findIndex((l) => stamp.test(l));
      if (idx < 0) continue;
      const m = lines[idx].match(stamp);
      const body = lines.slice(idx + 1).join(' ').trim();
      const seg = normalizeSeg(m[1], m[2], body);
      if (seg) out.push(seg);
    }
    if (out.length) return out.sort((a, b) => a.start - b.start);
  }

  // LRC lines
  const lrc = /\[(\d{1,3}:\d{2}(?::\d{2})?[.,]\d{1,3})\](.*)/;
  if (lrc.test(text)) {
    const out = [];
    for (const line of text.split('\n')) {
      const m = line.match(lrc);
      if (!m) continue;
      const seg = normalizeSeg(m[1], null, m[2]);
      if (seg) out.push(seg);
    }
    for (let i = 0; i < out.length - 1; i++) if (out[i].end <= out[i].start) out[i].end = out[i + 1].start;
    if (out.length) {
      const last = out[out.length - 1];
      if (last.end <= last.start) last.end = last.start + 3;
      return out;
    }
  }
  return [];
}

function buildSrt(segs) {
  return segs.map((s, i) => `${i + 1}\n${fmtSrtTime(s.start)} --> ${fmtSrtTime(s.end)}\n${s.text}\n`).join('\n').trim() + '\n';
}
function buildLrc(segs) {
  return segs.map((s) => `${fmtLrcTime(s.start)}${s.text}`).join('\n') + '\n';
}

/* =========================================================
   results UI
   ========================================================= */
function showResults(segs, raw) {
  outputs = {
    srt: els.wantSrt.checked ? buildSrt(segs) : '',
    lrc: els.wantLrc.checked ? buildLrc(segs) : '',
    raw: String(raw || ''),
  };
  const available = Object.keys(outputs).filter((k) => outputs[k]);
  currentTab = available[0] || 'raw';
  els.results.hidden = false;
  els.resultMeta.textContent = `${segs.length} 条 · 可直接在框内修改后再下载`;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === currentTab));
  els.resultText.value = outputs[currentTab];
  els.downloadSrt.disabled = !outputs.srt;
  els.downloadLrc.disabled = !outputs.lrc;
}

function switchTab(tab) {
  outputs[currentTab] = els.resultText.value; // keep edits
  currentTab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  els.resultText.value = outputs[tab] || '（未生成该格式）';
}
function $$ (s) { return [...document.querySelectorAll(s)]; }
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
els.resultText.addEventListener('input', () => { outputs[currentTab] = els.resultText.value; });

function download(name, text) {
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function baseName() {
  return (pickedFile ? pickedFile.name.replace(/\.[^.]+$/, '') : 'subtitle').replace(/[\\/:*?"<>|]/g, '_');
}
els.downloadSrt.addEventListener('click', () => download(`${baseName()}.srt`, outputs.srt));
els.downloadLrc.addEventListener('click', () => download(`${baseName()}.lrc`, outputs.lrc));
els.copyBtn.addEventListener('click', async () => {
  outputs[currentTab] = els.resultText.value;
  try {
    await navigator.clipboard.writeText(outputs[currentTab]);
    els.copyHint.textContent = '已复制';
  } catch {
    els.resultText.select();
    els.copyHint.textContent = '已选中，请按 ⌘/Ctrl+C';
  }
  setTimeout(() => { els.copyHint.textContent = ''; }, 2200);
});

/* =========================================================
   generate
   ========================================================= */
els.generateBtn.addEventListener('click', async () => {
  if (busy) return;
  readConfigFromUI();
  if (!pickedFile) { toast('请先上传音频或视频文件', true); return; }
  if (!cfg.apiKey) { toast('请填写 API Key / Token', true); return; }
  if (cfg.provider === 'cloudflare' && !cfg.accountId) { toast('Cloudflare 需要填写 Account ID', true); return; }
  if (!cfg.endpoint) { toast('请填写 API 地址（可点“恢复默认”）', true); return; }

  busy = true;
  els.generateBtn.disabled = true;
  els.results.hidden = true;
  const status = (t) => { els.workStatus.textContent = t; };
  try {
    const { blob } = await prepareAudio(pickedFile, status);
    status(cfg.provider === 'gemini' ? '正在请求 Google AI Studio…' : '正在请求 Cloudflare Workers AI…');
    const raw = cfg.provider === 'gemini' ? await callGemini(blob) : await callCloudflare(blob);
    status('正在解析时间戳…');
    const segs = parseTimedText(raw);
    if (!segs.length) {
      outputs = { srt: '', lrc: '', raw };
      els.results.hidden = false;
      outputs.raw = raw;
      currentTab = 'raw';
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'raw'));
      els.resultText.value = raw;
      els.resultMeta.textContent = '未能识别时间戳，下面是原始返回';
      els.downloadSrt.disabled = true;
      els.downloadLrc.disabled = true;
      toast('没有解析到时间戳，请查看原始返回', true, 5000);
      return;
    }
    showResults(segs, raw);
    status(`完成：已生成 ${segs.length} 条带时间戳的内容`);
    toast(`生成完成，共 ${segs.length} 条`);
  } catch (err) {
    status('');
    toast(err.message || String(err), true, 6000);
  } finally {
    busy = false;
    els.generateBtn.disabled = false;
  }
});
