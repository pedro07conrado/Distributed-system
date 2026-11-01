# RPC — Gerenciamento de filmes

Servidor em Python e cliente de terminal em Java 17, com comunicação gRPC e banco MongoDB. O sistema permite cadastrar, consultar, atualizar e excluir filmes, além de listar por ator ou categoria.

O contrato das chamadas está em `proto/movies.proto`. Os dados são da coleção `sample_mflix.movies`.

## Requisitos

- Python 3.11 ou superior.
- JDK 17 ou superior, com `java` e `javac` no PATH ou `JAVA_HOME` configurado.
- MongoDB local ou Atlas, com os dados da Mflix.

## Preparar

Na raiz do repositório:

```powershell
cd RPC
.\scripts\setup.ps1
```

O script instala as dependências Python, gera os stubs e compila o cliente Java em `target/filmes-client.jar`. O Maven Wrapper baixa o Maven e as bibliotecas na primeira execução, por isso é necessário acesso à internet.

## Banco de dados

A conexão padrão é `mongodb://127.0.0.1:27017`, banco `sample_mflix`, coleção `movies`. O MongoDB deve estar rodando antes de iniciar o servidor.

Se não houver MongoDB local, é possível iniciá-lo com Docker Desktop:

```powershell
docker compose up -d
```

Para importar os dados em um banco vazio, instale as MongoDB Database Tools, deixe `mongorestore` no PATH e execute:

```powershell
.\scripts\import-mflix.ps1
```

Se necessário, informe o caminho do executável com `-RestorePath 'C:\MongoDBTools\bin\mongorestore.exe'`. A importação mantém a coleção existente quando ela já possui filmes.

Para usar outro endereço ou um cluster Atlas, configure as variáveis antes de iniciar o servidor. No Atlas, carregue a amostra `sample_mflix` pelo painel do cluster.

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017'
$env:MONGODB_DATABASE = 'sample_mflix'
```

## Executar

Na pasta `RPC`, inicie o servidor:

```powershell
.\.venv\Scripts\python.exe server/server.py
```

Em outro terminal, também na pasta `RPC`, abra o cliente:

```powershell
java -jar target/filmes-client.jar
```

O cliente abre um menu. O servidor atende em `127.0.0.1:50051`. Para trocar a porta, use `--port` tanto no servidor quanto no cliente.

## Comandos do cliente

Também é possível executar as operações diretamente:

```powershell
java -jar target/filmes-client.jar listar 5
java -jar target/filmes-client.jar ator "Tom Hanks" --limit 5
java -jar target/filmes-client.jar categoria Drama --limit 5
java -jar target/filmes-client.jar criar examples/filme.json
java -jar target/filmes-client.jar buscar CODIGO
java -jar target/filmes-client.jar atualizar CODIGO examples/alteracao.json
java -jar target/filmes-client.jar excluir CODIGO
```

Substitua `CODIGO` pelo identificador retornado no cadastro. A atualização altera somente os campos presentes no arquivo JSON. `--json` exibe a resposta completa, e `--offset` permite paginar as consultas por ator ou categoria.

No cadastro, são obrigatórios `title`, `year`, `plot`, `runtime`, `cast`, `genres`, `directors`, `countries` e `type`. Campos de texto e listas não podem ser vazios; `runtime` deve ser positivo. Os campos `imdb`, `tomatoes` e `awards` são ignorados pelo serviço.

Erros retornam ao cliente com uma mensagem e um status gRPC, como `INVALID_ARGUMENT`, `NOT_FOUND` ou `UNAVAILABLE`.

## Testes

Com o MongoDB rodando, execute na pasta `RPC`:

```powershell
.\scripts\test.ps1
```

Os testes compilam o cliente Java e verificam as chamadas ao servidor Python. Usam um banco temporário, removido ao terminar, sem alterar `sample_mflix`.
