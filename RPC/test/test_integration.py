"""Testa o cliente Java real contra o servidor Python e um MongoDB real."""

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import unittest

import grpc

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import movies_pb2 as pb
import movies_pb2_grpc as rpc


class JavaPythonIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jar = ROOT / "target" / "filmes-client.jar"
        if not cls.jar.is_file():
            raise RuntimeError("Compile o cliente Java com mvnw.cmd package antes de testar.")
        cls.database = "rpc_filmes_test_" + secrets.token_hex(8)
        cls.env = {**os.environ, "MONGODB_DATABASE": cls.database, "PYTHONIOENCODING": "utf-8"}
        cls.database_action("init")
        cls.addClassCleanup(cls.database_action, "drop")
        cls.temp = tempfile.TemporaryDirectory(prefix="rpc-java-test-")
        cls.addClassCleanup(cls.temp.cleanup)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.server = subprocess.Popen(
            [sys.executable, "-u", "server/server.py", "--port", str(cls.port)],
            cwd=ROOT, env=cls.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8",
        )
        cls.addClassCleanup(cls.stop_server)
        cls.channel = grpc.insecure_channel(f"127.0.0.1:{cls.port}")
        cls.addClassCleanup(cls.channel.close)
        grpc.channel_ready_future(cls.channel).result(timeout=15)
        cls.stub = rpc.MovieServiceStub(cls.channel)

    @classmethod
    def database_action(cls, action):
        subprocess.run([sys.executable, "test/database.py", action, cls.database],
                       cwd=ROOT, env=cls.env, check=True, capture_output=True, timeout=15)

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.communicate(timeout=10)

    def run_java(self, *args, port=None, input_text=None):
        return subprocess.run(
            ["java", "-jar", str(self.jar), "--port", str(port or self.port), *args],
            cwd=ROOT, env=self.env, input=input_text, capture_output=True,
            text=True, encoding="utf-8", timeout=25,
        )

    def call(self, *args):
        result = self.run_java("--json", *args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def java_error(self, code, *args, port=None):
        result = self.run_java("--json", *args, port=port)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        response = json.loads(result.stdout)
        self.assertEqual(response["error_code"], code, response)
        self.assertTrue(response["message"])

    def movie_file(self, movie):
        path = Path(self.temp.name) / (secrets.token_hex(4) + ".json")
        path.write_text(json.dumps(movie, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def test_crud_from_java_and_persistence_between_processes(self):
        created = self.call("criar", "examples/filme.json")["movie"]
        self.assertRegex(created["id"], r"^[a-f0-9]{24}$")
        self.assertEqual(created["year"], "2026")
        self.assertTrue(created["lastupdated"])
        movie_id = created["id"]
        self.assertEqual(self.call("buscar", movie_id)["movie"]["title"], "Filme da atividade RPC")
        updated = self.call("atualizar", movie_id, "examples/alteracao.json")["movie"]
        self.assertEqual(updated["runtime"], 95)
        self.assertEqual(updated["title"], "Filme atualizado via gRPC")
        self.assertEqual(updated["cast"], created["cast"])
        self.assertEqual(self.call("buscar", movie_id)["movie"]["runtime"], 95)
        self.assertEqual(self.call("excluir", movie_id)["id"], movie_id)
        self.java_error("NOT_FOUND", "buscar", movie_id)

    def test_filters_pagination_and_empty_results_from_java(self):
        actor = self.call("ator", "ator comum", "--limit", "1")
        self.assertEqual(actor["total"], 2)
        self.assertEqual(len(actor["movies"]), 1)
        next_page = self.call("ator", "Ator Comum", "--limit", "1", "--offset", "1")
        self.assertNotEqual(actor["movies"][0]["id"], next_page["movies"][0]["id"])
        category = self.call("categoria", "drama")
        self.assertEqual(category["total"], 1)
        self.assertEqual(category["movies"][0]["id"], "000000000000000000000001")
        for term in [".*", "Inexistente"]:
            self.assertEqual(self.call("ator", term)["movies"], [])
        listing = self.call("listar", "2")
        self.assertEqual(listing["total"], 3)
        self.assertEqual(len(listing["movies"]), 2)
        self.assertEqual(self.call("listar", "2", "999")["movies"], [])

    def test_sparse_records_and_metadata_preserved(self):
        sparse = self.call("buscar", "000000000000000000000003")["movie"]
        self.assertEqual(sparse["title"], "Registro esparso")
        self.assertNotIn("year", sparse)
        updated = self.call("atualizar", "000000000000000000000001",
                            self.movie_file({"title": "Título alterado"}))["movie"]
        self.assertEqual(updated["plot"], "Registro de teste.")
        self.assertNotIn("imdb", updated)
        self.database_action("verify")

    def test_dates_and_mflix_year_intervals(self):
        for year in ["2020è2022", "2020–", "2020-2022"]:
            response = self.call("atualizar", "000000000000000000000002", self.movie_file({
                "year": year, "released": "2020-01-01", "num_mflix_comments": 0,
            }))["movie"]
            self.assertEqual(response["year"], year)
            self.assertEqual(response["num_mflix_comments"], 0)
            self.assertTrue(response["released"].startswith("2020-01-01T00:00:00"))

    def test_errors_returned_to_java(self):
        patch = self.movie_file({"title": "Outro título"})
        for command in ["buscar", "atualizar", "excluir"]:
            for code, movie_id in [("NOT_FOUND", "ffffffffffffffffffffffff"),
                                   ("INVALID_ARGUMENT", "invalido")]:
                args = [command, movie_id] + ([patch] if command == "atualizar" else [])
                self.java_error(code, *args)
        self.java_error("INVALID_ARGUMENT", "atualizar", "000000000000000000000001",
                        self.movie_file({"cast": []}))
        self.java_error("INVALID_ARGUMENT", "criar", self.movie_file({"title": "Só título"}))

    def test_validation_on_the_server_without_cli(self):
        invalid_updates = [
            {"movie": pb.Movie(title=" "), "fields": ["title"]},
            {"movie": pb.Movie(), "fields": ["cast"]},
            {"movie": pb.Movie(genres=[""]), "fields": ["genres"]},
            {"movie": pb.Movie(runtime=0), "fields": ["runtime"]},
            {"movie": pb.Movie(runtime=-1), "fields": ["runtime"]},
            {"movie": pb.Movie(num_mflix_comments=-1), "fields": ["num_mflix_comments"]},
            {"movie": pb.Movie(year="1"), "fields": ["year"]},
            {"movie": pb.Movie(year="2020–1990"), "fields": ["year"]},
            {"movie": pb.Movie(released="data inválida"), "fields": ["released"]},
            {"movie": pb.Movie(id="000000000000000000000001"), "fields": ["title"]},
            {"movie": pb.Movie(lastupdated="2026-01-01"), "fields": ["lastupdated"]},
            {"movie": pb.Movie(), "fields": ["imdb"]}, {"movie": pb.Movie()}, {},
        ]
        for data in invalid_updates:
            with self.assertRaises(grpc.RpcError) as raised:
                self.stub.UpdateMovie(pb.UpdateMovieRequest(id="000000000000000000000001", **data), timeout=5)
            self.assertEqual(raised.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)
        for method, request in [
            (self.stub.CreateMovie, pb.CreateMovieRequest()),
            (self.stub.ListMovies, pb.ListMoviesRequest(limit=101)),
            (self.stub.ListByActor, pb.FilterRequest(filter=" ")),
            (self.stub.ListByCategory, pb.FilterRequest()),
        ]:
            with self.assertRaises(grpc.RpcError) as raised:
                method(request, timeout=5)
            self.assertEqual(raised.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)

    def test_java_rejects_wrong_json_types_and_readonly_fields(self):
        for movie in [{"title": 1}, {"runtime": 1.5}, {"runtime": 2147483648},
                      {"year": 2020.5}, {"cast": [1]}, {"plot": None}, {"id": "123"},
                      {"lastupdated": "2026"}, {"imdb": {}}, []]:
            self.java_error("CLIENT_ERROR", "criar", self.movie_file(movie))
        self.java_error("CLIENT_ERROR", "listar", "101")

    def test_simultaneous_java_clients_and_menu_recovery(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.call, "listar", "1")
            second = pool.submit(self.call, "categoria", "Drama")
            self.assertEqual(first.result()["total"], 3)
            self.assertEqual(second.result()["total"], 1)
        menu = self.run_java(input_text="2\ninvalido\n1\n1\n0\n0\n")
        self.assertEqual(menu.returncode, 0, menu.stdout + menu.stderr)
        self.assertIn("INVALID_ARGUMENT", menu.stderr)
        self.assertIn("Total: 3", menu.stdout)

    def test_unavailable_service_reported_by_java(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.java_error("UNAVAILABLE", "listar", "1", port=port)


if __name__ == "__main__":
    unittest.main()
