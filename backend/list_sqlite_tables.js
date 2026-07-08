const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('proxy.db');

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);

// Dump all tables schemas
for (const t of tables) {
  console.log(`\nSchema for ${t.name}:`);
  const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${t.name}'`).get();
  console.log(schema.sql);
  
  try {
    const rows = db.prepare(`SELECT * FROM ${t.name} LIMIT 5`).all();
    console.log(`Rows in ${t.name} (limit 5):`, rows);
  } catch (err) {
    console.error(`Error reading ${t.name}:`, err.message);
  }
}
