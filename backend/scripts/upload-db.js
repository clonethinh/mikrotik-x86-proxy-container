const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const local = path.resolve(__dirname, '../../data/proxy.db');
const c = new Client();
c.on('ready', () => {
  c.sftp((err, sftp) => {
    if (err) throw err;
    const rs = fs.createReadStream(local);
    const ws = sftp.createWriteStream('/disk1/data/proxy.db');
    ws.on('close', () => { console.log('DB uploaded'); c.end(); });
    rs.pipe(ws);
  });
});
c.connect({ host: '113.22.235.54', port: 22, username: 'admin', password: 'toanthinh' });