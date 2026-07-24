// tokenize.js
// Turns raw text into a clean list of lowercase word tokens, stripping
// punctuation and very common "stopwords" that add noise but no meaning.

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','so','of','to','in','on','at',
  'for','with','by','from','up','about','into','over','after','is','are',
  'was','were','be','been','being','it','its','this','that','these','those',
  'as','not','no','do','does','did','can','could','will','would','should',
  'has','have','had','i','you','he','she','we','they','them','his','her',
  'their','our','your'
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

module.exports = { tokenize, STOPWORDS };
