const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const dgram = require('node:dgram');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientFile = path.join(root, 'client', 'client.js');

async function tcpPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function udpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  socket.close();
  return port;
}

function watch(child) {
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  return {
    output: () => output,
    async until(pattern) {
      for (let i = 0; i < 50; i++) {
        if (pattern.test(output)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Não apareceu ${pattern}: ${output}`);
    },
  };
}

async function stop(child) {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
}

async function main() {
  const registryPort = await tcpPort();
  const alicePort = await udpPort();
  const bobPort = await udpPort();
  const server = spawn('java', ['-cp', path.join(root, 'out'), 'PeerRegistry', String(registryPort)]);
  let alice, bob;
  try {
    await watch(server).until(/Lista de peers TCP/);
    alice = spawn(process.execPath, [clientFile, 'alice', String(alicePort), 'localhost', String(registryPort)], { stdio: 'pipe' });
    const aliceLog = watch(alice);
    await aliceLog.until(/Online: \(ninguém\)/);
    bob = spawn(process.execPath, [clientFile, 'bob', String(bobPort), 'localhost', String(registryPort)], { stdio: 'pipe' });
    const bobLog = watch(bob);
    await aliceLog.until(/Online: bob/);
    await bobLog.until(/Online: alice/);
    alice.stdin.write('/to bob teste UDP\n');
    alice.stdin.write('/emoji bob 😀\n');
    alice.stdin.write('/url bob https://example.com\n');
    alice.stdin.write('/echo bob\n');
    await aliceLog.until(/\[você → bob\] teste UDP/);
    await bobLog.until(/\[mensagem\] alice .*teste UDP/);
    await bobLog.until(/\[emoji\] alice .*😀/);
    await bobLog.until(/\[URL\] alice .*https:\/\/example.com/);
    await aliceLog.until(/\[ECHO\] resposta/);
    alice.stdin.end('/quit\n');
    await bobLog.until(/Online: \(ninguém\)/);
    if (alice.exitCode === null) {
      await Promise.race([
        new Promise(resolve => alice.once('exit', resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Alice não encerrou: ${aliceLog.output()}`)), 3000)),
      ]);
    }
    assert.equal(alice.exitCode, 0);
    console.log('Chat, ECHO e atualização da lista: OK');
  } finally {
    await stop(alice);
    await stop(bob);
    await stop(server);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
