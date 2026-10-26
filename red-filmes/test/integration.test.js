const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { Connection, Operation, Request, Response, MAX_MESSAGE_SIZE } = require("../client/connection");
const { commandRequest } = require("../client/client");

const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const python = process.env.PYTHON || path.join(root, ".venv", "Scripts", "python.exe");
const database = "red_filmes_test_" + randomBytes(8).toString("hex");
const env = { ...process.env, MONGODB_DATABASE: database, PYTHONIOENCODING: "utf-8" };

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function startServer(port) {
  const child = spawn(python, ["-u", "server/server.py", "--port", String(port)], { cwd: root, env: env });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Servidor de teste não iniciou.")), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("filmes")) { clearTimeout(timer); resolve(); }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Servidor terminou com código ${code}.`)); });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  return { child, ready };
}

function frame(data) {
  const payload = Request.encode(Request.create(data)).finish();
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

async function rawExchange(port, bytes, count = 1, fragmented = false, halfClose = false) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: port });
    let buffer = Buffer.alloc(0);
    const responses = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Timeout na troca TCP.")); }, 8000);
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("connect", () => {
      if (fragmented) {
        let offset = 0;
        const send = () => {
          if (offset >= bytes.length) return;
          socket.write(bytes.subarray(offset, ++offset));
          setImmediate(send);
        };
        send();
      } else if (halfClose) socket.end(bytes);
      else socket.write(bytes);
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
        const size = buffer.readUInt32BE(0);
        responses.push(Response.toObject(Response.decode(buffer.subarray(4, size + 4)), { arrays: true, defaults: true }));
        buffer = buffer.subarray(size + 4);
      }
      if (responses.length === count) {
        clearTimeout(timer);
        socket.destroy();
        resolve(responses);
      }
    });
  });
}

