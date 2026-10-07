// In-house heatmap tracker (Justin, 2026-09-27) -- see src/pages/api/hm.ts
// for where this goes and src/pages/admin/heatmap.astro for the viewer.
//
// Records, per page view: where clicks land, how long each 100px band of
// the page is on screen (attention), how far down the visitor got, how fast
// the page loaded and responded for them,
// tagged with an anonymous visit id so one visit's pages can be shown in
// order. Never records anything typed, form values, or who the visitor is. Skips
// Do Not Track, automated browsers, and the admin viewer's own iframe.
//
// Opt-out for Justin, Smile and anyone testing the site: open any page with
// ?hm=off once and this browser is never tracked again (?hm=on undoes it).
// Visits from the Philippines (Smile) are also dropped server-side, in api/hm.ts.
(function () {
  try {
    if (/[?&]hm=off\b/.test(location.search)) localStorage.setItem('hm_off', '1');
    if (/[?&]hm=on\b/.test(location.search)) localStorage.removeItem('hm_off');
    if (localStorage.getItem('hm_off')) return;
  } catch (e) {
    // storage blocked (private mode) -- carry on
  }
  if (navigator.doNotTrack === '1' || navigator.webdriver || window.top !== window.self) return;
  if (!navigator.sendBeacon) return;

  var BAND = 100; // px per attention band
  var device = window.innerWidth < 768 ? 'm' : 'd';
  var loadedAt = Date.now();

  // Anonymous visit id, so the session viewer can show one visitor's pages
  // in order (Justin, 2026-09-28). A random string, kept in this browser
  // only, and replaced after 30 minutes of no activity -- it never
  // identifies the person.
  var sessionId = (function () {
    var fresh = Math.random().toString(36).slice(2, 12);
    try {
      var saved = (localStorage.getItem('hm_s') || '').split('|');
      var id = saved[0] && Date.now() - Number(saved[1]) < 30 * 60000 ? saved[0] : fresh;
      localStorage.setItem('hm_s', id + '|' + Date.now());
      return id;
    } catch (e) {
      return fresh;
    }
  })();
  function touchSession() {
    try { localStorage.setItem('hm_s', sessionId + '|' + Date.now()); } catch (e) { /* storage blocked */ }
  }

  // Where this page view came from: another site's name (never the full
  // address), and any campaign tag on the link.
  var ref = '';
  try {
    var rh = document.referrer ? new URL(document.referrer).hostname : '';
    if (rh && rh !== location.hostname) ref = rh.replace(/^www\./, '');
  } catch (e) { /* bad referrer */ }
  var cp = new URLSearchParams(location.search);
  var campaign = [cp.get('utm_source'), cp.get('utm_campaign')].filter(Boolean).join(' / ') || (cp.get('gclid') ? 'Google Ads' : '');

  var clicks = [];
  var bands = {};
  var maxDepth = 0;
  var visibleSecs = 0;
  var lastActive = Date.now();
  var firstSend = true;
  // Ties together the several sends one page view can make (tab switches),
  // so the rollup counts its view and scroll depth once.
  var viewId = Math.random().toString(36).slice(2, 12);

  // Real-world speed for this page view (2026-09-29), the three numbers
  // Google judges pages on: LCP (how long until the main content showed),
  // INP (the slowest response to a tap or click, roughly) and CLS (how much
  // the layout jumped around). Sent with the page view's first beacon.
  var perf = { lcp: 0, inp: 0, cls: 0 };
  function observe(type, fn, opts) {
    try {
      new PerformanceObserver(function (list) { list.getEntries().forEach(fn); }).observe(Object.assign({ type: type, buffered: true }, opts || {}));
    } catch (e) { /* not supported in this browser */ }
  }
  // A page opened in a background tab paints its main content only once it's
  // looked at, so its LCP measured the time it sat unseen (listing pages read
  // 28-30s on 2026-10-06). Same rule as Google's web-vitals: ignore anything
  // after the page was first hidden.
  var firstHidden = document.visibilityState === 'hidden' ? 0 : Infinity;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') firstHidden = Math.min(firstHidden, performance.now()); }, true);
  observe('largest-contentful-paint', function (e) { if (e.startTime < firstHidden) perf.lcp = Math.round(e.startTime); });
  observe('event', function (e) { if (e.interactionId && e.duration > perf.inp) perf.inp = Math.round(e.duration); }, { durationThreshold: 40 });
  observe('layout-shift', function (e) { if (!e.hadRecentInput) perf.cls += e.value; });

  function docW() { return document.documentElement.clientWidth || window.innerWidth; }
  function docH() { return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight); }

  // What was clicked, in words: a link or button's text (or aria-label),
  // otherwise just the kind of thing -- clicks on non-links are useful too
  // (people expecting a photo or heading to do something).
  function labelFor(el) {
    var t = el.closest && el.closest('a, button, [role="button"], summary, label');
    if (t) {
      var text = (t.getAttribute('aria-label') || t.innerText || t.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return (t.tagName === 'A' ? 'Link: ' : 'Button: ') + (text || (t.tagName === 'A' ? t.getAttribute('href') : '(no text)'));
    }
    if (el.closest && el.closest('input, select, textarea')) return 'Form field';
    if (el.tagName === 'IMG') return '(photo, not a link)';
    return '(not a link)';
  }

  document.addEventListener('click', function (e) {
    if (clicks.length >= 200) return;
    clicks.push([Math.round(e.pageX), Math.round(e.pageY), labelFor(e.target), Math.round((Date.now() - loadedAt) / 1000)]);
  }, true);

  ['scroll', 'pointermove', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
  });

  // Once a second, credit every band currently on screen -- but only while
  // the tab is visible and someone has moved/scrolled in the last 30s, so a
  // page left open in a background tab doesn't count as attention.
  setInterval(function () {
    if (document.visibilityState !== 'visible' || Date.now() - lastActive > 30000) return;
    visibleSecs++;
    var top = window.scrollY, bottom = top + window.innerHeight;
    if (bottom > maxDepth) maxDepth = bottom;
    for (var b = Math.floor(top / BAND); b * BAND < bottom; b++) bands[b] = (bands[b] || 0) + 1;
  }, 1000);

  function send() {
    if (visibleSecs < 1 && clicks.length === 0) return;
    var payload = {
      id: viewId,
      p: location.pathname,
      d: device,
      w: docW(),
      h: docH(),
      v: firstSend ? 1 : 0, // count the page view once, however many times we send
      c: clicks,
      a: bands,
      s: Math.round(maxDepth),
      t: visibleSecs,
      q: firstSend ? search : null,
      f: forms,
      sid: sessionId,
      st: loadedAt, // page opened; with n, lets the server place it in time whatever this device's clock says
      n: Date.now(),
      ti: firstSend ? document.title.slice(0, 100) : '',
      r: firstSend ? ref : '',
      u: firstSend ? campaign.slice(0, 80) : '',
      pf: firstSend && perf.lcp ? { l: perf.lcp, i: perf.inp, c: Math.round(perf.cls * 1000) / 1000 } : null,
    };
    touchSession();
    if (navigator.sendBeacon('/api/hm', JSON.stringify(payload))) {
      firstSend = false;
      clicks = [];
      bands = {};
      visibleSecs = 0;
    }
  }

  // /search filters in use (buyer demand). Free-text boxes (q, keyword) are
  // left out -- people type their own address there. Page 2+ of the same
  // search isn't counted again.
  var search = null;
  if (location.pathname.replace(/\/$/, '') === '/search') {
    var sp = new URLSearchParams(location.search);
    if (!sp.get('page') || sp.get('page') === '1') {
      search = {};
      ['area', 'minPrice', 'maxPrice', 'types', 'minBeds', 'minBaths'].forEach(function (k) {
        var v = sp.get(k);
        if (v) search[k] = v.slice(0, 80);
      });
      if (!Object.keys(search).length) search = null;
    }
  }

  // Forms people start but don't finish: which form, the last field they
  // were in, and whether they sent it. Never the values typed.
  var forms = {};
  function formName(f) {
    var n = f.querySelector('input[name="form-name"]');
    return ((n && n.value) || f.getAttribute('name') || f.id || 'form').slice(0, 40);
  }
  document.addEventListener('focusin', function (e) {
    var el = e.target, f = el && el.form;
    if (!f || !el.name || el.type === 'hidden' || el.name === 'bot-field') return;
    var k = formName(f);
    forms[k] = forms[k] || { s: 0 };
    forms[k].l = el.name.slice(0, 40);
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var k = formName(f);
    forms[k] = forms[k] || {};
    forms[k].s = 1;
  }, true);

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);
})();
