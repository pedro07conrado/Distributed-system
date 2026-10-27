"""Implementação dos métodos remotos do contrato movies.proto."""

from functools import wraps
import logging
import re

import grpc
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

import movies_pb2 as pb
import movies_pb2_grpc as rpc
from validation import (
    MovieNotFound, PROJECTION, ValidationError, movie_changes, object_id, to_movie,
)


def rpc_errors(method):
    """Traduz erros da aplicação para status gRPC recebidos pelo cliente."""
    @wraps(method)
    def handle(self, request, context):
        try:
            return method(self, request, context)
        except ValidationError as error:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error))
        except MovieNotFound:
            context.abort(grpc.StatusCode.NOT_FOUND, "Filme não encontrado para o código informado.")
        except PyMongoError:
            logging.error("Falha ao acessar o MongoDB.")
            context.abort(grpc.StatusCode.UNAVAILABLE, "Não foi possível acessar o banco de dados.")
        except Exception:
            logging.exception("Falha no processamento da chamada RPC.")
            context.abort(grpc.StatusCode.INTERNAL, "Erro interno ao processar a operação.")
    return handle


class MovieService(rpc.MovieServiceServicer):
    def __init__(self, collection):
        self.collection = collection

    @rpc_errors
    def CreateMovie(self, request, context):
        if not request.HasField("movie"):
            raise ValidationError("Informe os dados do filme.")
        document = movie_changes(request.movie, request.fields, creating=True)
        document["_id"] = self.collection.insert_one(document).inserted_id
        return pb.MovieResponse(movie=to_movie(document))

    @rpc_errors
    def GetMovie(self, request, context):
        document = self.collection.find_one({"_id": object_id(request.id)}, PROJECTION)
        if document is None:
            raise MovieNotFound()
        return pb.MovieResponse(movie=to_movie(document))

    @rpc_errors
    def UpdateMovie(self, request, context):
        query = {"_id": object_id(request.id)}
        if not request.HasField("movie"):
            raise ValidationError("Informe os campos para atualizar.")
        changes = movie_changes(request.movie, request.fields)
        document = self.collection.find_one_and_update(
            query, {"$set": changes}, projection=PROJECTION,
            return_document=ReturnDocument.AFTER,
        )
        if document is None:
            raise MovieNotFound()
        return pb.MovieResponse(movie=to_movie(document))

    @rpc_errors
    def DeleteMovie(self, request, context):
        result = self.collection.delete_one({"_id": object_id(request.id)})
        if not result.deleted_count:
            raise MovieNotFound()
        return pb.DeleteMovieResponse(id=request.id, message="Filme excluído.")

    def list_movies(self, request, field=None):
        limit = request.limit or 20
        if limit > 100:
            raise ValidationError("O limite deve estar entre 1 e 100.")
        query = {}
        if field:
            value = request.filter.strip()
            if not value:
                raise ValidationError("O ator ou a categoria não pode ser vazio.")
            query[field] = {"$regex": "^" + re.escape(value) + "$", "$options": "i"}
        total = self.collection.count_documents(query)
        cursor = self.collection.find(query, PROJECTION).sort([("title", 1), ("_id", 1)])
        movies = [to_movie(doc) for doc in cursor.skip(request.offset).limit(limit)]
        return pb.MovieList(movies=movies, total=total)

    @rpc_errors
    def ListMovies(self, request, context):
        return self.list_movies(request)

    @rpc_errors
    def ListByActor(self, request, context):
        return self.list_movies(request, "cast")

    @rpc_errors
    def ListByCategory(self, request, context):
        return self.list_movies(request, "genres")
