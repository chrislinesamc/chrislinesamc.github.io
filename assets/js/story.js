// Scroll stories: a [data-story] section made of [data-beat] blocks. Fades each beat's text in and out around the
// middle of the screen and tells the page's visual where the reader is: beat k spans [k, k + 1).
(() => {
  'use strict';
  const story = document.querySelector('[data-story]');
  if (!story) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const beats = [...story.querySelectorAll('[data-beat]')];
  const listeners = [];

  function position() {
    const mid = innerHeight * 0.5;
    let b = 0;
    for (let i = 0; i < beats.length; i++) {
      const r = beats[i].getBoundingClientRect();
      if (mid < r.top) break;
      if (mid <= r.bottom) { b = i + (mid - r.top) / r.height; break; }
      b = i + 1 + (mid - r.bottom) / innerHeight;          // past the last beat: keep counting in screens
    }
    return reduced.matches ? Math.floor(b) + 0.5 : b;      // reduced motion: jump between beat states
  }

  function update() {
    const vh = innerHeight;
    for (const el of beats) {
      const r = el.getBoundingClientRect();
      const c = (vh * 0.5 - r.top) / r.height;              // 0 at the block's top, 1 at its bottom
      const o = Math.max(0, Math.min(1, Math.min(c / 0.22, (1 - c) / 0.22)));
      const inner = el.firstElementChild;
      inner.style.opacity = o.toFixed(3);
      inner.style.transform = reduced.matches ? '' : `translate3d(0, ${((0.5 - c) * 40).toFixed(1)}px, 0)`;
    }
    const b = position();
    for (const fn of listeners) fn(b);
  }

  window.Story = {
    element: story,
    beats,
    reduced,
    position,
    onChange(fn) { listeners.push(fn); fn(position()); },
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
})();
