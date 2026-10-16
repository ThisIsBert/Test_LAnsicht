"""Browser regressions: python3 -m unittest discover -s tests -v."""
import html
from pathlib import Path
import unittest

from playwright.sync_api import sync_playwright, expect


SOURCE = Path(__file__).resolve().parents[1] / 'spektrum-leseransicht.user.js'
HOME = 'https://www.spektrum.de/'
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"></svg>'


def article(number, title=None, kind='news', image=False):
    picture = '<noscript><img src="/test-image.svg" width="640" height="360" alt="Testbild"></noscript>' if image else ''
    return f'''<article class="teaser teaser__small"><a href="/{kind}/test/{number}">
      <h3 class="teaser__small__heading"><span class="teaser__small__heading__kicker">Forschung</span>
      <span class="show-for-sr">: </span>{html.escape(title or f'Neues aus der Forschung {number}')}</h3>
      <p>Ein kurzer Text zum wissenschaftlichen Beitrag.</p>{picture}</a></article>'''


def homepage():
    # Same sidebar/carousel nesting as the observed Spektrum homepage.
    return f'''<main id="main"><div class="row"><div class="columns medium-8">
      {article(10000, 'Aktuelle Forschung & neue Erkenntnisse', image=True)}
      </div><div class="columns medium-4">
      <aside class="row teaser teaser__list_box"><div><h3 class="teaser-category">Meistgelesen</h3></div>
        <div><ol><li><a href="/news/test/90000">Beliebter älterer Artikel</a></li>
        <li><a href="/news/test/10000">Veralteter Titel aus der Bestenliste</a></li></ol></div>
      </aside></div></div>
      <div class="row"><div class="columns medium-12">
        <div class="teaser-area"><h3>Das Beste von Spektrum.de</h3></div>
        <div class="swiper"><div class="shuffle-teaser">
          {article(90001, 'Ein älterer Evergreen', image=True)}
          {article(10000, 'Anderer Titel im Best-of', image=True)}
        </div></div>
      </div></div>
      <div class="sponsored">{article(90002, 'Gesponserter Beitrag')}</div>
      {''.join(article(11000 + i, image=i < 6) for i in range(25))}
      {''.join(article(12000 + i, kind=kind) for i, kind in enumerate(['kolumne', 'podcast', 'video', 'raetsel', 'frage', 'rezension', 'leseprobe', 'wissen']))}
      <a href="/podcast/">Alle Podcasts</a>
      <article><a href="/video/partner/test/90003"><h3>Partnerinhalt ausschließen</h3></a></article>
      <article><a href="https://example.com/news/test/90004"><h3>Fremde Domain ausschließen</h3></a></article>
    </main>'''


class ReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.markup = homepage()

        def route(request):
            if request.request.resource_type == 'document':
                request.fulfill(content_type='text/html', body='<!doctype html><meta charset="utf-8">' + self.markup)
            elif request.request.url.endswith('test-image.svg'):
                request.fulfill(content_type='image/svg+xml', body=SVG)
            else:
                request.abort()
        self.page.route('**/*', route)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def load(self, path=''):
        self.page.goto(HOME + path)
        self.page.add_script_tag(path=str(SOURCE))
        self.reader = self.page.locator('#spektrum-reader-view')
        if not path:
            expect(self.reader.locator('#reader-content article').first).to_be_visible()

    def test_collections_are_excluded_without_losing_shared_current_articles(self):
        self.load()
        expect(self.reader.locator('#article-count')).to_have_text('34 Beiträge')
        self.reader.locator('#toggle-more').click()
        titles = self.reader.locator('#reader-content article h2, #reader-content article h3').all_text_contents()
        self.assertEqual(titles.count('Aktuelle Forschung & neue Erkenntnisse'), 1)
        self.assertEqual(len(titles), 34)
        for forbidden in ['Meistgelesen', 'Veralteter Titel aus der Bestenliste', 'Anderer Titel im Best-of', 'Ein älterer Evergreen', 'Gesponserter Beitrag']:
            self.assertNotIn(forbidden, titles)
        self.assertFalse(self.reader.locator('#reader-content a[href*="9000"]').count())
        expect(self.reader.locator('.hero img')).to_have_attribute('src', HOME + 'test-image.svg')
        self.assertTrue(self.reader.locator('.hero img').evaluate('(img) => img.complete && img.naturalWidth > 0'))

    def test_nearest_list_item_supplies_title_not_surrounding_teaser(self):
        self.markup = '''<main><aside class="teaser"><h3>Weitere Nachrichten</h3><ul>
          <li><a href="/news/test/10000">Der erste richtige Artikeltitel</a></li>
          <li><a href="/news/test/10001">Der zweite richtige Artikeltitel</a></li>
          </ul></aside></main>'''
        self.load()
        titles = self.reader.locator('#reader-content article h2, #reader-content article h3').all_text_contents()
        self.assertIn('Der erste richtige Artikeltitel', titles)
        self.assertIn('Der zweite richtige Artikeltitel', titles)
        self.assertNotIn('Weitere Nachrichten', titles)
        self.assertEqual(self.reader.locator('.hero > a').evaluate('(el) => getComputedStyle(el).gridTemplateColumns').count(' '), 0)

    def test_compact_layout_filters_and_preference_survive_reload(self):
        self.load()
        self.reader.locator('[data-layout="compact"]').click()
        expect(self.reader.locator('.hero, .visual-card')).to_have_count(0)
        expect(self.reader.locator('.overview-item')).to_have_count(12)
        expect(self.reader.locator('.overview-item h3').first).to_have_text('Aktuelle Forschung & neue Erkenntnisse')
        self.reader.locator('[data-filter="kolumne"]').click()
        expect(self.reader.locator('[data-filter="kolumne"]')).to_have_attribute('aria-pressed', 'true')
        expect(self.reader.locator('[data-filter="all"]')).to_have_attribute('aria-pressed', 'false')
        expect(self.reader.locator('#article-count')).to_have_text('1 Beitrag')
        self.load()
        expect(self.reader.locator('[data-layout="compact"]')).to_have_attribute('aria-pressed', 'true')
        expect(self.reader.locator('.hero, .visual-card')).to_have_count(0)
        self.reader.locator('[data-layout="magazine"]').click()
        expect(self.reader.locator('.hero')).to_be_visible()
        expect(self.reader.locator('.visual-card')).to_have_count(3)

    def test_blocked_storage_does_not_break_startup_or_layout_switch(self):
        self.context.add_init_script('''Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };''')
        self.load()
        expect(self.reader.locator('.hero')).to_be_visible()
        self.reader.locator('[data-layout="compact"]').click()
        expect(self.reader.locator('.overview-item')).to_have_count(12)
        expect(self.reader.locator('.hero')).to_have_count(0)

    def test_expansion_keeps_keyboard_focus_and_refresh_excludes_new_collection(self):
        self.load()
        self.reader.locator('#toggle-more').focus()
        self.page.keyboard.press('Enter')
        expect(self.reader.locator('#toggle-more')).to_be_focused()
        expect(self.reader.locator('#toggle-more')).to_have_attribute('aria-expanded', 'true')
        expect(self.reader.locator('.overview-item')).to_have_count(30)
        self.page.keyboard.press('Enter')
        expect(self.reader.locator('#toggle-more')).to_have_attribute('aria-expanded', 'false')
        expect(self.reader.locator('.overview-item')).to_have_count(12)
        self.page.locator('#main').evaluate('(el) => el.insertAdjacentHTML("beforeend", `<section><h2>Meistgelesen</h2><a href="/news/test/90005">Noch ein älterer Artikel</a></section>`)')
        self.reader.locator('#refresh').click()
        expect(self.reader.locator('#article-count')).to_have_text('34 Beiträge')

    def test_responsive_layout_and_accessible_view_switch(self):
        self.load()
        expect(self.reader.locator('h1')).to_have_count(1)
        for width in [320, 390, 768, 1280]:
            for theme in ['light', 'dark']:
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.page.emulate_media(color_scheme=theme)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, theme))
                expect(self.reader.locator('.hero')).to_be_visible()
                self.reader.locator('#show-original').click()
                expect(self.page.locator('#main')).to_be_visible()
                self.reader.locator('#show-reader').click()
                expect(self.page.locator('#main')).to_be_hidden()
        self.page.keyboard.press('Escape')
        expect(self.reader.locator('#reader-shell')).to_be_hidden()


if __name__ == '__main__':
    unittest.main()
