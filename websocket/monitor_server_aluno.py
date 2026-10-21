"""Servidor da atividade: conexão persistente, eco JSON e monitoramento TCP."""

import asyncio
import json

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed


async def tcp_check(host: str, port: int = 443, timeout: float = 3.0) -> bool:
    """True se a conexão TCP abrir; False em caso de falha ou timeout.

    A operação assíncrona permite verificar outros hosts e receber comandos
    enquanto esta conexão está aguardando resposta.
    """
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
    except (OSError, TimeoutError):
        return False

    writer.close()
    try:
        await writer.wait_closed()
    except OSError:
        pass  # A conexão TCP já abriu: um reset ao fechar não muda o resultado.
    return True


async def monitor_host(
    ws: ServerConnection, host: str, interval: int = 5, port: int = 443
):
    """Envia a primeira checagem imediatamente e repete até desconectar."""
    print(f"[+] Monitorando {host}:{port} (intervalo {interval}s)")
    try:
        while True:
            online = await tcp_check(host, port)
            await ws.send(json.dumps({"host": host, "tcp": online}))
            await asyncio.sleep(interval)
    except ConnectionClosed:
        pass
    finally:
        print(f"[-] Monitoramento encerrado: {host}:{port}")


def validate_monitor(data: dict) -> tuple[str, int, int]:
    """Valida os parâmetros antes de criar ou substituir uma tarefa."""
    host = data.get("host")
    if not isinstance(host, str) or not host.strip():
        raise ValueError("O campo 'host' deve ser um texto não vazio.")
    host = host.strip().lower()
    if len(host) > 253 or any(c.isspace() or c in "/\\\x00" for c in host):
        raise ValueError("Informe somente o nome ou IP do host, sem URL ou espaços.")

    interval = data.get("interval", 5)
    if type(interval) is not int or not 1 <= interval <= 3600:
        raise ValueError("O campo 'interval' deve ser um inteiro entre 1 e 3600.")

    # Extensão opcional para permitir demonstrações com serviços locais.
    port = data.get("port", 443)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("O campo 'port' deve ser um inteiro entre 1 e 65535.")
    return host, interval, port


async def handler(ws: ServerConnection):
    """Cada cliente possui sua própria lista de tarefas de monitoramento."""
    monitor_tasks: dict[str, asyncio.Task] = {}
    print(f"[+] Cliente conectado: {ws.remote_address}")
    try:
        # Este loop mantém o handler ativo enquanto a conexão estiver aberta.
        async for message in ws:
            try:
                if not isinstance(message, str):
                    raise ValueError("Envie comandos como texto JSON.")
                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    raise ValueError("JSON inválido.") from None
                if not isinstance(data, dict):
                    raise ValueError("O comando deve ser um objeto JSON.")

                if data.get("cmd") == "repeat":
                    if not isinstance(data.get("message"), str):
                        raise ValueError("O campo 'message' deve ser um texto.")
                    # Devolve o mesmo JSON recebido, inclusive sua formatação.
                    await ws.send(message)
                elif data.get("cmd") == "monitor":
                    host, interval, port = validate_monitor(data)
                    previous = monitor_tasks.get(host)
                    if previous is not None:
                        previous.cancel()
                        await asyncio.gather(previous, return_exceptions=True)
                    # Não usamos await monitor_host: isso impediria novos comandos.
                    monitor_tasks[host] = asyncio.create_task(
                        monitor_host(ws, host, interval, port),
                        name=f"monitor:{host}",
                    )
                else:
                    raise ValueError("Comando desconhecido. Use 'repeat' ou 'monitor'.")
            except ValueError as error:
                # Um comando inválido não encerra a conexão nem os monitores.
                await ws.send(json.dumps({"error": str(error)}, ensure_ascii=False))
    except ConnectionClosed:
        pass
    finally:
        # Evita deixar tarefas rodando depois que o cliente sair.
        for task in monitor_tasks.values():
            task.cancel()
        await asyncio.gather(*monitor_tasks.values(), return_exceptions=True)
        print(f"[-] Cliente desconectado: {ws.remote_address}")


async def main():
    async with serve(handler, "0.0.0.0", 8765):
        print("[*] Servidor WebSocket rodando em ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[*] Servidor encerrado.")
