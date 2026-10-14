# Questão 1 — Servidor TCP

O servidor usa **Java 17** e o cliente usa **JavaScript com Node.js 18+**, apenas com bibliotecas padrão. O servidor aceita vários clientes ao mesmo tempo: cada conexão ganha uma thread e um diretório corrente próprio. São duas linguagens distintas, conforme a descrição geral da atividade.

## Executar

Abra um terminal nesta pasta (`socket-tcp/questao-01`) e compile:

```powershell
New-Item -ItemType Directory -Force out | Out-Null
javac -encoding UTF-8 -d out src/PasswordHash.java src/ClientHandler.java src/TcpServer.java
```

No primeiro terminal, inicie o servidor:

```powershell
java -cp out TcpServer
```

No segundo terminal, inicie um cliente. Repita este comando em um terceiro terminal para testar dois clientes simultâneos:

```powershell
node client/client.js
```

A porta padrão é `9000`. Opcionalmente, use `java -cp out TcpServer 9002` e `node client/client.js localhost 9002`. Execute o servidor a partir desta pasta, pois ele lê `users.properties` e `server-data` do diretório corrente.

Usuários de demonstração: `alice` e `bob`, ambos com senha `teste123`. O cliente calcula SHA-512 antes de enviar a senha. São apenas dados para exercício; troque-os antes de usar fora de um ambiente de aula.

## Experimente

Digite uma linha por vez no cliente:

```text
CONNECT alice, teste123
PWD
GETDIRS
CHDIR documentos
PWD
GETFILES
CHDIR ..
GETFILES
EXIT
```

Na área da Alice, `GETDIRS` lista `documentos` e `GETFILES` na raiz lista `boas-vindas.txt`. Para verificar a separação entre usuários, conecte Bob no outro cliente: a pasta `documentos` da Alice não estará disponível para ele.

## Protocolo

Cada solicitação é **uma String UTF** no formato de `DataOutputStream.writeUTF` do Java. Cada resposta usa o formato de `DataInputStream.readUTF`. Isso inclui a contagem das listas: é texto, como `"2"`, e não um inteiro binário. O cliente JavaScript implementa os dois bytes de comprimento e o UTF modificado exigidos por esse formato.

| Solicitação | Resposta |
| --- | --- |
| `CONNECT usuario, hash` | `SUCCESS` ou `ERROR`. `hash` é o SHA-512 da senha em UTF-8, com 128 caracteres hexadecimais. |
| `PWD` | Caminho dentro da área do usuário, como `/` ou `/documentos`. |
| `CHDIR caminho` | `SUCCESS` ou `ERROR`. Aceita caminho relativo ou iniciado em `/` (raiz da área do usuário). |
| `GETFILES` | Contagem como String UTF, seguida de uma String UTF por arquivo. |
| `GETDIRS` | Contagem como String UTF, seguida de uma String UTF por diretório. |
| `EXIT` | Encerra a conexão, sem resposta. |

Antes de um `CONNECT` válido, os outros comandos retornam `ERROR`. Caminhos fora da área do usuário retornam `ERROR`. O servidor não envia o caminho físico do computador; `/` significa a pasta particular do usuário.

## Arquivos principais

- `TcpServer.java`: abre a porta e aceita conexões.
- `ClientHandler.java`: interpreta comandos e guarda a sessão de cada cliente.
- `PasswordHash.java`: compara o hash recebido com o hash salvo no servidor.
- `client/client.js`: cliente de terminal; calcula SHA-512 e codifica/decodifica String UTF do Java.
- `users.properties`: usuários e hashes de demonstração.
- `server-data/`: pastas e arquivos que o servidor lista.

## Ordem para estudar o código

1. Leia `TcpServer.java`: ele abre a porta e cria uma thread para cada conexão.
2. Leia `ClientHandler.java`, começando por `run()` e `process()`: ali estão a leitura dos comandos e a escolha da resposta.
3. Leia `client/client.js`, começando por `main()`: ele lê o que você digita e mostra a resposta. As funções `writeUTF()` e `Reader` cuidam dos bytes enviados pelo TCP.
