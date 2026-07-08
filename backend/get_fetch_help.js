const { Client } = require('ssh2');

const conn = new Client();

const creds = {
  host: '113.22.235.54',
  port: 22,
  username: 'admin',
  password: 'toanthinh',
};

conn.on('ready', () => {
  console.log('SSH connection established. Requesting shell...');
  conn.shell((err, stream) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }

    let output = '';
    stream.on('close', () => {
      console.log('\n=== Stream Closed ===');
      conn.end();
    }).on('data', (data) => {
      output += data.toString();
      // Look for the prompt or specific text
      if (output.includes('?]')) {
        // We can write command
      }
    });

    // Write command to terminal
    setTimeout(() => {
      // Send command followed by ? then Enter, then wait and exit
      stream.write('/tool fetch ?\n');
      setTimeout(() => {
        console.log('OUTPUT FROM INTERACTIVE HELP:');
        console.log(output);
        stream.end();
      }, 5000);
    }, 2000);
  });
}).on('error', console.error).connect(creds);
