const { Client } = require('ssh2');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22,
  username: 'admin',
  password: 'toanthinh',
};

conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }
    const path = '/disk1/3proxy-p4-b/etc/3proxy/3proxy.cfg';
    sftp.readFile(path, (err, data) => {
      if (err) {
        console.error(err);
      } else {
        console.log('CFG CONTENTS:\n', data.toString());
      }
      conn.end();
    });
  });
}).on('error', console.error).connect(creds);
