const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22,
  username: 'admin',
  password: 'toanthinh',
};

conn.on('ready', () => {
  console.log('SSH connection ready. Starting SFTP...');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP Error:', err);
      conn.end();
      return;
    }

    sftp.readdir('/disk1', (err, list) => {
      if (err) {
        console.error('Readdir /disk1 Error:', err);
        conn.end();
        return;
      }

      console.log('Files in /disk1:');
      list.forEach(item => console.log(` - ${item.filename} (${item.attrs.size} bytes)`));

      // Read all users-*.json files
      const userFiles = list.filter(item => item.filename.startsWith('users-') && item.filename.endsWith('.json'));
      console.log(`Found ${userFiles.length} user config files.`);

      let completed = 0;
      const results = {};

      if (userFiles.length === 0) {
        downloadDb(sftp);
        return;
      }

      userFiles.forEach(file => {
        const fullPath = `/disk1/${file.filename}`;
        sftp.readFile(fullPath, (err, data) => {
          completed++;
          if (err) {
            console.error(`Error reading ${fullPath}:`, err);
          } else {
            try {
              results[file.filename] = JSON.parse(data.toString());
            } catch (e) {
              results[file.filename] = data.toString();
            }
          }

          if (completed === userFiles.length) {
            console.log('\nUser configs read:');
            console.log(JSON.stringify(results, null, 2));
            fs.writeFileSync(path.join(__dirname, 'router_users.json'), JSON.stringify(results, null, 2));
            downloadDb(sftp);
          }
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(creds);

function downloadDb(sftp) {
  const remoteDb = '/disk1/data/proxy.db';
  const localDb = path.join(__dirname, 'proxy.db');
  console.log(`Attempting to download database from ${remoteDb} to ${localDb}...`);
  sftp.fastGet(remoteDb, localDb, (err) => {
    if (err) {
      console.log(`Could not download ${remoteDb} (maybe it does not exist there):`, err.message);
      // Try /disk1/proxy.db
      sftp.fastGet('/disk1/proxy.db', localDb, (err2) => {
        if (err2) {
          console.log('Could not download /disk1/proxy.db either.');
        } else {
          console.log('Successfully downloaded proxy.db from /disk1/proxy.db');
        }
        conn.end();
      });
    } else {
      console.log('Successfully downloaded proxy.db from /disk1/data/proxy.db');
      conn.end();
    }
  });
}
