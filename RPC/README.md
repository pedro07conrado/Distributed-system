# Atividade RPC — Gerenciamento de filmes

Servidor **Python** e cliente de terminal **Node.js**, em linguagens distintas, usando **gRPC** e os dados da coleção **`sample_mflix.movies`** do MongoDB. Implementa CRUD, listagem geral, filtros por ator e categoria e devolução de erros ao cliente.

```text
Cliente Node.js                 Servidor Python                  MongoDB
@grpc/grpc-js  <-- gRPC -->  MovieService / PyMongo  <-- driver -->  sample_mflix.movies
                   |
           proto/movies.proto
```

O arquivo `.proto` define mensagens e métodos remotos. O Python usa os stubs gerados por `grpcio-tools`; o Node.js carrega o mesmo contrato com `@grpc/proto-loader`. O gRPC cuida do transporte HTTP/2 e da serialização Protobuf, sem implementar manualmente frames de socket.

## 1. Preparar as dependências

Requer Windows, Python 3.11+ e Node.js 18+. Na raiz do repositório:

```powershell
cd RPC
.\scripts\setup.ps1
```

O script cria `.venv`, instala as dependências Python/Node e gera `server/movies_pb2.py` e `server/movies_pb2_grpc.py`. Ele não instala MongoDB. Os arquivos gerados também acompanham o código, e podem ser regenerados com:

```powershell
.\.venv\Scripts\python.exe -m grpc_tools.protoc -I proto --python_out=server --grpc_python_out=server proto/movies.proto
```

## 2. Disponibilizar o banco e os dados Mflix

O servidor usa, por padrão, `mongodb://127.0.0.1:27017`, banco `sample_mflix`, coleção `movies`. Executáveis e dados do MongoDB não acompanham a entrega. Escolha uma das opções:

- **Banco local já existente:** inicie seu MongoDB e reutilize `sample_mflix.movies`, caso a coleção já esteja importada. Neste repositório, quem já preparou a RED pode iniciar o banco com `..\red-filmes\scripts\start-mongo.ps1`, executado a partir de `RPC`; a atividade RPC funciona de forma independente dessa pasta quando há outro MongoDB disponível.
- **MongoDB Atlas:** disponibilize um cluster com a amostra `sample_mflix` e configure a URI de conexão no ambiente do servidor.
- **MongoDB Community separado:** instale/inicie o banco fora do projeto. Como alternativa, com Docker Desktop disponível, execute `docker compose up -d` na pasta `RPC`. O arquivo `compose.yaml` publica apenas `127.0.0.1:27017` e armazena os dados em um volume Docker. Use essa opção quando não houver outro MongoDB ocupando essa porta. Para parar o contêiner preservando os dados: `docker compose stop`.

Para um banco local vazio, instale também as [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) e execute:

```powershell
.\scripts\import-mflix.ps1
```

Se `mongorestore` não estiver no PATH, informe o executável:

```powershell
.\scripts\import-mflix.ps1 -RestorePath 'C:\MongoDBTools\bin\mongorestore.exe'
```

O script baixa o arquivo oficial de exemplos para `%LOCALAPPDATA%\Distributed-system\mflix`, fora do projeto, e importa **somente `sample_mflix.movies`**. Não usa `--drop`; se a coleção de destino já contiver dados, pula a importação. Um arquivo oficial já baixado pode ser reutilizado com `-ArchivePath 'C:\caminho\sampledata.archive'`. Para uma importação interrompida, confira a quantidade de registros antes de usar a coleção, pois o script preserva coleções não vazias.

