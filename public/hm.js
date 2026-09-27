// In-house heatmap tracker (Justin, 2026-09-27) -- see src/pages/api/hm.ts
// for where this goes and src/pages/admin/heatmap.astro for the viewer.
//
// Records, per page view: where clicks land, how long each 100px band of
// the page is on screen (attention), and how far down the visitor got.
// Never records anything typed, form values, or who the visitor is. Skips
// Do Not Track, automated browsers, and the admin viewer's own iframe.
(function () {
  if (navigator.doNotTrack === '1' || navigator.webdriver || window.top !== window.self) return;
  if (!navigator.sendBeacon) return;

  var BAND = 100; // px per attention band
  var device = window.innerWidth < 768 ? 'm' : 'd';
  var clicks = [];
  var bands = {};
  var maxDepth = 0;
  var visibleSecs = 0;
  var lastActive = Date.now();
  var firstSend = true;
  // Ties together the several sends one page view can make (tab switches),
  // so the rollup counts its view and scroll depth once.
  var viewId = Math.random().toString(36).slice(2, 12);

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
    clicks.push([Math.round(e.pageX), Math.round(e.pageY), labelFor(e.target)]);
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
    };
    if (navigator.sendBeacon('/api/hm', JSON.stringify(payload))) {
      firstSend = false;
      clicks = [];
      bands = {};
      visibleSecs = 0;
    }
  }

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);
})();
