# Sistemas Distribuídos

Atividades da disciplina de Sistemas Distribuídos do Prof. Rodrigo Campiolo.

Os exercícios estão organizados pelo protocolo de comunicação:

- [Socket TCP — Atividade 01](socket-tcp/README.md)
- [Socket UDP — Atividade 02](socket-udp/README.md)
- [WebSocket — Monitoramento de hosts](websocket/README.md)
- [RED — Gerenciamento de filmes com TCP e Protocol Buffers](red-filmes/README.md)
- [RPC — Gerenciamento de filmes com gRPC, Python e Java](RPC/README.md)

O código foi separado em classes pequenas para facilitar a leitura e a discussão do fluxo.

## RPC — Gerenciamento de filmes

A atividade RPC usa um servidor em **Python** e um cliente de terminal em **Java 17**, com comunicação **gRPC** e persistência na coleção `sample_mflix.movies` do **MongoDB**. Implementa cadastro, consulta, atualização e exclusão de filmes, listagem por ator e categoria e tratamento de erros devolvidos ao cliente.

Consulte o [README da atividade RPC](RPC/README.md) para preparar as dependências, executar o servidor e o cliente, rodar os testes e gerar o ZIP de entrega.
