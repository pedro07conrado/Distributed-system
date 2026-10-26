const dgram = require('node:dgram');
const net = require('node:net');
const readline = require('node:readline');
const crypto = require('node:crypto');

const [nickname, portText, registryHost, registryPortText] = process.argv.slice(2);
const port = Number(portText);
const nameBytes = Buffer.from(nickname || '', 'utf8');
if (nameBytes.length < 1 || nameBytes.length > 64 || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Uso: node client/client.js apelido portaUDP [hostRegistro portaTCP]');
  process.exit(1);
}

const udp = dgram.createSocket('udp4');
const peers = new Map();
const awaitingEcho = new Set();
let registry;
let peersRemaining = 0;
let nextPeers = new Map();

function packet(type, text) {
  const message = Buffer.from(text, 'utf8');
  if (message.length > 255) throw new Error('Mensagem excede 255 bytes UTF-8');
  return Buffer.concat([Buffer.from([type, nameBytes.length]), nameBytes, Buffer.from([message.length]), message]);
}

function send(peer, type, text, recipient) {
  const data = packet(type, text);
  udp.send(data, peer.port, peer.host, error => {
    if (error) {
      awaitingEcho.delete(text);
      console.error(`Falha ao enviar para ${recipient}: ${error.message}`);
    } else if (type === 4) {
      console.log(`[ECHO] enviado para ${recipient}; aguardando resposta`);
    } else {
      console.log(`[você → ${recipient}] ${text}`);
    }
    keyboard.prompt(true);
  });
}

udp.on('message', (data, remote) => {
  if (data.length < 4 || data[1] < 1 || data[1] > 64 || data.length < 3 + data[1]
      || data.length !== 3 + data[1] + data[2 + data[1]] || data[0] < 1 || data[0] > 4) return;
  const sender = data.subarray(2, 2 + data[1]).toString('utf8');
  const message = data.subarray(3 + data[1]).toString('utf8');
  if (data[0] === 4) {
    if (awaitingEcho.delete(message)) console.log(`[ECHO] resposta de ${remote.address}:${remote.port}`);
    else udp.send(data, remote.port, remote.address);
    return;
  }
  const type = ['', 'mensagem', 'emoji', 'URL'][data[0]];
  console.log(`[${type}] ${sender} (${remote.address}:${remote.port}): ${message}`);
});
udp.on('error', error => { console.error(error.message); process.exitCode = 1; });

function connectRegistry() {
  if (!registryHost) return;
  // O registro deve informar endereços IPv4, pois o socket do chat é udp4.
  registry = net.createConnection({ host: registryHost, port: Number(registryPortText || 9002), family: 4 });
  let buffer = '';
  registry.on('connect', () => registry.write(`JOIN ${nameBytes.toString('base64')} ${port}\n`));
  registry.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line.startsWith('ERROR ')) { console.error(line); registry.end(); }
      else if (line.startsWith('PEERS ')) { peersRemaining = Number(line.slice(6)); nextPeers = new Map(); if (peersRemaining === 0) updatePeers(); }
      else if (line.startsWith('PEER ') && peersRemaining > 0) {
        const [, encoded, host, peerPort] = line.split(' ');
        nextPeers.set(Buffer.from(encoded, 'base64').toString('utf8'), { host, port: Number(peerPort) });
        if (--peersRemaining === 0) updatePeers();
      }
    }
  });
  registry.on('error', error => console.error(`Registro TCP: ${error.message}`));
  registry.on('close', () => console.log('Registro TCP desconectado'));
}

function updatePeers() {
  peers.clear();
  for (const [name, peer] of nextPeers) if (name !== nickname) peers.set(name, peer);
  console.log('Online: ' + ([...peers.keys()].join(', ') || '(ninguém)'));
}

const keyboard = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
udp.bind(port, () => {
  console.log(`UDP na porta ${port}. /add apelido host porta | /peers | /to apelido texto | /emoji apelido emoji | /url apelido URL | /echo apelido | /quit`);
  connectRegistry();
  keyboard.prompt();
});
keyboard.on('line', line => {
  const [command, first, ...rest] = line.trim().split(/\s+/);
  try {
    if (command === '/add') {
      const peerPort = Number(rest[1]);
      if (!first || !rest[0] || !Number.isInteger(peerPort) || peerPort < 1 || peerPort > 65535) throw new Error('Use /add apelido host porta');
      peers.set(first, { host: rest[0], port: peerPort });
    } else if (command === '/peers') {
      console.log([...peers].map(([name, peer]) => `${name} ${peer.host}:${peer.port}`).join('\n') || '(ninguém)');
    } else if (['/to', '/emoji', '/url', '/echo'].includes(command)) {
      const peer = peers.get(first);
      if (!peer) throw new Error('Peer desconhecido; use /peers ou /add');
      const type = { '/to': 1, '/emoji': 2, '/url': 3, '/echo': 4 }[command];
      const message = type === 4 ? crypto.randomBytes(8).toString('hex') : rest.join(' ');
      if (!message) throw new Error('Mensagem vazia');
      if (type === 4) awaitingEcho.add(message);
      send(peer, type, message, first);
    } else if (command === '/quit') {
      keyboard.close();
      return;
    } else if (line.trim()) console.log('Comando desconhecido');
  } catch (error) { console.error(error.message); }
  keyboard.prompt();
});
keyboard.on('close', () => { registry?.end(); udp.close(); process.stdin.pause(); });
