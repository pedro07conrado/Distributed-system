const net = require("node:net");
const path = require("node:path");
const protobuf = require("protobufjs");

const root = new protobuf.Root().loadSync(
  path.join(__dirname, "../proto/movies.proto"), { keepCase: true }
).resolveAll();
const Request = root.lookupType("red.Request");
const Response = root.lookupType("red.Response");
const Movie = root.lookupType("red.Movie");
const Operation = root.lookupEnum("red.Operation").values;
const MAX_MESSAGE_SIZE = 1024 * 1024;

class Connection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("Conexão encerrada pelo servidor.")));
  }

  static async open(host = "127.0.0.1", port = 9004) {
    const socket = net.createConnection({ host, port });
    const connection = new Connection(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Tempo limite ao conectar ao servidor."));
      }, 5000);
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
    });
    return connection;
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size < 1 || size > MAX_MESSAGE_SIZE) {
        this.fail(new Error("Tamanho de resposta inválido."));
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < size + 4) return;
      const payload = this.buffer.subarray(4, size + 4);
      this.buffer = this.buffer.subarray(size + 4);
      if (!this.pending) {
        this.socket.destroy();
        return;
      }
      try {
        const response = Response.toObject(Response.decode(payload), { arrays: true, defaults: true });
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(response);
      } catch {
        this.fail(new Error("Resposta Protobuf inválida."));
        this.socket.destroy();
        return;
      }
    }
  }

  request(data) {
    if (this.pending) return Promise.reject(new Error("Aguarde a resposta da operação anterior."));
    if (this.socket.destroyed) return Promise.reject(new Error("Conexão fechada."));
    const error = Request.verify(data);
    if (error) return Promise.reject(new Error(error));
    const payload = Request.encode(Request.create(data)).finish();
    if (!payload.length || payload.length > MAX_MESSAGE_SIZE) {
      return Promise.reject(new Error("Mensagem inválida ou maior que 1 MiB."));
    }
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    Buffer.from(payload).copy(frame, 4);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error("Tempo limite aguardando resposta."));
        this.socket.destroy();
      }, 15000);
      this.pending = { resolve, reject, timer };
      this.socket.write(frame);
    });
  }

  fail(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }

  close() {
    this.socket.end();
  }
}

module.exports = { Connection, Movie, Operation, Request, Response, MAX_MESSAGE_SIZE };