test("Servidor Python e cliente Node.js com MongoDB real", { timeout: 60000 }, async (t) => {
  await exec(python, ["test/database.py", "init", database], { cwd: root, env: env });
  const port = await freePort();
  const { child, ready } = startServer(port);
  let connection;
  try {
    await ready;
    connection = await Connection.open("127.0.0.1", port);
    await t.test("CRUD completo e atualização parcial", async () => {
      const created = await connection.request(commandRequest(["criar", path.join(root, "examples/filme.json")]));
      assert.equal(created.ok, true);
      const id = created.movies[0].id;
      assert.match(id, /^[a-f0-9]{24}$/);
      const read = await connection.request({ operation: Operation.READ, id: id });
      assert.equal(read.movies[0].title, "Filme da atividade RED");
      const updated = await connection.request(commandRequest(["atualizar", id, path.join(root, "examples/alteracao.json")]));
      assert.equal(updated.ok, true);
      assert.equal(updated.movies[0].runtime, 95);
      assert.deepEqual(updated.movies[0].cast, ["Ator de Exemplo", "Atriz de Exemplo"]);
      const deleted = await connection.request({ operation: Operation.DELETE, id: id });
      assert.equal(deleted.ok, true);
      const missing = await connection.request({ operation: Operation.READ, id: id });
      assert.equal(missing.error_code, "NOT_FOUND");
    });

    await t.test("consulta por ator e categoria sem distinguir maiúsculas", async () => {
      const actor = await connection.request({ operation: Operation.BY_ACTOR, filter: "ator comum" });
      assert.equal(actor.total, 2);
      const category = await connection.request({ operation: Operation.BY_CATEGORY, filter: "drama" });
      assert.equal(category.total, 1);
      assert.equal(category.movies[0].title, "Filme de Teste A");
      const literal = await connection.request({ operation: Operation.BY_ACTOR, filter: ".*" });
      assert.equal(literal.total, 0);
    });

    await t.test("paginação e ausência de resultados", async () => {
      const first = await connection.request({ operation: Operation.LIST, limit: 1 });
      const second = await connection.request({ operation: Operation.LIST, limit: 1, offset: 1 });
      assert.equal(first.total, 2);
      assert.equal(first.movies.length, 1);
      assert.equal(first.movies[0].year, "2020");
      assert.equal(second.movies[0].year, "2020–2022");
      assert.notEqual(first.movies[0].id, second.movies[0].id);
      const empty = await connection.request({ operation: Operation.BY_CATEGORY, filter: "Inexistente" });
      assert.equal(empty.ok, true);
      assert.equal(empty.movies.length, 0);
    });

    await t.test("anos de séries aceitam o separador legado da Mflix", async () => {
      const response = await connection.request({ operation: Operation.UPDATE,
        id: "000000000000000000000002", movie: { year: "2020è2022" }, fields: ["year"] });
      assert.equal(response.ok, true);
      assert.equal(response.movies[0].year, "2020è2022");
    });

    await t.test("metadados ignorados são preservados no banco", async () => {
      const updated = await connection.request({ operation: Operation.UPDATE,
        id: "000000000000000000000001", movie: { title: "Título alterado" }, fields: ["title"] });
      assert.equal(updated.ok, true);
      assert.equal(updated.movies[0].plot, "Registro de teste.");
      assert.equal(updated.movies[0].imdb, undefined);
      await exec(python, ["test/database.py", "verify-metadata", database], { cwd: root, env: env });
    });

    await t.test("código inexistente e código inválido devolvem erro", async () => {
      for (const operation of [Operation.READ, Operation.UPDATE, Operation.DELETE]) {
        const request = { operation: operation, id: "ffffffffffffffffffffffff",
          movie: { title: "Novo título" }, fields: ["title"] };
        assert.equal((await connection.request(request)).error_code, "NOT_FOUND");
      }
      for (const id of ["", "123", "z".repeat(24)]) {
        const response = await connection.request({ operation: Operation.READ, id: id });
        assert.equal(response.error_code, "VALIDATION_ERROR");
      }
    });

    await t.test("campos vazios e parâmetros inválidos são recusados", async () => {
      const invalid = [
        { operation: Operation.CREATE },
        { operation: Operation.CREATE, movie: { title: "Só título" } },
        { operation: Operation.UPDATE, movie: { title: "   " }, fields: ["title"] },
        { operation: Operation.UPDATE, movie: { cast: [] }, fields: ["cast"] },
        { operation: Operation.UPDATE, movie: { cast: [""] }, fields: ["cast"] },
        { operation: Operation.UPDATE, movie: { runtime: 0 }, fields: ["runtime"] },
        { operation: Operation.UPDATE, movie: { year: "1" }, fields: ["year"] },
        { operation: Operation.UPDATE, movie: { year: "2020–1990" }, fields: ["year"] },
        { operation: Operation.UPDATE, movie: { released: "data inválida" }, fields: ["released"] },
        { operation: Operation.UPDATE, movie: {}, fields: ["inexistente"] },
        { operation: Operation.BY_ACTOR, filter: " " },
        { operation: Operation.BY_CATEGORY, filter: "" },
        { operation: Operation.LIST, limit: 101 },
      ];
      for (const data of invalid) {
        const response = await connection.request({ id: "000000000000000000000001", ...data });
        assert.equal(response.ok, false, JSON.stringify(data));
        assert.equal(response.error_code, "VALIDATION_ERROR");
      }
      assert.equal((await connection.request({ operation: Operation.LIST })).ok, true);
    });

    await t.test("frames TCP fragmentados e mensagens agrupadas", async () => {
      const request = frame({ operation: Operation.LIST, limit: 1 });
      const fragmented = await rawExchange(port, request, 1, true);
      assert.equal(fragmented[0].ok, true);
      const combined = await rawExchange(port, Buffer.concat([request, request]), 2);
      assert.equal(combined.length, 2);
      assert.ok(combined.every((response) => response.ok));
    });

    await t.test("Protobuf malformado, frame truncado e tamanho inválido", async () => {
      const malformed = await rawExchange(port, Buffer.from([0, 0, 0, 1, 255]));
      assert.equal(malformed[0].error_code, "PROTOCOL_ERROR");
      for (const size of [0, MAX_MESSAGE_SIZE + 1]) {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(size);
        const response = await rawExchange(port, header);
        assert.equal(response[0].error_code, "PROTOCOL_ERROR");
      }
      const truncated = await rawExchange(port, Buffer.from([0, 0, 0, 10, 8]), 1, false, true);
      assert.equal(truncated[0].error_code, "PROTOCOL_ERROR");
    });

    await t.test("clientes simultâneos e CLI real", async () => {
      const other = await Connection.open("127.0.0.1", port);
      try {
        const results = await Promise.all([
          connection.request({ operation: Operation.LIST }),
          other.request({ operation: Operation.LIST }),
        ]);
        assert.ok(results.every((response) => response.ok));
      } finally { other.close(); }
      const result = await exec(process.execPath,
        ["client/client.js", "--port", String(port), "--json", "listar", "1"], { cwd: root });
      const response = JSON.parse(result.stdout);
      assert.equal(response.ok, true);
      assert.equal(response.movies.length, 1);
      await assert.rejects(exec(process.execPath,
        ["client/client.js", "--port", String(port), "buscar", "invalido"], { cwd: root }),
      (error) => error.code === 1 && error.stderr.includes("VALIDATION_ERROR"));
    });
  } finally {
    if (connection) connection.close();
    child.kill();
    await exec(python, ["test/database.py", "drop", database], { cwd: root, env: env });
  }
});
