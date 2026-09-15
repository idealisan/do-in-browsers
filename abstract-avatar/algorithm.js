(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbstractAvatar = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_OPTS = {
    bitsPerChannel: 5,
    maxColors: 8,
    minDist: 40
  };

  function buildHistogram(rgba, bpc) {
    var size = 1 << bpc;
    var step = 8 - bpc;
    var hist = new Uint32Array(size * size * size);
    var shiftR = bpc * 2;
    var shiftG = bpc;
    for (var i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      var r = rgba[i] >> step;
      var g = rgba[i + 1] >> step;
      var b = rgba[i + 2] >> step;
      var idx = (r << shiftR) | (g << shiftG) | b;
      hist[idx]++;
    }
    return hist;
  }

  function findPeaks(hist, bpc, maxColors, minDist) {
    var size = 1 << bpc;
    var step = 8 - bpc;
    var shiftR = bpc * 2;
    var shiftG = bpc;
    var half = 1 << (step - 1);
    var candidates = [];

    for (var r = 0; r < size; r++) {
      for (var g = 0; g < size; g++) {
        for (var b = 0; b < size; b++) {
          var idx = (r << shiftR) | (g << shiftG) | b;
          var count = hist[idx];
          if (count === 0) continue;
          var isMax = true;
          outer:
          for (var dr = -1; dr <= 1; dr++) {
            var nr = r + dr;
            if (nr < 0 || nr >= size) continue;
            for (var dg = -1; dg <= 1; dg++) {
              var ng = g + dg;
              if (ng < 0 || ng >= size) continue;
              for (var db = -1; db <= 1; db++) {
                if (dr === 0 && dg === 0 && db === 0) continue;
                var nb = b + db;
                if (nb < 0 || nb >= size) continue;
                var nidx = (nr << shiftR) | (ng << shiftG) | nb;
                if (hist[nidx] > count) {
                  isMax = false;
                  break outer;
                }
              }
            }
          }
          if (isMax) {
            candidates.push({
              count: count,
              color: [(r << step) + half, (g << step) + half, (b << step) + half]
            });
          }
        }
      }
    }

    candidates.sort(function (a, b) { return b.count - a.count; });

    var peaks = [];
    for (var i = 0; i < candidates.length; i++) {
      if (peaks.length >= maxColors) break;
      var c = candidates[i].color;
      var ok = true;
      for (var j = 0; j < peaks.length; j++) {
        var p = peaks[j].color;
        var drr = c[0] - p[0], dgg = c[1] - p[1], dbb = c[2] - p[2];
        if (drr * drr + dgg * dgg + dbb * dbb < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (ok) peaks.push(candidates[i]);
    }
    return peaks;
  }

  function recolor(rgba, peaks) {
    var out = new Uint8ClampedArray(rgba);
    if (peaks.length === 0) return out;
    for (var i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      var r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      var best = 0;
      var bestDist = Infinity;
      for (var k = 0; k < peaks.length; k++) {
        var c = peaks[k].color;
        var dr = r - c[0], dg = g - c[1], db = b - c[2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      }
      out[i] = peaks[best].color[0];
      out[i + 1] = peaks[best].color[1];
      out[i + 2] = peaks[best].color[2];
    }
    return out;
  }

  function quantize(rgba, opts) {
    opts = opts || {};
    var bpc = opts.bitsPerChannel || DEFAULT_OPTS.bitsPerChannel;
    var maxColors = opts.maxColors || DEFAULT_OPTS.maxColors;
    var minDist = (opts.minDist === 0) ? 0 : (opts.minDist || DEFAULT_OPTS.minDist);
    var hist = buildHistogram(rgba, bpc);
    var peaks = findPeaks(hist, bpc, maxColors, minDist);
    var data = recolor(rgba, peaks);
    return { data: data, peaks: peaks };
  }

  return {
    buildHistogram: buildHistogram,
    findPeaks: findPeaks,
    recolor: recolor,
    quantize: quantize,
    DEFAULT_OPTS: DEFAULT_OPTS
  };
});