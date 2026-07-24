// indexer.js
// Reads every page in the `pages` table and builds the inverted index:
//   - postings: for each (term, page) pair, how many times the term appears (term_frequency)
//   - terms: for each term, how many distinct pages it appears in (doc_frequency)
//
// Run this after crawler.js finishes (or any time you want to rebuild the index
// from whatever pages are currently in the database).
//
// Usage: node indexer.js

const db = require('./db');
const { tokenize } = require('./tokenize');

function buildIndex() {
  console.log('Building index...');

  // Clear existing index (we rebuild fully each run — simplest and safest for a first version)
  db.exec('DELETE FROM postings; DELETE FROM terms;');

  const pages = db.prepare('SELECT id, title, description, content FROM pages').all();
  console.log(`Indexing ${pages.length} pages...`);

  const insertPosting = db.prepare(`
    INSERT INTO postings (term, page_id, term_frequency)
    VALUES (@term, @page_id, @term_frequency)
    ON CONFLICT(term, page_id) DO UPDATE SET term_frequency = term_frequency + excluded.term_frequency
  `);

  const upsertTermDocFreq = db.prepare(`
    INSERT INTO terms (term, doc_frequency) VALUES (@term, 1)
    ON CONFLICT(term) DO UPDATE SET doc_frequency = doc_frequency + 1
  `);

  const transaction = db.transaction((pages) => {
    for (const page of pages) {
      // Title and description words count extra by being tokenized in too (simple relevance boost
      // happens naturally since they add to term_frequency).
      const fullText = `${page.title} ${page.title} ${page.description} ${page.content}`;
      const tokens = tokenize(fullText);

      if (tokens.length === 0) continue;

      // Count term frequencies within this page
      const freq = {};
      for (const t of tokens) freq[t] = (freq[t] || 0) + 1;

      for (const [term, count] of Object.entries(freq)) {
        insertPosting.run({ term, page_id: page.id, term_frequency: count });
        upsertTermDocFreq.run({ term });
      }
    }
  });

  transaction(pages);

  const termCount = db.prepare('SELECT COUNT(*) as c FROM terms').get().c;
  const postingCount = db.prepare('SELECT COUNT(*) as c FROM postings').get().c;
  console.log(`Index built: ${termCount} unique terms, ${postingCount} postings.`);
  console.log(`Run "node server.js" to start the search UI.`);
}

buildIndex();
