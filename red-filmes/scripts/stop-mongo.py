"""Encerra o MongoDB local sem remover seus dados."""

from pymongo import MongoClient
from pymongo.errors import AutoReconnect

with MongoClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=3000) as client:
    try:
        client.admin.command({"shutdown": 1})
    except AutoReconnect:
        # O MongoDB fecha a conexão ao terminar o processo.
        pass
print("MongoDB local encerrado.")
