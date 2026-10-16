"""Offline RSS/browser regressions: python3 -m unittest discover -s tests -v."""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import html
from pathlib import Path
import unittest

from playwright.sync_api import sync_playwright, expect

SOURCE = Path(__file__).resolve().parents[1] / 'spektrum-leseransicht.user.js'
HOME = 'https://www.spektrum.de/'
FEED_PATH = '/alias/rss/spektrum-de-rss-feed/996406'
NOW = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="steelblue"/></svg>'
HOMEPAGE = '''<!doctype html><html lang="de"><meta charset="utf-8"><body>
  <main id="main"><h2>Meistgelesen</h2><article><a href="/news/alt/2345370">
  <h3>Die Relativitätstheorie als Härtetest für die KI</h3></a></article>
  <aside>Anzeige und Shop</aside></main></body></html>'''


def entry(number, hours=0, kind='news', **kwargs):
    return dict(number=number, hours=hours, kind=kind, title=f'Forschungsergebnis {number}', **kwargs)


def feed(items):
    output = ['<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Spektrum.de RSS-Feed</title>']
    for item in items:
        url = item.get('url', f'{HOME}{item["kind"]}/test/{item["number"]}')
        output.append(f'<item><title>{html.escape(item["title"])}</title><link>{html.escape(url)}</link>')
        output.append('<description>' + html.escape(item.get('description', 'Ein kurzer & verständlicher Vorspann.')) + '</description>')
        output.append('<atom:author><atom:name>Beispielautorin</atom:name></atom:author>')
        if item['hours'] is not None:
            output.append('<pubDate>' + format_datetime(NOW - timedelta(hours=item['hours'])) + '</pubDate>')
        if item.get('image', True):
            output.append('<media:content medium="image" type="image/svg+xml" url="https://static.spektrum.de/test-image.svg"/>')
        for category in item.get('categories', []):
            output.append('<category>' + html.escape(category) + '</category>')
        output.append('</item>')
    return ''.join(output) + '</channel></rss>'


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
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900}, timezone_id='Europe/Berlin', reduced_motion='reduce')
        self.page = self.context.new_page()
        self.page.clock.set_fixed_time(NOW)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.items = [entry(10002, hours=4), entry(10003, hours=1, kind='podcast'), entry(10001, hours=0, image=False), entry(10004, hours=100), entry(10005, hours=2, kind='kolumne')]
        self.feed_body = None
        self.feed_status = 200
        self.requests = []
        self.pending = []
        self.defer_feed = False

        def route(request):
            if request.request.url == HOME + FEED_PATH.lstrip('/'):
                self.requests.append(request.request)
                if self.defer_feed:
                    self.pending.append(request)
                else:
                    request.fulfill(status=self.feed_status, content_type='application/rss+xml', body=self.feed_body if self.feed_body is not None else feed(self.items))
            elif request.request.resource_type == 'document':
                request.fulfill(content_type='text/html', body=HOMEPAGE)
            elif request.request.url.endswith('test-image.svg'):
                request.fulfill(content_type='image/svg+xml', body=SVG)
            else:
                request.abort()
        self.page.route('**/*', route)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def load(self, path='', wait=True):
        self.page.goto(HOME + path)
        self.page.add_script_tag(path=str(SOURCE))
        self.reader = self.page.locator('#spektrum-reader-view')
        if wait and not path:
            expect(self.reader.locator('#reader-content')).to_have_attribute('aria-busy', 'false')

    def all_visible_links(self):
        return self.reader.locator('#reader-content article > a').evaluate_all('(els) => els.map(el => el.href)')

    def test_feed_drives_news_order_without_homepage_content(self):
        self.load()
        expect(self.reader.locator('#article-count')).to_have_text('2 Beiträge')
        expect(self.reader.locator('.hero h2')).to_have_text('Forschungsergebnis 10001')
        expect(self.reader.locator('.hero')).to_have_class('hero hero-text')
        expect(self.reader.locator('[data-filter="news"]')).to_have_attribute('aria-pressed', 'true')
        self.assertEqual(self.all_visible_links(), [HOME + 'news/test/10001', HOME + 'news/test/10002'])
        expect(self.reader.locator('#reader-content a[href*="2345370"]')).to_have_count(0)
        expect(self.reader.locator('#reader-content time').first).to_have_attribute('datetime', NOW.isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
        expect(self.page.locator('#main')).to_be_hidden()
        self.assertEqual(len(self.requests), 1)
        expect(self.reader.locator('footer')).to_contain_text('kein vollständiges Archiv')

    def test_period_handles_old_and_unknown_dates(self):
        self.items += [entry(10006, hours=72), entry(10007, hours=None), entry(10008, hours=-12)]
        self.load()
        expect(self.reader.locator('#article-count')).to_have_text('3 Beiträge')
        self.reader.locator('#period').select_option('7')
        expect(self.reader.locator('#article-count')).to_have_text('4 Beiträge')
        self.reader.locator('#period').select_option('all')
        expect(self.reader.locator('#article-count')).to_have_text('6 Beiträge')
        expect(self.reader.locator('#reader-content')).to_contain_text('Datum unbekannt')
        self.assertTrue(self.all_visible_links()[-1].endswith('/10007'))
        self.assertEqual(len(self.requests), 1)  # Filtering does not refetch.

    def test_formats_are_separate_and_empty_news_does_not_fallback(self):
        self.items = [entry(10001, kind='podcast')]
        self.load()
        expect(self.reader.locator('#article-count')).to_have_text('0 Beiträge')
        expect(self.reader.locator('.empty')).to_contain_text('Keine Beiträge')
        expect(self.reader.locator('[data-filter="news"]')).to_have_attribute('aria-pressed', 'true')
        self.reader.locator('[data-filter="podcast"]').click()
        expect(self.reader.locator('#article-count')).to_have_text('1 Beitrag')
        expect(self.reader.locator('#reader-content article')).to_have_attribute('data-type', 'podcast')
        self.reader.locator('[data-filter="all"]').click()
        expect(self.reader.locator('#article-count')).to_have_text('1 Beitrag')

    def test_invalid_feed_retry_and_original_access(self):
        self.feed_body = '<html><body>Fehlerseite</body></html>'
        self.load()
        expect(self.reader.locator('#feed-status')).to_have_attribute('role', 'alert')
        expect(self.reader.locator('#reader-content article')).to_have_count(0)
        expect(self.reader.locator('#retry-feed')).to_be_visible()
        self.reader.locator('#show-original').click()
        expect(self.page.locator('#main')).to_be_visible()
        self.reader.locator('#show-reader').click()
        self.feed_body = None
        self.reader.locator('#retry-feed').click()
        expect(self.reader.locator('#article-count')).to_have_text('2 Beiträge')
        expect(self.reader.locator('#feed-status')).not_to_have_class('feed-status is-error')

    def test_refresh_retains_choices_and_previous_data_on_error(self):
        self.load()
        self.reader.locator('#period').select_option('all')
        self.reader.locator('[data-layout="compact"]').click()
        self.feed_status = 503
        self.reader.locator('#refresh').click()
        expect(self.reader.locator('#feed-status')).to_contain_text('zuletzt geladenen Beiträge bleiben sichtbar')
        expect(self.reader.locator('#article-count')).to_have_text('3 Beiträge')
        self.feed_status = 200
        duplicate = entry(10001, hours=4, url=HOME + 'news/test/10001?tracking=1#fragment')
        self.items += [duplicate, entry(10010, hours=-1)]
        self.page.clock.set_fixed_time(NOW + timedelta(hours=1))
        self.reader.locator('#refresh').click()
        expect(self.reader.locator('#article-count')).to_have_text('4 Beiträge')
        expect(self.reader.locator('.overview-item h3').first).to_have_text('Forschungsergebnis 10010')
        expect(self.reader.locator('#period')).to_have_value('all')
        expect(self.reader.locator('[data-filter="news"]')).to_have_attribute('aria-pressed', 'true')
        expect(self.reader.locator('.hero')).to_have_count(0)
        self.assertEqual(len(self.requests), 3)

    def test_pending_fetch_does_not_force_reader_over_original_view(self):
        self.defer_feed = True
        self.load(wait=False)
        expect(self.reader.locator('#refresh')).to_be_disabled()
        expect(self.reader.locator('#reader-content')).to_have_attribute('aria-busy', 'true')
        self.reader.locator('#show-original').click()
        self.assertEqual(len(self.pending), 1)
        self.pending.pop().fulfill(content_type='application/rss+xml', body=feed(self.items))
        expect(self.reader.locator('#reader-content')).to_have_attribute('aria-busy', 'false')
        expect(self.reader.locator('#reader-shell')).to_be_hidden()
        expect(self.page.locator('#main')).to_be_visible()

    def test_layout_choice_survives_reload_and_blocked_storage(self):
        self.load()
        self.reader.locator('[data-layout="compact"]').click()
        self.load()
        expect(self.reader.locator('[data-layout="compact"]')).to_have_attribute('aria-pressed', 'true')
        expect(self.reader.locator('.hero')).to_have_count(0)
        self.context.add_init_script('Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error("Storage disabled"); };')
        self.load()
        expect(self.reader.locator('.hero')).to_be_visible()
        self.reader.locator('[data-layout="compact"]').click()
        expect(self.reader.locator('.overview-item')).to_have_count(2)

    def test_responsive_themes_keyboard_and_broken_images(self):
        self.load()
        for width in [320, 390, 768, 1280]:
            for theme in ['light', 'dark']:
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.page.emulate_media(color_scheme=theme)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, theme))
                expect(self.reader.locator('.hero')).to_be_visible()
        self.reader.locator('.visual-card img').evaluate('(img) => img.dispatchEvent(new Event("error"))')
        expect(self.reader.locator('.visual-image')).to_have_count(0)
        self.page.keyboard.press('Escape')
        expect(self.reader.locator('#reader-shell')).to_be_hidden()
        self.reader.locator('#show-reader').click()
        expect(self.page.locator('#main')).to_be_hidden()

    def test_feed_markup_and_links_are_safe(self):
        self.items = [entry(10001), entry(10002, url='https://example.com/news/test/10002'), entry(10003, url='javascript:alert(1)'), entry(10004, kind='video', url=HOME + 'video/partner/test/10004'), entry(10005, categories=['Sponsored'])]
        self.items[0]['title'] = '<img src=x onerror="window.injected=true">Titel & Forschung'
        self.items[0]['description'] = '<script>window.injected=true</script><p>Sicherer <strong>Vorspann</strong></p>'
        self.load()
        expect(self.reader.locator('#article-count')).to_have_text('1 Beitrag')
        expect(self.reader.locator('.hero h2')).to_have_text('Titel & Forschung')
        expect(self.reader.locator('.hero-copy p')).to_have_text('Sicherer Vorspann')
        self.assertFalse(self.page.evaluate('Boolean(window.injected)'))
        expect(self.reader.locator('.hero img')).to_have_attribute('src', 'https://static.spektrum.de/test-image.svg')

    def test_expansion_preserves_order_and_keyboard_focus(self):
        self.items = [entry(10000 + i, hours=i) for i in reversed(range(25))]
        self.load()
        expect(self.reader.locator('.overview-item')).to_have_count(12)
        self.reader.locator('#toggle-more').focus()
        self.page.keyboard.press('Enter')
        expect(self.reader.locator('#toggle-more')).to_be_focused()
        expect(self.reader.locator('#toggle-more')).to_have_attribute('aria-expanded', 'true')
        expect(self.reader.locator('.overview-item')).to_have_count(21)
        self.assertEqual(self.all_visible_links(), [HOME + f'news/test/{10000 + i}' for i in range(25)])
        self.page.keyboard.press('Enter')
        expect(self.reader.locator('.overview-item')).to_have_count(12)

    def test_article_pages_are_untouched(self):
        self.load('news/test/10001')
        expect(self.reader).to_have_count(0)
        expect(self.page.locator('#main')).to_be_visible()
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
