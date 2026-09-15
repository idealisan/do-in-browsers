'use strict';
const assert = require('assert');
const { quantize, findPeaks, buildHistogram } = require('../algorithm.js');

function makeImage(width, height, regions) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let color = null;
      let alpha = 255;
      for (const r of regions) {
        if (x >= r.pos.x && x < r.pos.x + r.pos.w && y >= r.pos.y && y < r.pos.y + r.pos.h) {
          color = r.color;
          break;
        }
      }
      if (!color) { alpha = 0; }
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = color ? color[c] : 0;
      }
      rgba[i + 3] = alpha;
    }
  }
  return { rgba, width, height };
}

function addNoise(rgba, amount, strength) {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (Math.random() < amount) {
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.max(0, Math.min(255, rgba[i + c] + (Math.random() * 2 - 1) * strength));
      }
    }
  }
}

function nearestColor(color, palette) {
  let best = null;
  let bestD = Infinity;
  for (const p of palette) {
    const d = (color[0] - p[0]) ** 2 + (color[1] - p[1]) ** 2 + (color[2] - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return { color: best, dist: Math.sqrt(bestD) };
}

{
  const base = [
    { pos: { x: 0, y: 0, w: 60, h: 60 }, color: [200, 30, 40] },
    { pos: { x: 60, y: 0, w: 40, h: 60 }, color: [20, 180, 170] },
    { pos: { x: 0, y: 60, w: 100, h: 40 }, color: [240, 150, 20] }
  ];
  const { rgba, width, height } = makeImage(100, 100, base);
  addNoise(rgba, 0.2, 16);

  const { data, peaks } = quantize(rgba, { maxColors: 8, minDist: 50 });

  assert.ok(peaks.length >= 3, 'should find at least 3 peaks, got ' + peaks.length);
  for (const b of base) {
    const near = nearestColor(b.color, peaks.map(p => p.color));
    assert.ok(near.dist <= 8, `peak for ${b.color} far: ${near.dist} -> ${near.color}`);
  }

  const outputColors = new Set();
  let transparentKept = 0, transparentTotal = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      transparentTotal++;
      continue;
    }
    outputColors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    const p = nearestColor([data[i], data[i + 1], data[i + 2]], peaks.map(x => x.color)).color;
    assert.strictEqual(data[i], p[0]);
    assert.strictEqual(data[i + 1], p[1]);
    assert.strictEqual(data[i + 2], p[2]);
  }
  assert.ok(outputColors.size <= peaks.length, 'output has more colors than peaks');
  console.log('test1 OK: peaks =', peaks.map(p => p.color.join(',')).join(' | '), `(output colors: ${outputColors.size})`);
}

{
  const { rgba, width, height } = makeImage(50, 50, []);
  const { data, peaks } = quantize(rgba, { maxColors: 4 });
  assert.strictEqual(peaks.length, 0);
  for (let i = 3; i < data.length; i += 4) assert.strictEqual(data[i], 0);
  console.log('test2 OK: empty/transparent image left untouched');
}

{
  const { rgba, width, height } = makeImage(64, 64, [
    { pos: { x: 0, y: 0, w: 32, h: 64 }, color: [10, 10, 10] },
    { pos: { x: 32, y: 0, w: 32, h: 64 }, color: [245, 245, 245] }
  ]);
  const hist = buildHistogram(rgba, 5);
  const peaks = findPeaks(hist, 5, 8, 40);
  const dark = nearestColor([10, 10, 10], peaks.map(p => p.color));
  const light = nearestColor([245, 245, 245], peaks.map(p => p.color));
  assert.ok(dark.dist <= 4 && light.dist <= 4, 'polar colors both found');
  console.log('test3 OK: contrast image peaks', peaks.map(p => p.color.join(',')).join(' | '));
}

console.log('ALL TESTS PASSED');