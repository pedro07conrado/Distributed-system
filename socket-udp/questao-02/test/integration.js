const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const dgram = require('node:dgram');

const root = path.resolve(__dirname, '..');
const classpath = path.join(root, 'out');
const client = path.join(root, 'client', 'client.js');

async function freePort() {
  const socket = dgram.createSocket('udp4');
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  socket.close();
  return port;
}

function run(file, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [client, file, '127.0.0.1', String(port)], { cwd: root });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'udp-upload-test-'));
  const port = await freePort();
  const server = spawn('java', ['-cp', classpath, 'UdpFileServer', String(port)], { cwd: dir });
  let serverOutput = '';
  server.stdout.on('data', chunk => serverOutput += chunk);
  server.stderr.on('data', chunk => serverOutput += chunk);
  try {
    for (let i = 0; i < 30 && !serverOutput.includes('Upload UDP'); i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(serverOutput, /Upload UDP/, 'servidor não iniciou');
    const files = [
      ['small.txt', Buffer.from('Arquivo de 100 bytes.\n'.padEnd(100, 'x'))],
      ['binary.bin', crypto.randomBytes(4096)],
      ['large.bin', crypto.randomBytes(4 * 1024 * 1024)],
    ];
    for (const [name, data] of files) await fs.writeFile(path.join(dir, name), data);
    await Promise.all(files.map(([name]) => run(path.join(dir, name), port)));
    for (const [name, data] of files) {
      const received = await fs.readFile(path.join(dir, 'server-data', name));
      assert.deepEqual(received, data, `${name} difere do original`);
      console.log(`${name}: ${data.length} bytes, íntegro`);
    }
  } finally {
    if (server.exitCode === null) {
      const stopped = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await stopped;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