Para trocar a conexão ou o nome do banco, configure antes de importar e iniciar o servidor:

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_DATABASE = 'sample_mflix'
```

No Atlas, substitua `MONGODB_URI` pela URI do cluster e carregue a amostra pela interface do Atlas. Credenciais são lidas do ambiente e não devem ser adicionadas ao código. O cliente Node.js conhece somente o endereço do serviço gRPC.

## 3. Executar

Na pasta `RPC`, inicie o servidor:

```powershell
.\.venv\Scripts\python.exe server/server.py
```

Em outro terminal, também na pasta `RPC`, abra o menu do cliente:

```powershell
node client/client.js
```

O serviço atende em `127.0.0.1:50051`. Para outro endereço/porta, use `server/server.py --host 127.0.0.1 --port 50052` e `client/client.js --host 127.0.0.1 --port 50052`. A configuração de demonstração usa gRPC local sem TLS; a conexão do MongoDB é configurada separadamente.

Também é possível chamar cada operação diretamente:

```powershell
node client/client.js listar 5
node client/client.js buscar 573a1390f29313caabcd42e8
node client/client.js ator "Tom Hanks" --limit 5
node client/client.js categoria Drama --limit 5
node client/client.js criar examples/filme.json
```

O cadastro retorna o `id` do filme. Substitua `CODIGO` por esse valor:

```powershell
node client/client.js buscar CODIGO
node client/client.js atualizar CODIGO examples/alteracao.json
node client/client.js excluir CODIGO
```

Para paginar e exibir a resposta completa em JSON:

```powershell
node client/client.js listar 5 5
node client/client.js --json ator "Tom Hanks" --limit 5 --offset 5
```

O limite padrão é 20, o máximo é 100, e `offset` informa quantos resultados pular. Os filtros comparam o nome completo sem distinguir maiúsculas/minúsculas; categorias usam os valores da Mflix, como `Drama`, `Comedy` e `Action`. JSON é usado na entrada local e na exibição; a chamada remota usa gRPC/Protobuf.

## Métodos e erros remotos

| Comando | Método gRPC | Resultado |
| --- | --- | --- |
| `criar` | `CreateMovie` | Filme cadastrado com código gerado pelo MongoDB |
| `buscar` | `GetMovie` | Filme pelo código |
| `atualizar` | `UpdateMovie` | Filme com os campos informados atualizados |
| `excluir` | `DeleteMovie` | Código e confirmação de exclusão |
| `listar` | `ListMovies` | Página de filmes e total |
| `ator` | `ListByActor` | Página filtrada por `cast` e total |
| `categoria` | `ListByCategory` | Página filtrada por `genres` e total |

O servidor usa os status gRPC para devolver erros com descrição ao cliente:

| Status | Situação |
| --- | --- |
| `INVALID_ARGUMENT` | Código malformado, campo vazio/ausente ou parâmetro inválido |
| `NOT_FOUND` | Código válido que não corresponde a um filme |
| `UNAVAILABLE` | Falha de acesso ao MongoDB ou serviço gRPC indisponível |
| `INTERNAL` | Falha inesperada de processamento |
| `DEADLINE_EXCEEDED` | Chamada excedeu o tempo limite |
| `RESOURCE_EXHAUSTED` | Mensagem excedeu o limite do gRPC |

A CLI imprime o status e a mensagem e retorna código de saída 1 em caso de erro; com `--json`, imprime `error_code` e `message`. No menu, é possível corrigir a entrada e realizar outra chamada. A conexão inicial tem limite de 5 segundos, e cada chamada tem prazo de 15 segundos.

## Campos dos filmes

No cadastro, são obrigatórios `title`, `year`, `plot`, `runtime`, `cast`, `genres`, `directors`, `countries` e `type`. Os demais campos do contrato são opcionais. `id` representa o `_id` do MongoDB; `id` e `lastupdated` são definidos pelo servidor. Textos informados devem conter caracteres além de espaços; listas informadas devem conter textos não vazios. `runtime` precisa ser positivo e `num_mflix_comments` não pode ser negativo. `released` aceita data ISO 8601.

`year` aceita anos entre 1800 e 2200 e intervalos como `1994–1998` ou `1981–`; o separador legado `è` da base original também é preservado. Por isso, é texto no contrato Protobuf. A CLI aceita ano numérico no JSON, e o MongoDB continua armazenando anos únicos como números.

A atualização é parcial e preserva campos omitidos. No cadastro e na atualização, `fields` identifica os campos enviados, inclusive listas vazias que precisam ser rejeitadas. A CLI preenche essa lista automaticamente; outros clientes devem informá-la para distinguir uma lista vazia de uma lista omitida. Registros originais com campos ausentes podem ser consultados. `imdb`, `tomatoes` e `awards` são ignorados pelo serviço e preservados no banco.

## Testar

Com o MongoDB disponível, na pasta `RPC`:

```powershell
npm test
```

Os testes iniciam um servidor gRPC Python em porta temporária e fazem chamadas com o cliente Node.js. Usam um MongoDB real e criam uma base exclusiva `rpc_filmes_test_<identificador>`, removida ao terminar; não modificam `sample_mflix`. Cobrem os sete métodos, CRUD, persistência entre conexões, paginação, filtros, dados esparsos, preservação de metadados, datas, erros de validação, código inexistente, clientes simultâneos e comandos reais da CLI. Falhas de banco e erros internos são injetados em um serviço gRPC separado para verificar os status sem derrubar o banco real.

## Entregar

Na raiz do repositório:

```powershell
.\RPC\scripts\empacotar.ps1
```

O arquivo `RPC_a2515725.zip` contém a pasta `RPC` com fontes, contrato, stubs gerados, exemplos, testes, instruções e scripts. Não inclui `.venv`, `node_modules`, executáveis, dados ou downloads do MongoDB, caches ou logs. Não compacte a pasta inteira após instalar as dependências.

Quem receber deve usar **Extrair Tudo**, abrir a pasta `RPC` extraída e seguir as etapas de preparação e execução. A primeira instalação das dependências e a obtenção da Mflix requerem internet.

## Arquivos principais

- `proto/movies.proto`: contrato e métodos remotos.
- `server/server.py`: inicialização gRPC e conexão MongoDB.
- `server/service.py`: implementação do serviço e tradução dos erros.
- `server/validation.py`: validação e conversão de filmes.
- `server/movies_pb2*.py`: mensagens e stubs gerados.
- `client/connection.js`: canal e chamadas gRPC em Node.js.
- `client/client.js`: comandos e menu de terminal.
- `scripts`: instalação das dependências, importação e empacotamento.
- `test`: integração entre as duas linguagens e testes de erros.

Referências: [gRPC em Python](https://grpc.io/docs/languages/python/basics/), [gRPC em Node.js](https://grpc.io/docs/languages/node/basics/), [status gRPC](https://grpc.io/docs/guides/status-codes/), [coleção Mflix](https://www.mongodb.com/docs/manual/sample-data/sample-mflix/) e [importação oficial local](https://www.mongodb.com/docs/manual/sample-data/load-sample-data-local/).
