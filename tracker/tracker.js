// ============================================================
// FocusTrace v3.2 — Tracker with Gaze Calibration
// ============================================================

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var vid = $('vid'), ov = $('ov'), octx = ov.getContext('2d');
  var gazeEl = $('gaze'), sandbox = $('sandbox');

  // ---- Landmarks ----
  var LE = { top: 159, bot: 145, inn: 133, out: 33 };
  var RE = { top: 386, bot: 374, inn: 362, out: 263 };
  var L_IRIS = 468, R_IRIS = 473;
  var NOSE = 1, FOREHEAD = 10, CHIN = 152, L_CHEEK = 234, R_CHEEK = 454;
  var L_EYE_IDX = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  var R_EYE_IDX = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
  var FACE_IDX = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

  // ---- Session State ----
  var sandboxReady = false, cameraReady = false;
  var tracking = false, frames = 0, focusFrames = 0, unfocusCount = 0;
  var tStart = 0, timerInt = null, frameLoopId = null;
  var scores = [], unfocusEvents = [], eyeClosedSince = 0, lastLogMs = 0;
  var BUF = 8, bGaze = [], bEyes = [], bHead = [], bIris = [];

  // ---- Calibration State ----
  var CAL_POINTS = [
    { x: 0.10, y: 0.10 }, { x: 0.50, y: 0.08 }, { x: 0.90, y: 0.10 },
    { x: 0.10, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.90, y: 0.50 },
    { x: 0.10, y: 0.90 }, { x: 0.50, y: 0.92 }, { x: 0.90, y: 0.90 }
  ];
  var SAMPLES_PER_POINT = 25;
  var calActive = false, calPointIdx = 0, calSamples = [], calCurrentSamples = [];
  var calCollecting = false, calDone = false, calMapping = null;
  var calAccuracy = 0, calData = null, latestFlat = null;

  // ============================================================
  // CALIBRATION ENGINE
  // ============================================================

  function startCalibration() {
    calActive = true; calPointIdx = 0; calSamples = []; calCurrentSamples = [];
    calCollecting = false; calDone = false; calMapping = null;
    $('calOv').classList.add('show');
    $('calDone').classList.remove('show');
    $('calCollecting').classList.remove('show');
    $('calDesc').textContent = 'Look at the dot and click it. Hold your gaze steady.';
    updateCalProgress(); showCalPoint();
  }

  function showCalPoint() {
    if (calPointIdx >= CAL_POINTS.length) { finishCalibration(); return; }
    var pt = CAL_POINTS[calPointIdx];
    var el = $('calPoint');
    el.style.left = (pt.x * 100) + '%';
    el.style.top = (pt.y * 100) + '%';
    el.classList.remove('locked');
    el.classList.add('show');
    $('calCollecting').classList.remove('show');
  }

  $('calPoint').addEventListener('click', function () {
    if (calCollecting) return;
    calCollecting = true; calCurrentSamples = [];
    $('calCollecting').classList.add('show');
    $('calDesc').textContent = 'Hold still \u2014 sampling gaze at point ' + (calPointIdx + 1) + '...';
  });

  function collectCalSample(flat, count) {
    if (!calCollecting || !flat) return;
    var nose = lmPt(flat, NOSE);
    var hasIris = count > 468;
    var iL = hasIris ? lmPt(flat, L_IRIS) : nose;
    var iR = hasIris ? lmPt(flat, R_IRIS) : nose;
    calCurrentSamples.push({ faceX: nose.x, faceY: nose.y, irisLX: iL.x, irisLY: iL.y, irisRX: iR.x, irisRY: iR.y });

    if (calCurrentSamples.length >= SAMPLES_PER_POINT) {
      var n = calCurrentSamples.length;
      var avg = { faceX: 0, faceY: 0, irisLX: 0, irisLY: 0, irisRX: 0, irisRY: 0 };
      for (var i = 0; i < n; i++) { var s = calCurrentSamples[i]; avg.faceX += s.faceX; avg.faceY += s.faceY; avg.irisLX += s.irisLX; avg.irisLY += s.irisLY; avg.irisRX += s.irisRX; avg.irisRY += s.irisRY; }
      for (var k in avg) avg[k] /= n;
      var pt = CAL_POINTS[calPointIdx];
      avg.screenX = pt.x; avg.screenY = pt.y;
      calSamples.push(avg);
      calCollecting = false;
      $('calPoint').classList.add('locked');
      calPointIdx++;
      updateCalProgress();
      setTimeout(showCalPoint, 400);
    }
  }

  function updateCalProgress() {
    $('calProgress').textContent = calPointIdx + ' / ' + CAL_POINTS.length;
    $('calFill').style.width = (calPointIdx / CAL_POINTS.length * 100) + '%';
  }

  function finishCalibration() {
    $('calPoint').classList.remove('show');
    $('calCollecting').classList.remove('show');
    calMapping = computeMapping(calSamples);
    calAccuracy = computeAccuracy(calSamples, calMapping);
    calDone = true;
    calData = { points: calSamples.length, accuracy: calAccuracy, mapping: calMapping, timestamp: Date.now() };
    $('calDone').classList.add('show');
    $('calDoneDesc').textContent = 'Accuracy: ' + calAccuracy + '% \u2014 ' +
      (calAccuracy >= 80 ? 'Excellent!' : calAccuracy >= 60 ? 'Good \u2014 usable.' : 'Fair \u2014 try again in better lighting.');
    updateCalBadge();
    logEv('\u25CE', 'Calibration done \u2014 ' + calAccuracy + '% accuracy');
  }

  function computeMapping(samples) {
    var n = samples.length;
    if (n < 3) return null;
    var X = [], Yx = [], Yy = [];
    for (var i = 0; i < n; i++) {
      var s = samples[i];
      var imx = (s.irisLX + s.irisRX) / 2, imy = (s.irisLY + s.irisRY) / 2;
      X.push([1, s.faceX, s.faceY, imx, imy]);
      Yx.push(s.screenX); Yy.push(s.screenY);
    }
    var cx = leastSquares(X, Yx), cy = leastSquares(X, Yy);
    if (!cx || !cy) return null;
    return { cx: cx, cy: cy };
  }

  function leastSquares(X, Y) {
    var n = X.length, p = X[0].length;
    var XtX = [], XtY = [];
    for (var i = 0; i < p; i++) { XtX.push([]); var sy = 0; for (var j = 0; j < p; j++) { var sij = 0; for (var k = 0; k < n; k++) sij += X[k][i] * X[k][j]; XtX[i].push(sij); } for (var k2 = 0; k2 < n; k2++) sy += X[k2][i] * Y[k2]; XtY.push(sy); }
    return gaussSolve(XtX, XtY);
  }

  function gaussSolve(A, b) {
    var n = b.length, M = [];
    for (var i = 0; i < n; i++) { M.push(A[i].slice()); M[i].push(b[i]); }
    for (var col = 0; col < n; col++) {
      var mr = col, mv = Math.abs(M[col][col]);
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > mv) { mv = Math.abs(M[r][col]); mr = r; }
      if (mv < 1e-10) return null;
      var tmp = M[col]; M[col] = M[mr]; M[mr] = tmp;
      for (var r2 = col + 1; r2 < n; r2++) { var f = M[r2][col] / M[col][col]; for (var j = col; j <= n; j++) M[r2][j] -= f * M[col][j]; }
    }
    var x = new Array(n);
    for (var i2 = n - 1; i2 >= 0; i2--) { x[i2] = M[i2][n]; for (var j2 = i2 + 1; j2 < n; j2++) x[i2] -= M[i2][j2] * x[j2]; x[i2] /= M[i2][i2]; }
    return x;
  }

  function computeAccuracy(samples, mapping) {
    if (!mapping) return 0;
    var totalErr = 0;
    for (var i = 0; i < samples.length; i++) {
      var p = applyMapping(samples[i], mapping);
      totalErr += Math.sqrt(Math.pow(p.x - samples[i].screenX, 2) + Math.pow(p.y - samples[i].screenY, 2));
    }
    return Math.round(Math.max(0, Math.min(100, (1 - (totalErr / samples.length) / 0.20) * 100)));
  }

  function applyMapping(sample, mapping) {
    var imx = (sample.irisLX + sample.irisRX) / 2, imy = (sample.irisLY + sample.irisRY) / 2;
    var feat = [1, sample.faceX, sample.faceY, imx, imy];
    var px = 0, py = 0;
    for (var i = 0; i < feat.length; i++) { px += mapping.cx[i] * feat[i]; py += mapping.cy[i] * feat[i]; }
    return { x: px, y: py };
  }

  function getCalibratedGaze(flat, count) {
    if (!calMapping) return null;
    var nose = lmPt(flat, NOSE);
    var hasIris = count > 468;
    var iL = hasIris ? lmPt(flat, L_IRIS) : nose;
    var iR = hasIris ? lmPt(flat, R_IRIS) : nose;
    return applyMapping({ faceX: nose.x, faceY: nose.y, irisLX: iL.x, irisLY: iL.y, irisRX: iR.x, irisRY: iR.y }, calMapping);
  }

  function updateCalBadge() {
    var b = $('calBadge'); b.style.display = '';
    if (calDone) { b.className = 'cal-badge ' + (calAccuracy >= 75 ? 'good' : calAccuracy >= 50 ? 'ok' : 'poor'); $('calBadgeText').textContent = 'Cal: ' + calAccuracy + '%'; }
    else { b.className = 'cal-badge'; $('calBadgeText').textContent = 'Not calibrated'; }
  }

  $('btnCalibrate').addEventListener('click', startCalibration);
  $('btnRecal').addEventListener('click', function () { $('calDone').classList.remove('show'); startCalibration(); });
  $('btnCalDone').addEventListener('click', function () { $('calOv').classList.remove('show'); calActive = false; });

  // ============================================================
  // HELPERS
  // ============================================================
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function dist2d(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }
  function smooth(buf, val) { buf.push(val); if (buf.length > BUF) buf.shift(); return Math.round(buf.reduce(function (a, b) { return a + b; }, 0) / buf.length); }
  function fmtT(sec) { return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function fmtClock(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function lmPt(flat, i) { return { x: flat[i * 3], y: flat[i * 3 + 1] }; }

  // ============================================================
  // CAMERA
  // ============================================================
  async function initCamera() {
    $('camLbl').textContent = 'Requesting camera...';
    logEv('\u23F3', 'Requesting camera...');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      vid.srcObject = stream; await vid.play();
      cameraReady = true; $('camDot').classList.add('on'); $('camLbl').textContent = 'Camera active';
      logEv('\uD83D\uDCF7', 'Camera ready'); checkFullReady();
    } catch (err) {
      $('initMsg').textContent = '\u26a0\ufe0f ' + err.message;
      $('camLbl').textContent = 'Failed: ' + err.message;
      logEv('\u274C', 'Camera: ' + err.message);
    }
  }

  // ============================================================
  // SANDBOX
  // ============================================================
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'ready') { sandboxReady = true; logEv('\uD83E\uDDE0', 'FaceMesh loaded'); checkFullReady(); }
    else if (e.data.type === 'error') { $('initMsg').textContent = '\u26a0\ufe0f ' + e.data.message; }
    else if (e.data.type === 'landmarks') { handleLandmarks(new Float32Array(e.data.data), e.data.count); }
  });

  function checkFullReady() {
    if (sandboxReady && cameraReady) {
      $('initOv').classList.add('hidden'); $('badge').className = 'badge off'; $('badge').textContent = 'READY';
      $('btnStart').disabled = false; $('btnCalibrate').style.display = ''; $('calBadge').style.display = '';
      updateCalBadge(); $('camLbl').textContent = 'Ready \u2014 calibrate for best accuracy';
      logEv('\u2705', 'Ready \u2014 calibrate then start');
    }
  }

  function startFrameLoop() {
    var interval = 1000 / 15, lastTime = 0;
    function loop(now) {
      frameLoopId = requestAnimationFrame(loop);
      if (now - lastTime < interval) return; lastTime = now;
      if (!sandboxReady || vid.readyState < 2) return;
      try { createImageBitmap(vid).then(function (bmp) { sandbox.contentWindow.postMessage({ type: 'frame', bitmap: bmp }, '*', [bmp]); }).catch(function () {}); } catch (e) {}
    }
    frameLoopId = requestAnimationFrame(loop);
  }

  // ============================================================
  // LANDMARK HANDLER
  // ============================================================
  function handleLandmarks(flat, count) {
    latestFlat = flat;
    drawOverlay(flat, count);
    if (calActive && calCollecting) { collectCalSample(flat, count); return; }
    if (!tracking) return;
    frames++; $('mFrames').textContent = frames;
    var a = analyzeFrame(flat, count);
    var sc = computeScore(a);
    if (sc.s >= 50) focusFrames++;
    checkUnfocus(a, sc);
    if (frames % 3 === 0) scores.push({ ts: Date.now(), s: sc.s, g: sc.g, e: sc.e, h: sc.h, i: sc.i });
    updateUI(sc, a);
    if (frames % 15 === 0) {
      try { chrome.runtime.sendMessage({ type: 'SAVE', key: 'live', data: { score: sc.s, time: fmtT(Math.floor((Date.now() - tStart) / 1000)), readings: frames, triggers: unfocusCount, gazeScore: sc.g, eyeScore: sc.e, headScore: sc.h } }); } catch (e) {}
    }
  }

  function analyzeFrame(flat, count) {
    var hasIris = count > 468;
    var earL = computeEAR(flat, LE), earR = computeEAR(flat, RE), earAvg = (earL + earR) / 2;
    var closed = earAvg < 0.16;
    var eyeScore = Math.round(clamp((earAvg - 0.12) / 0.25) * 100);
    var nose = lmPt(flat, NOSE), lC = lmPt(flat, L_CHEEK), rC = lmPt(flat, R_CHEEK);
    var fW = Math.abs(rC.x - lC.x) || 0.001, fH = Math.abs(lmPt(flat, FOREHEAD).y - lmPt(flat, CHIN).y) || 0.001;
    var yaw = ((nose.x - (lC.x + rC.x) / 2) / fW) * 90;
    var pitch = ((nose.y - (lmPt(flat, FOREHEAD).y + lmPt(flat, CHIN).y) / 2) / fH) * 60;
    var away = Math.abs(yaw) > 22 || Math.abs(pitch) > 18;
    var headScore = Math.round(Math.max(0, 100 - (Math.abs(yaw) + Math.abs(pitch)) * 2));

    var gazeX, gazeY, dev;
    if (calMapping) { var cg = getCalibratedGaze(flat, count); gazeX = cg.x; gazeY = cg.y; dev = Math.sqrt(Math.pow(gazeX - 0.5, 2) + Math.pow(gazeY - 0.5, 2)); }
    else { gazeX = nose.x; gazeY = nose.y; dev = Math.sqrt(Math.pow(nose.x - 0.5, 2) + Math.pow(nose.y - 0.45, 2)); }
    var gazeScore = Math.round(Math.max(0, 100 - dev * 250));

    var irisScore = gazeScore;
    if (hasIris) {
      var lI = lmPt(flat, L_IRIS), rI = lmPt(flat, R_IRIS);
      var lRat = dist2d(lI.x, lI.y, lmPt(flat, LE.inn).x, lmPt(flat, LE.inn).y) / (dist2d(lmPt(flat, LE.inn).x, lmPt(flat, LE.inn).y, lmPt(flat, LE.out).x, lmPt(flat, LE.out).y) || 0.001);
      var rRat = dist2d(rI.x, rI.y, lmPt(flat, RE.inn).x, lmPt(flat, RE.inn).y) / (dist2d(lmPt(flat, RE.inn).x, lmPt(flat, RE.inn).y, lmPt(flat, RE.out).x, lmPt(flat, RE.out).y) || 0.001);
      irisScore = Math.round(Math.max(0, 100 - Math.abs(((lRat + rRat) / 2) - 0.5) * 300));
    }
    return { eyeScore: eyeScore, closed: closed, headScore: headScore, yaw: Math.round(yaw), pitch: Math.round(pitch), away: away, gazeScore: gazeScore, dev: dev, irisScore: irisScore, sx: gazeX, sy: gazeY };
  }

  function computeEAR(flat, eye) {
    var top = lmPt(flat, eye.top), bot = lmPt(flat, eye.bot), inn = lmPt(flat, eye.inn), out = lmPt(flat, eye.out);
    var h = dist2d(inn.x, inn.y, out.x, out.y);
    return h > 0 ? dist2d(top.x, top.y, bot.x, bot.y) / h : 0;
  }

  function computeScore(a) {
    var g = smooth(bGaze, a.gazeScore), e = smooth(bEyes, a.eyeScore), h = smooth(bHead, a.headScore), i = smooth(bIris, a.irisScore);
    return { s: Math.round(g * .30 + e * .25 + h * .25 + i * .20), g: g, e: e, h: h, i: i };
  }

  // ============================================================
  // UNFOCUS
  // ============================================================
  function checkUnfocus(a, sc) {
    var now = Date.now();
    if (a.closed) { if (!eyeClosedSince) eyeClosedSince = now; else if (now - eyeClosedSince > 2000) addUnfocus(now, 'eyes_closed', 'Eyes closed ' + ((now - eyeClosedSince) / 1000).toFixed(1) + 's'); } else eyeClosedSince = 0;
    if (a.away) addUnfocus(now, 'head_turn', 'Head turned (yaw:' + a.yaw + '\u00B0)');
    if (a.dev > 0.35) addUnfocus(now, 'gaze_away', 'Gaze deviation ' + (a.dev * 100).toFixed(0) + '%');
    if (sc.s < 25) addUnfocus(now, 'low_score', 'Score ' + sc.s + '%');
  }

  function addUnfocus(ts, type, detail) {
    if (unfocusEvents.some(function (e) { return e.type === type && ts - e.ts < 3000; })) return;
    unfocusEvents.push({ ts: ts, type: type, detail: detail }); unfocusCount++;
    $('mTrigs').textContent = unfocusCount;
    var icons = { eyes_closed: '\uD83D\uDE34', head_turn: '\u21A9\uFE0F', gaze_away: '\uD83D\uDC40', low_score: '\uD83D\uDCC9' };
    logEv(icons[type] || '\u26A0\uFE0F', detail);
  }

  // ============================================================
  // UI
  // ============================================================
  function updateUI(sc, a) {
    $('scoreBig').textContent = sc.s;
    $('scoreBig').className = 'score-big mono ' + (sc.s >= 70 ? 'hi' : sc.s >= 40 ? 'mi' : 'lo');
    $('scoreFill').style.width = sc.s + '%';
    $('scoreFill').style.background = sc.s >= 70 ? 'var(--gn)' : sc.s >= 40 ? 'var(--am)' : 'var(--rd)';
    setSig('sGaze', 'svGaze', sc.g); setSig('sEyes', 'svEyes', sc.e);
    setSig('sHead', 'svHead', sc.h); setSig('sIris', 'svIris', sc.i);
    if (calDone) setSig('sCal', 'svCal', calAccuracy);
    gazeEl.style.left = (a.sx * window.innerWidth) + 'px';
    gazeEl.style.top = (a.sy * window.innerHeight) + 'px';
  }

  function setSig(bId, vId, pct) { $(bId).style.width = Math.min(100, Math.max(0, pct)) + '%'; $(vId).textContent = pct; }

  function logEv(icon, text) {
    var now = Date.now(); if (now - lastLogMs < 800) return; lastLogMs = now;
    var t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var el = document.createElement('div'); el.className = 'log-item';
    el.innerHTML = '<span class="log-time mono">' + t + '</span><span class="log-ic">' + icon + '</span><span class="log-tx">' + text + '</span>';
    var log = $('log'); log.insertBefore(el, log.firstChild);
    while (log.children.length > 60) log.removeChild(log.lastChild);
  }

  // ============================================================
  // DRAWING
  // ============================================================
  function drawOverlay(flat, count) {
    ov.width = vid.videoWidth || 640; ov.height = vid.videoHeight || 480;
    octx.clearRect(0, 0, ov.width, ov.height);
    var w = ov.width, h = ov.height;
    octx.strokeStyle = 'rgba(99,102,241,0.4)'; octx.lineWidth = 1.5;
    drawContour(flat, L_EYE_IDX, w, h); drawContour(flat, R_EYE_IDX, w, h);
    if (count > 468) { octx.fillStyle = 'rgba(99,102,241,0.5)'; [L_IRIS, R_IRIS].forEach(function (idx) { var p = lmPt(flat, idx); octx.beginPath(); octx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2); octx.fill(); }); }
    octx.fillStyle = 'rgba(6,182,212,0.5)'; var n = lmPt(flat, NOSE); octx.beginPath(); octx.arc(n.x * w, n.y * h, 3, 0, Math.PI * 2); octx.fill();
    octx.strokeStyle = 'rgba(99,102,241,0.1)'; octx.lineWidth = 1; drawContour(flat, FACE_IDX, w, h);
  }
  function drawContour(flat, indices, w, h) { octx.beginPath(); for (var i = 0; i < indices.length; i++) { var p = lmPt(flat, indices[i]); if (i === 0) octx.moveTo(p.x * w, p.y * h); else octx.lineTo(p.x * w, p.y * h); } octx.closePath(); octx.stroke(); }

  // ============================================================
  // SESSION
  // ============================================================
  $('btnStart').addEventListener('click', function () {
    tracking = true; frames = 0; focusFrames = 0; unfocusCount = 0;
    scores = []; unfocusEvents = []; eyeClosedSince = 0;
    bGaze = []; bEyes = []; bHead = []; bIris = []; tStart = Date.now();
    $('btnStart').style.display = 'none'; $('btnStop').style.display = '';
    $('btnCalibrate').style.display = 'none';
    $('badge').className = 'badge live'; $('badge').textContent = '\u25CF TRACKING';
    gazeEl.classList.add('on'); $('log').innerHTML = '';
    logEv('\u2705', 'Session started' + (calDone ? ' (calibrated: ' + calAccuracy + '%)' : ' (uncalibrated)'));
    $('mTrigs').textContent = '0'; $('mFrames').textContent = '0';
    clearInterval(timerInt);
    timerInt = setInterval(function () { $('mTime').textContent = fmtT(Math.floor((Date.now() - tStart) / 1000)); }, 1000);
  });

  $('btnStop').addEventListener('click', function () {
    tracking = false; clearInterval(timerInt); gazeEl.classList.remove('on');
    $('btnStart').style.display = ''; $('btnStop').style.display = 'none'; $('btnCalibrate').style.display = '';
    $('badge').className = 'badge off'; $('badge').textContent = 'ENDED';
    logEv('\uD83C\uDFC1', 'Session ended');
    var results = genResults();
    try {
      chrome.runtime.sendMessage({ type: 'SAVE', key: 'session', data: { scores: scores, unfocusEvents: unfocusEvents, results: results, calibration: calData, startTime: tStart, endTime: Date.now() } });
      chrome.runtime.sendMessage({ type: 'SAVE', key: 'live', data: { ended: true } });
    } catch (e) {}
    showResults(results);
  });

  // ============================================================
  // INSIGHTS
  // ============================================================
  function genResults() {
    var dur = (Date.now() - tStart) / 1000, durMin = dur / 60;
    if (scores.length < 3) return { personality: { name: 'Unknown', emoji: '\u2753', desc: 'Too short' }, summary: { avgScore: 0, peakScore: 0, totalMin: Math.round(durMin), unfocusCount: unfocusCount, focusPct: 0, calibrated: calDone, calAccuracy: calAccuracy }, insights: [{ icon: '\uD83D\uDCCA', title: 'Too Short', text: 'Record 30+ seconds.' }] };
    var avg = Math.round(scores.reduce(function (s, e) { return s + e.s; }, 0) / scores.length);
    var peak = Math.max.apply(null, scores.map(function (s) { return s.s; }));
    var focusPct = frames > 0 ? Math.round(focusFrames / frames * 100) : 0;
    var ins = [];

    if (calDone) ins.push({ icon: '\u25CE', title: 'Calibrated Session', text: 'Personalized gaze calibration (' + calAccuracy + '%). ' + (calAccuracy >= 75 ? 'Highly precise tracking.' : calAccuracy >= 50 ? 'Reasonably accurate.' : 'Consider recalibrating.') });

    var mxS = 0, sS = 0, cS = 0, cSt = 0;
    for (var j = 0; j < scores.length; j++) { if (scores[j].s >= 60) { if (!cS) cSt = scores[j].ts; cS++; if (cS > mxS) { mxS = cS; sS = cSt; } } else cS = 0; }
    if (mxS > 0) ins.push({ icon: '\uD83C\uDFAF', title: 'Deep Focus', text: 'Longest streak: ~' + Math.max(1, Math.round(mxS * 1.2)) + 's at ' + fmtClock(sS) + '.' });

    var mxD = 0, dTs = 0;
    for (var k = 1; k < scores.length; k++) { var d = scores[k - 1].s - scores[k].s; if (d > mxD) { mxD = d; dTs = scores[k].ts; } }
    if (mxD > 15) { var near = unfocusEvents.filter(function (e) { return Math.abs(e.ts - dTs) < 3000; }); ins.push({ icon: '\uD83D\uDCC9', title: 'Focus Drop', text: 'At ' + fmtClock(dTs) + ', dropped ' + mxD + 'pts. ' + (near.length ? 'Cause: ' + near[0].type.replace('_', ' ') : '') }); }

    var eEv = unfocusEvents.filter(function (e) { return e.type === 'eyes_closed'; });
    if (eEv.length) ins.push({ icon: '\uD83D\uDE34', title: 'Eye Closures', text: eEv.length + 'x (2s+). ' + (eEv.length > 3 ? 'Fatigue likely.' : 'Normal.') });

    var aG = Math.round(scores.reduce(function (s, e) { return s + e.g; }, 0) / scores.length);
    var aE = Math.round(scores.reduce(function (s, e) { return s + e.e; }, 0) / scores.length);
    var aH = Math.round(scores.reduce(function (s, e) { return s + e.h; }, 0) / scores.length);
    var wl = [{ n: 'gaze', v: aG }, { n: 'eyes', v: aE }, { n: 'head', v: aH }].sort(function (a, b) { return a.v - b.v; });
    ins.push({ icon: '\uD83D\uDD0D', title: 'Weakest: ' + wl[0].n, text: 'Avg ' + wl[0].v + '% \u2014 your main area for improvement.' });

    var variance = scores.reduce(function (s, e) { return s + Math.pow(e.s - avg, 2); }, 0) / scores.length;
    var trend = scores[scores.length - 1].s - scores[0].s;
    var p;
    if (avg > 70 && variance < 150) p = { name: 'Laser Focus', emoji: '\uD83C\uDFAF', desc: 'Exceptional sustained attention' };
    else if (avg > 60 && variance > 200) p = { name: 'Wave Rider', emoji: '\uD83C\uDF0A', desc: 'Deep focus with brief dips' };
    else if (trend > 15) p = { name: 'Slow Burner', emoji: '\uD83D\uDD25', desc: 'Focus built over time' };
    else if (trend < -15) p = { name: 'Fast Starter', emoji: '\uD83D\uDE80', desc: 'Strong start that faded' };
    else if (avg < 40) p = { name: 'Scattered', emoji: '\uD83E\uDD8B', desc: 'Frequent attention shifts' };
    else p = { name: 'Steady State', emoji: '\u2696\uFE0F', desc: 'Consistent moderate focus' };
    return { personality: p, summary: { avgScore: avg, peakScore: peak, totalMin: Math.round(durMin * 10) / 10, unfocusCount: unfocusCount, focusPct: focusPct, calibrated: calDone, calAccuracy: calAccuracy }, insights: ins.slice(0, 6) };
  }

  // ============================================================
  // RESULTS UI
  // ============================================================
  function showResults(r) {
    $('resOv').classList.add('show');
    $('resPill').innerHTML = r.personality.emoji + ' ' + r.personality.name;
    $('resPdesc').textContent = r.personality.desc;
    var sm = r.summary;
    $('resStats').innerHTML = '<div class="rs"><div class="rs-v hi">' + sm.avgScore + '%</div><div class="rs-l">Avg Score</div></div><div class="rs"><div class="rs-v" style="color:var(--gn)">' + sm.peakScore + '%</div><div class="rs-l">Peak</div></div><div class="rs"><div class="rs-v">' + sm.focusPct + '%</div><div class="rs-l">Focused</div></div><div class="rs"><div class="rs-v lo">' + sm.unfocusCount + '</div><div class="rs-l">Triggers</div></div>';

    var rc = $('resCal');
    if (sm.calibrated) {
      rc.classList.add('show');
      rc.innerHTML = '<div class="res-cal-title"><div class="cd"></div>Gaze Calibration</div><div class="res-cal-grid"><div class="res-cal-stat"><div class="v" style="color:#a855f7">' + sm.calAccuracy + '%</div><div class="l">Accuracy</div></div><div class="res-cal-stat"><div class="v">' + (calData ? calData.points : 9) + '</div><div class="l">Points</div></div><div class="res-cal-stat"><div class="v" style="color:var(--gn)">Yes</div><div class="l">Calibrated</div></div></div>';
    } else { rc.classList.remove('show'); rc.innerHTML = ''; }

    drawTimeline();
    var html = '';
    r.insights.forEach(function (i) { html += '<div class="ri"><div class="ri-h"><span class="ri-ic">' + i.icon + '</span><span class="ri-tt">' + i.title + '</span></div><div class="ri-tx">' + i.text + '</div></div>'; });
    $('resIns').innerHTML = html;
  }

  function drawTimeline() {
    var c = $('tlCanvas'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1, rect = c.getBoundingClientRect();
    c.width = rect.width * dpr; c.height = rect.height * dpr; ctx.scale(dpr, dpr);
    var w = rect.width, h = rect.height; ctx.clearRect(0, 0, w, h);
    if (scores.length < 2) return;
    ctx.fillStyle = 'rgba(34,197,94,.04)'; ctx.fillRect(0, 0, w, h * .3);
    ctx.fillStyle = 'rgba(239,68,68,.04)'; ctx.fillRect(0, h * .6, w, h * .4);
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    [30, 50, 70].forEach(function (p) { var y = h - (p / 100) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
    ctx.setLineDash([]);
    var gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(99,102,241,.18)'); gr.addColorStop(1, 'rgba(99,102,241,.01)');
    ctx.beginPath(); ctx.moveTo(0, h);
    for (var i = 0; i < scores.length; i++) { var x = (i / (scores.length - 1)) * w, y = h - (scores[i].s / 100) * h; if (!i) ctx.lineTo(x, y); else { var px = ((i - 1) / (scores.length - 1)) * w, py = h - (scores[i - 1].s / 100) * h; ctx.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y); } }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
    ctx.beginPath();
    for (var i2 = 0; i2 < scores.length; i2++) { var x2 = (i2 / (scores.length - 1)) * w, y2 = h - (scores[i2].s / 100) * h; if (!i2) ctx.moveTo(x2, y2); else { var px2 = ((i2 - 1) / (scores.length - 1)) * w, py2 = h - (scores[i2 - 1].s / 100) * h; ctx.bezierCurveTo((px2 + x2) / 2, py2, (px2 + x2) / 2, y2, x2, y2); } }
    ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2.5; ctx.stroke();
    if (unfocusEvents.length && scores.length > 1) { var t0 = scores[0].ts, t1 = scores[scores.length - 1].ts, tr = t1 - t0 || 1; ctx.fillStyle = 'rgba(239,68,68,.5)'; unfocusEvents.forEach(function (ev) { var ex = ((ev.ts - t0) / tr) * w; ctx.beginPath(); ctx.arc(ex, h - 4, 3, 0, Math.PI * 2); ctx.fill(); }); }
  }

  $('btnExport').addEventListener('click', function () {
    var d = { version: '3.2', exportedAt: new Date().toISOString(), startTime: tStart, endTime: Date.now(), scores: scores, unfocusEvents: unfocusEvents, calibration: calData, results: genResults() };
    var b = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = 'focustrace-' + new Date().toISOString().slice(0, 16) + '.json'; a.click();
  });

  $('btnNew').addEventListener('click', function () {
    $('resOv').classList.remove('show');
    $('scoreBig').textContent = '\u2014'; $('scoreBig').className = 'score-big mono';
    $('scoreFill').style.width = '0%'; $('mTime').textContent = '0:00'; $('mFrames').textContent = '0'; $('mTrigs').textContent = '0';
    ['sGaze', 'sEyes', 'sHead', 'sIris', 'sCal'].forEach(function (id) { $(id).style.width = '0%'; });
    ['svGaze', 'svEyes', 'svHead', 'svIris', 'svCal'].forEach(function (id) { $(id).textContent = '\u2014'; });
    $('log').innerHTML = '';
    if (calDone) setSig('sCal', 'svCal', calAccuracy);
  });

  // Boot
  logEv('\u23F3', 'Starting...');
  initCamera();
  startFrameLoop();
})();
