const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");

const definition = loader.loadSync(path.join(__dirname, "../proto/movies.proto"), {
  keepCase: true, longs: Number, enums: String, defaults: true, arrays: true, oneofs: false,
});
const { MovieService } = grpc.loadPackageDefinition(definition).rpcmovies;

class Connection {
  constructor(client) {
    this.client = client;
  }

  static async open(host = "127.0.0.1", port = 50051) {
    const client = new MovieService(`${host}:${port}`, grpc.credentials.createInsecure());
    try {
      await new Promise((resolve, reject) => {
        client.waitForReady(Date.now() + 5000, (error) => error ? reject(error) : resolve());
      });
      return new Connection(client);
    } catch (error) {
      client.close();
      throw error;
    }
  }

  request({ method, data }) {
    return new Promise((resolve, reject) => {
      this.client[method](data, { deadline: Date.now() + 15000 }, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  close() {
    this.client.close();
  }
}

module.exports = { Connection, grpc };
