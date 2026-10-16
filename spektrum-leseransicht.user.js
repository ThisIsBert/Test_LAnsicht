// ==UserScript==
// @name         Spektrum.de – Leseransicht
// @namespace    https://github.com/ThisIsBert/Spektrum-Userscripts
// @version      0.6.0
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
  const VERSION = '0.6.0';
  const FEED_PATH = '/alias/rss/spektrum-de-rss-feed/996406';
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
    filter: 'news',
    items: [],
    pageItems: [],
    feedItems: [],
    expanded: false,
    undatedExpanded: false,
    layout: savedLayout(),
    days: '3',
    loading: false,
    error: false,
    updatedAt: null,
    readerScroll: 0,
    originalScroll: 0
  };

  const norm = (s = '') => String(s).replace(/\s+/g, ' ').trim();
  const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));

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

  function plainText(value) {
    const template = document.createElement('template');
    template.innerHTML = value || '';
    template.content.querySelectorAll('script, style, iframe, object').forEach(node => node.remove());
    return norm(template.content.textContent);
  }

  function articleKey(url) {
    const parsed = new URL(url, location.href);
    return `${parsed.hostname.replace(/^www\./, '')}:${parsed.pathname.split('/').filter(Boolean).at(-1)}`;
  }

  function publisherImage(value, alt = '') {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || !/(^|\.)spektrum\.de$/i.test(url.hostname)) return null;
      return { src: url.href, alt: norm(alt) };
    } catch { return null; }
  }

  function excludedPageBlocks(scope) {
    const excluded = [...scope.querySelectorAll('.kiosk, [class*="kiosk__"], .product-actions, .advert, .ad-container, .native-ad, .sponsored')];
    for (const heading of scope.querySelectorAll('h2, h3, h4, [role="heading"]')) {
      if (!/^(?:meistgelesen|das beste von spektrum\s*\.\s*de|(?:sponsored\s*)?partnerinhalte?|werbung|anzeige|topseller)[.!:]?$/i.test(norm(heading.textContent))) continue;
      for (let block = heading.parentElement; block && block !== scope; block = block.parentElement) {
        if ([...block.querySelectorAll('a[href]')].some(a => isEditorialUrl(a.href))) {
          excluded.push(block);
          break;
        }
      }
    }
    return excluded;
  }

  function pageImage(card) {
    const images = [...card.querySelectorAll('img')].filter(img => !img.closest('.author-img-wrap'));
    for (const node of card.querySelectorAll('noscript')) {
      if (node.closest('.author-img-wrap')) continue;
      const template = document.createElement('template');
      template.innerHTML = node.textContent;
      images.push(...template.content.querySelectorAll('img'));
    }
    return images.filter(img => !img.matches('.image__author') && !/avatar|logo|icon/i.test(img.className))
      .map(img => {
        const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset') || '';
        const largest = srcset.split(',').map(part => part.trim().split(/\s+/))
          .sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0))[0]?.[0];
        const value = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || largest || img.getAttribute('src');
        const image = publisherImage(value, img.getAttribute('alt') || '');
        const dimensions = image?.src.match(/(?:f|[?&]f=)(\d+)x(\d+)/);
        const quality = (Number(dimensions?.[1]) * Number(dimensions?.[2])) || (img.width * img.height) || 1;
        return { image, quality };
      }).filter(item => item.image).sort((a, b) => b.quality - a.quality)[0]?.image || null;
  }

  function extractPageItems() {
    const scope = document.querySelector('#main') || document.querySelector('main');
    if (!scope) return [];
    const excluded = excludedPageBlocks(scope);
    const byId = new Map();
    for (const anchor of scope.querySelectorAll('a[href]')) {
      if (!isEditorialUrl(anchor.href) || anchor.closest('nav') || excluded.some(block => block.contains(anchor))) continue;
      const campaign = new URL(anchor.href).searchParams.get('itm_campaign') || '';
      if (/^(?:meistgelesen|articles-of-interest)$/i.test(campaign)) continue;
      const card = anchor.closest('article, li, .teaser');
      if (!card) continue;
      const headingSelector = '[class*="__title"], [class*="__heading"], h1, h2, h3, h4';
      const heading = anchor.querySelector(headingSelector) || card.querySelector(headingSelector);
      const clone = heading?.cloneNode(true);
      clone?.querySelectorAll('[class*="kicker"], .show-for-sr').forEach(node => node.remove());
      const title = norm(clone?.textContent || anchor.textContent);
      if (!title || /^(?:meistgelesen|das beste von spektrum\.de|anzeige|werbung|sponsored)$/i.test(title)) continue;
      const url = canonicalUrl(anchor.href);
      const type = getType(url);
      const dateNode = card.querySelector('[itemprop="datePublished"], time[datetime]:not([itemprop="dateModified"])');
      const date = Date.parse(dateNode?.getAttribute('content') || dateNode?.getAttribute('datetime') || '');
      const entry = {
        url, type, title, typeLabel: ALLOWED_TYPES.get(type).label,
        teaser: norm(card.querySelector('[class*="__text"], p')?.textContent),
        image: pageImage(card), publishedAt: Number.isFinite(date) ? date : null,
        author: norm(card.querySelector('[class*="__author"]')?.textContent).replace(/^von\s+/i, ''),
        fromPage: true, fromFeed: false
      };
      const key = articleKey(url);
      const previous = byId.get(key);
      byId.set(key, previous ? {
        ...previous, image: previous.image || entry.image, teaser: previous.teaser || entry.teaser,
        author: previous.author || entry.author, publishedAt: previous.publishedAt ?? entry.publishedAt
      } : entry);
    }
    return [...byId.values()];
  }

  function mergeSources() {
    const byId = new Map(state.pageItems.map(item => [articleKey(item.url), item]));
    for (const feed of state.feedItems) {
      const key = articleKey(feed.url);
      const page = byId.get(key);
      byId.set(key, page ? {
        ...feed, title: page.title || feed.title, image: page.image || feed.image,
        teaser: feed.teaser || page.teaser, author: feed.author || page.author,
        publishedAt: feed.publishedAt ?? page.publishedAt, fromPage: true
      } : feed);
    }
    state.items = [...byId.values()].sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity));
  }

  function feedImage(item) {
    const media = [...item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'content')]
      .find(node => node.getAttribute('medium') === 'image' || /^image\//i.test(node.getAttribute('type') || ''));
    const enclosure = [...item.querySelectorAll('enclosure')]
      .find(node => /^image\//i.test(node.getAttribute('type') || ''));
    const value = media?.getAttribute('url') || enclosure?.getAttribute('url');
    return publisherImage(value);
  }

  function parseFeed(text) {
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror') || !xml.querySelector('rss > channel')) throw new Error('Invalid RSS feed');
    const byUrl = new Map();
    for (const item of xml.querySelectorAll('channel > item')) {
      const url = canonicalUrl(norm(item.querySelector('link')?.textContent));
      if (!isEditorialUrl(url)) continue;
      const categories = [...item.querySelectorAll('category')].map(node => norm(node.textContent));
      if (categories.some(label => /^(?:anzeige|werbung|sponsored|partnerinhalte?)$/i.test(label))) continue;
      const title = plainText(item.querySelector('title')?.textContent);
      if (!title) continue;
      const type = getType(url);
      const timestamp = Date.parse(item.querySelector('pubDate')?.textContent || '');
      const publishedAt = Number.isFinite(timestamp) ? timestamp : null;
      const author = [...item.getElementsByTagNameNS('http://www.w3.org/2005/Atom', 'name')]
        .map(node => norm(node.textContent)).filter(Boolean).join(', ');
      const entry = {
        url, type, title, typeLabel: ALLOWED_TYPES.get(type).label,
        teaser: plainText(item.querySelector('description')?.textContent),
        image: feedImage(item), author, publishedAt, fromFeed: true, fromPage: false
      };
      const key = articleKey(url);
      const previous = byUrl.get(key);
      if (!previous || (publishedAt ?? -Infinity) > (previous.publishedAt ?? -Infinity)) byUrl.set(key, entry);
    }
    // Stable chronological order; undated items keep their source order.
    return [...byUrl.values()].sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity));
  }

  function dateHtml(item) {
    if (item.publishedAt === null) return '<span>Datum unbekannt</span>';
    const date = new Date(item.publishedAt);
    const label = date.toLocaleString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<time datetime="${date.toISOString()}" title="${escapeHtml(date.toLocaleString('de-DE'))}">${escapeHtml(label)}</time>`;
  }

  function formatMeta(item) {
    const author = item.type === 'kolumne' && item.author ? ` · ${escapeHtml(item.author)}` : '';
    return `${escapeHtml(item.typeLabel)} · ${dateHtml(item)}${author}`;
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
            <div class="meta">${formatMeta(item)}</div>
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
          ${item.image ? `<div class="visual-image"><img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}" loading="lazy"></div>` : ''}
          <div class="visual-copy">
            <div class="meta">${formatMeta(item)}</div>
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
            <div class="overview-meta">${formatMeta(item)}</div>
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
    if (state.days === 'all') return state.items;
    const now = Date.now();
    const cutoff = now - Number(state.days) * 86400000;
    return state.items.filter(item => item.publishedAt === null || (item.publishedAt >= cutoff && item.publishedAt <= now));
  }

  function renderFilters(shadow) {
    shadow.querySelector('.filters').innerHTML = filterButtons(availableItems());
  }

  function renderFeedStatus(shadow) {
    const status = shadow.querySelector('#feed-status');
    status.classList.toggle('is-error', state.error);
    status.setAttribute('role', state.error ? 'alert' : 'status');
    status.textContent = state.loading ? 'Webseite und Feed werden abgeglichen …'
      : state.error ? (state.updatedAt ? 'Datumsabgleich fehlgeschlagen. Die zuletzt geladenen Beiträge bleiben sichtbar.' : 'Feed nicht erreichbar. Beiträge der Startseite bleiben ohne RSS-Ergänzung verfügbar.')
      : `Abgeglichen: ${state.updatedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${state.pageItems.length} Webseitenbeiträge · ${state.feedItems.length} Feed-Beiträge`;
    shadow.querySelector('#reader-content').setAttribute('aria-busy', String(state.loading));
    shadow.querySelector('#refresh').disabled = state.loading;
  }

  function undatedHtml(items) {
    if (!items.length) return '';
    const visible = state.undatedExpanded ? items : items.slice(0, INITIAL_OVERVIEW_COUNT);
    const title = items.some(item => item.fromPage) ? 'Weitere Beiträge der Startseite' : 'Beiträge ohne Datum';
    return `<section id="undated-section" class="overview-section undated-section" aria-label="${title}">
      <div class="section-head"><h2>${title}</h2><span>${visible.length} von ${items.length}</span></div>
      <p class="section-note">Ohne verlässliche Datumsangabe. Diese Beiträge bleiben unabhängig vom gewählten Zeitraum sichtbar.</p>
      <div id="undated-list">${visible.map(overviewItemHtml).join('')}</div>
      ${items.length > INITIAL_OVERVIEW_COUNT ? `<button id="toggle-undated" class="more-button" type="button" aria-expanded="${state.undatedExpanded}" aria-controls="undated-list">${state.undatedExpanded ? 'Weniger anzeigen' : `${items.length - INITIAL_OVERVIEW_COUNT} weitere Beiträge anzeigen`}</button>` : ''}
    </section>`;
  }

  function renderContent(shadow) {
    const selection = currentItems();
    const list = selection.filter(item => item.publishedAt !== null);
    const undated = selection.filter(item => item.publishedAt === null);
    const content = shadow.querySelector('#reader-content');
    const count = shadow.querySelector('#article-count');
    if (!content || !count) return;

    count.textContent = `${selection.length} ${selection.length === 1 ? 'Beitrag' : 'Beiträge'}`;

    if (!selection.length) {
      content.innerHTML = state.loading ? '<div class="empty">Die neuesten Beiträge werden geladen …</div>'
        : state.error && !state.updatedAt ? '<div class="empty"><strong>Der Nachrichtenabruf ist fehlgeschlagen.</strong><p><button class="secondary" type="button" id="retry-feed">Erneut versuchen</button></p></div>'
        : '<div class="empty"><strong>Keine Beiträge in dieser Auswahl.</strong><br>Wähle einen anderen Zeitraum oder „Alle Formate“.</div>';
      return;
    }

    if (!list.length) {
      content.innerHTML = undatedHtml(undated);
      return;
    }

    const compact = state.layout === 'compact';
    const hero = compact ? null : list[0];
    const remaining = list.filter(item => item.url !== hero?.url);
    const visual = compact ? [] : remaining.slice(0, 3);

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
            <h2>${compact ? 'Nach Datum geordnet' : 'Im Überblick'}</h2>
            <span>${visibleOverview.length} von ${overview.length}</span>
          </div>
          <div id="overview-list" class="overview-list">${visibleOverview.map(overviewItemHtml).join('')}</div>
          ${hiddenCount ? `
            <button id="toggle-more" class="more-button" type="button" aria-expanded="${state.expanded}" aria-controls="overview-list">
              ${state.expanded ? 'Weniger anzeigen' : `${hiddenCount} weitere Beiträge anzeigen`}
            </button>` : ''}
        </section>` : ''}
      ${undatedHtml(undated)}
    `;
  }

  function filterButtons(items) {
    const counts = new Map();
    for (const item of items) counts.set(item.type, (counts.get(item.type) || 0) + 1);

    const preferred = ['news', 'kolumne', 'podcast', 'video', 'frage', 'raetsel', 'rezension', 'wissen', 'leseprobe'];
    const buttons = preferred
      .filter(type => counts.has(type) || type === 'news' || type === state.filter)
      .map(type => `<button class="filter${state.filter === type ? ' is-active' : ''}" type="button" data-filter="${type}" aria-pressed="${state.filter === type}">${escapeHtml(ALLOWED_TYPES.get(type).plural)} <span>${counts.get(type) || 0}</span></button>`)
      .join('');

    return `<button class="filter${state.filter === 'all' ? ' is-active' : ''}" type="button" data-filter="all" aria-pressed="${state.filter === 'all'}">Alle Formate <span>${items.length}</span></button>${buttons}`;
  }

  function shellHtml() {
    return `
      <div id="reader-shell" class="reader-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="brand">
              <span class="brand-mark">S</span>
              <div><strong>Spektrum</strong><span>Leseransicht · ${VERSION}</span></div>
            </div>
            <nav class="actions" aria-label="Ansicht">
              <button id="refresh" class="icon-button" type="button" title="Neue Beiträge laden" aria-label="Neue Beiträge laden">↻</button>
              <button id="show-original" class="secondary" type="button">Originalseite</button>
            </nav>
          </div>
        </header>

        <main class="page">
          <div class="intro">
            <div>
              <p class="eyebrow">Wissenschaft ohne Umwege</p>
              <h1>Spektrum, aufgeräumt.</h1>
              <p class="intro-copy">Nachrichten, Kolumnen und mehr. In Ruhe lesen.</p>
            </div>
            <div class="intro-tools">
              <div id="article-count" class="count" role="status" aria-live="polite" aria-atomic="true"></div>
              <div class="layout-switch" role="group" aria-label="Darstellung">
                <button type="button" data-layout="magazine" aria-pressed="${state.layout === 'magazine'}">Magazin</button>
                <button type="button" data-layout="compact" aria-pressed="${state.layout === 'compact'}">Kompakt</button>
              </div>
            </div>
          </div>
          <div class="feed-tools">
            <label class="period-choice">Zeitraum <select id="period">
              <option value="3">Letzte 3 Tage</option><option value="7">Letzte 7 Tage</option><option value="all">Alle datierten Beiträge</option>
            </select></label>
            <div id="feed-status" class="feed-status" role="status" aria-live="polite"></div>
          </div>
          <nav class="filters" aria-label="Formate filtern">${filterButtons([])}</nav>
          <div id="reader-content"></div>
          <footer>Leseransicht ${VERSION} · Inhalte und Bilder: Spektrum.de.<br>Quellen: geladene Startseite und <a href="${FEED_PATH}">RSS-Feed</a> (kein vollständiges Archiv). Undatierte Beiträge stehen separat.</footer>
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
    .reader-shell :is(a, button, select):focus-visible, .reader-fab:focus-visible {
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
    .feed-tools { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
    .period-choice { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .period-choice select { max-width: 100%; border: 1px solid var(--soft); border-radius: 6px; padding: 7px; background: var(--surface); color: var(--text); font: inherit; }
    .feed-status { color: var(--muted); font-size: 12px; }
    .feed-status.is-error { color: var(--accent); }
    button:disabled { opacity: .5; cursor: wait; }
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
    .undated-section { margin-top: 48px; }
    .section-note { color: var(--muted); font-size: 13px; line-height: 1.5; }
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

  async function refresh(shadow) {
    if (state.loading) return;
    state.pageItems = extractPageItems();
    mergeSources();
    state.loading = true;
    state.error = false;
    renderFeedStatus(shadow);
    if (!state.updatedAt) renderContent(shadow);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(new URL(FEED_PATH, location.origin), {
        credentials: 'omit', cache: 'no-cache', signal: controller.signal
      });
      if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
      state.feedItems = parseFeed(await response.text());
      state.updatedAt = new Date();
      state.expanded = false;
      state.undatedExpanded = false;
    } catch (error) {
      state.error = true;
      console.warn('[Spektrum Leseransicht] RSS konnte nicht geladen werden:', error.message);
    } finally {
      clearTimeout(timer);
      state.loading = false;
      mergeSources();
      renderFilters(shadow);
      renderContent(shadow);
      renderFeedStatus(shadow);
    }
  }

  function mount() {
    document.getElementById(ROOT_ID)?.remove();
    installGlobalStyle();

    const host = document.createElement('div');
    host.id = ROOT_ID;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = shellHtml();
    while (wrapper.firstChild) shadow.appendChild(wrapper.firstChild);

    renderContent(shadow);
    document.documentElement.classList.add(ACTIVE_CLASS);

    shadow.addEventListener('change', event => {
      if (event.target.id !== 'period') return;
      state.days = event.target.value;
      state.expanded = false;
      state.undatedExpanded = false;
      renderFilters(shadow);
      renderContent(shadow);
    });

    shadow.addEventListener('click', event => {
      const filter = event.target.closest('.filter');
      if (filter) {
        state.filter = filter.dataset.filter || 'all';
        state.expanded = false;
        state.undatedExpanded = false;
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
        state.undatedExpanded = false;
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

      if (event.target.closest('#toggle-undated')) {
        state.undatedExpanded = !state.undatedExpanded;
        const top = shadow.querySelector('#undated-section').getBoundingClientRect().top + window.scrollY;
        renderContent(shadow);
        shadow.querySelector('#toggle-undated')?.focus({ preventScroll: true });
        if (!state.undatedExpanded) window.scrollTo({ top: top - 82, behavior: 'instant' });
        return;
      }

      if (event.target.closest('#show-original')) showOriginal(shadow);
      if (event.target.closest('#show-reader')) activateReader(shadow);
      if (event.target.closest('#refresh, #retry-feed')) void refresh(shadow);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.active) showOriginal(shadow);
    });

    // Broken publisher images should leave a clean text layout.
    shadow.addEventListener('error', event => {
      if (!event.target.matches?.('img')) return;
      const hero = event.target.closest('.hero');
      if (hero) hero.classList.add('hero-text');
      event.target.closest('.hero-image, .visual-image')?.remove();
    }, true);

    void refresh(shadow);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
