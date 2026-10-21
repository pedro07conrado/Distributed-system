"""TCP transporta um fluxo: cada Protobuf recebe um prefixo de tamanho."""

import struct

MAX_MESSAGE_SIZE = 1024 * 1024


class ProtocolError(Exception):
    pass


def read_exact(sock, size, allow_eof=False):
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            if not data and allow_eof:
                return None
            raise ProtocolError("Conexão encerrada no meio da mensagem.")
        data.extend(chunk)
    return bytes(data)


def receive_frame(sock):
    header = read_exact(sock, 4, allow_eof=True)
    if header is None:
        return None
    size = struct.unpack("!I", header)[0]
    if not 1 <= size <= MAX_MESSAGE_SIZE:
        raise ProtocolError("Tamanho de mensagem inválido (máximo: 1 MiB).")
    return read_exact(sock, size)


def send_frame(sock, payload):
    if not 1 <= len(payload) <= MAX_MESSAGE_SIZE:
        raise ProtocolError("Resposta excedeu o limite de 1 MiB. Reduza o limite da consulta.")
    sock.sendall(struct.pack("!I", len(payload)) + payload)
