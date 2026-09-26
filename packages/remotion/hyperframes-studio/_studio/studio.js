// Studio Engine helpers for HyperFrames blocks (GSAP paused timelines, seekable to any time).
// Text markup in variables: *gold*, ~red~, _muted_ (whole words); lines separated by "|".
(function () {
  var S = {};

  S.vars = function (defaults) {
    var v = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
    var out = {};
    var k;
    for (k in defaults) out[k] = defaults[k];
    for (k in window.__hfVariables || {}) out[k] = window.__hfVariables[k];
    for (k in v) if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k];
    return out;
  };
  S.num = function (v, d) {
    var n = Number(v);
    return v === '' || v === null || v === undefined || !isFinite(n) ? d : n;
  };
  S.nums = function (v) {
    if (Array.isArray(v)) return v.map(Number);
    return v === undefined || v === null || v === '' ? [] : String(v).split(',').map(function (s) { return Number(s.trim()); });
  };
  S.strs = function (v, sep) {
    if (Array.isArray(v)) return v.map(String);
    return v === undefined || v === null || v === '' ? [] : String(v).split(sep || ',').map(function (s) { return s.trim(); });
  };
  /** Public-root-relative path (e.g. "mcd/counter.png") from a block page at hyperframes/blocks/<name>/. */
  S.asset = function (p) {
    return /^(https?:|data:|\/)/.test(p) ? p : '../../../' + p;
  };

  /** Root, paused timeline registered for the runtime, padded to the duration. */
  S.setup = function (id, duration) {
    var root = document.querySelector('[data-composition-id="' + id + '"]');
    root.setAttribute('data-duration', String(duration));
    var tl = gsap.timeline({ paused: true });
    tl.set({}, {}, duration);
    window.__timelines = window.__timelines || {};
    window.__timelines[id] = tl;
    return { root: root, tl: tl };
  };

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  S.el = el;

  /** Word markup → { text, cls }. */
  function parseWord(w) {
    var m = w.match(/^([^*~_]*)([*~_])(.+)\2([^*~_]*)$/);
    if (!m) return { text: w, cls: '' };
    return { pre: m[1], text: m[3], post: m[4], cls: m[2] === '*' ? 'gold' : m[2] === '~' ? 'red' : 'muted' };
  }
  /** Splits "*real estate*" into words that each keep the markup. */
  function tokens(line) {
    var out = [];
    var re = /([*~_])([^*~_]+)\1|(\S+)/g;
    var m;
    while ((m = re.exec(line))) {
      if (m[3]) out.push(m[3]);
      else m[2].trim().split(/\s+/).forEach(function (w) { out.push(m[1] + w + m[1]); });
    }
    return out;
  }

  /** Reveal: blur → sharp, rising, expo ease. */
  S.reveal = function (tl, targets, at, o) {
    o = o || {};
    tl.fromTo(
      targets,
      { opacity: 0, y: o.y === undefined ? '0.32em' : o.y, filter: 'blur(' + (o.blur === undefined ? 16 : o.blur) + 'px)', scale: o.scale || 1 },
      { opacity: 1, y: 0, filter: 'blur(0px)', scale: 1, duration: o.duration || 0.8, ease: o.ease || 'expo.out', stagger: o.stagger || 0 },
      at
    );
  };
  S.hide = function (tl, targets, at, o) {
    o = o || {};
    tl.to(targets, { opacity: 0, y: o.y === undefined ? '-0.12em' : o.y, filter: 'blur(12px)', duration: o.duration || 0.45, ease: 'power2.in', stagger: o.stagger || 0.015 }, at);
  };

  /**
   * Title from variables: text ("line|line"), sizes ("150,150"), cues (one time per word,
   * optional), start, stagger, position (center|left|bottom|top-left), kicker, kickerAt,
   * strike (word index), strikeAt, exitAt, soft (line indexes drawn in weight 600).
   */
  S.title = function (parent, tl, v) {
    var box = el('div', 'st-title ' + (v.position || 'center'), parent);
    if (v.kicker) {
      var k = el('div', 'st-kicker', box);
      k.textContent = v.kicker;
      S.reveal(tl, k, S.num(v.kickerAt, 0.1), { blur: 8, y: '0.4em' });
    }
    var lines = String(v.text || '').split('|');
    var sizes = S.nums(v.sizes);
    var soft = S.nums(v.soft);
    var words = [];
    lines.forEach(function (line, li) {
      var le = el('div', 'st-line' + (soft.indexOf(li) >= 0 ? ' soft' : ''), box);
      le.style.fontSize = (sizes[li] || sizes[0] || 140) + 'px';
      tokens(line).forEach(function (t) {
        var p = parseWord(t);
        var w = el('span', 'st-word', le);
        if (p.pre) w.appendChild(document.createTextNode(p.pre));
        var inner = el('span', p.cls, w);
        inner.textContent = p.text;
        if (p.post) w.appendChild(document.createTextNode(p.post));
        words.push(w);
      });
    });
    var cues = S.nums(v.cues);
    var start = S.num(v.start, 0.15);
    var stagger = S.num(v.stagger, 0.07);
    words.forEach(function (w, i) {
      var at = cues.length ? (cues[i] !== undefined ? cues[i] : cues[cues.length - 1] + (i - cues.length + 1) * stagger) : start + i * stagger;
      S.reveal(tl, w, Math.max(0, at - 0.06), { duration: 0.85 });
    });
    if (v.strike !== undefined && v.strike !== '' && words[S.num(v.strike, -1)]) {
      var target = words[S.num(v.strike, -1)];
      var line = el('span', 'st-strike', target);
      var sAt = S.num(v.strikeAt, 1);
      tl.to(line, { scaleX: 1, duration: 0.42, ease: 'power3.inOut' }, sAt);
      tl.to(target.querySelector('span'), { opacity: 0.38, duration: 0.3, ease: 'power1.out' }, sAt + 0.2);
    }
    if (v.exitAt !== undefined && v.exitAt !== '') S.hide(tl, box.children, S.num(v.exitAt, 99));
    return { box: box, words: words };
  };

  /** Ambient warm light behind the content, drifting slowly. */
  S.glow = function (parent, tl, duration, at) {
    var g = el('div', 'st-glow', parent);
    tl.fromTo(g, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 1.6, ease: 'power2.out' }, at || 0);
    tl.fromTo(g, { x: -60 }, { x: 60, duration: duration, ease: 'sine.inOut' }, 0);
    return g;
  };

  /** Counts a number into `node` between two times. */
  S.count = function (tl, node, o) {
    var fmt = function (x) {
      var d = o.decimals || 0;
      var s = x.toFixed(d);
      if (o.separator) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, o.separator);
      return (o.prefix || '') + s + (o.suffix || '');
    };
    var proxy = { v: o.from || 0 };
    node.textContent = fmt(proxy.v);
    tl.fromTo(proxy, { v: o.from || 0 }, { v: o.to, duration: o.duration || 1.2, ease: o.ease || 'expo.out', onUpdate: function () { node.textContent = fmt(proxy.v); } }, o.at || 0);
    return fmt;
  };

  S.source = function (parent, tl, text, at) {
    if (!text) return;
    var s = el('div', 'st-source', parent);
    s.textContent = text;
    tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.out' }, at || 0.4);
  };

  window.Studio = S;
})();
