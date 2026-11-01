"""Validação dos campos Mflix e conversão entre MongoDB e Protobuf."""

from datetime import datetime, timezone
import re

from bson import ObjectId

import movies_pb2 as pb

ARRAY_FIELDS = {"cast", "genres", "directors", "writers", "countries", "languages"}
TEXT_FIELDS = {"title", "plot", "fullplot", "rated", "poster", "type"}
NUMBER_FIELDS = {"runtime", "num_mflix_comments"}
EDITABLE_FIELDS = ARRAY_FIELDS | TEXT_FIELDS | NUMBER_FIELDS | {"year", "released"}
REQUIRED_FIELDS = {"title", "year", "plot", "runtime", "cast", "genres", "directors", "countries", "type"}
PROJECTION = {"imdb": 0, "tomatoes": 0, "awards": 0}


class ValidationError(Exception):
    pass


class MovieNotFound(Exception):
    pass


def object_id(value):
    if not value or not ObjectId.is_valid(value):
        raise ValidationError("Código inválido: informe um ObjectId com 24 dígitos hexadecimais.")
    return ObjectId(value)


def movie_changes(movie, fields=(), creating=False):
    if movie.id or movie.HasField("lastupdated"):
        raise ValidationError("id e lastupdated são definidos pelo servidor.")
    names = set(fields) if fields else {field.name for field, _ in movie.ListFields()}
    if names - EDITABLE_FIELDS:
        raise ValidationError("Campo não editável: " + ", ".join(sorted(names - EDITABLE_FIELDS)))
    if creating and REQUIRED_FIELDS - names:
        raise ValidationError("Campos obrigatórios: " + ", ".join(sorted(REQUIRED_FIELDS - names)))
    if not names:
        raise ValidationError("Informe pelo menos um campo para atualizar.")

    changes = {}
    for name in names:
        if name in ARRAY_FIELDS:
            value = [item.strip() for item in getattr(movie, name)]
            if not value or any(not item for item in value):
                raise ValidationError(f"O campo '{name}' não pode ser uma lista vazia ou conter textos vazios.")
        else:
            if not movie.HasField(name):
                raise ValidationError(f"O campo '{name}' não foi informado.")
            value = getattr(movie, name)
            if name in TEXT_FIELDS:
                value = value.strip()
                if not value:
                    raise ValidationError(f"O campo '{name}' não pode ser vazio.")
            elif name == "released":
                try:
                    value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
                    if value.tzinfo is None:
                        value = value.replace(tzinfo=timezone.utc)
                except ValueError:
                    raise ValidationError("released deve ser uma data ISO 8601, como 2026-10-27.") from None
            elif name == "year":
                value = value.strip()
                match = re.fullmatch(r"([0-9]{4})(?:[–è-]([0-9]{4})?)?", value)
                if not match or not 1800 <= int(match[1]) <= 2200:
                    raise ValidationError("year deve ser um ano entre 1800 e 2200 ou um intervalo, como 1994–1998.")
                if match[2] and not int(match[1]) <= int(match[2]) <= 2200:
                    raise ValidationError("O fim do intervalo de year deve ser maior ou igual ao início.")
                if len(value) == 4:
                    value = int(value)
            elif name == "runtime" and value <= 0:
                raise ValidationError("runtime deve ser maior que zero.")
            elif name == "num_mflix_comments" and value < 0:
                raise ValidationError("num_mflix_comments não pode ser negativo.")
        changes[name] = value
    changes["lastupdated"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return changes


def to_movie(document):
    movie = pb.Movie(id=str(document["_id"]))
    # A base original possui registros com campos ausentes.
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
