// ==UserScript==
// @name         Spektrum.de – Leseransicht
// @namespace    https://github.com/ThisIsBert/Spektrum-Userscripts
// @version      0.1.0
// @description  Eine moderne, minimalistische Startseite mit redaktionellen Spektrum-Inhalten – ohne Shop, Abo, Werbung und Verlagspromos.
// @match        https://www.spektrum.de/
// @match        https://spektrum.de/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (location.pathname !== '/') return;

  const ROOT_ID = 'spektrum-reader-view';
  const STYLE_ID = 'spektrum-reader-page-lock';
  const ALLOWED_TYPES = new Map([
    ['news',      { label: 'Nachricht', plural: 'Nachrichten' }],
    ['kolumne',   { label: 'Kolumne', plural: 'Kolumnen' }],
    ['podcast',   { label: 'Podcast', plural: 'Podcasts' }],
    ['video',     { label: 'Video', plural: 'Videos' }],
    ['raetsel',   { label: 'Rätsel', plural: 'Rätsel' }],
    ['frage',     { label: 'Frage', plural: 'Fragen' }],
    ['rezension', { label: 'Rezension', plural: 'Rezensionen' }],
    ['leseprobe', { label: 'Leseprobe', plural: 'Leseproben' }],
    ['wissen',    { label: 'Wissen', plural: 'Wissen' }]
  ]);

  const state = {
    active: true,
    filter: 'all',
    items: [],
    scrollTop: 0
  };

  const norm = (s = '') => String(s).replace(/\s+/g, ' ').trim();
  const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));

  function absoluteUrl(value) {
    if (!value) return '';
    try { return new URL(value, location.href).href; } catch { return ''; }
  }

  function canonicalUrl(value) {
    try {
      const u = new URL(value, location.href);
      u.search = '';
      u.hash = '';
      return u.href.replace(/\/$/, '');
    } catch {
      return value || '';
    }
  }

  function getType(url) {
    try {
      const first = new URL(url, location.href).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
      return ALLOWED_TYPES.has(first) ? first : null;
    } catch {
      return null;
    }
  }

  function isEditorialUrl(url) {
    const type = getType(url);
    if (!type) return false;
    try {
      const u = new URL(url, location.href);
      if (!/(^|\.)spektrum\.de$/i.test(u.hostname)) return false;
      if (u.pathname === '/video/partner' || u.pathname.startsWith('/video/partner/')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function isCommercialOrSponsored(node) {
    const text = norm(node?.textContent || '');
    const cls = node?.className ? String(node.className) : '';
    return /\b(sponsored|partnerinhalt|partnerinhalte|anzeige|werbung)\b/i.test(text) ||
           /\b(kiosk|product-actions|advert|ad-container)\b/i.test(cls);
  }

  function findCard(anchor) {
    return anchor.closest('article') ||
           anchor.closest('li.teaser__line__left') ||
           anchor.closest('li') ||
           anchor.closest('[class*="teaser"]') ||
           anchor.parentElement;
  }

  function cleanHeadingText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll([
      '.teaser__small__heading__kicker',
      '.teaser__large__heading__kicker',
      '.show-for-sr',
      '[class*="kicker"]'
    ].join(',')).forEach(n => n.remove());
    return norm(clone.textContent).replace(/^[:|–—-]+\s*/, '');
  }

  function extractKicker(card, anchor) {
    const explicit = card?.querySelector([
      '.teaser__wide__kicker',
      '.teaser__small__heading__kicker',
      '.teaser__large__heading__kicker',
      '.teaser__grid__kicker',
      '[class*="__kicker"]',
      '[class*="kicker"]'
    ].join(','));
    if (explicit) return norm(explicit.textContent);

    // Die schmalen Nachrichtenlisten kodieren die Dachzeile als erstes <span>.
    if (card?.matches('li.teaser__line__left')) {
      const firstSpan = anchor.querySelector(':scope > span');
      if (firstSpan) return norm(firstSpan.textContent);
    }
    return '';
  }

  function extractTitle(card, anchor, kicker) {
    const titleEl = card?.querySelector([
      '.teaser__wide__title',
      '.teaser__grid__title',
      '.teaser__full__title',
      '.teaser__small__heading',
      '.teaser__large__heading',
      'h1', 'h2', 'h3', 'h4'
    ].join(','));

    let title = cleanHeadingText(titleEl);

    if (!title && card?.matches('li.teaser__line__left')) {
      const clone = anchor.cloneNode(true);
      clone.querySelectorAll('span').forEach(n => n.remove());
      title = norm(clone.textContent).replace(/^\s*[|:–—-]+\s*/, '');
    }

    if (!title) title = norm(anchor.textContent);

    if (kicker && title.toLocaleLowerCase('de-DE').startsWith(kicker.toLocaleLowerCase('de-DE'))) {
      title = norm(title.slice(kicker.length)).replace(/^\s*[:|–—-]+\s*/, '');
    }

    return title;
  }

  function extractTeaser(card, title, kicker) {
    const explicit = card?.querySelector([
      '.teaser__wide__text',
      '.teaser__small__text',
      '.teaser__large__text',
      '.teaser__grid__text',
      '.teaser__full__text',
      'figcaption .show-for-medium',
      '[class*="teaser__grid__text"]'
    ].join(','));
    if (explicit) return norm(explicit.textContent);

    const p = card?.querySelector('p');
    if (p) return norm(p.textContent);

    // Bei einfachen Podcast/Video-Karten steckt der Teaser oft in einem generischen div.
    const blocks = [...(card?.querySelectorAll('div') || [])]
      .map(el => norm(el.textContent))
      .filter(text => text && text !== title && text !== kicker && text.length >= 45 && text.length <= 500);

    return blocks.sort((a, b) => a.length - b.length)[0] || '';
  }

  function imageScore(img) {
    if (!img) return -1;
    if (img.matches('.image__author') || img.closest('.author-img-wrap')) return -100000;
    const src = img.currentSrc || img.src || '';
    const fromUrl = src.match(/f(\d+)x(\d+)/i);
    const w = img.naturalWidth || img.width || Number(fromUrl?.[1]) || 0;
    const h = img.naturalHeight || img.height || Number(fromUrl?.[2]) || 0;
    return w * h;
  }

  function extractImage(card) {
    const imgs = [...(card?.querySelectorAll('img') || [])]
      .filter(img => !img.matches('.image__author') && !img.closest('.author-img-wrap'))
      .sort((a, b) => imageScore(b) - imageScore(a));

    const img = imgs[0];
    if (!img) return null;
    const src = absoluteUrl(img.currentSrc || img.getAttribute('src'));
    if (!src) return null;
    return { src, alt: norm(img.getAttribute('alt') || '') };
  }

  function extractAuthor(card) {
    const el = card?.querySelector([
      '.teaser__wide__author',
      '.teaser__large__author',
      '[class*="teaser"][class*="author"]'
    ].join(','));
    return el ? norm(el.textContent) : '';
  }

  function extractItems() {
    const scope = document.querySelector('#main') || document.querySelector('main') || document.body;
    const anchors = [...scope.querySelectorAll('a[href]')].filter(a => isEditorialUrl(a.href));
    const seen = new Set();
    const items = [];

    for (const anchor of anchors) {
      const url = canonicalUrl(anchor.href);
      if (!url || seen.has(url)) continue;

      const card = findCard(anchor);
      if (!card || isCommercialOrSponsored(card)) continue;

      const type = getType(url);
      const kicker = extractKicker(card, anchor);
      const title = extractTitle(card, anchor, kicker);
      const teaser = extractTeaser(card, title, kicker);
      const image = extractImage(card);
      const author = extractAuthor(card);
      const cardClass = card.className ? String(card.className) : '';

      if (!title || title.length < 8) continue;
      if (/^(sponsored|partnerinhalte?|neuerscheinungen|abonnement|bestellen)$/i.test(title)) continue;

      seen.add(url);
      items.push({
        url,
        type,
        typeLabel: ALLOWED_TYPES.get(type)?.label || 'Artikel',
        kicker,
        title,
        teaser,
        image,
        author,
        originalClass: cardClass,
        featured: /teaser__wide|teaser__large/.test(cardClass)
      });
    }

    return items;
  }

  function formatMeta(item) {
    const parts = [];
    if (item.kicker) parts.push(item.kicker);
    else parts.push(item.typeLabel);
    if (item.author) parts.push(item.author.replace(/^von\s+/i, 'von '));
    return parts.join(' · ');
  }

  function cardHtml(item, { hero = false, compact = false } = {}) {
    const image = item.image
      ? `<div class="${hero ? 'hero-image' : 'card-image'}"><img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}" loading="lazy"></div>`
      : '';

    const teaser = item.teaser
      ? `<p class="${hero ? 'hero-teaser' : 'card-teaser'}">${escapeHtml(item.teaser)}</p>`
      : '';

    const meta = `<div class="meta">${escapeHtml(formatMeta(item))}</div>`;

    if (hero) {
      return `
        <article class="hero" data-type="${item.type}">
          <a href="${escapeHtml(item.url)}" class="hero-link">
            ${image}
            <div class="hero-copy">
              ${meta}
              <h1>${escapeHtml(item.title)}</h1>
              ${teaser}
              <span class="read-more">Artikel lesen <span aria-hidden="true">→</span></span>
            </div>
          </a>
        </article>`;
    }

    if (compact) {
      return `
        <article class="compact-card" data-type="${item.type}">
          <a href="${escapeHtml(item.url)}">
            <div>
              ${meta}
              <h3>${escapeHtml(item.title)}</h3>
            </div>
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        </article>`;
    }

    return `
      <article class="card" data-type="${item.type}">
        <a href="${escapeHtml(item.url)}">
          ${image}
          <div class="card-copy">
            ${meta}
            <h2>${escapeHtml(item.title)}</h2>
            ${teaser}
          </div>
        </a>
      </article>`;
  }

  function currentItems() {
    if (state.filter === 'all') return state.items;
    return state.items.filter(item => item.type === state.filter);
  }

  function renderContent(shadow) {
    const list = currentItems();
    const content = shadow.querySelector('#reader-content');
    const count = shadow.querySelector('#article-count');
    if (!content || !count) return;

    count.textContent = `${list.length} ${list.length === 1 ? 'Beitrag' : 'Beiträge'}`;

    if (!list.length) {
      content.innerHTML = `<div class="empty"><strong>Nichts gefunden.</strong><br>Für diesen Filter enthält die aktuelle Startseite keine Beiträge.</div>`;
      return;
    }

    const hero = list[0];
    const cards = list.slice(1, 13);
    const rest = list.slice(13);

    content.innerHTML = `
      ${cardHtml(hero, { hero: true })}
      ${cards.length ? `
        <section class="section">
          <div class="section-head"><h2>Aktuell</h2></div>
          <div class="grid">${cards.map(item => cardHtml(item)).join('')}</div>
        </section>` : ''}
      ${rest.length ? `
        <section class="section more-section">
          <div class="section-head"><h2>Mehr entdecken</h2></div>
          <div class="compact-list">${rest.map(item => cardHtml(item, { compact: true })).join('')}</div>
        </section>` : ''}
    `;
  }

  function filterButtons(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.type, (counts.get(item.type) || 0) + 1);

    const preferred = ['news', 'kolumne', 'podcast', 'video', 'frage', 'raetsel', 'rezension', 'wissen', 'leseprobe'];
    const buttons = preferred
      .filter(type => counts.has(type))
      .map(type => `<button class="filter" data-filter="${type}">${escapeHtml(ALLOWED_TYPES.get(type).plural)} <span>${counts.get(type)}</span></button>`)
      .join('');

    return `<button class="filter is-active" data-filter="all">Alle <span>${items.length}</span></button>${buttons}`;
  }

  function shellHtml(items) {
    return `
      <div id="overlay" class="overlay is-visible">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <span class="brand-mark">S</span>
              <div>
                <strong>Spektrum</strong>
                <span>Leseransicht</span>
              </div>
            </div>
            <nav class="actions" aria-label="Ansicht">
              <button id="refresh" class="icon-button" title="Inhalte neu einlesen" aria-label="Inhalte neu einlesen">↻</button>
              <button id="show-original" class="secondary">Originalseite</button>
            </nav>
          </div>
        </header>

        <main class="page">
          <div class="intro">
            <div>
              <p class="eyebrow">Wissenschaft ohne Umwege</p>
              <h1>Was heute lesenswert ist.</h1>
              <p class="intro-copy">Artikel, Kolumnen, Podcasts und Videos der Spektrum-Startseite – ohne Shop, Abo, Werbung und doppelte Teaser.</p>
            </div>
            <div id="article-count" class="count"></div>
          </div>

          <div class="filters" aria-label="Inhalte filtern">
            ${filterButtons(items)}
          </div>

          <div id="reader-content"></div>
          <footer>Leseransicht · Inhalte und Bilder stammen aus der geladenen Spektrum-Seite.</footer>
        </main>
      </div>

      <button id="show-reader" class="reader-fab" hidden>Leseransicht</button>
    `;
  }

  const css = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    button, a { -webkit-tap-highlight-color: transparent; }

    .overlay {
      --bg: #f7f7f4;
      --surface: #ffffff;
      --text: #171717;
      --muted: #696969;
      --soft: #e8e8e2;
      --accent: #b51f32;
      --accent-soft: #f5e8ea;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      overflow: auto;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
      opacity: 0;
      pointer-events: none;
      transition: opacity .18s ease;
    }
    .overlay.is-visible { opacity: 1; pointer-events: auto; }
    .overlay a { color: inherit; text-decoration: none; }
    .overlay button { font: inherit; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid color-mix(in srgb, var(--soft) 88%, transparent);
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(18px) saturate(150%);
    }
    .topbar-inner {
      width: min(1240px, calc(100% - 40px));
      min-height: 72px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand { display: flex; align-items: center; gap: 11px; letter-spacing: -.01em; }
    .brand-mark {
      width: 34px; height: 34px; border-radius: 10px;
      display: grid; place-items: center;
      background: var(--accent); color: white;
      font: 700 20px/1 Georgia, serif;
    }
    .brand div { display: grid; line-height: 1.08; }
    .brand strong { font-size: 15px; font-weight: 720; }
    .brand div span { margin-top: 4px; color: var(--muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .secondary, .icon-button, .filter, .reader-fab {
      border: 1px solid var(--soft);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: transform .15s ease, border-color .15s ease, background .15s ease;
    }
    .secondary:hover, .icon-button:hover, .filter:hover { border-color: #c9c9c2; transform: translateY(-1px); }
    .secondary { border-radius: 999px; padding: 9px 14px; font-size: 13px; font-weight: 650; }
    .icon-button { width: 38px; height: 38px; border-radius: 50%; font-size: 20px; line-height: 1; }

    .page { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 58px 0 72px; }
    .intro { display: flex; align-items: end; justify-content: space-between; gap: 36px; margin-bottom: 26px; }
    .eyebrow, .meta {
      margin: 0 0 9px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 780;
      letter-spacing: .095em;
      text-transform: uppercase;
    }
    .intro h1 { margin: 0; max-width: 760px; font-size: clamp(34px, 4.5vw, 64px); line-height: .99; letter-spacing: -.045em; font-weight: 760; }
    .intro-copy { max-width: 740px; margin: 18px 0 0; color: var(--muted); font-size: 16px; }
    .count { color: var(--muted); font-size: 12px; white-space: nowrap; }

    .filters {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 0 0 22px;
      margin-bottom: 10px;
      scrollbar-width: none;
    }
    .filters::-webkit-scrollbar { display: none; }
    .filter { flex: 0 0 auto; border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 650; }
    .filter span { margin-left: 4px; color: var(--muted); font-weight: 500; }
    .filter.is-active { border-color: var(--text); background: var(--text); color: var(--bg); }
    .filter.is-active span { color: color-mix(in srgb, var(--bg) 68%, transparent); }

    .hero { margin: 8px 0 54px; }
    .hero-link {
      min-height: 480px;
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(360px, .85fr);
      overflow: hidden;
      border: 1px solid var(--soft);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 1px 0 rgba(0,0,0,.015);
    }
    .hero-image { min-height: 100%; background: #deded8; overflow: hidden; }
    .hero-image img { width: 100%; height: 100%; min-height: 480px; object-fit: cover; display: block; transition: transform .5s ease; }
    .hero-link:hover .hero-image img { transform: scale(1.018); }
    .hero-copy { display: flex; flex-direction: column; justify-content: center; padding: clamp(30px, 4vw, 58px); }
    .hero-copy h1 { margin: 0; font-size: clamp(34px, 4vw, 57px); line-height: 1.02; letter-spacing: -.042em; font-weight: 760; }
    .hero-teaser { margin: 20px 0 0; color: var(--muted); font-size: 17px; line-height: 1.58; }
    .read-more { margin-top: 32px; font-size: 13px; font-weight: 720; }
    .read-more span { display: inline-block; margin-left: 4px; transition: transform .15s ease; }
    .hero-link:hover .read-more span { transform: translateX(4px); }

    .section { margin-top: 52px; }
    .section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; border-bottom: 1px solid var(--soft); padding-bottom: 12px; }
    .section-head h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 34px 24px; }
    .card { min-width: 0; }
    .card a { display: block; }
    .card-image { aspect-ratio: 16 / 9; overflow: hidden; border-radius: 15px; background: #deded8; }
    .card-image img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform .35s ease; }
    .card a:hover .card-image img { transform: scale(1.025); }
    .card-copy { padding: 15px 2px 0; }
    .card-copy .meta { margin-bottom: 7px; }
    .card h2 { margin: 0; font-size: clamp(19px, 1.6vw, 24px); line-height: 1.13; letter-spacing: -.025em; font-weight: 720; text-wrap: balance; }
    .card-teaser { margin: 10px 0 0; color: var(--muted); font-size: 14px; line-height: 1.52; }
    .card a:hover h2, .compact-card a:hover h3 { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }

    .more-section { margin-top: 64px; }
    .compact-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 46px; }
    .compact-card { border-bottom: 1px solid var(--soft); }
    .compact-card a { min-height: 124px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 21px 0; }
    .compact-card .meta { margin-bottom: 6px; }
    .compact-card h3 { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: -.015em; font-weight: 680; }
    .arrow { color: var(--muted); font-size: 19px; transition: transform .15s ease; }
    .compact-card a:hover .arrow { transform: translateX(4px); color: var(--text); }

    .empty { margin: 36px 0; padding: 40px; border: 1px solid var(--soft); border-radius: 18px; background: var(--surface); color: var(--muted); }
    footer { margin-top: 72px; padding-top: 18px; border-top: 1px solid var(--soft); color: var(--muted); font-size: 11px; }

    .reader-fab {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      border-radius: 999px;
      padding: 11px 16px;
      box-shadow: 0 10px 35px rgba(0,0,0,.18);
      font: 700 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .reader-fab:hover { transform: translateY(-2px); }

    @media (max-width: 950px) {
      .hero-link { grid-template-columns: 1fr; }
      .hero-image img { min-height: 0; aspect-ratio: 16/9; }
      .hero-copy { padding: 30px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .compact-list { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .topbar-inner, .page { width: min(100% - 24px, 1240px); }
      .topbar-inner { min-height: 62px; }
      .brand div span { display: none; }
      .secondary { padding: 8px 11px; }
      .page { padding-top: 36px; }
      .intro { display: block; margin-bottom: 22px; }
      .intro-copy { font-size: 14px; }
      .count { margin-top: 14px; }
      .hero { margin-bottom: 40px; }
      .hero-link { min-height: 0; border-radius: 18px; }
      .hero-copy { padding: 24px 20px 27px; }
      .hero-copy h1 { font-size: clamp(30px, 9vw, 44px); }
      .hero-teaser { font-size: 15px; }
      .grid { grid-template-columns: 1fr; gap: 34px; }
      .card-image { border-radius: 13px; }
      .section { margin-top: 42px; }
      .compact-card a { min-height: 100px; }
    }

    @media (prefers-color-scheme: dark) {
      .overlay {
        --bg: #111210;
        --surface: #191a18;
        --text: #f1f1ed;
        --muted: #a5a69f;
        --soft: #30312d;
        --accent: #ef6676;
        --accent-soft: #2b1d20;
      }
      .hero-image, .card-image { background: #242521; }
    }
  `;

  function setPageLock(locked) {
    let style = document.getElementById(STYLE_ID);
    if (locked) {
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = 'html, body { overflow: hidden !important; }';
        document.documentElement.appendChild(style);
      }
    } else {
      style?.remove();
    }
  }

  function showReader(shadow) {
    state.active = true;
    shadow.querySelector('#overlay')?.classList.add('is-visible');
    shadow.querySelector('#show-reader').hidden = true;
    setPageLock(true);
  }

  function showOriginal(shadow) {
    state.active = false;
    const overlay = shadow.querySelector('#overlay');
    state.scrollTop = overlay?.scrollTop || 0;
    overlay?.classList.remove('is-visible');
    shadow.querySelector('#show-reader').hidden = false;
    setPageLock(false);
  }

  function refresh(shadow) {
    state.items = extractItems();
    state.filter = 'all';
    shadow.querySelector('.filters').innerHTML = filterButtons(state.items);
    shadow.querySelectorAll('.filter').forEach(btn => btn.classList.toggle('is-active', btn.dataset.filter === 'all'));
    renderContent(shadow);
    shadow.querySelector('#overlay').scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mount() {
    document.getElementById(ROOT_ID)?.remove();

    state.items = extractItems();
    if (!state.items.length) {
      console.warn('[Spektrum Leseransicht] Keine redaktionellen Inhalte gefunden.');
      return;
    }

    const host = document.createElement('div');
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = shellHtml(state.items);
    while (wrapper.firstChild) shadow.appendChild(wrapper.firstChild);

    renderContent(shadow);
    setPageLock(true);

    shadow.addEventListener('click', event => {
      const filter = event.target.closest('.filter');
      if (filter) {
        state.filter = filter.dataset.filter || 'all';
        shadow.querySelectorAll('.filter').forEach(btn => btn.classList.toggle('is-active', btn === filter));
        renderContent(shadow);
        shadow.querySelector('#overlay').scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (event.target.closest('#show-original')) showOriginal(shadow);
      if (event.target.closest('#show-reader')) {
        showReader(shadow);
        requestAnimationFrame(() => { shadow.querySelector('#overlay').scrollTop = state.scrollTop; });
      }
      if (event.target.closest('#refresh')) refresh(shadow);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.active) showOriginal(shadow);
    });

    console.info(`[Spektrum Leseransicht] ${state.items.length} redaktionelle Beiträge geladen.`);
  }

  // Ein kurzer Aufschub lässt Spektrum seine serverseitig ausgelieferten Slider/Teaser initialisieren.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 450), { once: true });
  } else {
    setTimeout(mount, 450);
  }
})();
