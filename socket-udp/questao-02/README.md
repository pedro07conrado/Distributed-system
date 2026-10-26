# Questão 2 — Upload de arquivos por UDP

## Executar

Abra um terminal na raiz do repositório (`Distributed-system`) e execute:

```powershell
cd socket-udp/questao-02
New-Item -ItemType Directory -Force out | Out-Null
javac -encoding UTF-8 -d out src/UdpFileServer.java
java -cp out UdpFileServer
```

Em outro terminal aberto na raiz do repositório:

```powershell
cd socket-udp/questao-02
node client/client.js examples/ola.txt
```

O servidor escuta na porta `9003` e salva em `server-data/`. Para trocar endereço ou porta: `java -cp out UdpFileServer 9004` e `node client/client.js arquivo.pdf 192.168.1.10 9004`. Arquivos de nome já existente são recusados. O cliente mostra o progresso. O servidor registra no terminal horário inicial e final, origem, nome, tamanho e resultado. Vários clientes podem transferir ao mesmo tempo.

## Protocolo binário

Todos os inteiros de mais de um byte usam **big endian**. Um identificador aleatório de 4 bytes distingue transferências de uma mesma origem. O servidor identifica a sessão por endereço UDP de origem mais identificador. O nome é UTF-8, com 1 a 255 bytes, sem separadores de caminho.

| Datagrama | Campos em ordem |
| --- | --- |
| START (`1`) | tipo `1`, id `4`, tamanho total `8` sem sinal, tamanho do nome `1`, nome `1..255` |
| DATA (`2`) | tipo `1`, id `4`, sequência `4`, tamanho do bloco `2`, conteúdo `1..1024` |
| END (`3`) | tipo `1`, id `4`, SHA-1 do arquivo `20` bytes |
| ACK (`4`) | tipo `1`, id `4`, sequência `4`, status `1` (`1` sucesso, `2` erro) |

O ACK do START usa sequência `0xffffffff`; o do END usa `0xfffffffe`. Blocos DATA começam na sequência `0`. O cliente aguarda um ACK antes de enviar o bloco seguinte e retransmite após 700 ms, até 8 tentativas. O servidor reconhece novamente blocos duplicados sem gravá-los duas vezes. Ao receber END, confere o tamanho e o SHA-1 antes de mover o arquivo temporário para `server-data/`. Arquivos incompletos são descartados após dois minutos sem atividade (na próxima chegada de pacote); o mesmo prazo mantém o ACK de um END concluído para eventual retransmissão. O protocolo funciona para texto, binários e arquivo vazio. O limite prático deste cliente é o tamanho inteiro seguro de JavaScript.

## Testar tamanhos e formatos

Execute o cliente com um texto pequeno, uma imagem/PDF e um arquivo de aproximadamente 4 MiB. Compare hashes SHA-1 do original e da cópia em `server-data/` com `Get-FileHash -Algorithm SHA1`. Para repetir o mesmo upload, remova ou renomeie a cópia no servidor.

Após compilar o servidor, `node test/integration.js` cria arquivos temporários de 100 bytes, 4 KiB e 4 MiB, envia os três em paralelo e compara cada cópia byte a byte. O teste não altera `server-data/` desta pasta.
