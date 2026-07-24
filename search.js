// search.js
// Implements BM25 ranking (a stronger, standard alternative to plain TF-IDF)
// over the inverted index built by indexer.js.
//
// BM25 score for a document D given query terms Q:
//   score(D,Q) = sum_over_terms[ IDF(term) * (tf * (k1+1)) / (tf + k1 * (1 - b + b * |D|/avgdl)) ]
//
// k1 controls term-frequency saturation, b controls length normalization.
// These are the standard defaults used by most search implementations.

const db = require('./db');
const { tokenize } = require('./tokenize');

const K1 = 1.5;
const B = 0.75;

function getCorpusStats() {
  const { totalDocs } = db.prepare('SELECT COUNT(*) as totalDocs FROM pages').get();
  const { avgLen } = db.prepare('SELECT AVG(word_count) as avgLen FROM pages').get();
  return { totalDocs: totalDocs || 0, avgLen: avgLen || 1 };
}

function search(query, limit = 10) {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  const { totalDocs, avgLen } = getCorpusStats();
  if (totalDocs === 0) return [];

  const scores = new Map(); // page_id -> score

  const termInfoStmt = db.prepare('SELECT doc_frequency FROM terms WHERE term = ?');
  const postingsStmt = db.prepare('SELECT page_id, term_frequency FROM postings WHERE term = ?');
  const pageLenStmt = db.prepare('SELECT word_count FROM pages WHERE id = ?');

  for (const term of terms) {
    const termInfo = termInfoStmt.get(term);
    if (!termInfo) continue; // term not in index at all

    const df = termInfo.doc_frequency;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

    const postings = postingsStmt.all(term);
    for (const { page_id, term_frequency } of postings) {
      const { word_count } = pageLenStmt.get(page_id);
      const docLen = word_count || 1;

      const numerator = term_frequency * (K1 + 1);
      const denominator = term_frequency + K1 * (1 - B + B * (docLen / avgLen));
      const termScore = idf * (numerator / denominator);

      scores.set(page_id, (scores.get(page_id) || 0) + termScore);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const getPageStmt = db.prepare('SELECT id, url, title, description, content FROM pages WHERE id = ?');

  return ranked.map(([page_id, score]) => {
    const page = getPageStmt.get(page_id);
    const snippet = buildSnippet(page.content, terms);
    return {
      url: page.url,
      title: page.title || page.url,
      description: page.description,
      snippet,
      score: Math.round(score * 1000) / 1000
    };
  });
}

// Builds a short "...text around the matched term..." preview, like a real search result.
function buildSnippet(content, terms, radius = 100) {
  if (!content) return '';
  const lower = content.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(content.length, idx + term.length + radius);
      let snippet = content.slice(start, end).trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet;
    }
  }
  return content.slice(0, radius * 2).trim() + '...';
}

module.exports = { search };
