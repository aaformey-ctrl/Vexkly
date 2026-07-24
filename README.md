# Vexkly — a real, self-built search engine

Crawler → inverted index → BM25 ranking → Express search UI. No third-party search API used.

## How it works
1. **crawler.js** — breadth-first crawls the seed URLs, follows links up to `MAX_DEPTH`,
   respects basic robots.txt rules, saves page text into SQLite (`pages` table).
2. **indexer.js** — reads every saved page, tokenizes the text, and builds an inverted index
   (`postings` table: term → page → frequency; `terms` table: term → how many pages contain it).
3. **search.js** — given a query, ranks matching pages using BM25 (standard relevance algorithm
   used by real search engines and Elasticsearch).
4. **server.js** + **public/index.html** — Express API (`/search?q=...`) and a Google-style search UI.

## Setup (run these on your machine / Render build step — this sandbox has no internet access)
```bash
cd search-engine
npm install
```

## Run it
```bash
# Step 1: crawl (populates search.db)
npm run crawl

# Step 2: build the index from crawled pages
node indexer.js

# Step 3: start the search UI
npm start
```
Then open http://localhost:3000

## Running the crawl on Render's free tier (no Shell access)
Render's free plan doesn't include Shell access. Instead, Vexkly exposes a protected admin
endpoint to trigger the crawl remotely:

1. Set an `ADMIN_KEY` environment variable on Render — any secret string you choose, e.g. `ADMIN_KEY=letMeC0ntrol`
2. Visit in your browser: `https://your-app.onrender.com/admin/crawl?key=YOUR_ADMIN_KEY`
   - This starts the crawl + indexing in the background and responds immediately
3. Check progress at: `https://your-app.onrender.com/admin/status?key=YOUR_ADMIN_KEY`
   - Shows `running: true` while in progress, then `lastResult` with page/term counts when done
4. Once `running` is `false` and `lastResult` is populated, go back to the main site and search

Keep your `ADMIN_KEY` secret — anyone with it can trigger a crawl on your site.

## Growing the crawl
Edit `SEED_URLS`, `MAX_PAGES`, and `MAX_DEPTH` in `crawler.js`. Start small (a few hundred pages)
to confirm everything works end-to-end, then scale up gradually. Re-run `node indexer.js` any
time after crawling more pages — it rebuilds the full index from whatever's in `search.db`.

## Deploying to Render
- Push this folder to GitHub, connect it to Render as a Web Service.
- Build command: `npm install`
- Start command: `npm start`
- **Important:** Render's free tier filesystem is ephemeral — `search.db` will be wiped on
  every redeploy/restart. For a persistent live index you have two options:
  1. Render's paid persistent disk (mount it, point SQLite there), or
  2. Migrate to a hosted DB (Postgres or MongoDB Atlas free tier) — ask me when you're ready
     and I'll adapt `db.js`/`search.js`/`indexer.js` accordingly.
- Crawling should be run as a one-off task (or scheduled job), not on every server boot.

## Tuning ranking
`search.js` uses BM25 with standard defaults `k1=1.5`, `b=0.75`. If short pages are ranking too
high/low relative to long ones, adjust `b` (0 = ignore length, 1 = full length normalization).

## Google Sign-In setup
Vexkly uses Google Identity Services (client-side button) + server-side token verification —
same approach as Elyndrix.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Use the same OAuth 2.0 Client ID as Elyndrix, or create a new one ("Web application" type)
3. Under **Authorized JavaScript origins**, add your Vexkly URL, e.g. `https://vexkly.onrender.com`
   (and `http://localhost:3000` for local testing)
4. Copy `.env.example` to `.env` and set:
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   SESSION_SECRET=some-long-random-string
   ```
5. On Render, add the same two variables under **Environment**
6. Run `npm install` again to pull in `express-session` and `google-auth-library`

The frontend fetches the Client ID from `/config` at load time — you never need to hardcode it
into `index.html`. Users tap the Google button, the ID token gets verified server-side, and a
session cookie keeps them signed in for 30 days. User records land in the new `users` table.

## Next steps to consider
- Autocomplete (prefix search on the `terms` table)
- Pagination
- Domain/site filters, date filters
- Scheduled re-crawling to keep the index fresh
- Moving off SQLite for persistence on Render
