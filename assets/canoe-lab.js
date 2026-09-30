/* Mock CANoe / CANalyzer lab.
   A small simulated CAN bus with a mock cluster ECU (the "device under test"), a trace,
   a panel, graphics, an interactive generator, a CAPL-subset interpreter and a test-module
   runner. Everything runs in this browser tab; nothing is sent anywhere. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  var store = window.siteStore || function () { return null; };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hex(n, w) { var s = Number(n).toString(16).toUpperCase(); while (s.length < (w || 2)) s = '0' + s; return s; }

  /* ================= Database (mock DBC) ================= */
  var DB = [
    { id: 0x0A0, name: 'Ignition', sender: 'BCM', cycle: 1000, dlc: 8, signals: [
      { name: 'KL15', start: 0, len: 2, values: { 0: 'OFF', 1: 'ACC', 2: 'ON' } }] },
    { id: 0x1A0, name: 'VehicleSpeed', sender: 'ABS', cycle: 100, dlc: 8, signals: [
      { name: 'VehicleSpeed', start: 0, len: 16, factor: 0.01, unit: 'km/h' }] },
    { id: 0x2B0, name: 'OutsideTemp', sender: 'Sensor', cycle: 500, dlc: 8, signals: [
      { name: 'OutsideTemp', start: 0, len: 16, factor: 0.1, offset: -40, unit: '°C', sna: 0xFFFF }] },
    { id: 0x3C0, name: 'BodyStatus', sender: 'BCM', cycle: 500, dlc: 8, signals: [
      { name: 'DoorDriverOpen', start: 0, len: 1, values: { 0: 'Closed', 1: 'Open' } },
      { name: 'DoorPassengerOpen', start: 1, len: 1, values: { 0: 'Closed', 1: 'Open' } },
      { name: 'SeatbeltDriver', start: 2, len: 1, values: { 0: 'Unbuckled', 1: 'Buckled' } }] },
    { id: 0x4D0, name: 'FuelLevel', sender: 'Engine', cycle: 1000, dlc: 8, signals: [
      { name: 'FuelLevel', start: 0, len: 8, factor: 0.5, unit: '%' }] },
    { id: 0x5E0, name: 'ClusterStatus', sender: 'Cluster', cycle: 500, dlc: 8, signals: [
      { name: 'SnowflakeIcon', start: 0, len: 1, values: { 0: 'Off', 1: 'On' } },
      { name: 'SeatbeltLamp', start: 1, len: 2, values: { 0: 'Off', 1: 'On', 2: 'Flashing' } },
      { name: 'DoorWarning', start: 3, len: 1, values: { 0: 'Off', 1: 'On' } },
      { name: 'LowFuelLamp', start: 4, len: 1, values: { 0: 'Off', 1: 'On' } },
      { name: 'TempDisplayValid', start: 5, len: 1, values: { 0: 'Invalid', 1: 'Valid' } },
      { name: 'DisplayedSpeed', start: 8, len: 16, unit: 'km/h', sna: 0xFFFF }] }
  ];
  var BY_ID = {}, BY_NAME = {}, SIG = {};
  DB.forEach(function (m) {
    BY_ID[m.id] = m; BY_NAME[m.name.toLowerCase()] = m;
    m.signals.forEach(function (s) {
      s.msg = m;
      if (s.factor == null) s.factor = 1;
      if (s.offset == null) s.offset = 0;
      if (s.unit == null) s.unit = '';
      SIG[s.name] = s;
    });
  });

  function getRaw(bytes, s) {
    var v = 0;
    for (var i = 0; i < s.len; i++) { var b = s.start + i; if ((bytes[b >> 3] >> (b & 7)) & 1) v += Math.pow(2, i); }
    return v;
  }
  function setRaw(bytes, s, raw) {
    for (var i = 0; i < s.len; i++) {
      var b = s.start + i, bit = Math.floor(raw / Math.pow(2, i)) % 2;
      if (bit) bytes[b >> 3] |= (1 << (b & 7)); else bytes[b >> 3] &= ~(1 << (b & 7));
    }
  }
  function phys(s, raw) { return Math.round((raw * s.factor + s.offset) * 1e6) / 1e6; }
  function toRaw(s, v) {
    var r = Math.round((Number(v) - s.offset) / s.factor), max = Math.pow(2, s.len) - 1;
    return Math.max(0, Math.min(max, isNaN(r) ? 0 : r));
  }
  function encode(m, values) {
    var d = new Uint8Array(8);
    m.signals.forEach(function (s) { if (values[s.name] !== undefined) setRaw(d, s, toRaw(s, values[s.name])); });
    return d;
  }
  function resolveMsg(key) {
    if (typeof key === 'number') return BY_ID[key] || null;
    key = String(key);
    if (/^0x[0-9a-f]+$/i.test(key)) return BY_ID[parseInt(key, 16)] || null;
    if (/^\d+$/.test(key)) return BY_ID[parseInt(key, 10)] || null;
    return BY_NAME[key.toLowerCase()] || null;
  }
  function keyToId(key) {
    var m = resolveMsg(key);
    if (m) return m.id;
    if (/^0x[0-9a-f]+$/i.test(key)) return parseInt(key, 16);
    if (/^\d+$/.test(key)) return parseInt(key, 10);
    return null;
  }
  function fmtVal(s, raw) {
    if (s.sna != null && raw === s.sna) return 'SNA (signal not available)';
    var p = phys(s, raw);
    if (s.values && s.values[raw] !== undefined) return raw + ' = ' + s.values[raw];
    var dec = s.factor < 1 ? String(s.factor).split('.')[1].length : 0;
    return p.toFixed(dec) + (s.unit ? ' ' + s.unit : '');
  }

  /* ================= Simulation state ================= */
  var DEFAULTS = { KL15: 2, VehicleSpeed: 0, OutsideTemp: 12, DoorDriverOpen: 0, DoorPassengerOpen: 0, SeatbeltDriver: 1, FuelLevel: 60 };
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  var S = { running: false, t0: 0, now: 0, mode: 'canoe', sig: copy(DEFAULTS), send: {}, sna: false, due: {}, bus: {},
    queue: [], loadWin: [], tick: null, ui: null, bug: 'none', mystery: null, igCyc: false, igDue: 0 };
  DB.forEach(function (m) { S.send[m.id] = true; });
  var F = { timers: 0 };   // what the learner has done (for the lessons)

  /* ================= Mock cluster ECU (device under test) ================= */
  var D;
  function resetDut() {
    D = { kl15: 0, speed: null, speedT: -1e9, temp: null, tempRaw: null, tempT: -1e9, doors: 0, belt: 1, fuel: null,
      snow: 0, beltLamp: 0, doorWarn: 0, lowFuel: 0, shownSpeed: null, tempValid: 0, lastKey: '', nextStatus: 0 };
  }
  resetDut();
  function activeBug() { return S.bug === 'mystery' ? S.mystery : S.bug; }
  function dutRx(f) {
    var m = BY_ID[f.id];
    if (!m || m.sender === 'Cluster') return;
    if (m.name === 'Ignition') {
      var k = getRaw(f.data, SIG.KL15);
      if (D.kl15 === 2 && k === 0) F.kl15Off = true;
      if (F.kl15Off && k === 2 && D.kl15 !== 2) F.kl15Back = true;
      D.kl15 = k;
    }
    if (m.name === 'VehicleSpeed') { D.speed = phys(SIG.VehicleSpeed, getRaw(f.data, SIG.VehicleSpeed)); D.speedT = S.now; }
    if (m.name === 'OutsideTemp') {
      D.tempRaw = getRaw(f.data, SIG.OutsideTemp);
      D.temp = D.tempRaw === 0xFFFF ? D.temp : phys(SIG.OutsideTemp, D.tempRaw);
      D.tempT = S.now;
    }
    if (m.name === 'BodyStatus') {
      D.doors = (getRaw(f.data, SIG.DoorDriverOpen) || getRaw(f.data, SIG.DoorPassengerOpen)) ? 1 : 0;
      D.belt = getRaw(f.data, SIG.SeatbeltDriver);
    }
    if (m.name === 'FuelLevel') D.fuel = phys(SIG.FuelLevel, getRaw(f.data, SIG.FuelLevel));
  }
  function dutStep() {
    var bug = activeBug();
    if (D.kl15 !== 2) { D.snow = 0; D.beltLamp = 0; D.doorWarn = 0; D.lowFuel = 0; D.shownSpeed = null; D.tempValid = 0; return; }
    var speedOk = D.speed != null && S.now - D.speedT < 500;
    D.shownSpeed = speedOk ? Math.max(0, Math.round(D.speed) - (bug === 'speed' ? 3 : 0)) : null;
    var fresh = D.temp != null && D.tempRaw !== 0xFFFF && S.now - D.tempT < 1500;
    if (bug === 'timeout' && D.temp != null && D.tempRaw !== 0xFFFF) fresh = true;   // bug: never notices the missing message
    var wasValid = D.tempValid;
    D.tempValid = fresh ? 1 : 0;
    if (!fresh && D.tempT > 0) F.tempInvalid = true;
    if (fresh && !wasValid && F.tempInvalid) F.tempRecovered = true;
    var before = D.snow;
    if (!fresh) D.snow = 0;
    else {
      var t = Math.round(D.temp * 10) / 10, onAt = bug === 'snow' ? 5.0 : 4.0;
      if (t <= onAt) D.snow = 1; else if (t >= 5.0) D.snow = 0;
    }
    if (!before && D.snow) F.snowOn = true;
    if (before && !D.snow && F.snowOn && fresh) F.snowOff = true;
    D.beltLamp = D.belt === 1 ? 0 : ((D.speed || 0) > 25 && bug !== 'belt' ? 2 : 1);
    D.doorWarn = D.doors ? 1 : 0;
    D.lowFuel = D.fuel != null && D.fuel < 10 ? 1 : 0;
  }
  function dutTx() {
    if (D.kl15 !== 2) return;
    var key = [D.snow, D.beltLamp, D.doorWarn, D.lowFuel, D.tempValid, D.shownSpeed].join(',');
    if (S.now >= D.nextStatus || key !== D.lastKey) {
      D.lastKey = key; D.nextStatus = S.now + 500;
      enqueue(0x5E0, encode(BY_ID[0x5E0], { SnowflakeIcon: D.snow, SeatbeltLamp: D.beltLamp, DoorWarning: D.doorWarn,
        LowFuelLamp: D.lowFuel, TempDisplayValid: D.tempValid, DisplayedSpeed: D.shownSpeed == null ? 0xFFFF : D.shownSpeed }), 'Rx', 'Cluster');
    }
  }

  /* ================= Bus ================= */
  function enqueue(id, data, dir, src, dlc) { S.queue.push({ id: id, data: data, dir: dir, src: src, dlc: dlc == null ? 8 : dlc }); }
  function processQueue() {
    var n = 0;
    while (S.queue.length && n++ < 400) { var f = S.queue.shift(); f.t = S.now; onFrame(f); }
  }
  function onFrame(f) {
    var m = BY_ID[f.id];
    f.name = m ? m.name : '';
    if (m) m.signals.forEach(function (s) {
      var raw = getRaw(f.data, s), v = (s.sna != null && raw === s.sna) ? NaN : phys(s, raw), prev = S.bus[s.name];
      S.bus[s.name] = v;
      pushHist(s.name, v);
      caplOnSignal(s.name, v, prev);
    });
    S.loadWin.push(S.now);
    dutRx(f);
    traceAdd(f);
    caplOnMessage(f);
    msgWaiters(f);
  }
  function sendSim(m) {
    var d = encode(m, S.sig);
    if (m.name === 'OutsideTemp' && S.sna) setRaw(d, SIG.OutsideTemp, 0xFFFF);
    enqueue(m.id, d, S.mode === 'canoe' ? 'Tx' : 'Rx', m.sender);
  }
  function simTx() {
    DB.forEach(function (m) {
      if (m.sender === 'Cluster' || !S.send[m.id]) return;
      if (S.now >= (S.due[m.id] || 0)) { S.due[m.id] = S.now + m.cycle; sendSim(m); }
    });
  }
  function setSig(name, v) {
    var s = SIG[name];
    if (!s) return;
    v = Number(v);
    if (isNaN(v)) return;
    if (name === 'OutsideTemp') v = Math.round(v * 10) / 10;
    S.sig[name] = v;
    var m = s.msg;
    if (S.running && S.send[m.id]) { S.due[m.id] = S.now + m.cycle; sendSim(m); }
    syncPanel();
  }
  function drive() {
    var t = S.now / 1000;
    S.sig.KL15 = 2; S.sig.SeatbeltDriver = 1; S.sig.DoorDriverOpen = 0; S.sig.DoorPassengerOpen = 0;
    S.sig.VehicleSpeed = Math.max(0, Math.round((55 + 45 * Math.sin(t / 6)) * 100) / 100);
    S.sig.OutsideTemp = Math.round((4.5 + 3 * Math.sin(t / 15)) * 10) / 10;
    S.sig.FuelLevel = Math.max(0, Math.round((40 - t * 0.2) * 2) / 2);
  }
  function tick() {
    if (!S.running) return;
    S.now = performance.now() - S.t0;
    if (S.mode === 'canalyzer') drive();
    simTx();
    if (S.igCyc && S.now >= S.igDue) { S.igDue = S.now + 100; igSend(true); }
    processQueue();
    dutStep();
    dutTx();
    processQueue();
    runTimers();
    processQueue();
  }

  function startMeasurement() {
    if (S.running) return;
    S.running = true; S.t0 = performance.now(); S.now = 0; S.due = {}; S.bus = {}; S.queue = []; S.loadWin = [];
    resetDut(); HIST = {};
    traceClear();
    F.started = true;
    writeLine('--- Measurement started (' + (S.mode === 'canoe' ? 'CANoe' : 'CANalyzer') + ' mode) ---', 'sys');
    if (PROG && $('caplSrc').value !== PROG.src) writeLine('Note: your CAPL code has changed since the last Compile. The OLD version is running. Press Compile to use the new one.', 'sys');
    instantiate();
    if (RUN) RUN.H.start.forEach(function (h) { runHandler(h, null); });
    S.tick = setInterval(tick, 20);
    $('btnStart').disabled = true; $('btnStop').disabled = false;
  }
  function stopMeasurement() {
    if (!S.running) return;
    if (RUN) RUN.H.stop.forEach(function (h) { runHandler(h, null); });
    S.running = false;
    clearInterval(S.tick);
    if (TEST && TEST.running) TEST.aborted = true;
    RUN = null;
    S.igCyc = false; $('igCyc').checked = false;
    writeLine('--- Measurement stopped ---', 'sys');
    $('btnStart').disabled = false; $('btnStop').disabled = true;
    renderAll();
  }

  /* ================= Trace ================= */
  var TR = { mode: 'fixed', paused: false, filter: '', rows: {}, pending: [], open: {} };
  function traceAdd(f) {
    if (TR.paused) return;
    TR.pending.push(f);
    if (TR.pending.length > 500) TR.pending.splice(0, TR.pending.length - 500);
  }
  function traceClear() {
    TR.rows = {}; TR.pending = [];
    $('trBody').innerHTML = '<tr class="tr-empty"><td colspan="7">' + (S.running ? 'Waiting for messages&hellip;' : 'Press &#9889; Start to see the messages on the bus.') + '</td></tr>';
  }
  function matchesFilter(f) {
    var q = TR.filter.trim().toLowerCase();
    if (!q) return true;
    return (f.name || '').toLowerCase().indexOf(q) >= 0 || hex(f.id, 3).toLowerCase().indexOf(q.replace(/^0x/, '')) >= 0;
  }
  function bytesHtml(f, prev, chgAt) {
    var h = '';
    for (var i = 0; i < f.dlc; i++) {
      var changed = chgAt && S.now - (chgAt[i] || -1e9) < 900;
      h += '<span class="by' + (changed ? ' chg' : '') + '">' + hex(f.data[i]) + '</span> ';
    }
    return h;
  }
  function decodeHtml(f) {
    var m = BY_ID[f.id];
    if (!m) return '<span class="dec-line unk">This ID is not in the database (DBC), so the tool cannot decode it. You only see the bytes.</span>';
    var h = '<span class="dec-line">' + esc(m.name) + ' &middot; sent by <b>' + esc(m.sender) + '</b> &middot; every ' + m.cycle + ' ms</span>';
    m.signals.forEach(function (s) {
      var raw = getRaw(f.data, s);
      h += '<span class="dec-line">&nbsp;&nbsp;<b>' + esc(s.name) + '</b> = ' + esc(fmtVal(s, raw)) +
        ' <span class="muted">(raw ' + raw + ' = 0x' + hex(raw, s.len > 8 ? 4 : 2) + (s.factor !== 1 || s.offset ? '; ' + raw + ' &times; ' + s.factor + (s.offset ? ' + (' + s.offset + ')' : '') : '') + ')</span></span>';
    });
    return h;
  }
  function rowCells(f) {
    return '<td>' + (f.t / 1000).toFixed(6) + '</td><td>CAN 1</td><td>' + hex(f.id, 3) + '</td><td>' + (f.name ? esc(f.name) : '<span class="unk">(unknown)</span>') +
      '</td><td class="' + (f.dir === 'Tx' ? 'tx' : 'rx') + '">' + f.dir + '</td><td>' + f.dlc + '</td>';
  }
  function flushTrace() {
    if (!TR.pending.length) return;
    var body = $('trBody');
    var empty = body.querySelector('.tr-empty');
    if (empty) empty.remove();
    if (TR.mode === 'fixed') {
      var latest = {};
      TR.pending.forEach(function (f) { latest[f.id] = f; });
      Object.keys(latest).forEach(function (k) {
        var f = latest[k], r = TR.rows[k];
        if (!r) {
          var tr = document.createElement('tr');
          tr.className = 'fr'; tr.setAttribute('data-id', k);
          r = TR.rows[k] = { tr: tr, dec: null, last: null, chg: {}, f: f };
          var after = null;
          Object.keys(TR.rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
            if (id > +k && !after) after = TR.rows[id].tr;
          });
          body.insertBefore(tr, after);
        }
        for (var i = 0; i < 8; i++) if (r.last && r.last[i] !== f.data[i]) r.chg[i] = S.now;
        r.last = f.data.slice(0); r.f = f;
        r.tr.innerHTML = rowCells(f) + '<td>' + bytesHtml(f, null, r.chg) + '</td>';
        if (r.dec) r.dec.firstChild.innerHTML = decodeHtml(f);
        var show = matchesFilter(f);
        r.tr.hidden = !show; if (r.dec) r.dec.hidden = !show;
      });
    } else {
      var wrap = $('trWrap'), atEnd = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 30;
      var frag = document.createDocumentFragment();
      TR.pending.forEach(function (f) {
        var tr = document.createElement('tr');
        tr.className = 'fr'; tr._f = f; tr.hidden = !matchesFilter(f);
        tr.innerHTML = rowCells(f) + '<td>' + bytesHtml(f) + '</td>';
        frag.appendChild(tr);
      });
      body.appendChild(frag);
      var rows = body.querySelectorAll('tr.fr');
      for (var j = 0; j < rows.length - 300; j++) {
        var nx = rows[j].nextSibling;
        if (nx && nx.classList && nx.classList.contains('dec')) nx.remove();
        rows[j].remove();
      }
      if (atEnd) wrap.scrollTop = wrap.scrollHeight;
    }
    TR.pending = [];
  }
  function traceClick(e) {
    var tr = e.target.closest('tr.fr');
    if (!tr) return;
    if (TR.mode === 'fixed') {
      var id = tr.getAttribute('data-id'), r = TR.rows[id];
      if (r.dec) { r.dec.remove(); r.dec = null; return; }
      r.dec = document.createElement('tr'); r.dec.className = 'dec';
      r.dec.innerHTML = '<td colspan="7"></td>';
      r.dec.firstChild.innerHTML = decodeHtml(r.f);
      tr.parentNode.insertBefore(r.dec, tr.nextSibling);
      if (+id === 0x1A0) F.exp1A0 = true;
    } else {
      var nx = tr.nextSibling;
      if (nx && nx.classList && nx.classList.contains('dec')) { nx.remove(); return; }
      var d = document.createElement('tr'); d.className = 'dec';
      d.innerHTML = '<td colspan="7">' + decodeHtml(tr._f) + '</td>';
      tr.parentNode.insertBefore(d, tr.nextSibling);
      if (tr._f.id === 0x1A0) F.exp1A0 = true;
    }
  }
  function setTraceMode(mode) {
    TR.mode = mode;
    $('trFixed').classList.toggle('on', mode === 'fixed');
    $('trScroll').classList.toggle('on', mode === 'scroll');
    traceClear();
  }
  function refilter() {
    $('trBody').querySelectorAll('tr.fr').forEach(function (tr) {
      var f = TR.mode === 'fixed' ? TR.rows[tr.getAttribute('data-id')].f : tr._f;
      tr.hidden = !matchesFilter(f);
      var nx = tr.nextSibling;
      if (nx && nx.classList && nx.classList.contains('dec')) nx.hidden = tr.hidden;
    });
  }

  /* ================= Graphics ================= */
  var HIST = {};
  var RANGES = { VehicleSpeed: [0, 200], OutsideTemp: [-20, 30], FuelLevel: [0, 100], KL15: [0, 2], DisplayedSpeed: [0, 200], SnowflakeIcon: [0, 1], SeatbeltLamp: [0, 2] };
  function pushHist(name, v) {
    var h = HIST[name] || (HIST[name] = []);
    h.push([S.now, v]);
    while (h.length && h[0][0] < S.now - 31000) h.shift();
  }
  function drawGraph() {
    var c = $('grCanvas'), w = c.clientWidth, hh = c.clientHeight;
    if (!w) return;
    var dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    var cs = getComputedStyle(document.documentElement);
    var col = cs.getPropertyValue('--accent').trim() || '#2563c9', grid = cs.getPropertyValue('--border').trim() || '#ddd', txt = cs.getPropertyValue('--text-2').trim() || '#666';
    var name = $('grSig').value, s = SIG[name], h = HIST[name] || [];
    var r = (RANGES[name] || [0, 1]).slice();
    h.forEach(function (p) { if (!isNaN(p[1])) { if (p[1] < r[0]) r[0] = Math.floor(p[1]); if (p[1] > r[1]) r[1] = Math.ceil(p[1]); } });
    var L = 42, R = 8, T = 8, B = 22, pw = w - L - R, ph = hh - T - B;
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = txt; ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var yv = r[0] + (r[1] - r[0]) * g / 4, y = T + ph - ph * g / 4;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText((Math.round(yv * 10) / 10).toString(), L - 6, y + 4);
    }
    ctx.textAlign = 'center';
    ['-30 s', '-20 s', '-10 s', 'now'].forEach(function (lab, i) { ctx.fillText(lab, L + pw * i / 3, hh - 6); });
    var t1 = S.now, t0 = t1 - 30000;
    function X(t) { return L + (t - t0) / 30000 * pw; }
    function Y(v) { return T + ph - (v - r[0]) / (r[1] - r[0] || 1) * ph; }
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    var penUp = true, lastY = null;
    h.forEach(function (p) {
      if (p[0] < t0) return;
      if (isNaN(p[1])) { penUp = true; return; }
      var x = X(p[0]), y = Y(p[1]);
      if (penUp) { ctx.moveTo(x, y); penUp = false; } else { ctx.lineTo(x, lastY); ctx.lineTo(x, y); }
      lastY = y;
    });
    if (!penUp && S.running) ctx.lineTo(X(t1), lastY);
    ctx.stroke();
    var last = h.length ? h[h.length - 1][1] : undefined;
    $('grVal').textContent = last === undefined ? (S.running ? 'No value yet.' : 'Start the measurement to see the signal.') :
      name + ' now: ' + (isNaN(last) ? 'SNA / not available' : fmtVal(s, toRaw(s, last)));
  }

  /* ================= Write window ================= */
  function writeLine(text, cls) {
    var w = $('wrBody');
    var d = document.createElement('div');
    d.className = cls || '';
    var stamp = S.running && cls !== 'sys' && cls !== 'err';
    d.textContent = (stamp ? '[' + (S.now / 1000).toFixed(3) + '] ' : '') + text;
    w.appendChild(d);
    while (w.childNodes.length > 300) w.removeChild(w.firstChild);
    w.scrollTop = w.scrollHeight;
  }

  /* ================= Panel ================= */
  function syncPanel() {
    var a = document.activeElement;
    function setv(id, v) { var el = $(id); if (el && el !== a) el.value = v; }
    setv('pSpeed', S.sig.VehicleSpeed); $('pSpeedV').textContent = Math.round(S.sig.VehicleSpeed);
    setv('pTemp', S.sig.OutsideTemp); setv('pTempN', Number(S.sig.OutsideTemp).toFixed(1)); $('pTempV').textContent = Number(S.sig.OutsideTemp).toFixed(1);
    setv('pFuel', S.sig.FuelLevel); $('pFuelV').textContent = S.sig.FuelLevel;
    $('pDoorD').checked = !!S.sig.DoorDriverOpen; $('pDoorP').checked = !!S.sig.DoorPassengerOpen; $('pBelt').checked = !!S.sig.SeatbeltDriver;
    $('pKL15').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-v') === S.sig.KL15); });
  }
  function wirePanel() {
    $('pKL15').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setSig('KL15', +b.getAttribute('data-v')); });
    $('pSpeed').addEventListener('input', function () { setSig('VehicleSpeed', +this.value); });
    $('pTemp').addEventListener('input', function () { setSig('OutsideTemp', +this.value); });
    $('pTempN').addEventListener('change', function () { setSig('OutsideTemp', +this.value); });
    $('pTempDn').addEventListener('click', function () { setSig('OutsideTemp', Math.round((S.sig.OutsideTemp - 0.1) * 10) / 10); });
    $('pTempUp').addEventListener('click', function () { setSig('OutsideTemp', Math.round((S.sig.OutsideTemp + 0.1) * 10) / 10); });
    $('pDoorD').addEventListener('change', function () { setSig('DoorDriverOpen', this.checked ? 1 : 0); });
    $('pDoorP').addEventListener('change', function () { setSig('DoorPassengerOpen', this.checked ? 1 : 0); });
    $('pBelt').addEventListener('change', function () { setSig('SeatbeltDriver', this.checked ? 1 : 0); });
    $('pFuel').addEventListener('input', function () { setSig('FuelLevel', +this.value); });
    var box = $('pSend'), h = '';
    DB.forEach(function (m) {
      if (m.sender === 'Cluster') return;
      h += '<label><input type="checkbox" data-id="' + m.id + '" checked> 0x' + hex(m.id, 3) + ' ' + esc(m.name) + ' <span class="muted">(' + esc(m.sender) + ', ' + m.cycle + ' ms)</span></label>';
    });
    box.innerHTML = h;
    box.addEventListener('change', function (e) {
      var id = +e.target.getAttribute('data-id');
      S.send[id] = e.target.checked;
      if (e.target.checked) S.due[id] = 0;
      writeLine('Rest-bus: 0x' + hex(id, 3) + ' ' + BY_ID[id].name + (e.target.checked ? ' is sent again.' : ' is no longer sent (like a broken or missing ECU).'), 'sys');
    });
    $('pSna').addEventListener('change', function () {
      S.sna = this.checked;
      if (S.running && S.send[0x2B0]) sendSim(BY_ID[0x2B0]);
      writeLine(this.checked ? 'OutsideTemp now sends SNA (0xFFFF): "sensor error".' : 'OutsideTemp sends normal values again.', 'sys');
    });
  }
  function setMode(mode) {
    S.mode = mode;
    $('modeCanoe').classList.toggle('on', mode === 'canoe');
    $('modeCanalyzer').classList.toggle('on', mode === 'canalyzer');
    $('labRoot').classList.toggle('canalyzer', mode === 'canalyzer');
    $('caplTest').disabled = mode !== 'canoe';
    if (mode === 'canoe') { S.sig = copy(DEFAULTS); syncPanel(); }
    writeLine(mode === 'canoe' ? 'Mode: CANoe. You can simulate ECUs (panel) and run test modules.' :
      'Mode: CANalyzer. You only WATCH a real car that drives by itself. The panel and test modules are not available.', 'sys');
  }

  /* ================= Mock cluster drawing ================= */
  function buildGauge() {
    var g = '', cx = 110, cy = 108;
    for (var v = 0; v <= 240; v += 20) {
      var a = (135 + v / 240 * 270) * Math.PI / 180, big = v % 40 === 0;
      g += '<line x1="' + (cx + 74 * Math.cos(a)).toFixed(1) + '" y1="' + (cy + 74 * Math.sin(a)).toFixed(1) + '" x2="' + (cx + 84 * Math.cos(a)).toFixed(1) +
        '" y2="' + (cy + 84 * Math.sin(a)).toFixed(1) + '" stroke="' + (big ? '#c9d3df' : '#56606d') + '" stroke-width="' + (big ? 2 : 1) + '"/>';
      if (big) g += '<text x="' + (cx + 62 * Math.cos(a)).toFixed(1) + '" y="' + (cy + 62 * Math.sin(a) + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#8b98a8">' + v + '</text>';
    }
    $('dTicks').innerHTML = g;
  }
  function lamp(id, on, col) { $(id).setAttribute('fill', on ? col : '#1c2530'); $(id + 'T').setAttribute('fill', on ? '#ffffff' : '#3b4756'); }
  function renderDut() {
    var on = S.running && D.kl15 === 2;
    $('dutOn').style.display = on ? '' : 'none';
    $('dutOff').style.display = on ? 'none' : '';
    $('dutOff').textContent = S.running ? 'Ignition off: screen is dark' : 'No power: press \u26A1 Start';
    if (!on) return;
    var sp = D.shownSpeed, v = sp == null ? 0 : Math.min(240, sp), a = (135 + v / 240 * 270) * Math.PI / 180;
    $('dSpeed').textContent = sp == null ? '---' : String(sp);
    $('dNeedle').setAttribute('x2', (110 + 68 * Math.cos(a)).toFixed(1));
    $('dNeedle').setAttribute('y2', (108 + 68 * Math.sin(a)).toFixed(1));
    $('dTemp').textContent = D.tempValid ? D.temp.toFixed(1) + ' \u00B0C' : '--.- \u00B0C';
    $('dSnow').style.display = D.snow ? '' : 'none';
    $('dPop').style.display = D.doorWarn ? '' : 'none';
    var blink = Math.floor(performance.now() / 400) % 2 === 0;
    lamp('ttBelt', D.beltLamp === 1 || (D.beltLamp === 2 && blink), '#c62f2f');
    lamp('ttDoor', D.doorWarn, '#c62f2f');
    lamp('ttFuel', D.lowFuel, '#d98e04');
  }

  /* ================= Interactive Generator ================= */
  var IG_PRESETS = [
    { l: '0x1A0 VehicleSpeed = 100 km/h', id: 0x1A0, d: encode(BY_ID[0x1A0], { VehicleSpeed: 100 }) },
    { l: '0x1A0 VehicleSpeed = 250 km/h', id: 0x1A0, d: encode(BY_ID[0x1A0], { VehicleSpeed: 250 }) },
    { l: '0x2B0 OutsideTemp = 4.0 \u00B0C', id: 0x2B0, d: encode(BY_ID[0x2B0], { OutsideTemp: 4.0 }) },
    { l: '0x2B0 OutsideTemp = SNA (FF FF = sensor error)', id: 0x2B0, d: new Uint8Array([0xFF, 0xFF, 0, 0, 0, 0, 0, 0]) },
    { l: '0x3C0 BodyStatus: driver door open, belt buckled', id: 0x3C0, d: encode(BY_ID[0x3C0], { DoorDriverOpen: 1, DoorPassengerOpen: 0, SeatbeltDriver: 1 }) },
    { l: '0x123 Unknown ID (not in the DBC)', id: 0x123, d: new Uint8Array([0xAB, 0xCD, 0, 0, 0, 0, 0, 0]), dlc: 2 }
  ];
  function igRead() {
    var id = parseInt(String($('igId').value).replace(/^0x/i, ''), 16);
    var dlc = Math.max(0, Math.min(8, parseInt($('igDlc').value, 10) || 0));
    var d = new Uint8Array(8);
    $('igBytes').querySelectorAll('input').forEach(function (inp, i) { var v = parseInt(inp.value, 16); d[i] = isNaN(v) ? 0 : v & 0xFF; });
    return { id: id, dlc: dlc, data: d };
  }
  function igPreview() {
    var f = igRead();
    if (isNaN(f.id) || f.id < 0 || f.id > 0x7FF) { $('igDec').textContent = 'ID must be a hex number from 000 to 7FF.'; return; }
    var m = BY_ID[f.id];
    $('igDec').innerHTML = m ? 'Means: ' + m.signals.map(function (s) { return '<b>' + esc(s.name) + '</b> = ' + esc(fmtVal(s, getRaw(f.data, s))); }).join(', ') :
      'This ID is not in the DBC: the receiver will not understand it.';
  }
  function igLoad(p) {
    $('igId').value = hex(p.id, 3); $('igDlc').value = p.dlc == null ? 8 : p.dlc;
    $('igBytes').querySelectorAll('input').forEach(function (inp, i) { inp.value = hex(p.d[i]); });
    igPreview();
  }
  function igSend(cyclic) {
    if (!S.running) { writeLine('Start the measurement first (\u26A1 Start).', 'err'); return; }
    var f = igRead();
    if (isNaN(f.id) || f.id > 0x7FF) { writeLine('IG: invalid ID.', 'err'); return; }
    enqueue(f.id, f.data, 'Tx', 'IG', f.dlc);
    F.igSent = true;
    if (!cyclic) writeLine('IG sent 0x' + hex(f.id, 3) + ': ' + Array.prototype.slice.call(f.data, 0, f.dlc).map(function (b) { return hex(b); }).join(' '), 'sys');
  }
  function wireIG() {
    var sel = $('igPreset');
    sel.innerHTML = IG_PRESETS.map(function (p, i) { return '<option value="' + i + '">' + esc(p.l) + '</option>'; }).join('');
    var h = '';
    for (var i = 0; i < 8; i++) h += '<input maxlength="2" aria-label="Byte ' + i + '" value="00">';
    $('igBytes').innerHTML = h;
    sel.addEventListener('change', function () { igLoad(IG_PRESETS[+this.value]); });
    ['igId', 'igDlc'].forEach(function (id) { $(id).addEventListener('input', igPreview); });
    $('igBytes').addEventListener('input', igPreview);
    $('igSend').addEventListener('click', function () { igSend(false); });
    $('igCyc').addEventListener('change', function () {
      if (this.checked && !S.running) { this.checked = false; writeLine('Start the measurement first.', 'err'); return; }
      S.igCyc = this.checked; S.igDue = S.now;
      writeLine(this.checked ? 'IG: sending every 100 ms. Note: the real sender keeps sending too, so the values fight.' : 'IG: cyclic sending stopped.', 'sys');
    });
    igLoad(IG_PRESETS[0]);
  }

  /* ================= Database window ================= */
  function renderDb() {
    var h = '<p class="muted" style="margin:0 0 6px">Real = raw &times; factor + offset. Byte order: Intel (low byte first).</p>';
    DB.forEach(function (m) {
      h += '<h4>0x' + hex(m.id, 3) + ' ' + esc(m.name) + ' <span class="muted" style="font-weight:400">&middot; sent by ' + esc(m.sender) + ' every ' + m.cycle + ' ms</span></h4>' +
        '<div class="table-wrap" style="margin:4px 0 10px"><table><tr><th>Signal</th><th>Start bit</th><th>Length</th><th>Factor</th><th>Offset</th><th>Unit</th><th>Notes</th></tr>';
      m.signals.forEach(function (s) {
        var notes = s.values ? Object.keys(s.values).map(function (k) { return k + '=' + s.values[k]; }).join(', ') : '';
        if (s.sna != null) notes = 'SNA = 0x' + hex(s.sna, 4);
        h += '<tr><td><b>' + esc(s.name) + '</b></td><td>' + s.start + '</td><td>' + s.len + '</td><td>' + s.factor + '</td><td>' + s.offset + '</td><td>' + esc(s.unit) + '</td><td>' + esc(notes) + '</td></tr>';
      });
      h += '</table></div>';
    });
    $('dbBody').innerHTML = h;
  }

  /* ================= CAPL: printf-style formatting ================= */
  function fmt(f, args) {
    var i = 0;
    return String(f).replace(/%([-0]?)(\d*)(?:\.(\d+))?(?:ll|l|h)?([diuxXfgcs%])/g, function (all, flag, w, prec, c) {
      if (c === '%') return '%';
      var a = args[i++], n = Number(a), out;
      switch (c) {
        case 'd': case 'i': case 'u': out = isNaN(n) ? 'NaN' : String(Math.trunc(n)); break;
        case 'x': out = (n >>> 0).toString(16); break;
        case 'X': out = (n >>> 0).toString(16).toUpperCase(); break;
        case 'f': case 'g': out = isNaN(n) ? 'NaN' : n.toFixed(prec != null ? +prec : 6); break;
        case 'c': out = typeof a === 'number' ? String.fromCharCode(a) : String(a); break;
        default: out = String(a);
      }
      var width = +w || 0;
      while (out.length < width) out = flag === '-' ? out + ' ' : (flag === '0' ? '0' + out : ' ' + out);
      return out;
    });
  }

  /* ================= CAPL: message objects and signal access ================= */
  function CMsg(key) {
    var def = resolveMsg(key), self = this;
    this.id = def ? def.id : keyToId(String(key));
    this.name = def ? def.name : '';
    this.dlc = def ? def.dlc : 8;
    this.bytes = new Uint8Array(8);
    this.dir = 1; this.time = 0;
    if (def) def.signals.forEach(function (s) {
      Object.defineProperty(self, s.name, {
        get: function () { return getRaw(self.bytes, s); },
        set: function (v) { setRaw(self.bytes, s, Math.max(0, Math.round(Number(v)))); },
        enumerable: true
      });
    });
  }
  CMsg.prototype.byte = function (i) { return this.bytes[i]; };
  CMsg.prototype.setByte = function (i, v) { this.bytes[i] = Number(v) & 0xFF; };
  CMsg.prototype.__phys = function (n) {
    var s = SIG[n]; if (!s) throw new Error('Unknown signal ' + n);
    var raw = getRaw(this.bytes, s);
    return s.sna != null && raw === s.sna ? NaN : phys(s, raw);
  };
  CMsg.prototype.__setPhys = function (n, v) { var s = SIG[n]; if (!s) throw new Error('Unknown signal ' + n); setRaw(this.bytes, s, toRaw(s, v)); };
  Object.defineProperty(CMsg.prototype, 'DLC', { get: function () { return this.dlc; }, set: function (v) { this.dlc = v; } });
  Object.defineProperty(CMsg.prototype, 'ID', { get: function () { return this.id; }, set: function (v) { this.id = v; } });

  var SIGP = new Proxy({}, {
    get: function (_, name) {
      if (typeof name !== 'string') return undefined;
      if (!SIG[name]) throw new Error('Unknown signal $' + name + '. Check the spelling in the Database window.');
      var v = S.bus[name];
      if (v === undefined) v = S.sig[name] !== undefined ? S.sig[name] : 0;
      return v;
    },
    set: function (_, name, v) {
      var s = SIG[name];
      if (!s) throw new Error('Unknown signal $' + name + '. Check the spelling in the Database window.');
      if (s.msg.sender === 'Cluster') { writeLine('$' + name + ' is sent by the cluster (the real ECU). You can only READ it, not set it.', 'err'); return true; }
      if (S.mode !== 'canoe') { writeLine('CANalyzer cannot simulate ECUs, so "$' + name + ' = ..." does nothing. Switch to CANoe.', 'err'); return true; }
      setSig(name, v);
      return true;
    }
  });

  /* ================= CAPL: compiler (CAPL subset -> JavaScript) ================= */
  var TYPES = 'int|float|double|byte|word|dword|long|int64|qword|char';
  function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }
  function CaplError(msg, line) { this.message = msg; this.line = line; }

  function skipWsComments(src, i) {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '/') { var e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
      if (src[i] === '/' && src[i + 1] === '*') { var e2 = src.indexOf('*/', i + 2); i = e2 < 0 ? src.length : e2 + 2; continue; }
      return i;
    }
  }
  function blockEnd(src, open) {
    var depth = 0;
    for (var i = open; i < src.length; i++) {
      var c = src[i];
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
      if (c === '"' || c === "'") { var q = c; i++; while (i < src.length && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  var HEADERS = [
    { re: /^variables\s*\{/, type: 'vars' },
    { re: /^includes\s*\{/, type: 'includes' },
    { re: /^on\s+(start|preStart|stopMeasurement|preStop)\s*\{/, type: 'sys' },
    { re: /^on\s+message\s+(\*|0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)\s*\{/, type: 'msg' },
    { re: /^on\s+timer\s+([A-Za-z_]\w*)\s*\{/, type: 'timer' },
    { re: /^on\s+key\s+('(?:\\.|[^'\\])')\s*\{/, type: 'key' },
    { re: /^on\s+(signal_update|signal_change|signal)\s+([A-Za-z_]\w*)\s*\{/, type: 'signal' },
    { re: /^testcase\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/, type: 'testcase' },
    { re: /^(?:void\s+)?(MainTest)\s*\(\s*(?:void)?\s*\)\s*\{/, type: 'main' },
    { re: new RegExp('^(?:void|' + TYPES + ')\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{'), type: 'fn' }
  ];
  function parse(src) {
    var out = [], i = 0;
    for (;;) {
      i = skipWsComments(src, i);
      if (i >= src.length) break;
      var rest = src.slice(i), hit = null, m = null;
      for (var k = 0; k < HEADERS.length; k++) { m = HEADERS[k].re.exec(rest); if (m) { hit = HEADERS[k]; break; } }
      var ln = lineOf(src, i);
      if (!hit) {
        var first = rest.split('\n')[0].trim().slice(0, 40);
        throw new CaplError('Line ' + ln + ': I don\'t understand "' + first + '". Each part must start with: variables { }, on start { }, on message X { }, on timer X { }, on key \'x\' { }, testcase Name() { }, void MainTest() { } or a function like void myFunc() { }.', ln);
      }
      var open = i + m[0].length - 1, end = blockEnd(src, open);
      if (end < 0) throw new CaplError('Line ' + ln + ': the { of this block is never closed. A } is missing.', ln);
      out.push({ type: hit.type, m: m, body: src.slice(open + 1, end), line: ln });
      i = end + 1;
    }
    return out;
  }
  /* Removes comments, hides strings and turns 'a' into its character code. */
  function protect(code) {
    var out = '', strs = [], i = 0, n = code.length;
    while (i < n) {
      var c = code[i], d = code[i + 1];
      if (c === '/' && d === '/') { var e = code.indexOf('\n', i); if (e < 0) e = n; out += ' '; i = e; continue; }
      if (c === '/' && d === '*') { var e2 = code.indexOf('*/', i + 2); if (e2 < 0) e2 = n - 2; out += code.slice(i, e2 + 2).replace(/[^\n]/g, ' '); i = e2 + 2; continue; }
      if (c === '"') {
        var j = i + 1;
        while (j < n && code[j] !== '"' && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
        strs.push(code.slice(i, j + 1)); out += '\u0001' + (strs.length - 1) + '\u0001'; i = j + 1; continue;
      }
      if (c === "'") {
        var ch = null, k = i + 1;
        if (code[k] === '\\') { ch = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39 }[code[k + 1]]; k += 2; }
        else { ch = code.charCodeAt(k); k += 1; }
        if (code[k] === "'" && ch != null) { out += String(ch); i = k + 1; continue; }
      }
      out += c; i++;
    }
    return { code: out, restore: function (s) { return s.replace(/\u0001(\d+)\u0001/g, function (_, x) { return strs[+x]; }); } };
  }
  function splitTop(s) {
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }
  function xDecl(code) {
    code = code.replace(/\bmessage\s+(\*|0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;/g, function (_, k, n) { return 'var ' + n + ' = __newMsg("' + k + '");'; });
    code = code.replace(/\b(msTimer|timer)\s+([A-Za-z_]\w*)\s*;/g, function (_, t, n) { return 'var ' + n + ' = __newTimer("' + n + '", ' + (t === 'timer' ? 1000 : 1) + ');'; });
    code = code.replace(new RegExp('\\b(?:const\\s+)?(?:' + TYPES + ')\\s+([A-Za-z_]\\w*)\\s*\\[\\s*([^\\]]*)\\]\\s*(?:=\\s*(\\{[^}]*\\}|\\u0001\\d+\\u0001))?\\s*;', 'g'),
      function (_, n, size, init) {
        if (init && init[0] === '{') return 'var ' + n + ' = [' + init.slice(1, -1) + '];';
        if (init) return 'var ' + n + ' = ' + init + ';';
        return 'var ' + n + ' = __arr(' + (parseInt(size, 10) || 0) + ');';
      });
    code = code.replace(new RegExp('\\b(?:const\\s+)?(?:' + TYPES + ')\\s+([A-Za-z_][^;]*);', 'g'), function (_, list) {
      return 'var ' + splitTop(list).map(function (p) { p = p.trim(); return /=/.test(p) ? p : p + ' = 0'; }).join(', ') + ';';
    });
    code = code.replace(new RegExp('\\(\\s*(?:' + TYPES + ')\\s*\\)', 'g'), '');
    code = code.replace(/\.([A-Za-z_]\w*)\.phys\s*=(?!=)\s*([^;]+);/g, '.__setPhys("$1", $2);');
    code = code.replace(/\.([A-Za-z_]\w*)\.phys\b/g, '.__phys("$1")');
    code = code.replace(/\.byte\s*\(([^)]*)\)\s*=(?!=)\s*([^;]+);/g, '.setByte($1, $2);');
    code = code.replace(/\$([A-Za-z_]\w*)/g, '__sig.$1');
    return code;
  }
  function params(p) {
    p = p.trim();
    if (!p || p === 'void') return '';
    return splitTop(p).map(function (x) {
      x = x.trim().replace(/\[\s*\]$/, '');
      var mm = /([A-Za-z_]\w*)\s*$/.exec(x);
      return mm ? mm[1] : x;
    }).join(', ');
  }
  var WAITS = /\b(TestWaitForTimeout|testWaitForTimeout|TestWaitForMessage|testWaitForMessage)\s*\(/g;
  function xAwait(code, names) {
    code = code.replace(WAITS, 'await $1(');
    names.forEach(function (n) { code = code.replace(new RegExp('(^|[^.\\w])' + n + '\\s*\\(', 'g'), '$1await ' + n + '('); });
    return code;
  }
  var API_NAMES = null;
  function compileSource(src) {
    var blocks = parse(src), asyncSet = {}, fnBlocks = [];
    blocks.forEach(function (b) {
      if (b.type === 'testcase' || b.type === 'main') asyncSet[b.m[1]] = true;
      if (b.type === 'fn') { fnBlocks.push(b); if (/\b[Tt]estWaitFor\w*\s*\(/.test(b.body)) asyncSet[b.m[1]] = true; }
    });
    var changed = true;
    while (changed) {
      changed = false;
      fnBlocks.forEach(function (b) {
        if (asyncSet[b.m[1]]) return;
        Object.keys(asyncSet).forEach(function (n) {
          if (!asyncSet[b.m[1]] && new RegExp('(^|[^.\\w])' + n + '\\s*\\(').test(b.body)) { asyncSet[b.m[1]] = true; changed = true; }
        });
      });
    }
    var asyncNames = Object.keys(asyncSet).filter(function (n) { return n !== 'MainTest'; });
    var pieces = [], hasMain = false, info = { tests: [], handlers: 0 };
    blocks.forEach(function (b) {
      var p = protect(b.body), code = xDecl(p.code);
      var isAsync = b.type === 'testcase' || b.type === 'main' || (b.type === 'fn' && asyncSet[b.m[1]]);
      if (isAsync) code = xAwait(code, asyncNames);
      code = p.restore(code);
      var meta = 'line:' + b.line + ', errs:0, ';
      var js = '';
      switch (b.type) {
        case 'includes': break;
        case 'vars': js = code; break;
        case 'sys':
          var ev = b.m[1].toLowerCase();
          js = '__H.' + (ev === 'start' || ev === 'prestart' ? 'start' : 'stop') + '.push({' + meta + 'name:"on ' + b.m[1] + '", fn:function(){' + code + '\n}});'; info.handlers++; break;
        case 'msg': js = '__H.msg.push({' + meta + 'key:' + JSON.stringify(b.m[1]) + ', name:"on message ' + b.m[1] + '", fn:function(){' + code + '\n}});'; info.handlers++; break;
        case 'timer': js = '__H.timer[' + JSON.stringify(b.m[1]) + '] = {' + meta + 'name:"on timer ' + b.m[1] + '", fn:function(){' + code + '\n}};'; info.handlers++; break;
        case 'key': js = '__H.key[' + protect(b.m[1]).code + '] = {' + meta + 'name:' + JSON.stringify('on key ' + b.m[1]) + ', fn:function(){' + code + '\n}};'; info.handlers++; break;
        case 'signal': js = '__H.sig.push({' + meta + 'sig:' + JSON.stringify(b.m[2]) + ', update:' + (b.m[1] === 'signal_update') + ', name:"on ' + b.m[1] + ' ' + b.m[2] + '", fn:function(){' + code + '\n}});'; info.handlers++; break;
        case 'testcase': js = 'async function ' + b.m[1] + '(' + params(b.m[2]) + '){ __tcBegin("' + b.m[1] + '"); try {' + code + '\n} finally { __tcEnd(); } }'; info.tests.push(b.m[1]); break;
        case 'main': hasMain = true; js = 'async function MainTest(){' + code + '\n}'; break;
        case 'fn': js = (asyncSet[b.m[1]] ? 'async ' : '') + 'function ' + b.m[1] + '(' + params(b.m[2]) + '){' + code + '\n}'; break;
      }
      if (js) pieces.push({ js: js, b: b });
    });
    var names = API_NAMES || (API_NAMES = Object.keys(makeApi({}, [])));
    var body = pieces.map(function (x) { return x.js; }).join('\n') + '\nreturn { MainTest: ' + (hasMain ? 'MainTest' : 'null') + ' };';
    var factory;
    try { factory = new Function(names.join(','), body); }
    catch (e) {
      for (var q = 0; q < pieces.length; q++) {
        try { new Function(names.join(','), pieces[q].js); }
        catch (e2) {
          var b = pieces[q].b, label = b.type === 'vars' ? 'variables' : b.m[0].replace(/\s*\{$/, '');
          throw new CaplError('Error in "' + label + '" (starts at line ' + b.line + '): ' + e2.message + '. Check for a missing ; or ), or a wrong name.', b.line);
        }
      }
      throw new CaplError(e.message, null);
    }
    return { src: src, factory: factory, names: names, hasMain: hasMain, info: info };
  }

  /* ================= CAPL: runtime ================= */
  var PROG = null, RUN = null, TEST = null, WAITERS = [];
  function makeApi(H, timers) {
    function wait(ms) {
      return new Promise(function (res, rej) {
        setTimeout(function () { if (TEST && TEST.aborted) rej(new Error('the measurement was stopped')); else res(); }, Math.max(0, Number(ms) || 0));
      });
    }
    function waitMsg(key, ms) {
      var id = keyToId(String(key));
      return new Promise(function (res) {
        var w = { id: id, res: res };
        WAITERS.push(w);
        setTimeout(function () { var i = WAITERS.indexOf(w); if (i >= 0) { WAITERS.splice(i, 1); res(0); } }, Math.max(0, Number(ms) || 0));
      });
    }
    function step(v, args) {
      args = [].slice.call(args);
      var id = '', text;
      if (args.length >= 2) { id = String(args[0]); text = fmt(args[1], args.slice(2)); } else text = fmt(args[0], []);
      var t = (S.now / 1000).toFixed(3);
      if (TEST && TEST.cur) TEST.cur.steps.push({ t: t, id: id, text: text, v: v });
      writeLine((v === 'pass' ? 'PASS ' : v === 'fail' ? 'FAIL ' : '') + (id ? '[' + id + '] ' : '') + text, v === 'info' ? 'capl' : v);
    }
    return {
      __H: H,
      __newMsg: function (k) { return new CMsg(k); },
      __newTimer: function (name, unit) { var t = { name: name, unit: unit, due: null }; timers.push(t); return t; },
      __arr: function (n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; },
      __sig: SIGP,
      write: function (f) { writeLine(fmt(f, [].slice.call(arguments, 1)), 'capl'); },
      output: function (m) {
        if (!m || !m.bytes) throw new Error('output() needs a message variable, e.g. message 0x123 m;');
        if (!S.running) return;
        enqueue(m.id, m.bytes.slice(0), 'Tx', 'CAPL', m.dlc);
      },
      setTimer: function (t, v) {
        if (!t || t.unit == null) throw new Error('setTimer() needs a timer variable, e.g. msTimer t;');
        t.due = S.now + Number(v) * t.unit;
      },
      cancelTimer: function (t) { if (t) t.due = null; },
      isTimerActive: function (t) { return t && t.due != null ? 1 : 0; },
      timeNow: function () { return Math.round(S.now * 100); },
      random: function (n) { return Math.floor(Math.random() * n); },
      abs: Math.abs, sqrt: Math.sqrt,
      elCount: function (a) { return a && a.length != null ? a.length : 0; },
      stop: function () { setTimeout(stopMeasurement, 0); },
      testCaseTitle: function (id, title) { if (TEST && TEST.cur) TEST.cur.title = title || id; },
      testCaseComment: function () { step('info', arguments); },
      testStep: function () { step('info', arguments); },
      testStepPass: function () { step('pass', arguments); },
      testStepFail: function () { step('fail', arguments); },
      TestWaitForTimeout: wait, testWaitForTimeout: wait,
      TestWaitForMessage: waitMsg, testWaitForMessage: waitMsg,
      __tcBegin: function (name) {
        if (!TEST) return;
        TEST.cur = { name: name, title: '', steps: [], verdict: 'pass' };
        TEST.cases.push(TEST.cur);
        writeLine('Test case ' + name + ' started', 'sys');
      },
      __tcEnd: function () {
        if (!TEST || !TEST.cur) return;
        var c = TEST.cur;
        c.verdict = c.steps.some(function (s) { return s.v === 'fail'; }) ? 'fail' : 'pass';
        writeLine('Test case ' + c.name + ': ' + c.verdict.toUpperCase(), c.verdict);
        TEST.cur = null;
      }
    };
  }
  function instantiate() {
    RUN = null;
    if (!PROG) return;
    var H = { start: [], stop: [], msg: [], timer: {}, key: {}, sig: [] }, timers = [];
    var api = makeApi(H, timers);
    try {
      var res = PROG.factory.apply(null, PROG.names.map(function (n) { return api[n]; }));
      RUN = { H: H, timers: timers, MainTest: res && res.MainTest };
    } catch (e) { writeLine('Error in variables { }: ' + e.message, 'err'); }
  }
  function runHandler(h, self) {
    if (h.errs > 3) return;
    try { h.fn.call(self); }
    catch (e) {
      h.errs++;
      writeLine('Error in "' + h.name + '" (line ' + h.line + '): ' + e.message + (h.errs > 3 ? ' (this block is now switched off)' : ''), 'err');
    }
  }
  function caplOnMessage(f) {
    if (!RUN || !RUN.H.msg.length) return;
    RUN.H.msg.forEach(function (h) {
      if (h.key !== '*' && keyToId(h.key) !== f.id) return;
      var m = new CMsg(f.id);
      m.bytes = f.data.slice(0); m.dlc = f.dlc; m.dir = f.dir === 'Tx' ? 1 : 0; m.time = Math.round(f.t * 100);
      runHandler(h, m);
    });
  }
  function caplOnSignal(name, v, prev) {
    if (!RUN || !RUN.H.sig.length) return;
    var same = v === prev || (isNaN(v) && isNaN(prev));
    RUN.H.sig.forEach(function (h) { if (h.sig === name && (h.update || !same)) runHandler(h, v); });
  }
  function runTimers() {
    if (!RUN) return;
    RUN.timers.forEach(function (t) {
      if (t.due != null && S.now >= t.due) {
        t.due = null;
        var h = RUN.H.timer[t.name];
        if (h) { F.timers++; runHandler(h, t); }
      }
    });
  }
  function msgWaiters(f) {
    for (var i = WAITERS.length - 1; i >= 0; i--) if (WAITERS[i].id === f.id) { var w = WAITERS.splice(i, 1)[0]; w.res(1); }
  }
  function pressKey(ch) {
    if (!ch) return false;
    if (!S.running) { writeLine('Key "' + ch + '": start the measurement first.', 'err'); return false; }
    if (!RUN) { writeLine('Key "' + ch + '": no compiled CAPL program is running.', 'err'); return false; }
    var h = RUN.H.key[ch.charCodeAt(0)];
    if (!h) { writeLine('Key "' + ch + '": your program has no  on key \'' + ch + '\'  block.', 'sys'); return false; }
    F.keyRan = true;
    runHandler(h, ch.charCodeAt(0));
    return true;
  }

  /* ================= CAPL editor ================= */
  var EXAMPLES = [
    { n: '1. Hello (on start, on key)', note: 'Press <b>Compile</b>, then <b>&#9889; Start</b>, then press the <b>h</b> key (or use "Press key" above). Watch the Write window.', c:
`/* Example 1: Hello CAPL
   A CAPL program is a set of blocks.
   Each block runs when its EVENT happens. */

on start
{
  write("Hello! The measurement has started.");
  write("Now press the h key.");
}

on key 'h'
{
  write("You pressed h. Time = %.1f s", timeNow() / 100000.0);
}
` },
    { n: '2. React to a message (raw vs phys)', note: 'Compile and Start. Every time OutsideTemp arrives (2 times per second) you see the raw number and the real value. Move the temperature slider.', c:
`/* Example 2: react to a message
   This block runs every time OutsideTemp (0x2B0) arrives.
   this.OutsideTemp       = raw value from the bytes
   this.OutsideTemp.phys  = real value (raw x factor + offset) */

on message OutsideTemp
{
  write("OutsideTemp: raw = %d, physical = %.1f C",
        this.OutsideTemp, this.OutsideTemp.phys);
}
` },
    { n: '3. Timer: ramp the speed', note: 'Compile and Start. Every second the speed goes up by 10 km/h until 120. Choose <b>VehicleSpeed</b> in Graphics to see the staircase.', c:
`/* Example 3: a timer
   Increase the speed by 10 km/h every second, from 0 to 120. */

variables
{
  msTimer rampTimer;
  float speed = 0;
}

on start
{
  $VehicleSpeed = 0;
  setTimer(rampTimer, 1000);
}

on timer rampTimer
{
  speed = speed + 10;
  $VehicleSpeed = speed;
  write("Speed set to %.0f km/h", speed);
  if (speed < 120)
  {
    setTimer(rampTimer, 1000);
  }
}
` },
    { n: '4. Build and send a message (output)', note: 'Compile and Start, then press <b>s</b>. Find ID <b>123</b> in the Trace (Tx). Click it: it cannot be decoded, because 0x123 is not in the DBC.', c:
`/* Example 4: build a message by hand and send it */

variables
{
  message 0x123 myMsg;
}

on key 's'
{
  myMsg.dlc = 2;
  myMsg.byte(0) = 0xAB;
  myMsg.byte(1) = 0xCD;
  output(myMsg);
  write("Sent 0x123 with data AB CD");
}

on message 0x123
{
  write("I see my own message on the bus: byte 0 = 0x%02X", this.byte(0));
}
` },
    { n: '5. Watch the cluster (read the DUT)', note: 'Compile and Start. Then change the temperature with the panel (&minus;0.1 / +0.1). CAPL tells you exactly when the cluster switches the snowflake.', c:
`/* Example 5: watch what the cluster (the real ECU) reports.
   The cluster sends ClusterStatus with its warning states. */

variables
{
  int lastSnow = -1;
}

on message ClusterStatus
{
  if (this.SnowflakeIcon != lastSnow)
  {
    lastSnow = this.SnowflakeIcon;
    write("Snowflake is now %s at %.1f C", lastSnow == 1 ? "ON" : "OFF", $OutsideTemp);
  }
}
` },
    { n: '6. Test module: snowflake BVA', note: 'Press <b>&#9654; Run test module</b>. It takes about 15 seconds. Then read the <b>Test report</b>. Try again with the bug "Snowflake turns ON at 5.0 \u00B0C" selected under the cluster.', c:
`/* Example 6: TEST MODULE - snowflake with boundary values.
   Requirement REQ-TMP-02: ON at 4.0 C or below,
   OFF at 5.0 C or above, no change in between. */

void checkSnow(float temp, int expected)
{
  $OutsideTemp = temp;
  TestWaitForTimeout(800);
  if ($SnowflakeIcon == expected)
    testStepPass("", "%.1f C: snowflake = %d (expected %d)", temp, $SnowflakeIcon, expected);
  else
    testStepFail("", "%.1f C: snowflake = %d (expected %d)", temp, $SnowflakeIcon, expected);
}

testcase TC_Snowflake_Cooling()
{
  testCaseTitle("TC-01", "Snowflake: getting colder");
  checkSnow(6.0, 0);
  checkSnow(5.1, 0);
  checkSnow(5.0, 0);
  checkSnow(4.1, 0);
  checkSnow(4.0, 1);
  checkSnow(3.9, 1);
}

testcase TC_Snowflake_Warming()
{
  testCaseTitle("TC-02", "Snowflake: getting warmer");
  checkSnow(3.0, 1);
  checkSnow(4.0, 1);
  checkSnow(4.9, 1);
  checkSnow(5.0, 0);
  checkSnow(5.1, 0);
}

void MainTest()
{
  $KL15 = 2;
  TestWaitForTimeout(500);
  TC_Snowflake_Cooling();
  TC_Snowflake_Warming();
}
` },
    { n: '7. Test module: speed and seatbelt', note: 'Press <b>&#9654; Run test module</b>. Then select the bug "speed 3 km/h too low" or "seatbelt never flashes" and run it again. The report shows which step fails.', c:
`/* Example 7: TEST MODULE - speed display and seatbelt lamp.
   REQ-SPD-01: show the speed rounded to whole km/h.
   REQ-BLT-01: lamp ON when unbuckled, FLASHING above 25 km/h. */

void checkSpeed(float kmh)
{
  $VehicleSpeed = kmh;
  TestWaitForTimeout(800);
  if ($DisplayedSpeed == kmh)
    testStepPass("", "Sent %.0f km/h, cluster shows %.0f km/h", kmh, $DisplayedSpeed);
  else
    testStepFail("", "Sent %.0f km/h, cluster shows %.0f km/h", kmh, $DisplayedSpeed);
}

testcase TC_SpeedDisplay()
{
  testCaseTitle("TC-03", "Speed display");
  checkSpeed(0);
  checkSpeed(1);
  checkSpeed(50);
  checkSpeed(199);
  checkSpeed(200);
}

testcase TC_SeatbeltFlashing()
{
  testCaseTitle("TC-04", "Seatbelt lamp flashes above 25 km/h");
  $SeatbeltDriver = 0;
  $VehicleSpeed = 25;
  TestWaitForTimeout(800);
  if ($SeatbeltLamp == 1)
    testStepPass("1", "25 km/h: lamp ON (steady)");
  else
    testStepFail("1", "25 km/h: lamp = %d, expected 1 (steady)", $SeatbeltLamp);
  $VehicleSpeed = 26;
  TestWaitForTimeout(800);
  if ($SeatbeltLamp == 2)
    testStepPass("2", "26 km/h: lamp FLASHING");
  else
    testStepFail("2", "26 km/h: lamp = %d, expected 2 (flashing)", $SeatbeltLamp);
  $SeatbeltDriver = 1;
  $VehicleSpeed = 0;
}

void MainTest()
{
  $KL15 = 2;
  TestWaitForTimeout(500);
  TC_SpeedDisplay();
  TC_SeatbeltFlashing();
}
` },
    { n: '8. Empty: write your own', note: 'Ideas: warn when the speed is above 120 (on message VehicleSpeed); open the driver door with a key ($DoorDriverOpen = 1); count how many ClusterStatus messages arrive.', c:
`/* Your own program */

variables
{
  int count = 0;
}

on start
{
  write("My program started");
}
` }
  ];
  function gutter(errLine) {
    var n = $('caplSrc').value.split('\n').length, h = '';
    for (var i = 1; i <= n; i++) h += (i === errLine ? '<span class="errl">' + i + '</span>' : i) + '\n';
    $('caplGutter').innerHTML = h;
    $('caplGutter').scrollTop = $('caplSrc').scrollTop;
  }
  function loadExample(i) {
    var ex = EXAMPLES[i];
    $('caplSrc').value = ex.c;
    $('caplHelp').innerHTML = '<div class="ex-note"><b>What to do:</b> ' + ex.note + '</div>';
    store('lab:code', ex.c);
    gutter();
    setCaplState(false);
  }
  function setCaplState(ok, text) {
    $('caplState').textContent = text || (ok ? 'compiled \u2713' : 'not compiled');
    $('caplState').style.color = ok ? 'var(--good)' : '';
  }
  function compileEditor() {
    var src = $('caplSrc').value;
    try {
      PROG = compileSource(src);
      gutter();
      var i = PROG.info;
      setCaplState(true);
      writeLine('Compiled OK: ' + i.handlers + ' event block(s)' + (i.tests.length ? ', ' + i.tests.length + ' test case(s)' : '') + (PROG.hasMain ? ', MainTest found' : '') + '.', 'pass');
      F.compiled = true;
      if (S.running) { writeLine('Like real CANoe: compiling stops the measurement. Press \u26A1 Start again.', 'sys'); stopMeasurement(); }
      return true;
    } catch (e) {
      PROG = null;
      setCaplState(false, 'error');
      gutter(e.line);
      writeLine('Compile error: ' + e.message, 'err');
      return false;
    }
  }
  function renderReport() {
    var box = $('winReport'), cases = TEST.cases;
    var failed = cases.filter(function (c) { return c.verdict === 'fail'; }).length;
    box.hidden = false;
    $('repVerdict').innerHTML = !cases.length ? 'no test cases ran' : failed ? '<span class="v-fail">FAILED</span>' : '<span class="v-pass">PASSED</span>';
    var h = '<p style="margin-top:0">Test module: <b>' + cases.length + '</b> test case(s), <b>' + (cases.length - failed) + '</b> passed, <b>' + failed + '</b> failed. Duration ' +
      ((Date.now() - TEST.started) / 1000).toFixed(1) + ' s. Cluster setting: ' + esc(S.bug === 'mystery' ? 'mystery bug (hidden)' : $('bugSel').selectedOptions[0].text) + '.</p>';
    if (TEST.error) h += '<p class="v-fail">Stopped early: ' + esc(TEST.error) + '</p>';
    cases.forEach(function (c) {
      h += '<div class="rep-case ' + c.verdict + '"><h4><span>' + esc(c.name) + (c.title ? ' &mdash; ' + esc(c.title) : '') + '</span><span class="v-' + c.verdict + '">' + c.verdict.toUpperCase() + 'ED</span></h4>' +
        '<div class="table-wrap" style="margin:0;border:0;border-radius:0"><table><tr><th>Time (s)</th><th>Step</th><th>Description</th><th>Result</th></tr>';
      c.steps.forEach(function (s, i) {
        h += '<tr><td>' + s.t + '</td><td>' + esc(s.id || String(i + 1)) + '</td><td>' + esc(s.text) + '</td><td class="v-' + s.v + '">' + (s.v === 'info' ? '&ndash;' : s.v.toUpperCase()) + '</td></tr>';
      });
      h += '</table></div></div>';
    });
    h += '<p class="small muted">In real CANoe, this report is saved as an HTML/XML file. Testers attach it to the test run in the test management tool (e.g. Xray or Polarion), and a failed step becomes a Jira bug with this report as evidence.</p>';
    $('repBody').innerHTML = h;
  }
  function runTestModule() {
    if (TEST && TEST.running) return;
    if (S.mode !== 'canoe') { writeLine('Test modules need CANoe. Switch the mode to CANoe.', 'err'); return; }
    if (!compileEditor()) return;
    if (!PROG.hasMain) { writeLine('No MainTest() found. A test module needs  void MainTest() { ... }  that calls your test cases. Load example 6 or 7.', 'err'); return; }
    startMeasurement();
    if (!RUN || !RUN.MainTest) return;
    TEST = { cases: [], cur: null, running: true, aborted: false, started: Date.now(), error: null };
    $('caplTest').disabled = true; $('caplCompile').disabled = true;
    writeLine('=== Test module started ===', 'sys');
    var main = RUN.MainTest;
    setTimeout(function () {
      main().catch(function (e) {
        TEST.error = e.message;
        writeLine('Test module stopped: ' + e.message, 'err');
        if (TEST.cur) { TEST.cur.steps.push({ t: (S.now / 1000).toFixed(3), id: '', text: 'Error: ' + e.message, v: 'fail' }); TEST.cur.verdict = 'fail'; TEST.cur = null; }
      }).then(function () {
        TEST.running = false;
        var failed = TEST.cases.filter(function (c) { return c.verdict === 'fail'; }).length;
        writeLine('=== Test module finished: ' + (TEST.cases.length ? (failed ? 'FAILED' : 'PASSED') : 'no test cases') + ' ===', failed ? 'fail' : 'pass');
        renderReport();
        F.testDone = true;
        $('caplTest').disabled = S.mode !== 'canoe'; $('caplCompile').disabled = false;
      });
    }, 600);
  }
  function wireEditor() {
    var ta = $('caplSrc'), sel = $('caplEx');
    sel.innerHTML = '<option value="">Choose an example&hellip;</option>' + EXAMPLES.map(function (e, i) { return '<option value="' + i + '">' + esc(e.n) + '</option>'; }).join('');
    sel.addEventListener('change', function () { if (this.value !== '') loadExample(+this.value); this.value = ''; });
    var saved = store('lab:code');
    if (saved) { ta.value = saved; $('caplHelp').innerHTML = '<div class="ex-note">Your last code was restored. Load an example to start fresh.</div>'; }
    else loadExample(0);
    gutter();
    ta.addEventListener('input', function () { gutter(); store('lab:code', ta.value); if (PROG) setCaplState(false, 'changed: compile again'); });
    ta.addEventListener('scroll', function () { $('caplGutter').scrollTop = ta.scrollTop; });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        gutter();
      }
    });
    $('caplCompile').addEventListener('click', compileEditor);
    $('caplTest').addEventListener('click', runTestModule);
    var bar = document.querySelector('.capl-bar');
    var ks = document.createElement('span');
    ks.className = 'keysim';
    ks.innerHTML = '<label for="keyIn">Press key:</label> <input id="keyIn" maxlength="1" value="h" size="2"> <button class="btn secondary" id="keyBtn" type="button">Press</button>';
    bar.appendChild(ks);
    $('keyBtn').addEventListener('click', function () { pressKey($('keyIn').value); });
    document.addEventListener('keydown', function (e) {
      var t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (S.running && RUN && RUN.H.key[e.key.charCodeAt(0)]) { e.preventDefault(); pressKey(e.key); }
    });
  }

  /* ================= Lessons ================= */
  var LESSONS = [
    { t: 'Start the measurement', b: 'Click the green <b>&#9889; Start</b> button. The bus comes alive: messages appear in the <b>Trace</b> and the cluster screen switches on.',
      r: 'In real CANoe: the lightning button in the toolbar, or press F9. Everything you see is also recorded.', ok: function () { return F.started; } },
    { t: 'Read the trace', b: 'In the <b>Trace</b>, find <b>VehicleSpeed</b> (ID <b>1A0</b>) and <b>click the line</b>. It opens and shows the signal inside: the raw number and the real value in km/h.',
      r: 'Testers read the trace every day to prove what the ECU received.', ok: function () { return F.exp1A0; } },
    { t: 'Change a signal with the panel', b: 'In the <b>Panel</b>, move <b>Vehicle speed</b> to <b>100 km/h</b>. Watch: (1) the data bytes of 1A0 turn yellow and become <code>10 27</code>, (2) the needle moves.<br>Why <code>10 27</code>? 100 km/h &divide; 0.01 (the factor) = 10000 = 0x<b>27</b><b>10</b>. The low byte is sent first: <b>10 27</b>.',
      r: 'In real CANoe the panel is built with the Panel Designer, or you use the signal-level "Interactive Generator".', ok: function () { return Math.abs((S.bus.VehicleSpeed || 0) - 100) < 0.6; } },
    { t: 'Ignition off and on', b: 'Click <b>OFF</b> at Ignition (KL15). The cluster goes dark and stops sending <b>ClusterStatus</b> (its time in the trace stops changing). Then click <b>ON</b> again.',
      r: 'Power-mode tests (KL15 off/on, sleep, wake-up) are a normal part of HMI testing.', ok: function () { return F.kl15Back; } },
    { t: 'Boundary test by hand: the snowflake', b: 'Read <b>REQ-TMP-02</b> under the cluster. Type <b>6.0</b> in the temperature box. Press <b>&minus;0.1</b> again and again: at which value does &#10052; appear? Then press <b>+0.1</b>: at which value does it disappear? You just did BVA in both directions.',
      r: 'This is exactly the snowflake interview question, done on a bench.', ok: function () { return F.snowOn && F.snowOff; } },
    { t: 'Break the sensor', b: 'In the Panel, open <b>Rest-bus</b> and untick <b>0x2B0 OutsideTemp</b>. The message stops. After 1.5 s the cluster must show <b>--.- &deg;C</b> (REQ-TMP-01). Tick it again: the value must come back. (Also try the SNA box.)',
      r: 'In real CANoe you deactivate a node or message in the simulation setup, or send SNA values.', ok: function () { return F.tempRecovered; } },
    { t: 'Watch a signal in Graphics', b: 'In <b>Graphics</b>, choose <b>OutsideTemp</b>. Move the temperature slider up and down. The line shows the history, like a heart monitor. Great for seeing flicker and jumps.',
      r: 'Graphics windows are used to check timing, ramps and signal jumps.', ok: function () {
        if ($('grSig').value !== 'OutsideTemp') return false;
        var h = (HIST.OutsideTemp || []).filter(function (p) { return p[0] > S.now - 20000 && !isNaN(p[1]); }).map(function (p) { return p[1]; });
        return h.length > 2 && Math.max.apply(null, h) - Math.min.apply(null, h) >= 1;
      } },
    { t: 'Send a frame by hand (IG)', b: 'In the <b>Interactive Generator</b>, choose the example <b>OutsideTemp = SNA</b> and press <b>Send once</b>. Find it in the trace (Tx). Did the cluster react? (The real sensor sends again 0.5 s later.)',
      r: 'The IG exists in both CANalyzer and CANoe.', ok: function () { return F.igSent; } },
    { t: 'Your first CAPL program', b: 'In the <b>CAPL Browser</b>, load example <b>1. Hello</b>. Press <b>Compile</b>, then <b>&#9889; Start</b>. Then press the <b>h</b> key (or type h in "Press key" and click Press). Look at the <b>Write</b> window.',
      r: 'In real CANoe, CAPL code is written in the CAPL Browser and added as a node in the Simulation Setup.', ok: function () { return F.keyRan; } },
    { t: 'A timer: ramp the speed', b: 'Load example <b>3. Timer</b>, press <b>Compile</b> and <b>&#9889; Start</b>. Every second CAPL raises the speed by 10 km/h. Choose <b>VehicleSpeed</b> in Graphics to see the staircase.',
      r: 'Timers are used for ramps, cyclic sending and delays.', ok: function () { return F.timers >= 3; } },
    { t: 'An automated test with a report', b: 'Load example <b>6. Test module: snowflake BVA</b>. Read the code: each step sets a temperature, waits, and checks the <b>SnowflakeIcon</b> signal from the cluster. Press <b>&#9654; Run test module</b> and wait about 15 seconds. Read the <b>Test report</b>.',
      r: 'This is how automated HMI tests work in CANoe: set inputs, wait, check outputs, report pass/fail.', ok: function () { return F.testDone; } },
    { t: 'Find the hidden bug', b: 'Under the cluster, choose <b>Mystery bug</b>. Now test like a tester: run test modules 6 and 7, use the panel, break the sensor, watch the trace. When you know the bug, choose your answer and press <b>Check</b>.',
      r: 'Finding, proving and reporting bugs is the job. Next step: write the Jira ticket for it!', ok: function () { return F.mysteryFound; } }
  ];
  var LS = { i: 0, done: {} };
  try { LS.i = Math.min(LESSONS.length - 1, parseInt(store('lab:lesson'), 10) || 0); LS.done = JSON.parse(store('lab:done') || '{}') || {}; } catch (e) { LS.done = {}; }
  function saveLessons() { store('lab:lesson', String(LS.i)); store('lab:done', JSON.stringify(LS.done)); }
  function renderLesson() {
    var L = LESSONS[LS.i], n = Object.keys(LS.done).length;
    $('lsCount').textContent = n + ' / ' + LESSONS.length + ' done';
    $('lsDots').innerHTML = LESSONS.map(function (x, i) {
      return '<button class="' + (LS.done[i] ? 'done ' : '') + (i === LS.i ? 'cur' : '') + '" data-i="' + i + '" aria-label="Lesson ' + (i + 1) + '">' + (LS.done[i] ? '\u2713' : i + 1) + '</button>';
    }).join('');
    $('lsTitle').textContent = 'Lesson ' + (LS.i + 1) + ' of ' + LESSONS.length + ': ' + L.t;
    $('lsBody').innerHTML = L.b;
    $('lsReal').innerHTML = '<b>Real life:</b> ' + L.r;
    var st = $('lsStatus');
    st.className = 'ls-status ' + (LS.done[LS.i] ? 'ok' : 'wait');
    st.textContent = LS.done[LS.i] ? '\u2713 Done! Click Next.' : 'Waiting for you\u2026';
    $('lsPrev').disabled = LS.i === 0;
    $('lsNext').disabled = LS.i === LESSONS.length - 1;
  }
  function checkLessons() {
    var changed = false;
    LESSONS.forEach(function (L, i) { if (!LS.done[i] && L.ok()) { LS.done[i] = 1; changed = true; } });
    if (changed) { saveLessons(); renderLesson(); }
  }
  function wireLessons() {
    $('lsPrev').addEventListener('click', function () { if (LS.i > 0) { LS.i--; saveLessons(); renderLesson(); } });
    $('lsNext').addEventListener('click', function () { if (LS.i < LESSONS.length - 1) { LS.i++; saveLessons(); renderLesson(); } });
    $('lsDots').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { LS.i = +b.getAttribute('data-i'); saveLessons(); renderLesson(); } });
    renderLesson();
  }

  /* ================= Bug practice ================= */
  var BUG_TEXT = { snow: 'the snowflake switches ON at 5.0 \u00B0C instead of 4.0 \u00B0C', speed: 'the shown speed is 3 km/h too low',
    timeout: 'the temperature freezes (old value stays) when the sensor message stops', belt: 'the seatbelt lamp never flashes above 25 km/h' };
  function wireBugs() {
    $('bugSel').addEventListener('change', function () {
      S.bug = this.value;
      $('guessBox').hidden = S.bug !== 'mystery';
      $('guessRes').textContent = '';
      if (S.bug === 'mystery') {
        var keys = Object.keys(BUG_TEXT);
        S.mystery = keys[Math.floor(Math.random() * keys.length)];
        writeLine('A hidden bug is now active in the cluster. Find it!', 'sys');
      } else writeLine(S.bug === 'none' ? 'Cluster works as specified (no bug).' : 'Bug active: ' + BUG_TEXT[S.bug] + '.', 'sys');
    });
    $('guessBtn').addEventListener('click', function () {
      var g = $('guessSel').value, res = $('guessRes');
      if (!g) { res.textContent = 'Choose an answer first.'; return; }
      if (g === S.mystery) {
        res.innerHTML = '<b class="v-pass">\u2713 Correct!</b> The bug: ' + esc(BUG_TEXT[S.mystery]) + '.';
        F.mysteryFound = true;
      } else res.innerHTML = '<b class="v-fail">\u2717 Not this one.</b> Keep testing: compare what you send with what the cluster shows.';
    });
  }

  /* ================= UI loop ================= */
  var uiCount = 0;
  function renderToolbar() {
    $('labTime').textContent = 't = ' + (S.now / 1000).toFixed(3) + ' s';
    var st = $('labState');
    st.textContent = S.running ? (TEST && TEST.running ? 'Test module running\u2026' : 'Measurement running') : 'Measurement stopped';
    st.className = 'lab-state' + (S.running ? ' run' : '');
    while (S.loadWin.length && S.loadWin[0] < S.now - 1000) S.loadWin.shift();
    var load = S.loadWin.length * 125 / 500000 * 100;
    $('labLoad').textContent = 'Bus load ' + load.toFixed(1) + '% (' + S.loadWin.length + ' msg/s)';
  }
  function renderAll() {
    renderToolbar();
    flushTrace();
    renderDut();
    if (uiCount % 2 === 0) drawGraph();
    checkLessons();
  }
  function uiLoop() { uiCount++; renderAll(); }

  /* ================= Init ================= */
  function init() {
    if (!$('labRoot')) return;
    buildGauge();
    wirePanel();
    wireIG();
    renderDb();
    wireEditor();
    wireLessons();
    wireBugs();
    var gs = $('grSig');
    gs.innerHTML = ['VehicleSpeed', 'OutsideTemp', 'FuelLevel', 'KL15', 'DisplayedSpeed', 'SnowflakeIcon', 'SeatbeltLamp']
      .map(function (n) { return '<option>' + n + '</option>'; }).join('');
    gs.addEventListener('change', drawGraph);
    $('btnStart').addEventListener('click', startMeasurement);
    $('btnStop').addEventListener('click', stopMeasurement);
    $('modeCanoe').addEventListener('click', function () { setMode('canoe'); });
    $('modeCanalyzer').addEventListener('click', function () { setMode('canalyzer'); });
    $('trBody').addEventListener('click', traceClick);
    $('trFixed').addEventListener('click', function () { setTraceMode('fixed'); });
    $('trScroll').addEventListener('click', function () { setTraceMode('scroll'); });
    $('trPause').addEventListener('click', function () { TR.paused = !TR.paused; this.classList.toggle('on', TR.paused); this.textContent = TR.paused ? 'Resume' : 'Pause'; });
    $('trClear').addEventListener('click', traceClear);
    $('trFilter').addEventListener('input', function () { TR.filter = this.value; refilter(); });
    $('wrClear').addEventListener('click', function () { $('wrBody').innerHTML = ''; });
    syncPanel();
    writeLine('Welcome to the mock CANoe lab. Start with lesson 1: press \u26A1 Start.', 'sys');
    renderAll();
    setInterval(uiLoop, 100);
    window.addEventListener('resize', drawGraph);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
