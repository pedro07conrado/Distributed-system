"""CRUD e consultas na coleção movies; independente do transporte TCP."""

from datetime import datetime, timezone
import re

from bson import ObjectId
from pymongo import ReturnDocument

import movies_pb2 as pb

ARRAY_FIELDS = {"cast", "genres", "directors", "writers", "countries", "languages"}
TEXT_FIELDS = {"title", "plot", "fullplot", "rated", "poster", "type"}
NUMBER_FIELDS = {"runtime", "num_mflix_comments"}
EDITABLE_FIELDS = ARRAY_FIELDS | TEXT_FIELDS | NUMBER_FIELDS | {"year", "released"}
REQUIRED_FIELDS = {"title", "year", "plot", "runtime", "cast", "genres", "directors", "countries", "type"}
PROJECTION = {"imdb": 0, "tomatoes": 0, "awards": 0}


class ServiceError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def object_id(value):
    if not value or not ObjectId.is_valid(value):
        raise ServiceError("VALIDATION_ERROR", "Código inválido: informe um ObjectId com 24 dígitos hexadecimais.")
    return ObjectId(value)


def movie_changes(movie, fields, creating=False):
    if movie.id or movie.HasField("lastupdated"):
        raise ServiceError("VALIDATION_ERROR", "id e lastupdated são definidos pelo servidor.")
    if not fields:
        fields = [field.name for field, _ in movie.ListFields()]
    names = set(fields)
    if names - EDITABLE_FIELDS:
        raise ServiceError("VALIDATION_ERROR", "Campo não editável: " + ", ".join(sorted(names - EDITABLE_FIELDS)))
    if creating and REQUIRED_FIELDS - names:
        raise ServiceError("VALIDATION_ERROR", "Campos obrigatórios: " + ", ".join(sorted(REQUIRED_FIELDS - names)))
    if not names:
        raise ServiceError("VALIDATION_ERROR", "Informe pelo menos um campo para atualizar.")

    changes = {}
    for name in names:
        if name in ARRAY_FIELDS:
            value = [item.strip() for item in getattr(movie, name)]
            if not value or any(not item for item in value):
                raise ServiceError("VALIDATION_ERROR", f"O campo '{name}' não pode ser uma lista vazia ou conter textos vazios.")
        else:
            if not movie.HasField(name):
                raise ServiceError("VALIDATION_ERROR", f"O campo '{name}' não foi informado.")
            value = getattr(movie, name)
            if name in TEXT_FIELDS:
                value = value.strip()
                if not value:
                    raise ServiceError("VALIDATION_ERROR", f"O campo '{name}' não pode ser vazio.")
            elif name == "released":
                try:
                    value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
                    if value.tzinfo is None:
                        value = value.replace(tzinfo=timezone.utc)
                except ValueError:
                    raise ServiceError("VALIDATION_ERROR", "released deve ser uma data ISO 8601, como 2026-10-21.") from None
            elif name == "year":
                value = value.strip()
                # O arquivo oficial também contém o separador legado "è".
                match = re.fullmatch(r"([0-9]{4})(?:[–è-]([0-9]{4})?)?", value)
                if not match or not 1800 <= int(match[1]) <= 2200:
                    raise ServiceError("VALIDATION_ERROR", "year deve ser um ano entre 1800 e 2200 ou um intervalo, como 1994–1998.")
                if match[2] and not int(match[1]) <= int(match[2]) <= 2200:
                    raise ServiceError("VALIDATION_ERROR", "O fim do intervalo de year deve ser maior ou igual ao início.")
                if len(value) == 4:
                    value = int(value)
            elif name == "runtime" and value <= 0:
                raise ServiceError("VALIDATION_ERROR", "runtime deve ser maior que zero.")
            elif name == "num_mflix_comments" and value < 0:
                raise ServiceError("VALIDATION_ERROR", "num_mflix_comments não pode ser negativo.")
        changes[name] = value
    changes["lastupdated"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return changes


def to_movie(document):
    movie = pb.Movie(id=str(document["_id"]))
    # A base original é esparsa: campos ausentes continuam ausentes na resposta.
    for name in EDITABLE_FIELDS | {"lastupdated"}:
        value = document.get(name)
        if value is None:
            continue
        if name in ARRAY_FIELDS:
            getattr(movie, name).extend(value)
        elif name == "year":
            movie.year = str(value)
        elif isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            setattr(movie, name, value.isoformat())
        else:
            setattr(movie, name, value)
    return movie


class MovieService:
    def __init__(self, collection):
        self.collection = collection

    def execute(self, request):
        operation = request.operation
        if operation == pb.CREATE:
            if not request.HasField("movie"):
                raise ServiceError("VALIDATION_ERROR", "Informe os dados do filme.")
            document = movie_changes(request.movie, request.fields, creating=True)
            document["_id"] = self.collection.insert_one(document).inserted_id
            return pb.Response(ok=True, message="Filme cadastrado.", movies=[to_movie(document)], total=1)

        if operation in (pb.READ, pb.UPDATE, pb.DELETE):
            query = {"_id": object_id(request.id)}
            if operation == pb.READ:
                document = self.collection.find_one(query, PROJECTION)
                message = "Filme encontrado."
            elif operation == pb.UPDATE:
                if not request.HasField("movie"):
                    raise ServiceError("VALIDATION_ERROR", "Informe os campos para atualizar.")
                changes = movie_changes(request.movie, request.fields)
                # Atualização parcial preserva campos omitidos e metadados ignorados.
                document = self.collection.find_one_and_update(
                    query, {"$set": changes}, projection=PROJECTION,
                    return_document=ReturnDocument.AFTER,
                )
                message = "Filme atualizado."
            else:
                document = self.collection.find_one_and_delete(query, projection=PROJECTION)
                message = "Filme excluído."
            if document is None:
                raise ServiceError("NOT_FOUND", "Filme não encontrado para o código informado.")
            return pb.Response(ok=True, message=message, movies=[to_movie(document)], total=1)

        if operation in (pb.LIST, pb.BY_ACTOR, pb.BY_CATEGORY):
            limit = request.limit or 20
            if limit > 100:
                raise ServiceError("VALIDATION_ERROR", "O limite deve estar entre 1 e 100.")
            query = {}
            if operation != pb.LIST:
                value = request.filter.strip()
                if not value:
                    raise ServiceError("VALIDATION_ERROR", "O ator ou a categoria não pode ser vazio.")
                field = "cast" if operation == pb.BY_ACTOR else "genres"
                query[field] = {"$regex": "^" + re.escape(value) + "$", "$options": "i"}
            total = self.collection.count_documents(query)
            cursor = self.collection.find(query, PROJECTION).sort([("title", 1), ("_id", 1)])
            movies = [to_movie(doc) for doc in cursor.skip(request.offset).limit(limit)]
            return pb.Response(ok=True, message="Consulta concluída.", movies=movies, total=total)

        raise ServiceError("INVALID_OPERATION", "Operação desconhecida.")
