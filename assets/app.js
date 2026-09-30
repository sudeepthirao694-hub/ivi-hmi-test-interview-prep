/* Shared behaviour for every page: navigation, theme, progress, TOC, drills. */
(function () {
  var PAGES = [
    { file: 'index.html', title: 'Home & study plan', group: 'Start here' },
    { file: 'start.html', title: 'The job explained simply', group: 'Start here' },
    { file: 'visual.html', title: 'Learn with pictures', group: 'Start here' },
    { file: 'car-basics.html', title: 'Car electronics basics (ECU, CAN)', group: 'Foundations' },
    { file: 'hmi.html', title: 'HMI & IVI features', group: 'Foundations' },
    { file: 'testing-basics.html', title: 'Testing basics (ISTQB)', group: 'Foundations' },
    { file: 'test-design.html', title: 'Test design & BVA', group: 'Core skills' },
    { file: 'defects.html', title: 'Bugs, Jira & defect reports', group: 'Core skills' },
    { file: 'regression.html', title: 'Retest & regression', group: 'Core skills' },
    { file: 'automation.html', title: 'Automation execution', group: 'Core skills' },
    { file: 'tools-logs.html', title: 'Tools, traces & logs', group: 'Core skills' },
    { file: 'canoe-lab.html', title: 'CANoe & CAPL lab (mock)', group: 'Core skills' },
    { file: 'eye-tests.html', title: 'Spot-the-defect drills', group: 'Practice' },
    { file: 'questions.html', title: 'Interview Q&A (130)', group: 'Practice' },
    { file: 'quiz.html', title: 'Quiz & flashcards', group: 'Practice' },
    { file: 'final-prep.html', title: 'Final prep & self-intro', group: 'Practice' },
    { file: 'glossary.html', title: 'Dictionary A–Z', group: 'Reference' },
    { file: 'cheatsheet.html', title: 'One-page cheat sheet', group: 'Reference' }
  ];
  window.SITE_PAGES = PAGES;

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  window.siteStore = store;

  var here = document.body.getAttribute('data-page') || 'index.html';
  var idx = PAGES.findIndex(function (p) { return p.file === here; });

  function isDone(file) { return store('done:' + file) === '1'; }

  /* ---------- Sidebar ---------- */
  function buildSidebar() {
    var nav = document.getElementById('sidebar');
    if (!nav) return;
    var html = '';
    var doneCount = PAGES.filter(function (p) { return isDone(p.file); }).length;
    var pct = Math.round(doneCount / PAGES.length * 100);
    html += '<div class="progress-mini">Your progress: <b>' + doneCount + '/' + PAGES.length + '</b> pages<div class="bar" style="margin-top:6px"><div style="width:' + pct + '%"></div></div></div>';
    var lastGroup = '';
    PAGES.forEach(function (p, i) {
      if (p.group !== lastGroup) { html += '<div class="group">' + p.group + '</div>'; lastGroup = p.group; }
      var cls = (p.file === here ? 'active ' : '') + (isDone(p.file) ? 'done' : '');
      html += '<a class="' + cls + '" href="' + p.file + '"><span class="num">' + (isDone(p.file) ? '✓' : i) + '</span><span>' + p.title + '</span></a>';
    });
    nav.innerHTML = html;
  }

  /* ---------- Theme ---------- */
  function applyThemeLabel() {
    var b = document.getElementById('themeBtn');
    if (!b) return;
    var t = store('theme') || 'auto';
    b.textContent = t === 'dark' ? '☾ Dark' : t === 'light' ? '☀ Light' : '◐ Auto';
  }
  function cycleTheme() {
    var t = store('theme') || 'auto';
    var next = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
    if (next === 'auto') { store('theme', null); document.documentElement.removeAttribute('data-theme'); }
    else { store('theme', next); document.documentElement.setAttribute('data-theme', next); }
    applyThemeLabel();
  }

  /* ---------- TOC ---------- */
  function buildToc() {
    var toc = document.getElementById('toc');
    if (!toc) return;
    var hs = document.querySelectorAll('article h2');
    if (!hs.length) { toc.remove(); return; }
    var html = '<b>On this page</b><ol>';
    hs.forEach(function (h, i) {
      if (!h.id) h.id = 's' + (i + 1) + '-' + h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      html += '<li><a href="#' + h.id + '">' + h.textContent.replace(/^\d+\.\s*/, '') + '</a></li>';
    });
    toc.innerHTML = html + '</ol>';
  }

  /* ---------- Done box + pager ---------- */
  function buildFooter() {
    var art = document.querySelector('article.content');
    if (!art || idx < 0) return;
    var box = document.createElement('label');
    box.className = 'done-box';
    box.innerHTML = '<input type="checkbox" id="doneChk"><span><b>I understood this page.</b> <span class="muted small">Tick it to track your progress (saved only in this browser).</span></span>';
    art.appendChild(box);
    var chk = box.querySelector('input');
    chk.checked = isDone(here);
    chk.addEventListener('change', function () { store('done:' + here, chk.checked ? '1' : null); buildSidebar(); });
    var pager = document.createElement('div');
    pager.className = 'pager';
    var prev = PAGES[idx - 1], next = PAGES[idx + 1];
    pager.innerHTML = (prev ? '<a href="' + prev.file + '"><small>← Previous</small>' + prev.title + '</a>' : '<span></span>') +
      (next ? '<a class="next" href="' + next.file + '"><small>Next →</small>' + next.title + '</a>' : '<span></span>');
    art.appendChild(pager);
  }

  /* ---------- Drills: answer toggles and timers ---------- */
  function wireDrills() {
    document.querySelectorAll('[data-toggle-answers]').forEach(function (btn) {
      var target = document.querySelector(btn.getAttribute('data-toggle-answers'));
      if (!target) return;
      var showText = btn.textContent;
      btn.addEventListener('click', function () {
        var on = target.classList.toggle('show-answers');
        btn.textContent = on ? 'Hide answers' : showText;
      });
    });
    document.querySelectorAll('[data-timer]').forEach(function (btn) {
      var secs = parseInt(btn.getAttribute('data-timer'), 10);
      var out = document.querySelector(btn.getAttribute('data-timer-out'));
      var handle = null;
      btn.addEventListener('click', function () {
        if (handle) { clearInterval(handle); handle = null; btn.textContent = 'Start timer'; return; }
        var left = secs;
        btn.textContent = 'Stop timer';
        var tick = function () {
          var m = Math.floor(left / 60), s = left % 60;
          if (out) out.textContent = m + ':' + (s < 10 ? '0' : '') + s;
          if (left <= 0) { clearInterval(handle); handle = null; btn.textContent = 'Start timer'; if (out) out.textContent = 'Time up! Check the answers.'; }
          left--;
        };
        tick();
        handle = setInterval(tick, 1000);
      });
    });
    document.querySelectorAll('[data-expand]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('data-expand') === 'all';
        document.querySelectorAll('details.qa').forEach(function (d) { d.open = open; });
      });
    });
    var rq = document.getElementById('randomQ');
    if (rq) {
      rq.addEventListener('click', function () {
        var all = Array.prototype.slice.call(document.querySelectorAll('details.qa'));
        all.forEach(function (d) { d.open = false; d.style.outline = ''; });
        var pick = all[Math.floor(Math.random() * all.length)];
        pick.style.outline = '3px solid var(--accent)';
        pick.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  /* ---------- Open a linked Q&A (e.g. questions.html#q-process) ---------- */
  function openHashTarget() {
    if (!location.hash) return;
    var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!el) return;
    var d = el.closest('details');
    if (d) { d.open = true; d.style.outline = '3px solid var(--accent)'; }
    el.scrollIntoView({ block: 'start' });
  }

  /* ---------- Word help: dotted words show a simple meaning when tapped ---------- */
  var SKIP = 'a,code,pre,svg,button,summary,h1,h2,h3,h4,th,input,select,textarea,label,script,style,' +
    '.w,.toc,.term,.flash,.opts,.pager,.done-box,.score,.chips,.page-kicker,.meta-row,.shot,.word-hint,.no-wordhelp';

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function byLen(a, b) { return b.length - a.length; }

  function loadWords(cb) {
    if (window.WORDS) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'assets/words.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  var tipEl = null;
  function showTip(el) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.id = 'wtip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    tipEl.innerHTML = '<b></b><span></span>';
    tipEl.firstChild.textContent = el.getAttribute('data-word');
    tipEl.lastChild.textContent = el.getAttribute('data-tip');
    tipEl.style.display = 'block';
    var r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  function wireTips() {
    document.addEventListener('click', function (e) {
      var w = e.target.closest ? e.target.closest('.w') : null;
      if (w) showTip(w); else hideTip();
    });
    document.addEventListener('mouseover', function (e) {
      var w = e.target.closest ? e.target.closest('.w') : null;
      if (w) showTip(w);
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('.w')) hideTip();
    });
    document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('w')) showTip(e.target); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  /* Wraps the first use of each hard word in every section (h2) and every Q&A. */
  function wordHelp(root) {
    var art = root || document.querySelector('article.content');
    if (!art || store('wordhelp') === 'off') return 0;
    var ci = {}, cs = {};
    (window.WORDS || []).concat(window.TIPS || []).forEach(function (w) {
      var forms = w.length > 3 ? w.slice(3) : [w[0]];
      forms.forEach(function (f) { ci[f.toLowerCase()] = { key: w[0], tip: w[1] }; });
    });
    var TC = window.TIPS_CS || {};
    Object.keys(TC).forEach(function (k) { cs[k] = { key: k, tip: TC[k] }; });
    var reCI = new RegExp('\\b(' + Object.keys(ci).sort(byLen).map(escRe).join('|') + ')\\b', 'gi');
    var reCS = new RegExp('\\b(' + Object.keys(cs).sort(byLen).map(escRe).join('|') + ')\\b', 'g');
    var count = 0, seen = {};

    function doBlock(block, seenSet) {
      if (block.matches && block.matches(SKIP)) return;
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = n.parentElement;
          return p && !p.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        var text = node.nodeValue, hits = [];
        [reCI, reCS].forEach(function (re) {
          re.lastIndex = 0;
          var m;
          while ((m = re.exec(text))) {
            var x = re === reCS ? cs[m[1]] : ci[m[1].toLowerCase()];
            if (x) hits.push({ i: m.index, s: m[1], x: x });
          }
        });
        if (!hits.length) return;
        hits.sort(function (a, b) { return a.i - b.i || b.s.length - a.s.length; });
        var frag = document.createDocumentFragment(), pos = 0, used = false;
        hits.forEach(function (h) {
          if (h.i < pos || seenSet[h.x.key]) return;
          seenSet[h.x.key] = 1;
          used = true;
          frag.appendChild(document.createTextNode(text.slice(pos, h.i)));
          var sp = document.createElement('span');
          sp.className = 'w';
          sp.tabIndex = 0;
          sp.setAttribute('data-word', h.x.key);
          sp.setAttribute('data-tip', h.x.tip);
          sp.textContent = h.s;
          frag.appendChild(sp);
          pos = h.i + h.s.length;
          count++;
        });
        if (!used) return;
        frag.appendChild(document.createTextNode(text.slice(pos)));
        node.parentNode.replaceChild(frag, node);
      });
    }

    if (root) { doBlock(root, {}); return count; }
    Array.prototype.forEach.call(art.children, function (child) {
      if (child.tagName === 'H2') { seen = {}; return; }
      if (child.tagName === 'DETAILS') { doBlock(child, {}); return; }
      doBlock(child, seen);
    });
    return count;
  }
  window.siteWordHelp = function (root) { if (window.WORDS) wordHelp(root); };

  function addWordToggle() {
    var tb = document.getElementById('themeBtn');
    if (!tb) return;
    var on = store('wordhelp') !== 'off';
    var b = document.createElement('button');
    b.className = 'icon-btn';
    b.id = 'wordBtn';
    b.title = 'Word help: tap a dotted word to see a simple meaning';
    b.setAttribute('aria-label', 'Word help ' + (on ? 'on' : 'off'));
    b.innerHTML = '<span aria-hidden="true">Aa</span><span class="lbl">Word help</span><b>' + (on ? 'ON' : 'OFF') + '</b>';
    b.addEventListener('click', function () { store('wordhelp', on ? 'off' : null); location.reload(); });
    tb.parentNode.insertBefore(b, tb);
  }

  function addWordHint() {
    if (store('wordhint') === 'x') return;
    var lead = document.querySelector('article.content .lead');
    if (!lead) return;
    var d = document.createElement('div');
    d.className = 'word-hint';
    d.innerHTML = '<span><b>Word help:</b> words with a <span class="w-demo">dotted line</span> are hard words. <b>Tap them</b> to see a simple meaning. Turn it off with the <b>Aa</b> button at the top.</span><button aria-label="Close">&times;</button>';
    d.querySelector('button').addEventListener('click', function () { store('wordhint', 'x'); d.remove(); });
    lead.parentNode.insertBefore(d, lead.nextSibling);
  }

  /* ---------- Mobile menu ---------- */
  function wireMenu() {
    var mb = document.getElementById('menuBtn');
    var ov = document.getElementById('overlay');
    if (mb) mb.addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
    if (ov) ov.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var kick = document.querySelector('.page-kicker');
    if (kick && idx > 0 && PAGES[idx].group !== 'Reference') kick.textContent = 'Chapter ' + idx + ' · ' + PAGES[idx].group;
    buildSidebar();
    applyThemeLabel();
    var tb = document.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', cycleTheme);
    buildToc();
    buildFooter();
    wireDrills();
    wireMenu();
    addWordToggle();
    if (store('wordhelp') !== 'off' && here !== 'glossary.html') {
      loadWords(function () { if (wordHelp() > 0) addWordHint(); });
      wireTips();
    }
    openHashTarget();
    window.addEventListener('hashchange', openHashTarget);
    var nav = document.getElementById('sidebar');
    var active = document.querySelector('.sidebar a.active');
    if (nav && active) nav.scrollTop = Math.max(0, active.offsetTop - nav.clientHeight / 2);
  });
})();
