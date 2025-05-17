const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const dbPath = 'data/rsu_platform.db';
const db = new Database(dbPath);

const selectStmt = db.prepare("SELECT rowid FROM vesting_event WHERE vesting_uid IS NULL OR vesting_uid = ''");
const updateStmt = db.prepare("UPDATE vesting_event SET vesting_uid = ? WHERE rowid = ?");

const rows = selectStmt.all();
let updated = 0;

db.transaction(() => {
  for (const row of rows) {
    const uid = nanoid(12);
    updateStmt.run(uid, row.rowid);
    updated++;
  }
})();

db.close();
console.log(`Updated ${updated} vesting_event rows with new vesting_uid.`); 