# Atividade RED — Gerenciamento de filmes

Servidor em Python, cliente de terminal em Node.js e persistência na coleção `sample_mflix.movies` do MongoDB. A comunicação usa TCP e mensagens binárias Protocol Buffers, definidas em `proto/movies.proto`.

Implementa cadastro, consulta por código, atualização parcial, exclusão, listagem geral, listagem por ator (`cast`) e por categoria (`genres`). Os campos `imdb`, `tomatoes` e `awards` não são exibidos ou editados pelo serviço.

## Preparar

Requer Windows x64, Python 3.11+ e Node.js 18+. Na raiz do repositório:

```powershell
cd red-filmes
.\scripts\setup.ps1
.\scripts\setup-mongo.ps1
```

O primeiro script instala as dependências e gera `server/movies_pb2.py` a partir do `.proto`. O segundo baixa o MongoDB Community 8.0.34, as Database Tools 100.19.0 e o arquivo oficial de exemplos do MongoDB. São downloads grandes; os arquivos ficam em `.runtime`, fora do Git. Downloads interrompidos podem ser retomados executando o script novamente.

O MongoDB é iniciado em segundo plano, restrito a `127.0.0.1:27017`. Seus dados persistem em `.runtime/data`, e o log fica em `.runtime/mongod.log`. O script importa **somente `sample_mflix.movies`**, sem `--drop`. Se a coleção já contiver dados, mantém o conteúdo existente. Não instala um serviço do Windows e não muda o PATH.

Após reiniciar o computador, basta iniciar o banco novamente:

```powershell
.\scripts\start-mongo.ps1
```

Para encerrar o banco de forma ordenada, na pasta `red-filmes`:

```powershell
.\.venv\Scripts\python.exe scripts/stop-mongo.py
```

## Executar

Na pasta `red-filmes`, inicie o servidor:

```powershell
.\.venv\Scripts\python.exe server/server.py
```

Em outro terminal, também na pasta `red-filmes`, abra o cliente:

```powershell
node client/client.js
```

O cliente apresenta um menu numerado. Cadastro e atualização leem arquivos JSON locais; os exemplos estão em `examples`. O arquivo é convertido em Protobuf antes de ser enviado ao servidor.

Também é possível executar cada operação diretamente:

```powershell
node client/client.js listar 5
node client/client.js buscar 573a139af29313caabceefa7
node client/client.js ator "Tom Hanks" --limit 5
node client/client.js categoria Drama --limit 5
node client/client.js criar examples/filme.json
```

O cadastro devolve o código do novo filme. Substitua `CODIGO` pelo valor retornado:

```powershell
node client/client.js buscar CODIGO
node client/client.js atualizar CODIGO examples/alteracao.json
node client/client.js excluir CODIGO
```

Para paginar e exibir respostas completas:

```powershell
node client/client.js listar 5 5
node client/client.js ator "Tom Hanks" --limit 5 --offset 5
node client/client.js --json categoria Drama --limit 2
```

O limite padrão é 20 e o máximo é 100. `offset` indica quantos resultados pular. As respostas informam o total correspondente à consulta, mesmo quando uma página contém menos registros. A busca por ator/categoria compara o nome completo, sem distinguir maiúsculas e minúsculas; categorias usam os nomes armazenados na Mflix, como `Drama`, `Comedy` e `Action`.

## Campos e erros

No cadastro, são obrigatórios `title`, `year`, `plot`, `runtime`, `cast`, `genres`, `directors`, `countries` e `type`. Campos opcionais são `fullplot`, `writers`, `languages`, `rated`, `released`, `poster` e `num_mflix_comments`. Os nomes seguem a coleção original. `id` corresponde ao `_id` do MongoDB e é gerado pelo banco. `lastupdated` é preenchido pelo servidor.

Textos informados não podem ser vazios ou conter somente espaços. Listas informadas precisam conter ao menos um texto não vazio. `year` aceita anos entre 1800 e 2200 e intervalos como `1994–1998` ou `1981–`, presentes nos registros de séries da Mflix. Por isso, esse campo é texto no Protobuf; o cliente também aceita um ano numérico no JSON de entrada. Anos únicos continuam sendo armazenados como números no MongoDB. `runtime` deve ser positivo e `num_mflix_comments` não pode ser negativo. `released`, quando informado, aceita data ISO 8601, por exemplo `2026-10-21` ou `2026-10-21T12:00:00Z`.

