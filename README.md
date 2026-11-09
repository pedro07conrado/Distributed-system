# Sistemas Distribuídos
<img width="683" height="631" alt="image" src="https://github.com/user-attachments/assets/6c9070c8-7e1e-492e-86b4-c9bad648f890" />

Atividades da disciplina de Sistemas Distribuídos do Prof.Dr.Rodrigo Campiolo.

Os exercícios estão organizados pelo protocolo de comunicação:

- [Socket TCP — Atividade 01](socket-tcp/README.md)
- [Socket UDP — Atividade 02](socket-udp/README.md)
- [WebSocket — Monitoramento de hosts](websocket/README.md)
- [RED — Gerenciamento de filmes com TCP e Protocol Buffers](red-filmes/README.md)
- [RPC — Gerenciamento de filmes com gRPC, Python e Java](RPC/README.md)

O código foi separado em classes pequenas para facilitar a leitura e a discussão do fluxo.

## RPC — Gerenciamento de filmes

A atividade RPC usa um servidor em **Python** e um cliente de terminal em **Java 17**, com comunicação **gRPC** e persistência na coleção `sample_mflix.movies` do **MongoDB**. Implementa cadastro, consulta, atualização e exclusão de filmes, listagem por ator e categoria e tratamento de erros devolvidos ao cliente.

As instruções de configuração, execução e testes estão no [README da atividade RPC](RPC/README.md).



