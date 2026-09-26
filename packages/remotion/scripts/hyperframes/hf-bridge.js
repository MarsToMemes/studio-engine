// Studio Engine bridge, injected at the head of every HyperFrames page, before the runtime.
// Mirrors what the HyperFrames producer injects (packages/producer/src/services/fileServer.ts,
// Apache-2.0): render-capture flag, variables, and the window.__hf = { duration, seek } protocol
// mapped onto the runtime's window.__player.
(function () {
  globalThis.__HF_RENDER_CAPTURE_MODE = true;
  try {
    var raw = new URLSearchParams(location.search).get('hfv');
    if (raw) window.__hfVariables = JSON.parse(raw);
  } catch (e) {
    console.error('[hf-bridge] bad variables', e);
  }
  // Snippets (data-composition-src) measure their text when they mount: hold the snippet
  // fetch until every declared font face has loaded, so the layout uses the real fonts.
  function fontsSettled() {
    if (!document.fonts) return Promise.resolve();
    var loads = [];
    document.fonts.forEach(function (face) {
      if (face.status === 'unloaded') loads.push(face.load().catch(function () {}));
    });
    return Promise.all(loads).then(function () { return document.fonts.ready; });
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var response = realFetch(input, init);
    if (!/\.html(\?|#|$)/.test(url)) return response;
    return response.then(function (res) {
      return fontsSettled().then(function () { return res; });
    });
  };
  function declaredDuration() {
    var root = document.querySelector('[data-composition-id]');
    var d = root ? Number(root.getAttribute('data-duration')) : 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  function install() {
    var p = window.__player;
    if (!p || typeof p.renderSeek !== 'function' || typeof p.getDuration !== 'function') return false;
    var hf = window.__hf || {};
    Object.defineProperty(hf, 'duration', {
      configurable: true,
      enumerable: true,
      get: function () {
        if (window.__hfTimelinesBuilding || !window.__renderReady) return 0;
        var d = p.getDuration();
        return d > 0 ? d : declaredDuration();
      },
    });
    hf.seek = function (t, options) {
      p.renderSeek(Math.max(0, Number(t) || 0), options);
    };
    window.__hf = hf;
    return true;
  }
  var iv = setInterval(function () {
    if (install()) clearInterval(iv);
  }, 20);
})();
