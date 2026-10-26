# WebSocket — Monitoramento de hosts

Implementação dos quatro desafios do Objeto de Aprendizagem de WebSockets do Prof. Rodrigo Campiolo. O servidor completa o código Python fornecido. O cliente usa HTML simples, CSS básico, formulários e uma tabela de status.

## Executar no Windows

Requer Python 3.11 ou superior e um navegador. Abra o PowerShell na raiz do repositório:

```powershell
cd websocket
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe monitor_server_aluno.py
```

O servidor atende em `ws://localhost:8765`. Deixe o terminal aberto. Em outro PowerShell na raiz do repositório, abra o cliente:

```powershell
Start-Process .\websocket\monitor_client.html
```

Também é possível abrir `monitor_client.html` com um duplo clique. Os arquivos HTML, CSS e JavaScript precisam estar na mesma pasta. Não é necessário instalar Node.js ou executar um servidor HTTP. `Ctrl+C` encerra o servidor WebSocket.

## Realizar os desafios

1. **Conectar:** mantenha `ws://localhost:8765` e clique em **Conectar**. A mensagem de conexão aparece e a conexão permanece aberta para novos comandos.
2. **Enviar e receber:** no formulário de mensagens, envie `Olá servidor`. O servidor devolve exatamente o JSON recebido.
3. **Monitorar um host:** use `google.com`, intervalo `5` e porta `443`. Clique em **Iniciar monitoramento**. O log recebe o primeiro resultado e continua recebendo novas verificações automaticamente.
4. **Monitorar vários hosts:** adicione `github.com` e `amazon.com` pelo mesmo formulário, um de cada vez. Cada host aparece em uma linha da tabela e tem uma tarefa independente no servidor. Abra outra aba do cliente para experimentar conexões simultâneas.

`tcp: true` aparece como **up**; `tcp: false`, como **down**. O teste verifica apenas se uma conexão TCP à porta escolhida pode ser aberta em até 3 segundos. Um resultado `down` pode indicar porta fechada, falha de DNS, bloqueio de rede ou timeout; não comprova que o computador inteiro está desligado. Não há requisição HTTP nem teste de conteúdo ou certificado TLS.

O navegador envia um comando por host e recebe as atualizações pela mesma conexão WebSocket. O servidor continua verificando os hosts periodicamente: uma mudança é percebida na próxima checagem, e o tempo de conexão se soma ao intervalo de espera entre checagens.

## Comandos JSON

| Ação | Cliente → servidor | Servidor → cliente |
| --- | --- | --- |
| Eco | `{"cmd":"repeat","message":"Olá servidor"}` | O mesmo JSON recebido |
| Monitorar | `{"cmd":"monitor","host":"google.com","interval":5}` | `{"host":"google.com","tcp":true}` ou `false`, periodicamente |
| Comando inválido | JSON malformado, comando desconhecido ou parâmetro inválido | `{"error":"descrição do erro"}`; a conexão continua aberta |

`host` é obrigatório. `interval` é um inteiro entre 1 e 3600 segundos (padrão: 5). A porta padrão é 443, como no código fornecido. O campo opcional `port`, entre 1 e 65535, permite testar outros serviços sem mudar os comandos originais da atividade. Por exemplo:

```json
{"cmd":"monitor","host":"localhost","interval":1,"port":8000}
```

Enviar novamente o mesmo host atualiza o intervalo e a porta, substituindo a tarefa anterior. Há um monitor por host em cada conexão; clientes diferentes mantêm listas independentes. Desconectar cancela todas as tarefas daquele cliente e limpa sua tabela. Para voltar a receber atualizações, conecte e adicione os hosts novamente.

## Demonstrar up/down sem internet

Em outro terminal, inicie um serviço TCP local com o servidor HTTP do Python:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Na interface, monitore `127.0.0.1`, porta `8000`, intervalo `1`. O status deve ficar `up`. Encerre **esse servidor HTTP** com `Ctrl+C` para observar `down` nas próximas checagens. Reinicie o mesmo comando para voltar a `up`. O servidor WebSocket deve continuar rodando durante toda a demonstração. Volte a porta para `443` ao testar os sites sugeridos.

## Organização do código

- `monitor_server_aluno.py`: `tcp_check` verifica a conexão TCP; `monitor_host` repete as checagens; `handler` recebe os comandos e administra as tarefas por cliente; `main` inicia o servidor.
- `monitor_client.html`: formulários e tabela para os quatro desafios.
- `style.css`: espaçamento, bordas e fonte da interface.
- `script_objeto_de_aprendizagem.js`: conexão WebSocket, envio de comandos, logs e tabela de status.
- `requirements.txt`: versão da biblioteca utilizada e testada.
- `test/test_integration.py`: testes de integração locais.

O `async for` mantém o handler recebendo comandos. `asyncio.create_task` inicia cada monitor sem bloquear o recebimento dos próximos hosts. No `finally`, o handler cancela e aguarda suas tarefas quando a conexão termina. A implementação utiliza a [API asyncio oficial do websockets 16.0](https://websockets.readthedocs.io/en/16.0/reference/asyncio/server.html).

## Testes

Na pasta `websocket`, após instalar a dependência:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s test -v
```

Os testes abrem servidores WebSocket e TCP reais em portas locais temporárias. Verificam conexão persistente, eco, erros de entrada, mudança de `up` para `down`, atualizações periódicas de vários hosts, substituição de tarefas, isolamento entre clientes e limpeza na desconexão. A compatibilidade com o comando original e a porta padrão 443 é verificada separadamente com uma checagem simulada, sem acessar a internet.
