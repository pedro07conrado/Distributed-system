const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");
const { test } = require("node:test");
const { Connection, grpc } = require("../client/connection");
const { commandRequest } = require("../client/client");

const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const python = process.env.PYTHON || path.join(root, ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const database = "rpc_filmes_test_" + randomBytes(8).toString("hex");
const env = { ...process.env, MONGODB_DATABASE: database, PYTHONIOENCODING: "utf-8" };

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function startServer(port) {
  const child = spawn(python, ["-u", "server/server.py", "--port", String(port)], { cwd: root, env });
  const ready = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Servidor gRPC não iniciou.")), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("Servidor gRPC em")) { clearTimeout(timer); resolve(); }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Servidor terminou com código ${code}.`)); });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  return { child, ready };
}

test("gRPC: cliente Node.js, servidor Python e MongoDB real", { timeout: 90000 }, async (t) => {
  let child;
  let connection;
  try {
    await exec(python, ["test/database.py", "init", database], { cwd: root, env });
    const port = await freePort();
    const started = startServer(port);
    child = started.child;
    await started.ready;
    connection = await Connection.open("127.0.0.1", port);
    const call = (method, data = {}) => connection.request({ method, data });
    const rejects = (method, data, code) => assert.rejects(call(method, data),
      (error) => error.code === code && typeof error.details === "string" && error.details.length > 0);

    await t.test("CRUD remoto completo e persistência após nova conexão", async () => {
      const created = await connection.request(commandRequest(["criar", path.join(root, "examples/filme.json")]));
      const id = created.movie.id;
      assert.match(id, /^[a-f0-9]{24}$/);
      assert.equal(created.movie.title, "Filme da atividade RPC");
      assert.equal(created.movie.year, "2026");
      assert.ok(created.movie.lastupdated);
      const other = await Connection.open("127.0.0.1", port);
      try {
        assert.equal((await other.request({ method: "GetMovie", data: { id } })).movie.title, created.movie.title);
      } finally { other.close(); }
      const updated = await connection.request(commandRequest(["atualizar", id, path.join(root, "examples/alteracao.json")]));
      assert.equal(updated.movie.title, "Filme atualizado via gRPC");
      assert.equal(updated.movie.runtime, 95);
      assert.deepEqual(updated.movie.cast, ["Ator de Exemplo", "Atriz de Exemplo"]);
      assert.equal((await call("GetMovie", { id })).movie.runtime, 95);
      assert.equal((await call("DeleteMovie", { id })).id, id);
      await rejects("GetMovie", { id }, grpc.status.NOT_FOUND);
    });

    await t.test("filtros por ator e categoria, busca literal e paginação", async () => {
      const actor = await call("ListByActor", { filter: "ator comum", limit: 1 });
      assert.equal(actor.total, 2);
      assert.equal(actor.movies.length, 1);
      const next = await call("ListByActor", { filter: "Ator Comum", limit: 1, offset: 1 });
      assert.notEqual(actor.movies[0].id, next.movies[0].id);
      assert.equal(next.movies[0].year, "2020–2022");
      const category = await call("ListByCategory", { filter: "drama" });
      assert.equal(category.total, 1);
      assert.equal(category.movies[0].title, "Filme de Teste A");
      for (const filter of [".*", "Inexistente"]) {
        const empty = await call("ListByActor", { filter });
        assert.equal(empty.total, 0);
        assert.deepEqual(empty.movies, []);
      }
      const all = await call("ListMovies", { limit: 2 });
      assert.equal(all.total, 3);
      assert.equal(all.movies.length, 2);
      assert.equal((await call("ListMovies", { offset: 999 })).movies.length, 0);
    });

    await t.test("registros esparsos e metadados Mflix preservados", async () => {
      const sparse = await call("GetMovie", { id: "000000000000000000000003" });
      assert.equal(sparse.movie.title, "Registro esparso");
      assert.equal(sparse.movie.year, undefined);
      const updated = await call("UpdateMovie", { id: "000000000000000000000001",
        movie: { title: "Título alterado" }, fields: ["title"] });
      assert.equal(updated.movie.plot, "Registro de teste.");
      assert.equal(updated.movie.imdb, undefined);
      await exec(python, ["test/database.py", "verify", database], { cwd: root, env });
    });

    await t.test("datas e intervalos de anos da coleção original", async () => {
      for (const year of ["2020è2022", "2020–", "2020-2022"]) {
        const response = await call("UpdateMovie", { id: "000000000000000000000002",
          movie: { year, released: "2020-01-01", num_mflix_comments: 0 },
          fields: ["year", "released", "num_mflix_comments"] });
        assert.equal(response.movie.year, year);
        assert.equal(response.movie.num_mflix_comments, 0);
        assert.match(response.movie.released, /^2020-01-01T00:00:00/);
      }
    });

    await t.test("códigos inexistentes retornam NOT_FOUND e inválidos INVALID_ARGUMENT", async () => {
      for (const method of ["GetMovie", "UpdateMovie", "DeleteMovie"]) {
        await rejects(method, { id: "ffffffffffffffffffffffff",
          movie: { title: "Outro título" }, fields: ["title"] }, grpc.status.NOT_FOUND);
        for (const id of ["", "123", "z".repeat(24)]) {
          await rejects(method, { id, movie: { title: "Outro título" }, fields: ["title"] },
            grpc.status.INVALID_ARGUMENT);
        }
      }
    });

    await t.test("servidor recusa campos vazios mesmo sem passar pela CLI", async () => {
      await rejects("CreateMovie", {}, grpc.status.INVALID_ARGUMENT);
      await rejects("CreateMovie", { movie: { title: "Só título" } }, grpc.status.INVALID_ARGUMENT);
      const validMovie = { title: "Teste", year: "2026", plot: "Teste", runtime: 90,
        cast: ["Ator"], genres: ["Drama"], directors: ["Diretor"], countries: ["Brazil"], type: "movie" };
      for (const movie of [{ ...validMovie, title: " " }, { ...validMovie, cast: [] }]) {
        await rejects("CreateMovie", { movie }, grpc.status.INVALID_ARGUMENT);
      }
      const emptyOptionalList = { ...validMovie, languages: [] };
      await rejects("CreateMovie", { movie: emptyOptionalList, fields: Object.keys(emptyOptionalList) },
        grpc.status.INVALID_ARGUMENT);
      const invalid = [
        { movie: { title: " " }, fields: ["title"] },
        { movie: { cast: [] }, fields: ["cast"] },
        { movie: { genres: [""] }, fields: ["genres"] },
        { movie: { runtime: 0 }, fields: ["runtime"] },
        { movie: { runtime: -1 }, fields: ["runtime"] },
        { movie: { num_mflix_comments: -1 }, fields: ["num_mflix_comments"] },
        { movie: { year: "1" }, fields: ["year"] },
        { movie: { year: "2020–1990" }, fields: ["year"] },
        { movie: { released: "data inválida" }, fields: ["released"] },
        { movie: { id: "000000000000000000000001" }, fields: ["title"] },
        { movie: { lastupdated: "2026-01-01" }, fields: ["lastupdated"] },
        { movie: {}, fields: ["imdb"] },
        { movie: {}, fields: ["title"] },
        { movie: {} }, {},
      ];
      for (const data of invalid) {
        await rejects("UpdateMovie", { id: "000000000000000000000001", ...data }, grpc.status.INVALID_ARGUMENT);
      }
      await rejects("ListByActor", { filter: " " }, grpc.status.INVALID_ARGUMENT);
      await rejects("ListByCategory", { filter: "" }, grpc.status.INVALID_ARGUMENT);
      await rejects("ListMovies", { limit: 101 }, grpc.status.INVALID_ARGUMENT);
      assert.equal((await call("ListMovies")).total, 3);
    });

    await t.test("clientes simultâneos e comandos reais de terminal", async () => {
      const other = await Connection.open("127.0.0.1", port);
      try {
        const results = await Promise.all([call("ListMovies"),
          other.request({ method: "ListByCategory", data: { filter: "Drama" } })]);
        assert.equal(results[0].total, 3);
        assert.equal(results[1].total, 1);
      } finally { other.close(); }
      const run = (...args) => exec(process.execPath,
        ["client/client.js", "--port", String(port), ...args], { cwd: root });
      const listed = await run("--json", "listar", "1");
      assert.equal(JSON.parse(listed.stdout).movies.length, 1);
      assert.equal(JSON.parse((await run("--json", "categoria", "Comedy")).stdout).total, 1);
      await assert.rejects(run("buscar", "invalido"),
        (error) => error.code === 1 && error.stderr.includes("INVALID_ARGUMENT"));
      await assert.rejects(run("--json", "buscar", "ffffffffffffffffffffffff"),
        (error) => error.code === 1 && JSON.parse(error.stdout).error_code === "NOT_FOUND");
    });

    await t.test("falhas do banco e falhas internas retornam status gRPC", async () => {
      await exec(python, ["test/test_errors.py"], { cwd: root, env });
    });
  } finally {
    if (connection) connection.close();
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await exec(python, ["test/database.py", "drop", database], { cwd: root, env });
  }
});
