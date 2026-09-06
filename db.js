const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'tutor.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'EXPLORING',
      current_track TEXT DEFAULT NULL,
      progress INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS backlog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      idea TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

const getUser = (chatId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) reject(err);
      if (!row) {
        db.run('INSERT INTO users (chat_id) VALUES (?)', [chatId], function(err) {
          if (err) reject(err);
          resolve({ chat_id: chatId, status: 'EXPLORING', current_track: null, progress: 0 });
        });
      } else {
        resolve(row);
      }
    });
  });
};

const updateUserStatus = (chatId, status, current_track) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET status = ?, current_track = ? WHERE chat_id = ?',
      [status, current_track, chatId],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
};

const addIdeaToBacklog = (chatId, idea) => {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO backlog (chat_id, idea) VALUES (?, ?)', [chatId, idea], function(err) {
      if (err) reject(err);
      resolve();
    });
  });
};

const getBacklog = (chatId) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM backlog WHERE chat_id = ?', [chatId], (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
};

module.exports = {
  getUser,
  updateUserStatus,
  addIdeaToBacklog,
  getBacklog
};
