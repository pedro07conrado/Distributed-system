const dgram = require('node:dgram');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const [filename, host = '127.0.0.1', portText = '9003'] = process.argv.slice(2);
const port = Number(portText);
if (!filename || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Uso: node client/client.js caminhoArquivo [host porta]');
  process.exit(1);
}

const udp = dgram.createSocket('udp4');
const id = crypto.randomBytes(4).readUInt32BE();
const START_SEQ = 0xffffffff, END_SEQ = 0xfffffffe;
let pending;
udp.on('message', bytes => {
  if (bytes.length !== 10 || bytes[0] !== 4 || bytes.readUInt32BE(1) !== id || !pending
      || bytes.readUInt32BE(5) !== pending.sequence) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  current.resolve(bytes[9]);
});

function sendWithAck(bytes, sequence) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const send = () => {
      if (++attempts > 8) { pending = null; reject(new Error(`Sem confirmação do pacote ${sequence}`)); return; }
      udp.send(bytes, port, host, error => { if (error) { pending = null; reject(error); } });
      pending.timer = setTimeout(send, 700);
    };
    pending = { sequence, resolve, timer: null };
    send();
  });
}

async function main() {
  const stat = await fsp.stat(filename);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error('Arquivo inválido ou grande demais');
  const name = Buffer.from(path.basename(filename), 'utf8');
  if (name.length < 1 || name.length > 255) throw new Error('Nome excede 255 bytes UTF-8');
  const start = Buffer.alloc(14 + name.length);
  start[0] = 1; start.writeUInt32BE(id, 1); start.writeBigUInt64BE(BigInt(stat.size), 5);
  start[13] = name.length; name.copy(start, 14);
  if (await sendWithAck(start, START_SEQ) !== 1) throw new Error('Servidor recusou nome ou arquivo existente');

  const file = await fsp.open(filename, 'r');
  const hash = crypto.createHash('sha1');
  let sent = 0, sequence = 0, lastPercent = -1;
  try {
    const chunk = Buffer.alloc(1024);
    while (sent < stat.size) {
      const length = Math.min(1024, stat.size - sent);
      const { bytesRead } = await file.read(chunk, 0, length, sent);
      if (bytesRead !== length) throw new Error('Arquivo alterado durante envio');
      const data = Buffer.alloc(11 + length);
      data[0] = 2; data.writeUInt32BE(id, 1); data.writeUInt32BE(sequence, 5);
      data.writeUInt16BE(length, 9); chunk.copy(data, 11, 0, length);
      if (await sendWithAck(data, sequence) !== 1) throw new Error(`Servidor rejeitou bloco ${sequence}`);
      hash.update(chunk.subarray(0, length));
      sent += length; sequence++;
      const percent = Math.floor(sent * 100 / stat.size);
      if (percent >= lastPercent + 10 || percent === 100) {
        process.stdout.write(`\rEnviado: ${percent}% (${sent}/${stat.size} bytes)`);
        lastPercent = percent;
      }
    }
  } finally { await file.close(); }
  const end = Buffer.alloc(25);
  end[0] = 3; end.writeUInt32BE(id, 1); hash.digest().copy(end, 5);
  if (await sendWithAck(end, END_SEQ) !== 1) throw new Error('SHA-1 não confere ou falha ao salvar');
  console.log(`\nConcluído: ${name.toString('utf8')}`);
}

main().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; })
  .finally(() => udp.close());
