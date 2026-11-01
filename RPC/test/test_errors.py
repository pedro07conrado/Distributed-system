"""Verifica status gRPC de falhas do banco e falhas inesperadas, sem derrubar MongoDB."""

from concurrent import futures
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import grpc
from pymongo.errors import PyMongoError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
import movies_pb2 as pb
import movies_pb2_grpc as rpc
from service import MovieService


class ErrorStatusTest(unittest.TestCase):
    def test_database_and_internal_errors_reach_the_client(self):
        collection = Mock()
        server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
        rpc.add_MovieServiceServicer_to_server(MovieService(collection), server)
        port = server.add_insecure_port("127.0.0.1:0")
        server.start()
        try:
            with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
                stub = rpc.MovieServiceStub(channel)
                for error, status in [(PyMongoError("detalhe privado"), grpc.StatusCode.UNAVAILABLE),
                                      (RuntimeError("detalhe interno"), grpc.StatusCode.INTERNAL)]:
                    collection.find_one.side_effect = error
                    with self.assertLogs(level="ERROR"), self.assertRaises(grpc.RpcError) as raised:
                        stub.GetMovie(pb.MovieId(id="000000000000000000000001"), timeout=5)
                    self.assertEqual(raised.exception.code(), status)
                    self.assertNotIn("detalhe", raised.exception.details())
        finally:
            server.stop(0).wait()


if __name__ == "__main__":
    unittest.main()
