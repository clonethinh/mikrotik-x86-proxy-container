const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22222,
  username: 'admin',
  password: 'toanthinh',
};

const commands = [
  '/system resource print',
  '/interface pppoe-client print detail',
  '/ip address print',
  '/container print detail',
  '/container mounts print',
  '/container envlist print',
  '/ip firewall nat print detail',
  '/ip firewall mangle print detail',
  '/routing table print',
  '/ip route print detail',
];

const outputFile = path.join(__dirname, 'router_status.txt');
fs.writeFileSync(outputFile, 'Mikrotik System Status Verification\n=================================\n\n');

conn.on('ready', async () => {
  console.log('SSH connection established successfully.');
  
  for (const cmd of commands) {
    console.log(`Running: ${cmd}`);
    fs.appendFileSync(outputFile, `\n=================== ${cmd} ===================\n`);
    try {
      const result = await runCommand(cmd);
      fs.appendFileSync(outputFile, result + '\n');
    } catch (err) {
      fs.appendFileSync(outputFile, `Error running ${cmd}: ${err.message}\n`);
    }
  }
  
  console.log(`Finished. Saved to ${outputFile}`);
  conn.end();
}).on('error', (err) => {
  console.error('Connection error:', err);
}).connect(creds);

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
