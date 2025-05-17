// Backfill UID columns for tenant, employee, and grant_record tables
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const db = new Database('data/rsu_platform.db');

function backfill(table, idCol, uidCol, length = 12) {
  const select = db.prepare(`SELECT ${idCol} FROM ${table} WHERE ${uidCol} IS NULL OR ${uidCol} = ''`);
  const update = db.prepare(`UPDATE ${table} SET ${uidCol} = ? WHERE ${idCol} = ?`);
  const rows = select.all();
  let count = 0;
  for (const row of rows) {
    let uid;
    let tries = 0;
    do {
      uid = nanoid(length);
      tries++;
      // Ensure uniqueness
    } while (db.prepare(`SELECT 1 FROM ${table} WHERE ${uidCol} = ?`).get(uid));
    update.run(uid, row[idCol]);
    count++;
  }
  console.log(`Backfilled ${count} ${uidCol} in ${table}`);
}

// This script is now obsolete. All tables use UID columns only.
console.log('All tables are UID-only. No backfill needed.');
process.exit(0);

backfill('tenant', 'tenant_id', 'tenant_uid', 10);
backfill('employee', 'employee_id', 'employee_uid', 12);
backfill('grant_record', 'grant_id', 'grant_uid', 14);

console.log('UID backfill complete.'); 