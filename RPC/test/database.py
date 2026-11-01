"""Prepara e remove SOMENTE bancos temporários exclusivos dos testes RPC."""

import os
import re
import sys

from bson import ObjectId
from pymongo import MongoClient

action, name = sys.argv[1:]
if not re.fullmatch(r"rpc_filmes_test_[a-f0-9]{16}", name):
    raise SystemExit("Nome de banco de teste inválido.")

with MongoClient(os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
                 serverSelectionTimeoutMS=5000) as client:
    collection = client[name].movies
    if action == "init":
        document = {
            "_id": ObjectId("000000000000000000000001"),
            "title": "Filme de Teste A", "year": 2020, "runtime": 90,
            "plot": "Registro de teste.", "cast": ["Ator Comum"], "genres": ["Drama"],
            "directors": ["Diretor"], "countries": ["Brazil"], "type": "movie",
            "imdb": {"rating": 8.5}, "awards": {"wins": 3}, "tomatoes": {"fresh": 10},
        }
        collection.insert_one(document)
        collection.insert_one({**document, "_id": ObjectId("000000000000000000000002"),
                               "title": "Filme de Teste B", "genres": ["Comedy"],
                               "year": "2020–2022", "type": "series"})
        collection.insert_one({"_id": ObjectId("000000000000000000000003"), "title": "Registro esparso"})
    elif action == "verify":
        document = collection.find_one({"_id": ObjectId("000000000000000000000001")})
        assert document["imdb"]["rating"] == 8.5
        assert document["awards"]["wins"] == 3
        assert document["tomatoes"]["fresh"] == 10
        assert document["runtime"] == 90
        assert document["plot"] == "Registro de teste."
    elif action == "drop":
        client.drop_database(name)
    else:
        raise SystemExit("Ação de teste inválida.")
