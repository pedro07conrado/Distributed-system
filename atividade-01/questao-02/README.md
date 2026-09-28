# Questão 2 — Arquivos remotos por TCP

O servidor usa **Java 17** e o cliente usa **JavaScript com Node.js 18+**, apenas com bibliotecas padrão. Vários clientes podem se conectar ao mesmo tempo e usam a mesma pasta de arquivos do servidor. Esta questão tem **protocolo binário próprio**; não usa `writeUTF` da Questão 1.

## Executar

Abra um terminal nesta pasta (`atividade-01/questao-02`) e compile:

```powershell
New-Item -ItemType Directory -Force out | Out-Null
javac -encoding UTF-8 -d out src/Protocol.java src/FileClientHandler.java src/FileServer.java
```

No primeiro terminal:

```powershell
java -cp out FileServer
```

No segundo terminal:

```powershell
node client/client.js
```

A porta padrão é `9001`. Para mudar, use `java -cp out FileServer 9003` e `node client/client.js localhost 9003`. Execute ambos a partir desta pasta para que os diretórios de arquivos apareçam aqui.

Digite uma linha por vez no cliente:

```text
ADDFILE examples/ola.txt
GETFILESLIST
GETFILE ola.txt
DELETE ola.txt
GETFILESLIST
EXIT
```

Abra outro cliente para conferir que ambos veem os mesmos arquivos. `ADDFILE` envia o nome do arquivo local e seus bytes; se o nome já existir no servidor, retorna `ERROR`. `GETFILE` salva o arquivo em `downloads/`. O servidor guarda os arquivos em `server-data/` e registra as ações em `logs/server.log`. Essas três pastas são criadas quando necessárias e estão no `.gitignore`.

## Formato das mensagens

Cada campo abaixo é binário, na ordem indicada. Campos com mais de um byte usam **big endian**. Nomes de arquivo são bytes UTF-8 e têm de 1 a 255 bytes; em `GETFILESLIST`, o nome da solicitação é vazio (tamanho `0`).

| Solicitação, enviada pelo cliente | Tamanho |
| --- | --- |
| Tipo da mensagem: `1` | 1 byte |
| Código do comando: `1` a `4` | 1 byte |
| Tamanho do nome | 1 byte |
| Nome do arquivo | Tamanho indicado acima |

| Resposta, enviada pelo servidor | Tamanho |
| --- | --- |
| Tipo da mensagem: `2` | 1 byte |
| Código do comando respondido | 1 byte |
| Status: `1` sucesso ou `2` erro | 1 byte |

Os comandos usam os números `1=ADDFILE`, `2=DELETE`, `3=GETFILESLIST`, `4=GETFILE`.

- **ADDFILE:** depois do cabeçalho da solicitação, envia 4 bytes com o tamanho do arquivo e, em seguida, seus bytes. O servidor responde com o cabeçalho de sucesso ou erro.
- **DELETE:** envia somente o cabeçalho da solicitação. O servidor exclui o arquivo e responde com o status.
- **GETFILESLIST:** envia somente o cabeçalho, com nome vazio. Se houver sucesso, a resposta acrescenta 2 bytes com a quantidade de arquivos. Para cada arquivo, acrescenta 1 byte com o tamanho do nome e os bytes do nome.
- **GETFILE:** envia somente o cabeçalho da solicitação. Se houver sucesso, a resposta acrescenta 4 bytes com o tamanho do arquivo e depois os bytes do arquivo.

O código envia e recebe os dados dos arquivos **byte a byte**, como pede o enunciado. O tamanho de arquivo ocupa 4 bytes sem sinal: de 1 a `4.294.967.295` bytes. Arquivos vazios retornam `ERROR`, pois o intervalo do enunciado começa em 1 byte. `EXIT` é só uma instrução do cliente de terminal para fechar a conexão; não faz parte dos quatro comandos binários.

## Onde ler o código

1. `FileServer.java` cria a pasta de armazenamento, configura `java.util.logging` e aceita conexões.
2. `FileClientHandler.java` lê o cabeçalho, executa os comandos e envia as respostas. Cada conexão usa uma instância desta classe.
3. `Protocol.java` concentra os números do protocolo e as funções comuns de leitura e escrita.
4. `client/client.js` interpreta o que você digita e transfere arquivos.

Os arquivos são identificados apenas por nome, sem subdiretórios. Isso mantém o exemplo simples e impede que um nome como `../outro-arquivo` acesse conteúdo fora da pasta do servidor.

Para estudar, comece por `FileServer.java` e depois pelo método `run()` de `FileClientHandler.java`. No cliente, comece por `main()`; as funções `addFile()`, `listFiles()`, `getFile()` e `deleteFile()` correspondem aos quatro comandos do enunciado.
