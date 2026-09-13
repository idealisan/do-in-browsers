(() => {
  'use strict';

  /* ============ 屏幕常亮：Wake Lock 优先，视频兜底 ============ */

  const statusEl = document.getElementById('status');
  const promptEl = document.getElementById('tap-prompt');
  const toastEl = document.getElementById('toast');
  const VIDEO_SRC = 'awake.mp4';
  const SUPPORTED = 'wakeLock' in navigator;

  let wakeLock = null;
  let video = null;
  let requesting = false;
  let toastTimer = null;

  function setStatus(text, active) {
    statusEl.textContent = text;
    statusEl.classList.toggle('on', !!active);
  }

  function showPrompt() {
    promptEl.hidden = false;
  }

  function hidePrompt() {
    promptEl.hidden = true;
  }

  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.src = VIDEO_SRC;
    video.className = 'keeper';
    document.body.appendChild(video);
    return video;
  }

  function startVideo() {
    return ensureVideo().play().then(() => {
      hidePrompt();
      setStatus('屏幕常亮（Wake Lock 不可用，已用循环视频兜底）', true);
      return true;
    }).catch(() => {
      showPrompt();
      setStatus('浏览器要求先交互才能播放，请点击屏幕', false);
      return false;
    });
  }

  function stopVideo() {
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }

  async function acquire() {
    if (requesting) return;
    if (!SUPPORTED) {
      await startVideo();
      return;
    }
    requesting = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      stopVideo();
      hidePrompt();
      setStatus('屏幕常亮已启用（Wake Lock）', true);
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        if (document.visibilityState === 'visible') acquire();
      });
    } catch (err) {
      await startVideo();
    } finally {
      requesting = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      acquire();
    } else {
      stopVideo();
    }
  });

  document.addEventListener('pointerdown', acquire, { passive: true });
  document.addEventListener('keydown', acquire);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
  }

  /* ============ UI：启动器 / 显示模式 ============ */

  const launcher = document.getElementById('launcher');
  const screen = document.getElementById('screen');
  const input = document.getElementById('script-url');
  const btn = document.getElementById('load-btn');
  const errEl = document.getElementById('err');

  let active = false;

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function buildMonitor() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    screen.innerHTML = '';
    screen.appendChild(canvas);

    const resizers = [];
    const state = { width: 0, height: 0, dpr: 1 };

    function resize() {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = w;
      state.height = h;
      state.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizers.forEach(fn => { try { fn(); } catch (e) {} });
    }

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));

    window.Monitor = {
      get canvas() { return canvas; },
      get ctx() { return ctx; },
      get width() { return state.width; },
      get height() { return state.height; },
      get dpr() { return state.dpr; },
      onResize(fn) { if (typeof fn === 'function') resizers.push(fn); },
      exit() { exitToLauncher(); }
    };

    resize();
  }

  function destroyMonitor() {
    window.Monitor = null;
  }

  function enterDisplay() {
    launcher.hidden = true;
    screen.hidden = false;
    active = true;
    buildMonitor();
    acquire();
  }

  function exitToLauncher() {
    if (!active) return;
    active = false;
    clearTimeout(pressTimer);
    stopVideo();
    hidePrompt();
    destroyMonitor();
    screen.innerHTML = '';
    screen.hidden = true;
    launcher.hidden = false;
    input.focus();
  }

  function loadScript(url) {
    const s = document.createElement('script');
    s.src = url;
    s.onerror = () => showError('脚本加载失败：' + url);
    document.head.appendChild(s);
  }

  function start() {
    const url = input.value.trim();
    if (!url) {
      showError('请输入 JavaScript 文件地址');
      input.focus();
      return;
    }
    errEl.hidden = true;
    localStorage.setItem('webmonitor.script', url);
    enterDisplay();
    loadScript(url);
  }

  btn.addEventListener('click', start);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') start();
  });

  /* ============ 显示模式下的退出手势 ============ */

  let pressTimer = null;

  function startPress() {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(exitToLauncher, 1500);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
  }

  screen.addEventListener('pointerdown', () => { if (active) startPress(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    screen.addEventListener(ev, cancelPress));
  screen.addEventListener('dblclick', exitToLauncher);
  document.addEventListener('keydown', e => {
    if (active && e.key === 'Escape') exitToLauncher();
  });

  /* ============ 全局错误提示 ============ */

  window.addEventListener('error', e => {
    if (active && e.message) toast(e.message);
  });

  /* ============ 启动 ============ */

  const saved = localStorage.getItem('webmonitor.script');
  input.value = saved || 'demo.js';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .catch(() => {});
    });
  }

  acquire();
})();