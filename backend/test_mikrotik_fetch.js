const { Client } = require('ssh2');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22222,
  username: 'admin',
  password: 'toanthinh',
};

conn.on('ready', async () => {
  console.log('SSH connection established.');
  
  try {
    const res = await runCommand('/tool fetch mode=http');
    console.log('Output for /tool fetch mode=http:\n', res);
  } catch (err) {
    console.error('Error:', err.message);
  }

  conn.end();
}).on('error', console.error).connect(creds);

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let output = '';
      stream.on('close', (code) => {
        resolve(output);
      }).on('data', (data) => {
        output += data.toString();
      }).stderr.on('data', (data) => {
        output += data.toString();
      });
    });
  });
}
