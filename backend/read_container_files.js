const { Client } = require('ssh2');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22,
  username: 'admin',
  password: 'toanthinh',
};

conn.on('ready', () => {
  console.log('SSH connection established. Reading files...');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP Error:', err);
      conn.end();
      return;
    }

    // Try reading generated 3proxy.cfg from proxy3p-4 root dir
    const cfgPath = '/disk1/3proxy-p4-b/etc/3proxy/3proxy.cfg';
    sftp.readFile(cfgPath, (err, data) => {
      if (err) {
        console.error(`Error reading ${cfgPath} (might be different path):`, err.message);
      } else {
        console.log(`\n=================== ${cfgPath} ===================`);
        console.log(data.toString());
      }
      
      // Let's also check if there is an entrypoint.lua in the root of the container
      const luaPath = '/disk1/3proxy-p4-b/entrypoint.lua';
      sftp.readFile(luaPath, (err2, data2) => {
        if (err2) {
          console.error(`Error reading ${luaPath}:`, err2.message);
        } else {
          console.log(`\n=================== ${luaPath} ===================`);
          console.log(data2.toString());
        }
        conn.end();
      });
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(creds);
