const fs = require("node:fs");
const readline = require("node:readline/promises");
const { Connection, grpc } = require("./connection");

function usage() {
  console.log(`Uso: node client/client.js [--host IP] [--port PORTA] [--json] [comando]

Comandos:
  listar [limite] [offset]
  buscar <id>
  criar <arquivo.json>
  atualizar <id> <arquivo.json>
  excluir <id>
  ator <nome completo> [--limit N] [--offset N]
  categoria <nome> [--limit N] [--offset N]

Sem comando, abre um menu no terminal. --json imprime a resposta completa.`);
}

function integer(value, name, min, max) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} deve ser um número inteiro.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} deve estar entre ${min} e ${max}.`);
  }
  return number;
}

function readMovie(filename) {
  const movie = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  if (!movie || typeof movie !== "object" || Array.isArray(movie)) {
    throw new Error("O arquivo deve conter um objeto JSON.");
  }
  if (typeof movie.year === "number" && Number.isInteger(movie.year)) movie.year = String(movie.year);
  const arrays = new Set(["cast", "genres", "directors", "writers", "countries", "languages"]);
  const texts = new Set(["title", "year", "plot", "fullplot", "rated", "released", "poster", "type"]);
  const numbers = new Set(["runtime", "num_mflix_comments"]);
  for (const [name, value] of Object.entries(movie)) {
    if (arrays.has(name)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${name} deve ser uma lista de textos.`);
      }
    } else if (texts.has(name)) {
      if (typeof value !== "string") throw new Error(`${name} deve ser texto.`);
    } else if (numbers.has(name)) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw new Error(`${name} deve ser um inteiro de 32 bits.`);
      }
    } else {
      throw new Error(`Campo não editável: ${name}`);
    }
  }
  return movie;
}

function commandRequest(args) {
  const [command, ...values] = args;
  if (command === "listar") {
    if (values.length > 2) throw new Error("Use listar [limite] [offset].");
    return { method: "ListMovies", data: {
      limit: integer(values[0] ?? 20, "limite", 1, 100),
      offset: integer(values[1] ?? 0, "offset", 0, 4294967295),
    } };
  }
  if (["buscar", "excluir"].includes(command)) {
    if (values.length !== 1) throw new Error(`Use ${command} <id>.`);
    return { method: command === "buscar" ? "GetMovie" : "DeleteMovie", data: { id: values[0] } };
  }
  if (command === "criar" || command === "atualizar") {
    const updating = command === "atualizar";
    if (values.length !== (updating ? 2 : 1)) {
      throw new Error(updating ? "Use atualizar <id> <arquivo.json>." : "Use criar <arquivo.json>.");
    }
    const movie = readMovie(values[updating ? 1 : 0]);
    return { method: updating ? "UpdateMovie" : "CreateMovie", data: updating
      ? { id: values[0], movie, fields: Object.keys(movie) } : { movie, fields: Object.keys(movie) } };
  }
  if (command === "ator" || command === "categoria") {
    let limit = 20;
    let offset = 0;
    const terms = [];
    for (let index = 0; index < values.length; index++) {
      if (values[index] === "--limit") limit = integer(values[++index], "limite", 1, 100);
      else if (values[index] === "--offset") offset = integer(values[++index], "offset", 0, 4294967295);
      else if (values[index].startsWith("--")) throw new Error(`Opção inválida: ${values[index]}`);
      else terms.push(values[index]);
    }
    return { method: command === "ator" ? "ListByActor" : "ListByCategory",
      data: { filter: terms.join(" "), limit, offset } };
  }
  throw new Error("Comando desconhecido. Use --help para ver os comandos.");
}

function printResponse(response, json, detail = false) {
  if (json) {
    console.log(JSON.stringify(response, null, 2));
  } else if (response.movie) {
    console.log(JSON.stringify(response.movie, null, 2));
  } else if (response.id) {
    console.log(`${response.message} Código: ${response.id}`);
  } else {
    for (const movie of response.movies) {
      if (detail) console.log(JSON.stringify(movie, null, 2));
      else console.log(`${movie.id} | ${movie.title ?? "(sem título)"} | ${movie.year ?? ""}`);
    }
    console.log(`Exibidos: ${response.movies.length}. Total: ${response.total ?? 0}.`);
  }
}

function printError(error, json) {
  const code = grpc.status[error.code] || "CLIENT_ERROR";
  const message = error.details || error.message;
  if (json) console.log(JSON.stringify({ error_code: code, message }, null, 2));
  else console.error(`Erro [${code}]: ${message}`);
}

async function menu(connection, json) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      console.log("\n1 - Listar filmes\n2 - Buscar por código\n3 - Cadastrar\n4 - Atualizar\n5 - Excluir\n6 - Listar por ator\n7 - Listar por categoria\n0 - Sair");
      const option = (await rl.question("Opção: ")).trim();
      if (option === "0") break;
      try {
        let args;
        if (option === "1") {
          const limit = await rl.question("Limite [20]: ");
          const offset = await rl.question("Offset [0]: ");
          args = ["listar", limit || "20", offset || "0"];
        } else if (["2", "5"].includes(option)) {
          args = [option === "2" ? "buscar" : "excluir", (await rl.question("Código: ")).trim()];
        } else if (option === "3") {
          args = ["criar", (await rl.question("Arquivo JSON: ")).trim()];
        } else if (option === "4") {
          args = ["atualizar", (await rl.question("Código: ")).trim(),
            (await rl.question("Arquivo JSON com os campos a alterar: ")).trim()];
        } else if (["6", "7"].includes(option)) {
          args = [option === "6" ? "ator" : "categoria", (await rl.question("Nome: ")).trim()];
        } else {
          console.log("Opção inválida.");
          continue;
        }
        printResponse(await connection.request(commandRequest(args)), json);
      } catch (error) {
        printError(error, json);
      }
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { usage(); return; }
  let host = "127.0.0.1";
  let port = 50051;
  let json = false;
  while (args[0]?.startsWith("--")) {
    const option = args.shift();
    if (option === "--host") {
      host = args.shift();
      if (!host) throw new Error("Informe o host.");
    } else if (option === "--port") port = integer(args.shift(), "porta", 1, 65535);
    else if (option === "--json") json = true;
    else throw new Error(`Opção inválida: ${option}`);
  }
  const request = args.length ? commandRequest(args) : null;
  const connection = await Connection.open(host, port);
  try {
    if (request) printResponse(await connection.request(request), json);
    else await menu(connection, json);
  } finally {
    connection.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    printError(error, process.argv.includes("--json"));
    process.exitCode = 1;
  });
}

module.exports = { commandRequest };
