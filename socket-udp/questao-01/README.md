# Questão 1 — Chat P2P por UDP

## Executar

Abra um terminal na raiz do repositório (`Distributed-system`) e execute os comandos abaixo. O primeiro comando entra na pasta da questão, onde está o diretório `src`:

```powershell
cd socket-udp/questao-01
New-Item -ItemType Directory -Force out | Out-Null
javac -encoding UTF-8 -d out src/PeerRegistry.java
java -cp out PeerRegistry
```

Abra outro terminal na raiz do repositório para Alice:

```powershell
cd socket-udp/questao-01
node client/client.js alice 9101 localhost 9002
```

Abra um terceiro terminal na raiz do repositório para Bob:

```powershell
cd socket-udp/questao-01
node client/client.js bob 9102 localhost 9002
```

Digite `/peers` para ver os participantes. No terminal de Alice, digite `/to bob salveee, Bob!`. Alice verá `[você → bob] salveee, Bob!` e Bob verá a mensagem recebida no seu terminal. A indicação local mostra o envio; o UDP não confirma a entrega de mensagens normais. Experimente também `/emoji bob 😀`, `/url bob https://example.com` e `/echo bob`. `/quit` fecha o cliente. O registro remove o participante quando sua conexão TCP termina e envia a nova lista a todos os outros.

O chat usa IPv4 tanto no UDP quanto na conexão ao registro TCP, inclusive quando o endereço informado é `localhost`.

Sem servidor TCP, rode `node client/client.js alice 9101` e `node client/client.js bob 9102`. Configure cada peer manualmente com `/add bob 127.0.0.1 9102` e `/add alice 127.0.0.1 9101`. Cada cliente precisa de sua própria porta UDP. Em computadores diferentes, use o IP acessível pela rede e libere as portas no firewall.

## Protocolo UDP

Cada datagrama contém exatamente estes campos, nesta ordem. Textos são UTF-8 e os comprimentos contam **bytes**, não caracteres. Um datagrama representa uma mensagem completa.

| Campo | Tamanho |
| --- | --- |
| Tipo | 1 byte: `1` texto, `2` emoji, `3` URL, `4` ECHO |
| Tamanho do apelido | 1 byte: `1` a `64` |
| Apelido | Tamanho indicado |
| Tamanho da mensagem | 1 byte: `0` a `255` |
| Mensagem | Tamanho indicado |

O receptor de ECHO devolve o mesmo datagrama ao endereço e porta de origem. O emissor usa o conteúdo aleatório para reconhecer a resposta e evitar um ciclo de respostas.

## Protocolo TCP opcional de presença

Cada linha termina em `\n`. O cliente abre uma conexão e envia `JOIN <apelido-base64> <porta-udp>`. O servidor responde `OK` ou `ERROR motivo`. Após cada entrada ou saída, envia a cada cliente `PEERS <quantidade>` e em seguida essa quantidade de linhas `PEER <apelido-base64> <ip> <porta-udp>`. Base64 evita ambiguidades com espaços e caracteres Unicode. A conexão permanece aberta enquanto o usuário está online; as mensagens de chat não passam pelo servidor.

Após compilar o servidor, `node test/integration.js` verifica as mensagens, o ECHO e a atualização da lista ao sair.
