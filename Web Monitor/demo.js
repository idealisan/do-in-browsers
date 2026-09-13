(() => {
  'use strict';

  function frame() {
    const { ctx, width, height } = Monitor;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) * 0.32;

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    const now = Date.now();
    const sweep = ((now / 1000) % 8) / 8;

    ctx.lineWidth = Math.max(3, Math.min(width, height) * 0.012);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2ee6a8';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(46,230,168,.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.22, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
    ctx.stroke();

    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${'周' + '日一二三四五六'[d.getDay()]}`;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.min(width, height) * 0.14}px system-ui, sans-serif`;
    ctx.fillText(time, cx, cy);

    ctx.fillStyle = '#8b95a7';
    ctx.font = `400 ${Math.min(width, height) * 0.038}px system-ui, sans-serif`;
    ctx.fillText(date, cx, cy + r * 0.62);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();