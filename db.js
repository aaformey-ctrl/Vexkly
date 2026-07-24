// db.js
// Sets up the SQLite database and schema for the search engine.
// Two core tables:
//   pages       -> one row per crawled page (url, title, text, metadata)
//   postings    -> inverted index: term -> which pages it appears in + how often (term frequency)
// A separate "terms" table tracks document frequency (how many pages contain each term),
// which BM25 ranking needs.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'search.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  content TEXT,
  word_count INTEGER DEFAULT 0,
  crawled_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terms (
  term TEXT PRIMARY KEY,
  doc_frequency INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS postings (
  term TEXT NOT NULL,
  page_id INTEGER NOT NULL,
  term_frequency INTEGER NOT NULL,
  PRIMARY KEY (term, page_id),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_postings_term ON postings(term);
CREATE INDEX IF NOT EXISTS idx_postings_page ON postings(page_id);

CREATE TABLE IF NOT EXISTS crawl_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  depth INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' -- pending | done | failed
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

module.exports = db;
