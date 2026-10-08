/* TitanLRS DS — tiny vanilla JS helpers. No dependencies. */
(function (global) {
  'use strict';

  // Inline SVG icon set — stroked, 16px, drawn on currentColor.
  const ICONS = {
    info:        '<circle cx="8" cy="8" r="6"/><path d="M8 7v4"/><circle cx="8" cy="5" r=".5" fill="currentColor"/>',
    link:        '<path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.5-.5"/>',
    sliders:     '<path d="M3 4h6"/><path d="M11 4h2"/><circle cx="10" cy="4" r="1.5"/><path d="M3 8h2"/><path d="M7 8h6"/><circle cx="6" cy="8" r="1.5"/><path d="M3 12h8"/><path d="M13 12"/><circle cx="12" cy="12" r="1.5"/>',
    radio:       '<path d="M3 11a5 5 0 0 1 10 0"/><path d="M5 11a3 3 0 0 1 6 0"/><circle cx="8" cy="11" r="1" fill="currentColor"/>',
    serial:      '<rect x="2" y="5" width="12" height="6" rx="1"/><circle cx="5" cy="8" r=".5" fill="currentColor"/><circle cx="7" cy="8" r=".5" fill="currentColor"/><circle cx="9" cy="8" r=".5" fill="currentColor"/><circle cx="11" cy="8" r=".5" fill="currentColor"/>',
    wifi:        '<path d="M2 6.5a9 9 0 0 1 12 0"/><path d="M4 9a6 6 0 0 1 8 0"/><path d="M6 11.5a3 3 0 0 1 4 0"/><circle cx="8" cy="13" r=".5" fill="currentColor"/>',
    upload:      '<path d="M8 11V3"/><path d="M5 6l3-3 3 3"/><path d="M3 11v2h10v-2"/>',
    download:    '<path d="M8 3v8"/><path d="M5 8l3 3 3-3"/><path d="M3 13h10"/>',
    cpu:         '<rect x="4" y="4" width="8" height="8" rx="1"/><rect x="6" y="6" width="4" height="4"/><path d="M2 6h2M2 10h2M12 6h2M12 10h2M6 2v2M10 2v2M6 12v2M10 12v2"/>',
    layers:      '<path d="M8 2 1 6l7 4 7-4-7-4z"/><path d="M1 10l7 4 7-4"/>',
    settings:    '<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/>',
    activity:    '<path d="M2 8h3l2-5 2 10 2-5h3"/>',
    chevron:     '<path d="M6 4l4 4-4 4"/>',
    chevronDown: '<path d="M4 6l4 4 4-4"/>',
    plus:        '<path d="M8 3v10M3 8h10"/>',
    search:      '<circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/>',
    bell:        '<path d="M3 11h10l-1.5-2V6a3.5 3.5 0 0 0-7 0v3z"/><path d="M6 13a2 2 0 0 0 4 0"/>',
    keyboard:    '<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 10h6M4 7h.01M7 7h.01M10 7h.01M13 7h.01"/>',
    sidebar:     '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>',
    home:        '<path d="M2 8l6-5 6 5v6H2z"/><path d="M6 14V9h4v5"/>',
    box:         '<path d="M2 5l6-3 6 3v6l-6 3-6-3z"/><path d="M2 5l6 3 6-3M8 8v6"/>',
    shield:      '<path d="M8 1L2 3v5c0 4 6 7 6 7s6-3 6-7V3z"/>',
    bind:        '<path d="M5 3a2 2 0 1 0 0 4M11 9a2 2 0 1 0 0 4"/><path d="M7 5l4 6"/>',
    button:      '<rect x="2" y="6" width="12" height="4" rx="2"/><circle cx="11" cy="8" r="1"/>',
    log:         '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M5 5h6M5 8h6M5 11h3"/>',
    flash:       '<path d="M9 1L3 9h4l-1 6 6-8H8l1-6z"/>',
    chart:       '<path d="M2 13V3M2 13h11"/><rect x="4" y="9" width="2" height="4"/><rect x="7" y="6" width="2" height="7"/><rect x="10" y="3" width="2" height="10"/>'
  };

  function icon(name) {
    const svg = ICONS[name];
    if (!svg) return '';
    return '<span class="td-icon"><svg viewBox="0 0 16 16">' + svg + '</svg></span>';
  }

  // Toggle (switch). Click flips state, fires "change" event.
  function bindToggles(root) {
    (root || document).querySelectorAll('.td-toggle').forEach(function (el) {
      if (el.dataset._tdBound) return;
      el.dataset._tdBound = '1';
      el.setAttribute('role', 'switch');
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      const initial = el.getAttribute('aria-checked') === 'true' || el.classList.contains('is-on');
      setToggle(el, initial);
      el.addEventListener('click', function () {
        setToggle(el, el.getAttribute('aria-checked') !== 'true');
        el.dispatchEvent(new CustomEvent('td:change', { detail: { checked: el.getAttribute('aria-checked') === 'true' } }));
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); el.click(); }
      });
    });
  }
  function setToggle(el, on) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.classList.toggle('is-on', !!on);
  }

  // Segmented control: clicks set is-active, fire td:change with index/value.
  function bindSegments(root) {
    (root || document).querySelectorAll('.td-segment').forEach(function (seg) {
      if (seg.dataset._tdBound) return;
      seg.dataset._tdBound = '1';
      const buttons = Array.from(seg.querySelectorAll('button'));
      buttons.forEach(function (b, i) {
        b.addEventListener('click', function () {
          buttons.forEach(function (x) { x.classList.remove('is-active'); });
          b.classList.add('is-active');
          seg.dispatchEvent(new CustomEvent('td:change', { detail: { index: i, value: b.dataset.value || b.textContent.trim() } }));
        });
      });
    });
  }

  // Render telemetry bars (n bars, levels[] 0..1)
  function renderBars(el, levels) {
    el.innerHTML = '';
    levels.forEach(function (lvl) {
      const i = document.createElement('i');
      const h = Math.max(2, Math.round(lvl * 32));
      i.style.height = h + 'px';
      i.style.opacity = (0.4 + lvl * 0.6).toFixed(2);
      el.appendChild(i);
    });
  }

  // Render an RC channel meter from a value [-1..1]
  function renderChannel(el, value) {
    value = Math.max(-1, Math.min(1, value));
    const fill = el.querySelector('.td-channel-fill') || (function () {
      const f = document.createElement('div');
      f.className = 'td-channel-fill';
      el.appendChild(f);
      return f;
    })();
    const half = 50;
    if (value >= 0) {
      fill.style.left = '50%';
      fill.style.right = (50 - value * half) + '%';
    } else {
      fill.style.left = (50 + value * half) + '%';
      fill.style.right = '50%';
    }
  }

  // Init everything on DOMContentLoaded.
  function init(root) {
    bindToggles(root);
    bindSegments(root);
  }

  global.TD = {
    icon: icon,
    init: init,
    bindToggles: bindToggles,
    bindSegments: bindSegments,
    setToggle: setToggle,
    renderBars: renderBars,
    renderChannel: renderChannel,
    ICONS: ICONS
  };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', function () { init(); });
})(window);
