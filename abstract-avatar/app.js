(function () {
  'use strict';
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var inCanvas = document.getElementById('in');
  var outCanvas = document.getElementById('out');
  var downloadBtn = document.getElementById('download');
  var swatches = document.getElementById('swatches');
  var info = document.getElementById('info');

  var hasImage = false;
  var lastPeaks = [];

  function params() {
    return {
      maxColors: +document.getElementById('sColors').value,
      minDist: +document.getElementById('sDist').value,
      bitsPerChannel: 5
    };
  }

  ['sColors', 'sDist'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('input', function () {
      document.getElementById('v' + id.slice(1)).textContent = el.value;
      if (hasImage) process();
    });
  });

  function loadImage(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      hasImage = true;
      var maxW = 1000;
      var scale = Math.min(1, maxW / img.width);
      inCanvas.width = Math.round(img.width * scale);
      inCanvas.height = Math.round(img.height * scale);
      var ctx = inCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, inCanvas.width, inCanvas.height);
      URL.revokeObjectURL(url);
      process();
    };
    img.src = url;
  }

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) loadImage(fileInput.files[0]);
  });

  function process() {
    var ctx = inCanvas.getContext('2d');
    var imgData = ctx.getImageData(0, 0, inCanvas.width, inCanvas.height);

    var start = performance.now();
    var result = AbstractAvatar.quantize(imgData.data, params());
    var ms = Math.round(performance.now() - start);

    outCanvas.width = inCanvas.width;
    outCanvas.height = inCanvas.height;
    var octx = outCanvas.getContext('2d');
    var outData = octx.createImageData(inCanvas.width, inCanvas.height);
    outData.data.set(result.data);
    octx.putImageData(outData, 0, 0);

    lastPeaks = result.peaks;
    swatches.innerHTML = '';
    result.peaks.forEach(function (p) {
      var s = document.createElement('div');
      s.className = 'swatch';
      s.style.background = 'rgb(' + p.color.join(',') + ')';
      swatches.appendChild(s);
    });
    info.textContent = result.peaks.length + ' 个主色 · 处理 ' + ms + 'ms · ' +
      inCanvas.width + 'x' + inCanvas.height;
    downloadBtn.disabled = false;
  }

  downloadBtn.addEventListener('click', function () {
    var a = document.createElement('a');
    a.download = 'abstract-avatar.png';
    a.href = outCanvas.toDataURL('image/png');
    a.click();
  });
})();