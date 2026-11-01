package br.edu.rpc.client;

import br.edu.rpc.movies.*;
import com.google.gson.JsonObject;
import com.google.protobuf.Message;
import com.google.protobuf.util.JsonFormat;
import io.grpc.StatusRuntimeException;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Cliente Java de terminal: cada operação usa um método remoto do stub gRPC. */
public final class MovieClient {
    private static final JsonFormat.Printer JSON = JsonFormat.printer()
        .preservingProtoFieldNames().includingDefaultValueFields();

    private MovieClient() {}

    public static void main(String[] args) {
        System.setOut(new PrintStream(System.out, true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(System.err, true, StandardCharsets.UTF_8));
        try {
            run(args);
        } catch (Exception error) {
            printError(error, Arrays.asList(args).contains("--json"));
            System.exit(1);
        }
    }

    private static void run(String[] args) throws IOException {
        List<String> values = new ArrayList<>(Arrays.asList(args));
        if (values.contains("--help")) {
            System.out.println("""
                Uso: java -jar target/filmes-client.jar [--host IP] [--port PORTA] [--json] [comando]

                  listar [limite] [offset]
                  buscar <id>
                  criar <arquivo.json>
                  atualizar <id> <arquivo.json>
                  excluir <id>
                  ator <nome completo> [--limit N] [--offset N]
                  categoria <nome> [--limit N] [--offset N]

                Sem comando, abre um menu no terminal. --json imprime a resposta completa.
                """);
            return;
        }
        String host = "127.0.0.1";
        int port = 50051;
        boolean json = false;
        while (!values.isEmpty() && values.get(0).startsWith("--")) {
            String option = values.remove(0);
            switch (option) {
                case "--host" -> host = take(values, "Informe o host.");
                case "--port" -> port = (int) integer(take(values, "Informe a porta."), "porta", 1, 65535);
                case "--json" -> json = true;
                default -> throw new IllegalArgumentException("Opção inválida: " + option);
            }
        }
        try (MovieConnection connection = new MovieConnection(host, port)) {
            if (values.isEmpty()) menu(connection, json);
            else printResponse(request(connection, values), json);
        }
    }

    private static Message request(MovieConnection connection, List<String> args) throws IOException {
        String command = args.get(0);
        List<String> values = args.subList(1, args.size());
        var stub = connection.stub();
        return switch (command) {
            case "listar" -> {
                if (values.size() > 2) throw new IllegalArgumentException("Use listar [limite] [offset].");
                int limit = values.isEmpty() ? 20 : (int) integer(values.get(0), "limite", 1, 100);
                int offset = values.size() < 2 ? 0 : (int) integer(values.get(1), "offset", 0, 4294967295L);
                yield stub.listMovies(ListMoviesRequest.newBuilder().setLimit(limit).setOffset(offset).build());
            }
            case "buscar", "excluir" -> {
                requireCount(values, 1, "Use " + command + " <id>.");
                MovieId id = MovieId.newBuilder().setId(values.get(0)).build();
                yield command.equals("buscar") ? stub.getMovie(id) : stub.deleteMovie(id);
            }
            case "criar", "atualizar" -> {
                boolean updating = command.equals("atualizar");
                requireCount(values, updating ? 2 : 1, updating
                    ? "Use atualizar <id> <arquivo.json>." : "Use criar <arquivo.json>.");
                MovieInput input = MovieInput.read(values.get(updating ? 1 : 0));
                yield updating
                    ? stub.updateMovie(UpdateMovieRequest.newBuilder().setId(values.get(0))
                        .setMovie(input.movie()).addAllFields(input.fields()).build())
                    : stub.createMovie(CreateMovieRequest.newBuilder().setMovie(input.movie())
                        .addAllFields(input.fields()).build());
            }
            case "ator", "categoria" -> {
                int limit = 20;
                int offset = 0;
                List<String> terms = new ArrayList<>();
                for (int index = 0; index < values.size(); index++) {
                    String value = values.get(index);
                    if (value.equals("--limit") || value.equals("--offset")) {
                        if (++index >= values.size()) throw new IllegalArgumentException("Informe o valor de " + value);
                        if (value.equals("--limit")) limit = (int) integer(values.get(index), "limite", 1, 100);
                        else offset = (int) integer(values.get(index), "offset", 0, 4294967295L);
                    } else if (value.startsWith("--")) {
                        throw new IllegalArgumentException("Opção inválida: " + value);
                    } else terms.add(value);
                }
                FilterRequest filter = FilterRequest.newBuilder().setFilter(String.join(" ", terms))
                    .setLimit(limit).setOffset(offset).build();
                yield command.equals("ator") ? stub.listByActor(filter) : stub.listByCategory(filter);
            }
            default -> throw new IllegalArgumentException("Comando desconhecido. Use --help para ver os comandos.");
        };
    }

    private static void printResponse(Message response, boolean json) throws IOException {
        if (json) System.out.println(JSON.print(response));
        else if (response instanceof MovieResponse result) System.out.println(JSON.print(result.getMovie()));
        else if (response instanceof DeleteMovieResponse result) {
            System.out.println(result.getMessage() + " Código: " + result.getId());
        } else if (response instanceof MovieList result) {
            for (Movie movie : result.getMoviesList()) {
                System.out.println(movie.getId() + " | " + (movie.hasTitle() ? movie.getTitle() : "(sem título)")
                    + " | " + movie.getYear());
            }
            System.out.println("Exibidos: " + result.getMoviesCount() + ". Total: " + Integer.toUnsignedString(result.getTotal()) + ".");
        }
    }

    private static void printError(Exception error, boolean json) {
        String code = "CLIENT_ERROR";
        String message = error.getMessage();
        if (error instanceof StatusRuntimeException rpcError) {
            code = rpcError.getStatus().getCode().name();
            message = rpcError.getStatus().getDescription();
            if (message == null || message.isBlank()) {
                message = switch (rpcError.getStatus().getCode()) {
                    case UNAVAILABLE -> "Serviço gRPC indisponível. Verifique o servidor, o endereço e a porta.";
                    case DEADLINE_EXCEEDED -> "A chamada excedeu o prazo de 15 segundos.";
                    default -> "Falha na chamada gRPC: " + code;
                };
            }
        }
        if (json) {
            JsonObject result = new JsonObject();
            result.addProperty("error_code", code);
            result.addProperty("message", message);
            System.out.println(result);
        } else System.err.println("Erro [" + code + "]: " + message);
    }

    private static void menu(MovieConnection connection, boolean json) throws IOException {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        while (true) {
            System.out.println("\n1 - Listar filmes\n2 - Buscar por código\n3 - Cadastrar\n4 - Atualizar\n5 - Excluir\n6 - Listar por ator\n7 - Listar por categoria\n0 - Sair");
            String option = prompt(input, "Opção: ");
            if (option == null || option.equals("0")) return;
            try {
                List<String> args = switch (option) {
                    case "1" -> List.of("listar", promptOrDefault(input, "Limite [20]: ", "20"),
                        promptOrDefault(input, "Offset [0]: ", "0"));
                    case "2", "5" -> List.of(option.equals("2") ? "buscar" : "excluir", promptRequired(input, "Código: "));
                    case "3" -> List.of("criar", promptRequired(input, "Arquivo JSON: "));
                    case "4" -> List.of("atualizar", promptRequired(input, "Código: "),
                        promptRequired(input, "Arquivo JSON com os campos a alterar: "));
                    case "6", "7" -> List.of(option.equals("6") ? "ator" : "categoria", promptRequired(input, "Nome: "));
                    default -> throw new IllegalArgumentException("Opção inválida.");
                };
                printResponse(request(connection, args), json);
            } catch (Exception error) {
                printError(error, json);
            }
        }
    }

    private static String prompt(BufferedReader input, String label) throws IOException {
        System.out.print(label);
        System.out.flush();
        String value = input.readLine();
        return value == null ? null : value.trim();
    }

    private static String promptRequired(BufferedReader input, String label) throws IOException {
        String value = prompt(input, label);
        if (value == null) throw new IllegalArgumentException("Entrada encerrada.");
        return value;
    }

    private static String promptOrDefault(BufferedReader input, String label, String defaultValue) throws IOException {
        String value = promptRequired(input, label);
        return value.isEmpty() ? defaultValue : value;
    }

    private static String take(List<String> values, String message) {
        if (values.isEmpty()) throw new IllegalArgumentException(message);
        return values.remove(0);
    }

    private static void requireCount(List<String> values, int count, String message) {
        if (values.size() != count) throw new IllegalArgumentException(message);
    }

    private static long integer(String value, String name, long min, long max) {
        try {
            if (!value.matches("[0-9]+")) throw new NumberFormatException();
            long number = Long.parseLong(value);
            if (number < min || number > max) throw new NumberFormatException();
            return number;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(name + " deve ser um inteiro entre " + min + " e " + max + ".");
        }
    }
}
