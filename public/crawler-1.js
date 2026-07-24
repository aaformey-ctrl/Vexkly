// crawler.js
// A polite, breadth-first web crawler.
//
// Usage:
//   node crawler.js
//
// Configure SEED_URLS, MAX_PAGES, MAX_DEPTH below. Run `npm run crawl` to start.
// Respects a basic robots.txt disallow check and rate-limits requests per domain.

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./db');

// ---- CONFIG ----
const SEED_URLS = [
  'https://en.wikipedia.org/wiki/Web_search_engine',
  'https://en.wikipedia.org/wiki/Ghana',
  'https://en.wikipedia.org/wiki/Node.js',
  'https://en.wikipedia.org/wiki/Artificial_intelligence'
  // Add more seed URLs here. General news/wiki/blog sites work well to start.
];
const MAX_PAGES = 200;        // stop after indexing this many pages (keep small for a first test run)
const MAX_DEPTH = 2;          // how many link-hops from a seed URL to follow
const REQUEST_DELAY_MS = 800; // politeness delay between requests to the same-ish crawl
const USER_AGENT = 'VexklyBot/1.0 (+https://example.com/bot)';
const TIMEOUT_MS = 10000;
// ----------------

const robotsCache = new Map(); // domain -> array of disallowed path prefixes

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDisallowedPaths(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let disallowed = [];
  try {
    const res = await axios.get(`${origin}/robots.txt`, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT }
    });
    const lines = res.data.split('\n');
    let applies = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (/^user-agent:\s*\*/i.test(line)) applies = true;
      else if (/^user-agent:/i.test(line)) applies = false;
      else if (applies && /^disallow:/i.test(line)) {
        const path = line.split(':')[1]?.trim();
        if (path) disallowed.push(path);
      }
    }
  } catch (e) {
    // No robots.txt or couldn't fetch it -> assume everything allowed
  }
  robotsCache.set(origin, disallowed);
  return disallowed;
}

async function isAllowed(url) {
  try {
    const u = new URL(url);
    const disallowed = await getDisallowedPaths(u.origin);
    return !disallowed.some(p => p && u.pathname.startsWith(p));
  } catch {
    return false;
  }
}

function normalizeUrl(base, href) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    // Only keep http(s) links
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxContentLength: 5 * 1024 * 1024, // 5MB cap
    validateStatus: s => s === 200
  });
  const contentType = res.headers['content-type'] || '';
  if (!contentType.includes('text/html')) return null;
  return res.data;
}

function extractContent(html, url) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, noscript, iframe').remove();

  const title = $('title').first().text().trim().slice(0, 300);
  const description = $('meta[name="description"]').attr('content')?.trim().slice(0, 500) || '';

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(url, href);
    if (normalized) links.push(normalized);
  });

  return { title, description, bodyText, links };
}

function savePage(url, title, description, content) {
  const upsert = db.prepare(`
    INSERT INTO pages (url, title, description, content, word_count)
    VALUES (@url, @title, @description, @content, @word_count)
    ON CONFLICT(url) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      content=excluded.content,
      word_count=excluded.word_count,
      crawled_at=CURRENT_TIMESTAMP
  `);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const info = upsert.run({ url, title, description, content, word_count: wordCount });
  // Get the page id whether inserted or updated
  const row = db.prepare('SELECT id FROM pages WHERE url = ?').get(url);
  return row.id;
}

async function crawl() {
  console.log(`Starting crawl. Seeds: ${SEED_URLS.length}, max pages: ${MAX_PAGES}, max depth: ${MAX_DEPTH}`);

  const visited = new Set();
  const queue = SEED_URLS.map(url => ({ url, depth: 0 }));
  let pagesSaved = 0;

  while (queue.length > 0 && pagesSaved < MAX_PAGES) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > MAX_DEPTH) continue;
    visited.add(url);

    const allowed = await isAllowed(url);
    if (!allowed) {
      console.log(`SKIP (robots.txt disallows): ${url}`);
      continue;
    }

    try {
      console.log(`Fetching [depth ${depth}]: ${url}`);
      const html = await fetchPage(url);
      if (!html) { console.log(`  -> skipped (not HTML)`); await sleep(REQUEST_DELAY_MS); continue; }

      const { title, description, bodyText, links } = extractContent(html, url);
      if (!bodyText || bodyText.length < 200) {
        console.log(`  -> skipped (too little content)`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const pageId = savePage(url, title, description, bodyText);
      pagesSaved++;
      console.log(`  -> saved (id ${pageId}, ${bodyText.length} chars, title: "${title.slice(0,60)}")`);

      if (depth < MAX_DEPTH) {
        for (const link of links) {
          if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch (err) {
      console.log(`  -> FAILED: ${err.message}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nCrawl finished. Pages saved: ${pagesSaved}`);
  console.log(`Run "node indexer.js" next to build the search index.`);
}

crawl().catch(err => {
  console.error('Crawl error:', err);
  process.exit(1);
});
