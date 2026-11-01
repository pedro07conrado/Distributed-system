"""Servidor gRPC em Python com persistência MongoDB."""

import argparse
from concurrent import futures
import logging
import os

import grpc
from pymongo import MongoClient
from pymongo.errors import PyMongoError

import movies_pb2_grpc as rpc
from service import MovieService


def main():
    parser = argparse.ArgumentParser(description="Servidor gRPC de gerenciamento de filmes")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=50051)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("A porta deve estar entre 1 e 65535.")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    mongo = MongoClient(
        os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
        serverSelectionTimeoutMS=5000, socketTimeoutMS=10000,
    )
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    try:
        mongo.admin.command("ping")
        collection = mongo[os.environ.get("MONGODB_DATABASE", "sample_mflix")].movies
        total = collection.count_documents({})
        rpc.add_MovieServiceServicer_to_server(MovieService(collection), server)
        address = f"{args.host}:{args.port}"
        if not server.add_insecure_port(address):
            raise RuntimeError("Porta gRPC indisponível.")
        server.start()
        print(f"Servidor gRPC em {address} | coleção movies: {total} filmes", flush=True)
        if not total:
            print("Coleção vazia: importe sample_mflix.movies conforme o README.", flush=True)
        server.wait_for_termination()
    except PyMongoError:
        print("Não foi possível acessar o MongoDB. Confira MONGODB_URI e inicie o banco.", flush=True)
        raise SystemExit(1)
    except RuntimeError:
        print("Não foi possível iniciar o gRPC. Verifique o endereço e a porta.", flush=True)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\nServidor encerrado.", flush=True)
    finally:
        server.stop(5).wait()
        mongo.close()


if __name__ == "__main__":
    main()
