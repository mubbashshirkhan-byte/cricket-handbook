// Register the service worker (makes the site installable and usable offline)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

document.addEventListener('DOMContentLoaded', () => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Footer year
  $('#year').textContent = new Date().getFullYear();

  // Desktop dropdowns: click to toggle (hover handled by CSS)
  $$('.main-nav .dd-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      const li = btn.parentElement;
      const isOpen = li.classList.contains('open');
      $$('.main-nav .has-dropdown.open').forEach(x => x.classList.remove('open'));
      li.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
      e.stopPropagation();
    });
  });
  document.addEventListener('click', () =>
    $$('.main-nav .has-dropdown.open').forEach(x => x.classList.remove('open')));

  // Mobile drawer: clone the main nav into it
  const drawer = $('#drawer');
  const backdrop = $('.drawer-backdrop');
  const toggle = $('.menu-toggle');
  $('.drawer-nav').appendChild($('.nav-list').cloneNode(true));
  $$('.drawer-nav .dd-toggle').forEach(btn =>
    btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')));

  const setDrawer = open => {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setDrawer(true));
  $('.drawer-close').addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  // TOC collapse (mobile)
  const toc = $('.toc');
  const tocToggle = $('.toc-toggle');
  tocToggle.addEventListener('click', () => {
    const open = toc.classList.toggle('open');
    tocToggle.setAttribute('aria-expanded', String(open));
  });
  $$('.toc-list a').forEach(a => a.addEventListener('click', () => toc.classList.remove('open')));

  // Scrollspy: highlight the active section in the TOC
  const links = $$('.toc-list a');
  const byId = Object.fromEntries(links.map(a => [a.getAttribute('href').slice(1), a]));
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        byId[entry.target.id]?.classList.add('active');
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  $$('.hb-section').forEach(s => observer.observe(s));

  // Reading progress + back-to-top
  const bar = $('.toc-progress span');
  const topBtn = $('.back-to-top');
  const content = $('.content');
  const onScroll = () => {
    const rect = content.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const pct = Math.min(100, Math.max(0, (-rect.top / total) * 100));
    bar.style.width = pct + '%';
    topBtn.classList.toggle('show', window.scrollY > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
});
