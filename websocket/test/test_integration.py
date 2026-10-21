"""Testes com conexões WebSocket e TCP reais, sem depender da internet."""

import asyncio
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import monitor_server_aluno as server


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.ws_server = await serve(server.handler, "127.0.0.1", 0)
        port = self.ws_server.sockets[0].getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}"
        self.tcp_server = await asyncio.start_server(
            lambda reader, writer: writer.close(), "127.0.0.1", 0
        )
        self.tcp_port = self.tcp_server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.ws_server.close()
        await self.ws_server.wait_closed()
        self.tcp_server.close()
        await self.tcp_server.wait_closed()
        self.assertEqual(self.monitor_tasks(), [])

    def monitor_tasks(self):
        return [t for t in asyncio.all_tasks() if t.get_name().startswith("monitor:")]

    async def receive(self, ws):
        return json.loads(await asyncio.wait_for(ws.recv(), timeout=8))

    async def monitor(self, ws, host="127.0.0.1", interval=1, port=None):
        await ws.send(json.dumps({
            "cmd": "monitor", "host": host, "interval": interval,
            "port": self.tcp_port if port is None else port,
        }))

    async def test_persistent_connection_and_exact_echo(self):
        async with connect(self.url, proxy=None) as ws:
            # O servidor aguarda comandos, sem fechar o handler ou mandar extras.
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(ws.recv(), timeout=0.1)
            for text in ("Olá servidor!", "Segunda mensagem 🚀"):
                message = json.dumps({"cmd": "repeat", "message": text}, ensure_ascii=False)
                await ws.send(message)
                self.assertEqual(await ws.recv(), message)

    async def test_invalid_commands_preserve_connection(self):
        invalid = [
            "{", "null", "[]", "42", '{"cmd":"unknown"}',
            '{"cmd":"repeat"}', '{"cmd":"repeat","message":false}',
            '{"cmd":"monitor","host":""}',
            '{"cmd":"monitor","host":123}',
            '{"cmd":"monitor","host":"https://google.com"}',
            *[json.dumps({"cmd": "monitor", "host": "localhost", "interval": value})
              for value in (0, -1, 1.5, True, "5", None, 3601)],
            *[json.dumps({"cmd": "monitor", "host": "localhost", "port": value})
              for value in (0, 65536, True, "443")],
            b'{"cmd":"repeat","message":"binary"}',
        ]
        async with connect(self.url, proxy=None) as ws:
            for command in invalid:
                with self.subTest(command=command):
                    await ws.send(command)
                    self.assertIn("error", await self.receive(ws))
            await ws.send('{"cmd":"repeat","message":"ainda conectado"}')
            self.assertEqual((await self.receive(ws))["message"], "ainda conectado")

    async def test_single_host_changes_from_up_to_down(self):
        async with connect(self.url, proxy=None) as ws:
            await self.monitor(ws)
            self.assertEqual(await self.receive(ws), {"host": "127.0.0.1", "tcp": True})
            self.tcp_server.close()
            await self.tcp_server.wait_closed()
            self.assertEqual(await self.receive(ws), {"host": "127.0.0.1", "tcp": False})

    async def test_multiple_hosts_update_without_new_commands(self):
        async with connect(self.url, proxy=None) as ws:
            await self.monitor(ws, "127.0.0.1")
            await self.monitor(ws, "localhost")
            # Hosts independentes podem responder em ordens e velocidades diferentes.
            counts = {"127.0.0.1": 0, "localhost": 0}
            async with asyncio.timeout(10):
                while min(counts.values()) < 2:
                    message = await self.receive(ws)
                    self.assertTrue(message["tcp"])
                    counts[message["host"]] += 1
            await ws.send('{"cmd":"repeat","message":"eco durante monitoramento"}')
            async with asyncio.timeout(3):
                while True:
                    message = await self.receive(ws)
                    if message.get("cmd") == "repeat":
                        self.assertEqual(message["message"], "eco durante monitoramento")
                        break

    async def test_repeated_host_replaces_task_and_disconnect_cleans_up(self):
        async with connect(self.url, proxy=None) as ws:
            await self.monitor(ws)
            await self.receive(ws)
            original = self.monitor_tasks()[0]
            await self.monitor(ws, host=" 127.0.0.1 ", interval=2)
            await self.receive(ws)
            self.assertTrue(original.cancelled())
            self.assertEqual(len(self.monitor_tasks()), 1)
            await self.monitor(ws, host="localhost")
            await self.receive(ws)
            self.assertEqual(len(self.monitor_tasks()), 2)
        await asyncio.wait_for(self.wait_for_cleanup(), timeout=2)
        self.assertEqual(self.monitor_tasks(), [])

    async def wait_for_cleanup(self):
        while self.monitor_tasks():
            await asyncio.sleep(0.01)

    async def test_clients_have_independent_monitors(self):
        async with connect(self.url, proxy=None) as first, connect(self.url, proxy=None) as second:
            await self.monitor(first)
            await self.receive(first)
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(second.recv(), timeout=0.1)
            await self.monitor(second, "localhost")
            self.assertEqual((await self.receive(second))["host"], "localhost")
            await first.close()
            self.assertEqual((await self.receive(second))["host"], "localhost")

    async def test_original_command_uses_default_port_443(self):
        async def check(host, port):
            self.assertEqual((host, port), ("google.com", 443))
            return True

        with patch.object(server, "tcp_check", check):
            async with connect(self.url, proxy=None) as ws:
                await ws.send('{"cmd":"monitor","host":"google.com","interval":5}')
                self.assertEqual(await self.receive(ws), {"host": "google.com", "tcp": True})


if __name__ == "__main__":
    unittest.main()
