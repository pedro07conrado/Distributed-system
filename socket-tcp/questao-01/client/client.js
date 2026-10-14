const net = require('node:net');
const crypto = require('node:crypto');
const readline = require('node:readline');

function writeUTF(socket, text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 1 && code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  if (bytes.length > 65535) {
    throw new Error('Mensagem grande demais');
  }
  const header = Buffer.alloc(2);
  header.writeUInt16BE(bytes.length);
  socket.write(Buffer.concat([header, Buffer.from(bytes)]));
}

class Reader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.waiting = null;
    this.error = null;
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.finish();
    });
    socket.on('end', () => this.fail(new Error('Servidor desconectou')));
    socket.on('error', error => this.fail(error));
  }

  finish() {
    if (this.waiting && this.buffer.length >= this.waiting.size) {
      const { size, resolve } = this.waiting;
      this.waiting = null;
      const result = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      resolve(result);
    }
  }

  fail(error) {
    this.error = error;
    if (this.waiting) {
      this.waiting.reject(error);
      this.waiting = null;
    }
  }

  read(size) {
    if (this.error) return Promise.reject(this.error);
    if (this.buffer.length >= size) {
      const result = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return Promise.resolve(result);
    }
    return new Promise((resolve, reject) => { this.waiting = { size, resolve, reject }; });
  }

  async readUTF() {
    const length = (await this.read(2)).readUInt16BE();
    const bytes = await this.read(length);
    const codes = [];
    for (let i = 0; i < bytes.length;) {
      const first = bytes[i++];
      if (first <= 0x7f) {
        codes.push(first);
      } else if ((first & 0xe0) === 0xc0) {
        codes.push(((first & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if ((first & 0xf0) === 0xe0) {
        codes.push(((first & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        throw new Error('Resposta UTF inválida');
      }
    }
    return String.fromCharCode(...codes);
  }
}

async function main() {
  const host = process.argv[2] || 'localhost';
  const port = Number(process.argv[3] || 9000);
  const socket = net.createConnection({ host, port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  }).catch(() => {
    throw new Error(`Não foi possível conectar a ${host}:${port}. Inicie o servidor Java primeiro.`);
  });
  const reader = new Reader(socket);
  const keyboard = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  console.log('CONNECT usuario, senha | PWD | CHDIR caminho | GETFILES | GETDIRS | EXIT');
  keyboard.prompt();
  try {
    for await (const typed of keyboard) {
      let command = typed.trim();
      if (command.startsWith('CONNECT ')) {
        const parts = command.slice(8).split(',');
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
          console.log('Use CONNECT usuario, senha');
          keyboard.prompt();
          continue;
        }
        const hash = crypto.createHash('sha512').update(parts[1].trim(), 'utf8').digest('hex');
        command = `CONNECT ${parts[0].trim()}, ${hash}`;
      }
      writeUTF(socket, command);
      if (command === 'EXIT') {
        break;
      }
      const answer = await reader.readUTF();
      if ((command === 'GETFILES' || command === 'GETDIRS') && answer !== 'ERROR') {
        console.log(`${answer} item(ns):`);
        for (let i = 0; i < Number(answer); i++) {
          console.log('- ' + await reader.readUTF());
        }
      } else {
        console.log(answer);
      }
      keyboard.prompt();
    }
  } finally {
    keyboard.close();
    socket.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
