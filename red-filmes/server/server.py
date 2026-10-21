"""Servidor TCP: recebe Request Protobuf e devolve Response Protobuf."""

import argparse
import logging
import os
import socketserver

from google.protobuf.message import DecodeError
from pymongo import MongoClient
from pymongo.errors import PyMongoError

import movies_pb2 as pb
from protocol import ProtocolError, receive_frame, send_frame
from service import MovieService, ServiceError


class MovieHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(120)
        while True:
            try:
                payload = receive_frame(self.request)
                if payload is None:
                    return
            except ProtocolError as error:
                self.send_error("PROTOCOL_ERROR", str(error))
                return  # Não é possível ressincronizar um frame inválido.
            except (OSError, TimeoutError):
                return

            try:
                request = pb.Request.FromString(payload)
                response = self.server.service.execute(request)
            except DecodeError:
                response = pb.Response(error_code="PROTOCOL_ERROR", message="Mensagem Protobuf inválida.")
            except ServiceError as error:
                response = pb.Response(error_code=error.code, message=str(error))
            except PyMongoError:
                logging.error("Falha ao acessar o MongoDB.")
                response = pb.Response(error_code="DATABASE_ERROR", message="Não foi possível acessar o banco de dados.")
            except Exception:
                logging.exception("Falha no processamento da requisição.")
                response = pb.Response(error_code="INTERNAL_ERROR", message="Erro interno ao processar a operação.")

            try:
                send_frame(self.request, response.SerializeToString())
            except ProtocolError as error:
                self.send_error("RESPONSE_TOO_LARGE", str(error))
            except OSError:
                return

    def send_error(self, code, message):
        try:
            send_frame(self.request, pb.Response(error_code=code, message=message).SerializeToString())
        except OSError:
            pass


class MovieServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, service):
        self.service = service
        super().__init__(address, MovieHandler)


def main():
    parser = argparse.ArgumentParser(description="Servidor RED de filmes via TCP/Protobuf")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9004)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    # A URI nunca é impressa: ela pode conter credenciais no uso com Atlas.
    mongo = MongoClient(os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
                        serverSelectionTimeoutMS=5000, socketTimeoutMS=10000)
    try:
        mongo.admin.command("ping")
        collection = mongo[os.environ.get("MONGODB_DATABASE", "sample_mflix")].movies
        with MovieServer((args.host, args.port), MovieService(collection)) as server:
            print(f"Servidor TCP em {args.host}:{args.port}", flush=True)
            print(f"Coleção movies: {collection.count_documents({})} filmes", flush=True)
            server.serve_forever()
    except PyMongoError:
        print("Não foi possível conectar ao MongoDB. Inicie o banco com scripts/start-mongo.ps1.")
        raise SystemExit(1)
    except OSError:
        print("Não foi possível abrir a porta TCP. Verifique se outro servidor está rodando.")
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        mongo.close()


if __name__ == "__main__":
    main()
