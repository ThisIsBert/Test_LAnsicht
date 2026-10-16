// ==UserScript==
// @name         Spektrum.de – Leseransicht
// @namespace    https://github.com/ThisIsBert/Spektrum-Userscripts
// @version      0.2.0
// @description  Eine ruhige, redaktionelle Spektrum-Startseite – ohne Shop, Abo, Werbung und Verlagspromos.
// @match        https://www.spektrum.de/
// @match        https://spektrum.de/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (location.pathname !== '/') return;

  const ROOT_ID = 'spektrum-reader-view';
  const GLOBAL_STYLE_ID = 'spektrum-reader-global-style';
  const ACTIVE_CLASS = 'spektrum-reader-active';

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
    readerScroll: 0,
    originalScroll: 0
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
    if (!node) return false;
    const text = norm(node.textContent || '');
    const cls = node.className ? String(node.className) : '';
    const commercialClass = /(?:^|\s)(?:kiosk|product-actions|advert|ad-container|native-ad|sponsored)(?:\s|$)/i.test(cls);
    const explicitLabel = /^(?:anzeige|werbung|sponsored|partnerinhalt|partnerinhalte)$/i.test(text);
    return commercialClass || explicitLabel;
  }

  function findCard(anchor) {
    return anchor.closest('article') ||
           anchor.closest('li.teaser__line__left') ||
           anchor.closest('[class*="teaser"]') ||
           anchor.closest('li') ||
           anchor.parentElement;
  }

  function cardPriority(card) {
    const cls = card?.className ? String(card.className) : '';
    if (/teaser__wide/.test(cls)) return 100;
    if (/teaser__full/.test(cls)) return 95;
    if (/teaser__large/.test(cls)) return 90;
    if (/teaser__grid/.test(cls)) return 75;
    if (/teaser__small/.test(cls)) return 65;
    if (/teaser__line/.test(cls) || card?.matches('li.teaser__line__left')) return 30;
    if (card?.matches('article')) return 55;
    return 40;
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

    const blocks = [...(card?.querySelectorAll('div') || [])]
      .map(el => norm(el.textContent))
      .filter(text => text && text !== title && text !== kicker && text.length >= 45 && text.length <= 500);

    return blocks.sort((a, b) => a.length - b.length)[0] || '';
  }

  function urlFromSrcset(value) {
    if (!value) return '';
    const entries = String(value).split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const bits = part.split(/\s+/);
        const descriptor = bits[1] || '';
        const width = Number(descriptor.replace(/\D/g, '')) || 0;
        return { url: bits[0], width };
      })
      .filter(entry => entry.url);

    entries.sort((a, b) => b.width - a.width);
    return entries[0]?.url || '';
  }

  function imageUrl(img) {
    const candidates = [
      img.currentSrc,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-original'),
      urlFromSrcset(img.getAttribute('srcset')),
      urlFromSrcset(img.getAttribute('data-srcset')),
      urlFromSrcset(img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset'))
    ];

    for (const candidate of candidates) {
      const url = absoluteUrl(candidate);
      if (!url || /^data:/i.test(url)) continue;
      return url;
    }
    return '';
  }

  function imageScore(img, src = imageUrl(img)) {
    if (!img || !src) return -1;
    if (img.matches('.image__author') || img.closest('.author-img-wrap')) return -100000;
    if (/avatar|author|logo|icon/i.test(`${img.className || ''} ${src}`)) return -50000;

    const fromUrl = src.match(/f(\d+)x(\d+)/i);
    const w = img.naturalWidth || img.width || Number(fromUrl?.[1]) || 0;
    const h = img.naturalHeight || img.height || Number(fromUrl?.[2]) || 0;
    return w * h || 1;
  }

  function extractImage(card) {
    const images = [...(card?.querySelectorAll('img') || [])]
      .map(img => {
        const src = imageUrl(img);
        return { img, src, quality: imageScore(img, src) };
      })
      .filter(entry => entry.src && entry.quality > 0)
      .sort((a, b) => b.quality - a.quality);

    if (images[0]) {
      return {
        src: images[0].src,
        alt: norm(images[0].img.getAttribute('alt') || ''),
        quality: images[0].quality
      };
    }

    const bgNode = [...(card?.querySelectorAll('[style*="background-image"]') || [])]
      .find(el => /url\(/i.test(el.getAttribute('style') || ''));
    const match = bgNode?.getAttribute('style')?.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i);
    const bgUrl = absoluteUrl(match?.[1]);
    return bgUrl ? { src: bgUrl, alt: '', quality: 1 } : null;
  }

  function extractAuthor(card) {
    const el = card?.querySelector([
      '.teaser__wide__author',
      '.teaser__large__author',
      '[class*="teaser"][class*="author"]'
    ].join(','));
    return el ? norm(el.textContent) : '';
  }

  function candidateFrom(anchor, order) {
    const url = canonicalUrl(anchor.href);
    const card = findCard(anchor);
    if (!url || !card || isCommercialOrSponsored(card)) return null;

    const type = getType(url);
    const kicker = extractKicker(card, anchor);
    const title = extractTitle(card, anchor, kicker);
    const teaser = extractTeaser(card, title, kicker);
    const image = extractImage(card);
    const author = extractAuthor(card);
    const originalClass = card.className ? String(card.className) : '';
    const priority = cardPriority(card);

    if (!title || title.length < 8) return null;
    if (/^(sponsored|partnerinhalte?|neuerscheinungen|abonnement|bestellen)$/i.test(title)) return null;

    return {
      url,
      type,
      typeLabel: ALLOWED_TYPES.get(type)?.label || 'Artikel',
      kicker,
      title,
      teaser,
      image,
      author,
      originalClass,
      priority,
      featured: priority >= 90,
      order
    };
  }

  function mergeCandidate(oldItem, newItem) {
    if (!oldItem) return newItem;

    const oldRichness = oldItem.priority + (oldItem.image ? 25 : 0) + (oldItem.teaser ? 8 : 0);
    const newRichness = newItem.priority + (newItem.image ? 25 : 0) + (newItem.teaser ? 8 : 0);
    const base = newRichness > oldRichness ? { ...newItem } : { ...oldItem };
    const other = newRichness > oldRichness ? oldItem : newItem;

    base.order = Math.min(oldItem.order, newItem.order);
    base.priority = Math.max(oldItem.priority, newItem.priority);
    base.featured = oldItem.featured || newItem.featured;
    base.kicker ||= other.kicker;
    base.author ||= other.author;

    if (!base.teaser || (other.teaser && other.teaser.length > base.teaser.length && other.teaser.length < 600)) {
      base.teaser = other.teaser || base.teaser;
    }

    if (!base.image || (other.image && (other.image.quality || 0) > (base.image.quality || 0))) {
      base.image = other.image || base.image;
    }

    return base;
  }

  function extractItems() {
    const scope = document.querySelector('#main') || document.querySelector('main') || document.body;
    const anchors = [...scope.querySelectorAll('a[href]')].filter(a => isEditorialUrl(a.href));
    const byUrl = new Map();

    anchors.forEach((anchor, order) => {
      const candidate = candidateFrom(anchor, order);
      if (!candidate) return;
      byUrl.set(candidate.url, mergeCandidate(byUrl.get(candidate.url), candidate));
    });

    return [...byUrl.values()].sort((a, b) => a.order - b.order);
  }

  function formatMeta(item) {
    const parts = [];
    if (item.kicker) parts.push(item.kicker);
    else parts.push(item.typeLabel);
    if (item.author) parts.push(item.author.replace(/^von\s+/i, 'von '));
    return parts.join(' · ');
  }

  function heroHtml(item) {
    const image = item.image
      ? `<div class="hero-image"><img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}"></div>`
      : '';
    const teaser = item.teaser ? `<p>${escapeHtml(item.teaser)}</p>` : '';

    return `
      <article class="hero" data-type="${item.type}">
        <a href="${escapeHtml(item.url)}">
          ${image}
          <div class="hero-copy">
            <div class="meta">${escapeHtml(formatMeta(item))}</div>
            <h1>${escapeHtml(item.title)}</h1>
            ${teaser}
            <span class="read-more">Lesen <span aria-hidden="true">→</span></span>
          </div>
        </a>
      </article>`;
  }

  function visualCardHtml(item) {
    return `
      <article class="visual-card" data-type="${item.type}">
        <a href="${escapeHtml(item.url)}">
          <div class="visual-image"><img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}" loading="lazy"></div>
          <div class="visual-copy">
            <div class="meta">${escapeHtml(formatMeta(item))}</div>
            <h2>${escapeHtml(item.title)}</h2>
            ${item.teaser ? `<p>${escapeHtml(item.teaser)}</p>` : ''}
          </div>
        </a>
      </article>`;
  }

  function textCardHtml(item) {
    return `
      <article class="text-card" data-type="${item.type}">
        <a href="${escapeHtml(item.url)}">
          <div class="meta">${escapeHtml(formatMeta(item))}</div>
          <h3>${escapeHtml(item.title)}</h3>
          ${item.teaser ? `<p>${escapeHtml(item.teaser)}</p>` : ''}
          <span class="arrow" aria-hidden="true">→</span>
        </a>
      </article>`;
  }

  function currentItems() {
    const list = state.filter === 'all'
      ? state.items
      : state.items.filter(item => item.type === state.filter);
    return [...list].sort((a, b) => a.order - b.order);
  }

  function chooseHero(list) {
    const withImages = list.filter(item => item.image);
    const pool = withImages.length ? withImages : list;
    return [...pool].sort((a, b) => (b.priority - a.priority) || (a.order - b.order))[0] || null;
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

    const hero = chooseHero(list);
    const remaining = list.filter(item => item !== hero);

    const visual = remaining.filter(item => item.image).slice(0, 6);
    const visualUrls = new Set(visual.map(item => item.url));
    const overview = remaining.filter(item => !visualUrls.has(item.url));

    content.innerHTML = `
      ${hero ? heroHtml(hero) : ''}

      ${visual.length ? `
        <section class="section visual-section">
          <div class="section-head">
            <h2>Aktuell</h2>
            <span>Ausgewählte Themen mit Bild</span>
          </div>
          <div class="visual-grid">${visual.map(visualCardHtml).join('')}</div>
        </section>` : ''}

      ${overview.length ? `
        <section class="section overview-section">
          <div class="section-head">
            <h2>Im Überblick</h2>
            <span>${overview.length} weitere ${overview.length === 1 ? 'Thema' : 'Themen'}</span>
          </div>
          <div class="text-grid">${overview.map(textCardHtml).join('')}</div>
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
      <div id="reader-shell" class="reader-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a class="brand" href="https://www.spektrum.de/" aria-label="Spektrum Leseransicht">
              <strong>Spektrum</strong><span>Leseransicht</span>
            </a>
            <nav class="actions" aria-label="Ansicht">
              <button id="refresh" class="refresh" title="Inhalte neu einlesen" aria-label="Inhalte neu einlesen">↻</button>
              <button id="show-original" class="original-button">Originalseite</button>
            </nav>
          </div>
        </header>

        <main class="page">
          <section class="intro">
            <div class="intro-copy-wrap">
              <p class="eyebrow">Wissenschaft ohne Umwege</p>
              <h1>Was heute lesenswert ist.</h1>
              <p class="intro-copy">Die redaktionellen Inhalte der Spektrum-Startseite – ohne Shop, Abo, Werbung und doppelte Teaser.</p>
            </div>
            <div id="article-count" class="count"></div>
          </section>

          <nav class="filters" aria-label="Inhalte filtern">
            ${filterButtons(items)}
          </nav>

          <div id="reader-content"></div>
          <footer>Leseransicht · Inhalte und Bilder stammen aus der geladenen Spektrum-Seite.</footer>
        </main>
      </div>

      <button id="show-reader" class="reader-fab" hidden>Leseransicht</button>
    `;
  }

  const css = `
    :host {
      --bg: #f5f5f1;
      --surface: #ffffff;
      --text: #171714;
      --muted: #6e6e67;
      --line: #deded7;
      --accent: #a71d2c;
      display: block;
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-rendering: optimizeLegibility;
    }

    *, *::before, *::after { box-sizing: border-box; }
    a { color: inherit; text-decoration: none; }
    button { font: inherit; }
    .reader-shell { min-height: 100vh; background: var(--bg); color: var(--text); }
    .reader-shell[hidden] { display: none !important; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid color-mix(in srgb, var(--line) 85%, transparent);
      background: color-mix(in srgb, var(--bg) 90%, transparent);
      backdrop-filter: blur(18px) saturate(140%);
    }
    .topbar-inner {
      width: min(1180px, calc(100% - 40px));
      min-height: 64px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand { display: flex; align-items: baseline; gap: 9px; letter-spacing: -.015em; }
    .brand strong { font-size: 18px; font-weight: 780; }
    .brand span { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .refresh, .original-button, .reader-fab {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: border-color .15s ease, transform .15s ease, background .15s ease;
    }
    .refresh:hover, .original-button:hover { border-color: #bdbdb5; transform: translateY(-1px); }
    .refresh { width: 36px; height: 36px; border-radius: 50%; font-size: 18px; line-height: 1; }
    .original-button { border-radius: 999px; padding: 8px 13px; font-size: 12px; font-weight: 700; }

    .page { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 62px 0 80px; }
    .intro { display: flex; align-items: end; justify-content: space-between; gap: 40px; margin-bottom: 24px; }
    .eyebrow, .meta {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .105em;
      text-transform: uppercase;
    }
    .intro h1 {
      margin: 0;
      max-width: 780px;
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-size: clamp(42px, 5vw, 70px);
      line-height: .98;
      letter-spacing: -.035em;
      font-weight: 700;
    }
    .intro-copy { max-width: 700px; margin: 16px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; }
    .count { padding-bottom: 4px; color: var(--muted); font-size: 11px; white-space: nowrap; }

    .filters {
      display: flex;
      align-items: center;
      gap: 20px;
      overflow-x: auto;
      margin: 0 0 28px;
      padding: 0 0 10px;
      border-bottom: 1px solid var(--line);
      scrollbar-width: none;
    }
    .filters::-webkit-scrollbar { display: none; }
    .filter {
      position: relative;
      flex: 0 0 auto;
      padding: 0 0 7px;
      border: 0;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .filter span { margin-left: 3px; color: color-mix(in srgb, var(--muted) 72%, transparent); font-size: 10px; font-weight: 500; }
    .filter::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -11px;
      height: 2px;
      background: transparent;
    }
    .filter:hover, .filter.is-active { color: var(--text); }
    .filter.is-active::after { background: var(--accent); }

    .hero { margin: 0 0 68px; }
    .hero > a {
      display: grid;
      grid-template-columns: minmax(0, 1.42fr) minmax(340px, .78fr);
      min-height: 470px;
      overflow: hidden;
      border: 1px solid var(--line);
      background: var(--surface);
    }
    .hero-image { min-height: 100%; overflow: hidden; background: #deded8; }
    .hero-image img { width: 100%; height: 100%; min-height: 470px; display: block; object-fit: cover; transition: transform .45s ease; }
    .hero > a:hover .hero-image img { transform: scale(1.015); }
    .hero-copy { display: flex; flex-direction: column; justify-content: center; padding: clamp(32px, 4vw, 54px); }
    .hero-copy h1 {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-size: clamp(36px, 4.1vw, 58px);
      line-height: 1.01;
      letter-spacing: -.035em;
      font-weight: 700;
    }
    .hero-copy p { margin: 20px 0 0; color: var(--muted); font-size: 16px; line-height: 1.6; }
    .read-more { margin-top: 28px; font-size: 12px; font-weight: 760; }
    .read-more span { display: inline-block; margin-left: 4px; transition: transform .15s ease; }
    .hero > a:hover .read-more span { transform: translateX(4px); }

    .section { margin-top: 58px; }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 20px;
      padding-bottom: 11px;
      border-bottom: 1px solid var(--line);
    }
    .section-head h2 { margin: 0; font-size: 17px; letter-spacing: -.015em; font-weight: 760; }
    .section-head span { color: var(--muted); font-size: 10px; }

    .visual-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 40px 24px; }
    .visual-card { min-width: 0; }
    .visual-card a { display: block; }
    .visual-image { aspect-ratio: 16 / 9; overflow: hidden; background: #deded8; }
    .visual-image img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform .32s ease; }
    .visual-card a:hover .visual-image img { transform: scale(1.022); }
    .visual-copy { padding: 14px 1px 0; }
    .visual-copy h2 {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-size: clamp(22px, 2vw, 28px);
      line-height: 1.08;
      letter-spacing: -.022em;
      font-weight: 700;
      text-wrap: balance;
    }
    .visual-copy p { margin: 9px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .visual-card a:hover h2, .text-card a:hover h3 { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }

    .overview-section { margin-top: 72px; }
    .text-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 54px; }
    .text-card { border-bottom: 1px solid var(--line); min-width: 0; }
    .text-card a { position: relative; display: block; min-height: 145px; padding: 22px 38px 22px 0; }
    .text-card h3 {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
      font-size: 22px;
      line-height: 1.13;
      letter-spacing: -.018em;
      font-weight: 700;
    }
    .text-card p {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .arrow { position: absolute; right: 2px; top: 50%; translate: 0 -50%; color: var(--muted); font-size: 18px; transition: transform .15s ease; }
    .text-card a:hover .arrow { transform: translateX(4px); color: var(--text); }

    .empty { margin: 36px 0; padding: 40px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
    footer { margin-top: 76px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }

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

    @media (max-width: 920px) {
      .hero > a { grid-template-columns: 1fr; min-height: 0; }
      .hero-image img { min-height: 0; aspect-ratio: 16 / 9; }
      .hero-copy { padding: 30px; }
      .visual-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .text-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 620px) {
      .topbar-inner, .page { width: calc(100% - 24px); }
      .topbar-inner { min-height: 58px; }
      .brand span { display: none; }
      .original-button { padding: 7px 10px; }
      .page { padding-top: 38px; }
      .intro { display: block; }
      .intro h1 { font-size: clamp(38px, 12vw, 54px); }
      .intro-copy { font-size: 14px; }
      .count { margin-top: 13px; }
      .filters { gap: 16px; margin-bottom: 20px; }
      .hero { margin-bottom: 48px; }
      .hero-copy { padding: 24px 20px 28px; }
      .hero-copy h1 { font-size: clamp(34px, 10vw, 46px); }
      .hero-copy p { font-size: 14px; }
      .visual-grid { grid-template-columns: 1fr; gap: 34px; }
      .section { margin-top: 46px; }
      .overview-section { margin-top: 58px; }
      .section-head span { display: none; }
      .text-card a { min-height: 120px; }
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #111210;
        --surface: #191a18;
        --text: #f1f1ed;
        --muted: #a3a49d;
        --line: #30312d;
        --accent: #ef6676;
      }
      .hero-image, .visual-image { background: #242521; }
    }
  `;

  function ensureGlobalStyle() {
    let style = document.getElementById(GLOBAL_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = GLOBAL_STYLE_ID;
      style.textContent = `
        html.${ACTIVE_CLASS}, html.${ACTIVE_CLASS} body {
          margin: 0 !important;
          padding: 0 !important;
          min-height: 100% !important;
          overflow: visible !important;
        }
        html.${ACTIVE_CLASS} body > :not(#${ROOT_ID}) {
          display: none !important;
        }
        html.${ACTIVE_CLASS} #${ROOT_ID} {
          display: block !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  function setReaderActive(shadow, active) {
    const shell = shadow.querySelector('#reader-shell');
    const fab = shadow.querySelector('#show-reader');
    state.active = active;

    if (active) {
      state.originalScroll = window.scrollY;
      shell.hidden = false;
      fab.hidden = true;
      document.documentElement.classList.add(ACTIVE_CLASS);
      requestAnimationFrame(() => window.scrollTo({ top: state.readerScroll, behavior: 'auto' }));
    } else {
      state.readerScroll = window.scrollY;
      document.documentElement.classList.remove(ACTIVE_CLASS);
      shell.hidden = true;
      fab.hidden = false;
      requestAnimationFrame(() => window.scrollTo({ top: state.originalScroll, behavior: 'auto' }));
    }
  }

  function refresh(shadow) {
    state.items = extractItems();
    state.filter = 'all';
    shadow.querySelector('.filters').innerHTML = filterButtons(state.items);
    shadow.querySelectorAll('.filter').forEach(btn => btn.classList.toggle('is-active', btn.dataset.filter === 'all'));
    renderContent(shadow);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mount() {
    document.getElementById(ROOT_ID)?.remove();

    state.items = extractItems();
    if (!state.items.length) {
      console.warn('[Spektrum Leseransicht] Keine redaktionellen Inhalte gefunden.');
      return;
    }

    ensureGlobalStyle();

    const host = document.createElement('div');
    host.id = ROOT_ID;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = shellHtml(state.items);
    while (wrapper.firstChild) shadow.appendChild(wrapper.firstChild);

    renderContent(shadow);
    document.documentElement.classList.add(ACTIVE_CLASS);

    shadow.addEventListener('click', event => {
      const filter = event.target.closest('.filter');
      if (filter) {
        state.filter = filter.dataset.filter || 'all';
        shadow.querySelectorAll('.filter').forEach(btn => btn.classList.toggle('is-active', btn === filter));
        renderContent(shadow);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (event.target.closest('#show-original')) setReaderActive(shadow, false);
      if (event.target.closest('#show-reader')) setReaderActive(shadow, true);
      if (event.target.closest('#refresh')) refresh(shadow);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.active) setReaderActive(shadow, false);
    });

    const recoveredImages = state.items.filter(item => item.image).length;
    console.info(`[Spektrum Leseransicht] ${state.items.length} redaktionelle Beiträge geladen, ${recoveredImages} mit Bild.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 650), { once: true });
  } else {
    setTimeout(mount, 650);
  }
})();