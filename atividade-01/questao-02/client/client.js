const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const ADD_FILE = 1, DELETE = 2, GET_FILES_LIST = 3, GET_FILE = 4;
const SUCCESS = 1, ERROR = 2;

class Reader {
  constructor(socket) {
    // TCP entrega bytes em pedaços. Este buffer guarda os que ainda não lemos.
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
}

function validName(name) {
  const size = Buffer.byteLength(name, 'utf8');
  return size >= 1 && size <= 255 && name !== '.' && name !== '..'
    && !name.includes('/') && !name.includes('\\') && !/[\x00-\x1f]/.test(name);
}

function sendRequest(socket, command, name = '') {
  const filename = Buffer.from(name, 'utf8');
  socket.write(Buffer.concat([Buffer.from([1, command, filename.length]), filename]));
}

async function readStatus(reader, command) {
  const header = await reader.read(3);
  if (header[0] !== 2 || header[1] !== command || ![SUCCESS, ERROR].includes(header[2])) {
    throw new Error('Resposta inválida do servidor');
  }
  return header[2];
}

async function sendByte(socket, byte) {
  if (!socket.write(Buffer.from([byte]))) {
    await new Promise(resolve => socket.once('drain', resolve));
  }
}

async function addFile(socket, reader, filename) {
  let file;
  try {
    file = await fs.open(filename, 'r');
    const size = (await file.stat()).size;
    const name = path.basename(filename);
    if (!validName(name) || size < 1 || size > 0xffffffff) {
      console.log('Nome ou tamanho fora do limite do protocolo');
      return;
    }
    sendRequest(socket, ADD_FILE, name);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(size);
    socket.write(length);
    const oneByte = Buffer.alloc(1);
    for (let i = 0; i < size; i++) {
      if ((await file.read(oneByte, 0, 1, i)).bytesRead !== 1) {
        throw new Error('Arquivo alterado durante o envio');
      }
      await sendByte(socket, oneByte[0]);
    }
    const status = await readStatus(reader, ADD_FILE);
    console.log(status === SUCCESS ? 'SUCCESS' : 'ERROR');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Arquivo local não encontrado');
    } else {
      throw error;
    }
  } finally {
    if (file) {
      await file.close();
    }
  }
}

async function deleteFile(socket, reader, name) {
  if (!validName(name)) {
    console.log('Nome de arquivo inválido');
    return;
  }
  sendRequest(socket, DELETE, name);
  const status = await readStatus(reader, DELETE);
  console.log(status === SUCCESS ? 'SUCCESS' : 'ERROR');
}

async function listFiles(socket, reader) {
  sendRequest(socket, GET_FILES_LIST);
  if ((await readStatus(reader, GET_FILES_LIST)) === ERROR) {
    console.log('ERROR');
    return;
  }
  const count = (await reader.read(2)).readUInt16BE();
  console.log(`${count} arquivo(s):`);
  for (let i = 0; i < count; i++) {
    const size = (await reader.read(1))[0];
    console.log('- ' + (await reader.read(size)).toString('utf8'));
  }
}

async function getFile(socket, reader, name) {
  if (!validName(name)) {
    console.log('Nome de arquivo inválido');
    return;
  }
  sendRequest(socket, GET_FILE, name);
  if ((await readStatus(reader, GET_FILE)) === ERROR) {
    console.log('ERROR');
    return;
  }
  const size = (await reader.read(4)).readUInt32BE();
  const downloads = path.resolve('downloads');
  await fs.mkdir(downloads, { recursive: true });
  const temporary = path.join(downloads, `.download-${process.pid}.tmp`);
  try {
    const file = await fs.open(temporary, 'w');
    try {
      for (let i = 0; i < size; i++) {
        await file.write(await reader.read(1)); // Recebe byte a byte.
      }
    } finally {
      await file.close();
    }
    const target = path.join(downloads, name);
    await fs.copyFile(temporary, target);
    console.log('Salvo em ' + target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function main() {
  const host = process.argv[2] || 'localhost';
  const port = Number(process.argv[3] || 9001);
  const socket = net.createConnection({ host, port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  }).catch(() => {
    throw new Error(`Não foi possível conectar a ${host}:${port}. Inicie o servidor Java primeiro.`);
  });
  const reader = new Reader(socket);
  const keyboard = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  console.log('ADDFILE caminho | DELETE nome | GETFILESLIST | GETFILE nome | EXIT');
  keyboard.prompt();
  try {
    for await (const typed of keyboard) {
      const command = typed.trim();
      if (command.toUpperCase() === 'EXIT') {
        break;
      }

      if (command.startsWith('ADDFILE ')) {
        await addFile(socket, reader, command.slice(8).trim());
      } else if (command.startsWith('DELETE ')) {
        await deleteFile(socket, reader, command.slice(7).trim());
      } else if (command === 'GETFILESLIST') {
        await listFiles(socket, reader);
      } else if (command.startsWith('GETFILE ')) {
        await getFile(socket, reader, command.slice(8).trim());
      } else {
        console.log('Comando desconhecido');
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
