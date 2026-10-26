// Page behaviour: smooth scroll, reveal-on-scroll, the current section in the nav, copy email, local time.
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Smooth scroll (Lenis turns itself off when the visitor asks for reduced motion)
  if (window.Lenis && !reduced) {
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.1 });     // anchors honour CSS scroll-padding-top
    window.__lenis = lenis;
  }

  // Keep the address bar at the page itself: drop #section once the jump is done (after a click, or on arriving)
  const clean = () => { if (location.hash) history.replaceState(null, '', location.pathname + location.search); };
  addEventListener('hashchange', clean);
  addEventListener('load', clean);

  // Reveal blocks as they enter the viewport
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  // Mark the nav link of the section in view
  const links = [...document.querySelectorAll('.nav nav a[href^="#"]')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && targets.length) {
    const nav = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links) {
          if (a.getAttribute('href') === '#' + e.target.id) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach((t) => nav.observe(t));
  }

  // Copy buttons: data-copy="text", or data-copy-from="#id" to copy that element's text (a citation)
  for (const btn of document.querySelectorAll('[data-copy], [data-copy-from]')) {
    const label = btn.querySelector('.copy-label');
    const idle = label.textContent;
    btn.addEventListener('click', async () => {
      const source = btn.dataset.copyFrom ? document.querySelector(btn.dataset.copyFrom) : null;
      try {
        await navigator.clipboard.writeText(source ? source.textContent : btn.dataset.copy);
        label.textContent = 'Copied';
      } catch (e) {
        label.textContent = 'Press Ctrl+C';
        const sel = getSelection(), r = document.createRange();
        r.selectNodeContents(source || btn.previousElementSibling);
        sel.removeAllRanges(); sel.addRange(r);
      }
      setTimeout(() => { label.textContent = idle; }, 2000);
    });
  }

  // Local time in Chennai
  const clock = document.getElementById('local-time');
  if (clock && window.Intl) {
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const tick = () => { clock.textContent = fmt.format(new Date()); };
    tick();
    clock.parentElement.hidden = false;
    setInterval(tick, 30000);
  }

  // Visit counter: one row per page view in the owner's Google Sheet, through an Apps Script web app. No cookies, no
  // IP addresses. Only the live https site counts; open any page once with ?me to stop counting this browser (?me=0 undoes it).
  const COUNTER = 'https://script.google.com/macros/s/AKfycbyhEW9GEtuOKeojmQYN70Eyi_YpH3zaMACg0BQtZJVfl71BrKo3rCI5KmiZMDMFuc64IQ/exec';
  const query = new URLSearchParams(location.search);
  let me = false, first = '1';
  try {
    if (query.has('me')) query.get('me') === '0' ? localStorage.removeItem('me') : localStorage.setItem('me', '1');
    me = !!localStorage.getItem('me');
    first = sessionStorage.getItem('seen') ? '' : '1';          // the first page of this visit
    sessionStorage.setItem('seen', '1');
  } catch (e) { /* storage blocked: count anyway */ }
  if (location.protocol === 'https:' && !me && !navigator.webdriver && !/bot|crawl|spider/i.test(navigator.userAgent)) {
    const from = document.referrer ? new URL(document.referrer).hostname : '';
    const hit = new URLSearchParams({
      page: location.pathname,
      from: from === location.hostname ? 'this site' : from,      // blank: typed, bookmarked, or opened from an app
      ref: query.get('ref') || '',
      tz: (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      lang: navigator.language || '',
      device: matchMedia('(max-width: 760px)').matches ? 'phone' : 'desktop',
      new: first,
    });
    fetch(COUNTER + '?' + hit, { mode: 'no-cors', keepalive: true }).catch(() => {});
  }
  // keep the address bar clean of ?ref= and ?me once they are read
  if (query.has('ref') || query.has('me')) history.replaceState(null, '', location.pathname + location.hash);
})();