A atualização altera somente os campos presentes no arquivo. Campos omitidos, incluindo `imdb`, `tomatoes` e `awards`, são preservados no banco. Registros originais que não possuem todos os campos podem ser consultados normalmente. O arquivo oficial importado também contém intervalos de anos com o separador legado `è`; esses valores são aceitos e preservados.

| Código de erro | Situação |
| --- | --- |
| `VALIDATION_ERROR` | Código malformado, campo vazio/ausente ou parâmetro inválido |
| `NOT_FOUND` | ObjectId válido que não corresponde a um filme |
| `INVALID_OPERATION` | Operação desconhecida |
| `PROTOCOL_ERROR` | Protobuf malformado, tamanho inválido ou frame incompleto |
| `DATABASE_ERROR` | Falha ao acessar o MongoDB |
| `RESPONSE_TOO_LARGE` | Resposta acima de 1 MiB; reduza o limite da consulta |

O erro volta ao cliente em uma mensagem `Response`, com `ok=false`, `error_code` e `message`. Erros de operação não fecham a conexão. Frames com tamanho inválido ou incompletos encerram a conexão após a tentativa de resposta. No modo de comando, o cliente retorna código de saída 1 em caso de erro.

## Protocolo TCP

Cada mensagem tem o formato:

```text
[4 bytes: tamanho sem sinal, big-endian][Request ou Response serializado em Protobuf]
```

O tamanho não inclui os quatro bytes do cabeçalho e é limitado a 1 MiB. O servidor lê exatamente o cabeçalho e o corpo, tratando tanto mensagens fragmentadas quanto várias mensagens no mesmo recebimento TCP. Uma conexão aceita várias operações sequenciais; clientes diferentes são atendidos em threads separadas. Conexões sem tráfego por 120 segundos são encerradas.

`Request.operation` seleciona a operação. `id` identifica o filme, `movie` contém os dados, `filter` contém ator/categoria, `limit`/`offset` controlam a página e `fields` registra quais campos foram enviados para atualização. `Response` traz o resultado, os filmes e o total. JSON é usado somente nos arquivos locais e na exibição do cliente; o tráfego TCP é Protobuf. A biblioteca `grpcio-tools` é usada como compilador; o serviço não utiliza gRPC.

Para trocar endereço/porta do serviço:

```powershell
.\.venv\Scripts\python.exe server/server.py --host 127.0.0.1 --port 9005
node client/client.js --host 127.0.0.1 --port 9005 listar 5
```

O banco pode ser configurado por `MONGODB_URI` e `MONGODB_DATABASE` no ambiente do servidor. Os padrões são `mongodb://127.0.0.1:27017` e `sample_mflix`. Credenciais não ficam no código.

## Testar

Com MongoDB rodando, execute na pasta `red-filmes`:

```powershell
npm test
```

Os testes iniciam um servidor Python em porta temporária e usam o cliente Node.js com MongoDB real. Criam uma base exclusiva `red_filmes_test_<identificador>` e a removem ao terminar. Não modificam `sample_mflix`. Cobrem CRUD, preservação dos metadados, consultas, paginação, campos vazios, códigos inexistentes, erros Protobuf, frames fragmentados/agrupados e clientes simultâneos.

## Arquivos

- `proto/movies.proto`: contrato compartilhado entre as duas linguagens.
- `server/server.py`: servidor TCP e tratamento de erros.
- `server/protocol.py`: leitura e escrita dos frames.
- `server/service.py`: validação, CRUD e consultas MongoDB.
- `server/movies_pb2.py`: código gerado pelo compilador Protobuf.
- `client/connection.js`: comunicação TCP e codificação Protobuf.
- `client/client.js`: menu e comandos de terminal.
- `scripts`: instalação das dependências e preparação do MongoDB local.
- `examples`: dados de cadastro e atualização.
- `test`: testes de integração.

Referências: [coleção Mflix e seus campos](https://www.mongodb.com/docs/manual/sample-data/sample-mflix/), [importação oficial dos dados em MongoDB local](https://www.mongodb.com/docs/manual/sample-data/load-sample-data-local/), [Protocol Buffers em Python](https://protobuf.dev/getting-started/pythontutorial/) e [protobuf.js](https://github.com/protobufjs/protobuf.js).
