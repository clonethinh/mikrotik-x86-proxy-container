const fs = require('fs');
try {
  const raw = fs.readFileSync('/proc/net/route', 'utf8');
  console.log(raw.split('\n').slice(0, 15).join('\n'));
} catch (e) {
  console.log('route err', e.message);
}
const os = require('os');
console.log('ips', Object.values(os.networkInterfaces()).flat().filter(i => !i.internal).map(i => i.address));