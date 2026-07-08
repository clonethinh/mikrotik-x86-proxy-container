const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync('proxy.db');
const rows = db.prepare("SELECT * FROM ProxyUser").all();
fs.writeFileSync(path.join(__dirname, 'all_proxies.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`Saved ${rows.length} proxies to all_proxies.json`);
