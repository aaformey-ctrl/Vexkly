// auth.js
// Handles Google Sign-In: verifies the ID token sent from the client
// (via Google Identity Services), then creates/updates a local user record.
//
// Requires the GOOGLE_CLIENT_ID environment variable to be set to your
// OAuth 2.0 Client ID from Google Cloud Console (same one used on Elyndrix).

const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not set on the server');
  }
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  // payload contains: sub (google id), email, name, picture, email_verified, etc.
  return payload;
}

function upsertUser(payload) {
  const { sub: googleId, email, name, picture } = payload;

  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  if (existing) {
    db.prepare('UPDATE users SET email = ?, name = ?, picture = ? WHERE google_id = ?')
      .run(email, name, picture, googleId);
    return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  }

  const info = db.prepare(
    'INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)'
  ).run(googleId, email, name, picture);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// Express middleware: reads req.session.userId (set at login) and attaches req.user
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?')
      .get(req.session.userId);
  }
  next();
}

module.exports = { verifyGoogleToken, upsertUser, attachUser };
