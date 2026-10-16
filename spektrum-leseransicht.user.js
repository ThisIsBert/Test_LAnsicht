// ==UserScript==
// @name         Spektrum.de – Leseransicht
// @namespace    https://github.com/ThisIsBert/Spektrum-Userscripts
// @version      0.4.1
// @downloadURL  https://raw.githubusercontent.com/ThisIsBert/Test_LAnsicht/main/spektrum-leseransicht.user.js
// @updateURL    https://raw.githubusercontent.com/ThisIsBert/Test_LAnsicht/main/spektrum-leseransicht.user.js
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
  const VERSION = '0.4.1';
  const INITIAL_OVERVIEW_COUNT = 12;
  const LAYOUT_KEY = 'spektrum-reader-layout';

  function savedLayout() {
    try { return localStorage.getItem(LAYOUT_KEY) === 'compact' ? 'compact' : 'magazine'; }
    catch { return 'magazine'; }
  }

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
    expanded: false,
    layout: savedLayout(),
    includeSections: false,
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
      if (!/^https?:$/.test(u.protocol)) return false;
      if (!/(^|\.)spektrum\.de$/i.test(u.hostname)) return false;
      if (u.pathname === '/video/partner' || u.pathname.startsWith('/video/partner/')) return false;

      // Rubrik- und Sammelseiten wie /podcast/, /rezension/ oder /leseprobe/
      // gehören nicht in die Leseransicht. Einzelbeiträge tragen bei Spektrum eine ID.
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2 || !/\d{5,}$/.test(parts.at(-1) || '')) return false;

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
    // Choose the nearest individual card, never an outer list's heading.
    return anchor.closest('article, li, .teaser') || anchor.parentElement;
  }

  function isRecommendationLink(anchor) {
    // Read tracking before canonicalUrl removes it. These markers are also
    // available when a carousel is moved or its heading has not loaded yet.
    try {
      const campaign = new URL(anchor.href).searchParams.get('itm_campaign') || '';
      return /^(?:meistgelesen|articles-of-interest)$/i.test(campaign);
    } catch { return false; }
  }

  function currentSectionEnd(scope) {
    // The main editorial stream precedes the named magazine/topic sections.
    // Sidebar headings such as Meistgelesen must not terminate that stream.
    return [...scope.querySelectorAll('.teaser-area, .teaser-category')]
      .find(node => !node.closest('aside, article') && norm(node.textContent)) || null;
  }

  function excludedCollections(scope) {
    const roots = [...scope.querySelectorAll('.kiosk, .product-actions, .advert, .ad-container, .native-ad, .sponsored')];
    for (const heading of scope.querySelectorAll('h2, h3, h4, [role="heading"]')) {
      if (!/^(?:meistgelesen|das beste von spektrum\s*\.\s*de)[.!:]?$/i.test(norm(heading.textContent))) continue;
      // Collection headings sit above their links. Exclude only that occurrence,
      // so an article also present in the normal news stream is still retained.
      for (let block = heading.parentElement; block && block !== scope; block = block.parentElement) {
        if ([...block.querySelectorAll('a[href]')].some(a => isEditorialUrl(a.href))) {
          roots.push(block);
          break;
        }
      }
    }
    return roots;
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
    const titleSelector = [
      '.teaser__wide__title',
      '.teaser__grid__title',
      '.teaser__full__title',
      '.teaser__small__heading',
      '.teaser__large__heading',
      'h1', 'h2', 'h3', 'h4'
    ].join(',');
    const titleEl = anchor.querySelector(titleSelector) || card?.querySelector(titleSelector);

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
    const imageNodes = [...(card?.querySelectorAll('img') || [])];
    // Lazy images may still live inside noscript when document-idle fires.
    for (const node of card?.querySelectorAll('noscript') || []) {
      const template = document.createElement('template');
      template.innerHTML = node.textContent;
      imageNodes.push(...template.content.querySelectorAll('img'));
    }
    const images = imageNodes
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
    if (/^(?:sponsored|partnerinhalte?|neuerscheinungen|abonnement|bestellen)$/i.test(title)) return null;

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

    const richness = item => item.priority + (item.image ? 25 : 0) + (item.teaser ? 8 : 0) + (item.author ? 2 : 0);
    const newWins = oldItem.current !== newItem.current ? newItem.current : richness(newItem) > richness(oldItem);
    const base = { ...(newWins ? newItem : oldItem) };
    const other = newWins ? oldItem : newItem;

    base.order = Math.min(oldItem.order, newItem.order);
    base.priority = Math.max(oldItem.priority, newItem.priority);
    base.featured = oldItem.featured || newItem.featured;
    base.current = oldItem.current || newItem.current;
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
    const excluded = excludedCollections(scope);
    const sectionEnd = currentSectionEnd(scope);
    const anchors = [...scope.querySelectorAll('a[href]')]
      .filter(a => isEditorialUrl(a.href) && !isRecommendationLink(a) && !excluded.some(block => block.contains(a)));
    const byUrl = new Map();

    anchors.forEach((anchor, order) => {
      const candidate = candidateFrom(anchor, order);
      if (!candidate) return;
      candidate.current = !sectionEnd || Boolean(anchor.compareDocumentPosition(sectionEnd) & Node.DOCUMENT_POSITION_FOLLOWING);
      byUrl.set(candidate.url, mergeCandidate(byUrl.get(candidate.url), candidate));
    });

    return [...byUrl.values()].sort((a, b) => a.order - b.order);
  }

  function formatMeta(item) {
    const parts = [];
    if (item.kicker && item.type !== 'news') parts.push(item.typeLabel);
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
      <article class="hero${item.image ? '' : ' hero-text'}" data-type="${escapeHtml(item.type)}">
        <a href="${escapeHtml(item.url)}">
          ${image}
          <div class="hero-copy">
            <div class="meta">${escapeHtml(formatMeta(item))}</div>
            <h2>${escapeHtml(item.title)}</h2>
            ${teaser}
            <span class="read-more">Lesen <span aria-hidden="true">→</span></span>
          </div>
        </a>
      </article>`;
  }

  function visualCardHtml(item) {
    return `
      <article class="visual-card" data-type="${escapeHtml(item.type)}">
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

  function overviewItemHtml(item) {
    return `
      <article class="overview-item" data-type="${escapeHtml(item.type)}">
        <a href="${escapeHtml(item.url)}">
          <div class="overview-copy">
            <div class="overview-meta">${escapeHtml(formatMeta(item))}</div>
            <h3>${escapeHtml(item.title)}</h3>
            ${item.teaser ? `<p>${escapeHtml(item.teaser)}</p>` : ''}
          </div>
          <span class="arrow" aria-hidden="true">→</span>
        </a>
      </article>`;
  }

  function currentItems() {
    return availableItems().filter(item => state.filter === 'all' || item.type === state.filter);
  }

  function availableItems() {
    return state.includeSections ? state.items : state.items.filter(item => item.current);
  }

  function renderFilters(shadow) {
    const items = availableItems();
    if (state.filter !== 'all' && !items.some(item => item.type === state.filter)) state.filter = 'all';
    shadow.querySelector('.filters').innerHTML = filterButtons(items);
    shadow.querySelectorAll('.filter').forEach(btn => {
      const active = btn.dataset.filter === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    shadow.querySelector('#selection-note').textContent = state.includeSections
      ? 'Beiträge aus allen redaktionellen Rubriken.' : 'Der aktuelle Überblick der Startseite.';
  }

  function rankForHero(a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (Boolean(b.image) !== Boolean(a.image)) return Number(Boolean(b.image)) - Number(Boolean(a.image));
    return a.order - b.order;
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

    const compact = state.layout === 'compact';
    const heroPool = list.some(item => item.image) ? list.filter(item => item.image) : list;
    const hero = compact ? null : [...heroPool].sort(rankForHero)[0];
    const remaining = list.filter(item => item.url !== hero?.url);
    const visual = remaining
      .filter(item => !compact && item.image)
      .sort((a, b) => (b.priority - a.priority) || (a.order - b.order))
      .slice(0, 3);

    const visualUrls = new Set(visual.map(item => item.url));
    const overview = remaining.filter(item => !visualUrls.has(item.url));
    const visibleOverview = state.expanded ? overview : overview.slice(0, INITIAL_OVERVIEW_COUNT);
    const hiddenCount = Math.max(0, overview.length - INITIAL_OVERVIEW_COUNT);

    content.innerHTML = `
      ${hero ? heroHtml(hero) : ''}

      ${visual.length ? `
        <section class="visual-section" aria-label="Weitere Themen">
          <div class="visual-grid">${visual.map(visualCardHtml).join('')}</div>
        </section>` : ''}

      ${overview.length ? `
        <section class="overview-section">
          <div class="section-head">
            <h2>${compact ? 'Alle Beiträge' : 'Im Überblick'}</h2>
            <span>${visibleOverview.length} von ${overview.length}</span>
          </div>
          <div id="overview-list" class="overview-list">${visibleOverview.map(overviewItemHtml).join('')}</div>
          ${hiddenCount ? `
            <button id="toggle-more" class="more-button" type="button" aria-expanded="${state.expanded}" aria-controls="overview-list">
              ${state.expanded ? 'Weniger anzeigen' : `${hiddenCount} weitere Beiträge anzeigen`}
            </button>` : ''}
        </section>` : ''}
    `;
  }

  function filterButtons(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.type, (counts.get(item.type) || 0) + 1);

    const preferred = ['news', 'kolumne', 'podcast', 'video', 'frage', 'raetsel', 'rezension', 'wissen', 'leseprobe'];
    const buttons = preferred
      .filter(type => counts.has(type))
      .map(type => `<button class="filter" type="button" data-filter="${type}" aria-pressed="false">${escapeHtml(ALLOWED_TYPES.get(type).plural)} <span>${counts.get(type)}</span></button>`)
      .join('');

    return `<button class="filter is-active" type="button" data-filter="all" aria-pressed="true">Alle <span>${items.length}</span></button>${buttons}`;
  }

  function shellHtml(items) {
    return `
      <div id="reader-shell" class="reader-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <span class="brand-mark">S</span>
              <div><strong>Spektrum</strong><span>Leseransicht · ${VERSION}</span></div>
            </div>
            <nav class="actions" aria-label="Ansicht">
              <button id="refresh" class="icon-button" type="button" title="Inhalte neu einlesen" aria-label="Inhalte neu einlesen">↻</button>
              <button id="show-original" class="secondary" type="button">Originalseite</button>
            </nav>
          </div>
        </header>

        <main class="page">
          <div class="intro">
            <div>
              <p class="eyebrow">Wissenschaft ohne Umwege</p>
              <h1>Was heute lesenswert ist.</h1>
              <p class="intro-copy" id="selection-note">Der aktuelle Überblick der Startseite.</p>
            </div>
            <div class="intro-tools">
              <div id="article-count" class="count" role="status" aria-live="polite" aria-atomic="true"></div>
              <div class="layout-switch" role="group" aria-label="Darstellung">
                <button type="button" data-layout="magazine" aria-pressed="${state.layout === 'magazine'}">Magazin</button>
                <button type="button" data-layout="compact" aria-pressed="${state.layout === 'compact'}">Kompakt</button>
              </div>
            </div>
          </div>
          <label class="section-choice"><input id="include-sections" type="checkbox"> Weitere Rubriken einbeziehen</label>
          <nav class="filters" aria-label="Inhalte filtern">${filterButtons(items.filter(item => item.current))}</nav>
          <div id="reader-content"></div>
          <footer>Leseransicht ${VERSION} · Auswahl aus der geladenen Startseite, keine Sortierung nach Veröffentlichungsdatum.<br>Inhalte und Bilder: Spektrum.de.</footer>
        </main>
      </div>

      <button id="show-reader" class="reader-fab" type="button" hidden>Leseransicht</button>
    `;
  }

  const css = `
    :host { all: initial; display: block; }
    [hidden] { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    button, a { -webkit-tap-highlight-color: transparent; }

    .reader-shell {
      --bg: #f7f7f4;
      --surface: #fff;
      --text: #171717;
      --muted: #6d6d68;
      --soft: #e3e3dd;
      --accent: #b51f32;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      text-rendering: optimizeLegibility;
    }
    .reader-shell a { color: inherit; text-decoration: none; }
    .reader-shell button { font-family: inherit; }
    .reader-shell :is(a, button, input):focus-visible, .reader-fab:focus-visible {
      outline: 2px solid var(--accent, #b51f32);
      outline-offset: 4px;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid color-mix(in srgb, var(--soft) 88%, transparent);
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(18px) saturate(150%);
    }
    .topbar-inner {
      width: min(1180px, calc(100% - 40px));
      min-height: 68px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark {
      width: 30px; height: 30px; border-radius: 9px;
      display: grid; place-items: center;
      background: var(--accent); color: white;
      font: 700 18px/1 Georgia, serif;
    }
    .brand div { display: grid; line-height: 1.05; }
    .brand strong { font-size: 14px; font-weight: 720; }
    .brand div span { margin-top: 4px; color: var(--muted); font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .secondary, .icon-button, .filter, .reader-fab, .more-button {
      border: 1px solid var(--soft);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: transform .15s ease, border-color .15s ease, background .15s ease;
    }
    .secondary:hover, .icon-button:hover, .more-button:hover { border-color: #c8c8c1; transform: translateY(-1px); }
    .secondary { border-radius: 999px; padding: 8px 13px; font-size: 12px; font-weight: 650; }
    .icon-button { width: 36px; height: 36px; border-radius: 50%; font-size: 19px; line-height: 1; }

    .page { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 50px 0 68px; }
    .intro { display: flex; align-items: end; justify-content: space-between; gap: 36px; margin-bottom: 20px; }
    .eyebrow, .meta, .overview-meta {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .intro h1 {
      margin: 0;
      max-width: 760px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(34px, 4vw, 54px);
      line-height: 1.08;
      letter-spacing: -.035em;
      font-weight: 700;
    }
    .intro-copy { max-width: 720px; margin: 12px 0 0; color: var(--muted); font-size: 15px; }
    .intro-tools { display: grid; justify-items: end; gap: 12px; }
    .count { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .section-choice { display: flex; align-items: center; gap: 8px; width: fit-content; margin: 0 0 10px; color: var(--muted); font-size: 12px; cursor: pointer; }
    .section-choice input { accent-color: var(--accent); }
    .layout-switch { display: flex; padding: 3px; border: 1px solid var(--soft); border-radius: 8px; }
    .layout-switch button {
      border: 0; border-radius: 5px; padding: 6px 10px;
      background: transparent; color: var(--muted); cursor: pointer; font-size: 12px;
    }
    .layout-switch button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px #0002; }

    .filters {
      display: flex;
      gap: 18px;
      overflow-x: auto;
      padding: 0 0 13px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--soft);
      scrollbar-width: none;
    }
    .filters::-webkit-scrollbar { display: none; }
    .filter {
      flex: 0 0 auto;
      padding: 9px 0;
      border: 0;
      border-bottom: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
    }
    .filter span { margin-left: 3px; opacity: .68; }
    .filter:hover { color: var(--text); }
    .filter.is-active { border-bottom-color: var(--accent); color: var(--text); font-weight: 700; }

    .hero { margin: 8px 0 42px; }
    .hero > a {
      min-height: 360px;
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, .78fr);
      overflow: hidden;
      border: 1px solid var(--soft);
      background: var(--surface);
    }
    .hero-text > a { grid-template-columns: 1fr; min-height: 0; }
    .hero-image { min-height: 100%; background: #deded8; overflow: hidden; }
    .hero-image img { width: 100%; height: 100%; min-height: 360px; object-fit: cover; display: block; transition: transform .5s ease; }
    .hero > a:hover .hero-image img { transform: scale(1.016); }
    .hero-copy { min-width: 0; overflow-wrap: anywhere; display: flex; flex-direction: column; justify-content: center; padding: clamp(28px, 3.6vw, 50px); }
    .hero-copy h2 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(30px, 3.3vw, 46px);
      line-height: 1.1;
      letter-spacing: -.035em;
      font-weight: 700;
    }
    .hero-copy p { margin: 17px 0 0; color: var(--muted); font-size: 15px; line-height: 1.58; }
    .read-more { margin-top: 27px; font-size: 12px; font-weight: 720; }
    .read-more span { display: inline-block; margin-left: 4px; transition: transform .15s ease; }
    .hero > a:hover .read-more span { transform: translateX(4px); }

    .visual-section { margin: 0 0 60px; }
    .visual-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 34px 22px; }
    .visual-card { min-width: 0; }
    .visual-card a { display: block; }
    .visual-image { aspect-ratio: 16 / 9; overflow: hidden; background: #deded8; }
    .visual-image img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform .35s ease; }
    .visual-card a:hover .visual-image img { transform: scale(1.025); }
    .visual-copy { padding-top: 13px; }
    .visual-copy h2 { margin: 0; font-size: clamp(19px, 1.7vw, 23px); line-height: 1.22; letter-spacing: -.02em; font-weight: 720; text-wrap: balance; }
    .visual-copy p { margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .visual-card a:hover h2, .overview-item a:hover h3 { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }

    .overview-section { width: min(940px, 100%); margin: 0 auto; }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--soft);
    }
    .section-head h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 27px; line-height: 1.1; }
    .section-head span { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .overview-list { display: block; }
    .overview-item { border-bottom: 1px solid var(--soft); }
    .overview-item a {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 24px;
      align-items: center;
      gap: 26px;
      padding: 19px 0;
    }
    .overview-meta { margin: 0 0 6px; line-height: 1.45; }
    .overview-copy { min-width: 0; overflow-wrap: anywhere; }
    .overview-copy h3 { margin: 0; font-size: 21px; line-height: 1.25; letter-spacing: -.018em; font-weight: 690; }
    .overview-copy p { margin: 7px 0 0; max-width: 75ch; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .arrow { color: var(--muted); font-size: 18px; transition: transform .15s ease; }
    .overview-item a:hover .arrow { transform: translateX(4px); color: var(--text); }

    .more-button {
      display: block;
      max-width: 100%;
      margin: 28px auto 0;
      border-radius: 999px;
      padding: 11px 18px;
      font-size: 12px;
      font-weight: 700;
    }

    .empty { margin: 36px 0; padding: 40px; border: 1px solid var(--soft); background: var(--surface); color: var(--muted); }
    footer { width: min(940px, 100%); margin: 68px auto 0; padding-top: 16px; border-top: 1px solid var(--soft); color: var(--muted); font-size: 10px; }

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

    @media (max-width: 900px) {
      .hero > a { grid-template-columns: 1fr; }
      .hero-image img { min-height: 0; aspect-ratio: 16/9; }
      .hero-copy { padding: 28px; }
      .visual-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .intro { flex-wrap: wrap; gap: 20px; }
    }

    @media (max-width: 620px) {
      .topbar-inner, .page { width: min(100% - 24px, 1180px); }
      .topbar-inner { min-height: 60px; }
      .brand div span { display: none; }
      .secondary { padding: 8px 10px; }
      .page { padding-top: 32px; }
      .intro { display: block; }
      .intro-tools { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; }
      .intro-copy { font-size: 14px; }
      .hero { margin-bottom: 34px; }
      .hero-copy { padding: 23px 20px 25px; }
      .visual-grid { grid-template-columns: 1fr; gap: 30px; }
      .visual-section { margin-bottom: 48px; }
      .overview-item a { grid-template-columns: 1fr 18px; gap: 10px; padding: 18px 0; }
      .overview-copy h3 { font-size: 19px; }
      .overview-copy p { font-size: 14px; }
      .section-head h2 { font-size: 24px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }

    @media (prefers-color-scheme: dark) {
      .reader-shell {
        --bg: #10110f;
        --surface: #171816;
        --text: #f1f1ed;
        --muted: #a5a69f;
        --soft: #30312d;
        --accent: #ef6676;
      }
      .hero-image, .visual-image { background: #242521; }
    }
  `;

  function installGlobalStyle() {
    let style = document.getElementById(GLOBAL_STYLE_ID);
    if (style) return;
    style = document.createElement('style');
    style.id = GLOBAL_STYLE_ID;
    style.textContent = `
      html.${ACTIVE_CLASS}, html.${ACTIVE_CLASS} body { margin: 0 !important; padding: 0 !important; background: #10110f !important; }
      html.${ACTIVE_CLASS} body > :not(#${ROOT_ID}) { display: none !important; }
      #${ROOT_ID} { display: block !important; }
    `;
    document.documentElement.appendChild(style);
  }

  function activateReader(shadow) {
    state.active = true;
    state.originalScroll = window.scrollY;
    document.documentElement.classList.add(ACTIVE_CLASS);
    shadow.querySelector('#reader-shell').hidden = false;
    shadow.querySelector('#show-reader').hidden = true;
    requestAnimationFrame(() => window.scrollTo(0, state.readerScroll));
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  function showOriginal(shadow) {
    state.active = false;
    state.readerScroll = window.scrollY;
    document.documentElement.classList.remove(ACTIVE_CLASS);
    shadow.querySelector('#reader-shell').hidden = true;
    shadow.querySelector('#show-reader').hidden = false;
    requestAnimationFrame(() => window.scrollTo(0, state.originalScroll));
  }

  function refresh(shadow) {
    const wasActive = state.active;
    if (wasActive) document.documentElement.classList.remove(ACTIVE_CLASS);
    state.items = extractItems();
    if (wasActive) document.documentElement.classList.add(ACTIVE_CLASS);

    state.filter = 'all';
    state.expanded = false;
    renderFilters(shadow);
    renderContent(shadow);
    scrollToTop();
  }

  function mount() {
    document.getElementById(ROOT_ID)?.remove();
    state.items = extractItems();

    if (!state.items.length) {
      console.warn('[Spektrum Leseransicht] Keine redaktionellen Inhalte gefunden.');
      return;
    }

    installGlobalStyle();

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

    shadow.addEventListener('change', event => {
      if (event.target.id !== 'include-sections') return;
      state.includeSections = event.target.checked;
      state.expanded = false;
      renderFilters(shadow);
      renderContent(shadow);
    });

    shadow.addEventListener('click', event => {
      const filter = event.target.closest('.filter');
      if (filter) {
        state.filter = filter.dataset.filter || 'all';
        state.expanded = false;
        shadow.querySelectorAll('.filter').forEach(btn => {
          btn.classList.toggle('is-active', btn === filter);
          btn.setAttribute('aria-pressed', String(btn === filter));
        });
        renderContent(shadow);
        scrollToTop();
        return;
      }

      const layout = event.target.closest('[data-layout]');
      if (layout) {
        state.layout = layout.dataset.layout;
        state.expanded = false;
        try { localStorage.setItem(LAYOUT_KEY, state.layout); } catch { /* Storage may be blocked. */ }
        shadow.querySelectorAll('[data-layout]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === layout)));
        renderContent(shadow);
        scrollToTop();
        return;
      }

      if (event.target.closest('#toggle-more')) {
        state.expanded = !state.expanded;
        const sectionTop = shadow.querySelector('.overview-section')?.getBoundingClientRect().top + window.scrollY;
        renderContent(shadow);
        shadow.querySelector('#toggle-more')?.focus({ preventScroll: true });
        if (!state.expanded && Number.isFinite(sectionTop)) window.scrollTo({ top: sectionTop - 82, behavior: 'instant' });
        return;
      }

      if (event.target.closest('#show-original')) showOriginal(shadow);
      if (event.target.closest('#show-reader')) activateReader(shadow);
      if (event.target.closest('#refresh')) refresh(shadow);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.active) showOriginal(shadow);
    });

    console.info(`[Spektrum Leseransicht] ${state.items.length} redaktionelle Beiträge geladen.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(mount, 500), { once: true });
  } else {
    setTimeout(mount, 500);
  }
})();
