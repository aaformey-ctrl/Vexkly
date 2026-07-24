// server.js
// Express app exposing:
//   GET /search?q=...   -> JSON search results
//   GET /                -> simple search UI (public/index.html)
//   GET /stats            -> basic index stats (page count, term count)

const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { search } = require('./search');
const { verifyGoogleToken, upsertUser, attachUser } = require('./auth');
const { crawl } = require('./crawler');
const { buildIndex } = require('./indexer');

const app = express();
const PORT = process.env.PORT || 3000;

let crawlStatus = { running: false, lastResult: null, lastError: null };

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    secure: process.env.NODE_ENV === 'production', // requires HTTPS in production (Render provides this)
    httpOnly: true
  }
}));
app.use(attachUser);

app.use(express.static(path.join(__dirname, 'public')));

// Client sends the Google ID token here after a successful Google Sign-In on the frontend.
app.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    const payload = await verifyGoogleToken(idToken);
    const user = upsertUser(payload);

    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture });
  } catch (err) {
    console.error('Google sign-in failed:', err.message);
    res.status(401).json({ error: 'Sign-in verification failed' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Frontend fetches this on load to get the Google Client ID (kept out of the HTML source)
app.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// Lets the frontend check "am I logged in?" on page load
app.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, ...req.user });
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ query: q, results: [], count: 0 });

  const start = Date.now();
  const results = search(q, 20);
  const timeMs = Date.now() - start;

  res.json({ query: q, results, count: results.length, timeMs });
});

app.get('/stats', (req, res) => {
  const pages = db.prepare('SELECT COUNT(*) as c FROM pages').get().c;
  const terms = db.prepare('SELECT COUNT(*) as c FROM terms').get().c;
  res.json({ pagesIndexed: pages, uniqueTerms: terms });
});

// --- Admin: trigger crawl + index without needing Shell access (useful on free Render tier) ---
// Visit: https://your-app.onrender.com/admin/crawl?key=YOUR_ADMIN_KEY
// Set ADMIN_KEY as an environment variable on Render — pick your own secret string.
function requireAdminKey(req, res, next) {
  const key = req.query.key;
  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({ error: 'ADMIN_KEY is not set on the server' });
  }
  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid or missing admin key' });
  }
  next();
}

app.get('/admin/crawl', requireAdminKey, (req, res) => {
  if (crawlStatus.running) {
    return res.json({ started: false, message: 'A crawl is already running.', status: crawlStatus });
  }

  crawlStatus = { running: true, lastResult: null, lastError: null };
  res.json({ started: true, message: 'Crawl started in the background. Check /admin/status for progress.' });

  // Run crawl then indexing in the background; response has already been sent.
  crawl()
    .then((pagesSaved) => {
      const indexResult = buildIndex();
      crawlStatus = {
        running: false,
        lastResult: { pagesSaved, ...indexResult, finishedAt: new Date().toISOString() },
        lastError: null
      };
    })
    .catch((err) => {
      crawlStatus = { running: false, lastResult: null, lastError: err.message };
    });
});

app.get('/admin/status', requireAdminKey, (req, res) => {
  res.json(crawlStatus);
});

app.listen(PORT, () => {
  console.log(`Vexkly running at http://localhost:${PORT}`);
});

  
