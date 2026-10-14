import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

public class PeerRegistry {
    private static final Map<String, Client> clients = new HashMap<>();

    private record Client(Socket socket, PrintWriter output, String host, int port) { }

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9002;
        try (ServerSocket server = new ServerSocket(port)) {
            System.out.println("Lista de peers TCP na porta " + port);
            while (true) {
                Socket socket = server.accept();
                new Thread(() -> serve(socket)).start();
            }
        }
    }

    private static void serve(Socket socket) {
        String nickname = null;
        try (socket;
             BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
             PrintWriter output = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8)) {
            String line = input.readLine();
            if (line == null) return;
            String[] parts = line.split(" ", -1);
            if (parts.length != 3 || !parts[0].equals("JOIN")) {
                output.println("ERROR registro invalido");
                return;
            }
            byte[] nameBytes = Base64.getDecoder().decode(parts[1]);
            nickname = new String(nameBytes, StandardCharsets.UTF_8);
            int udpPort = Integer.parseInt(parts[2]);
            if (nameBytes.length < 1 || nameBytes.length > 64 || nickname.isBlank()
                    || !java.util.Arrays.equals(nameBytes, nickname.getBytes(StandardCharsets.UTF_8))
                    || udpPort < 1 || udpPort > 65535) {
                output.println("ERROR apelido ou porta invalida");
                return;
            }
            synchronized (clients) {
                if (clients.containsKey(nickname)) {
                    output.println("ERROR apelido em uso");
                    return;
                }
                clients.put(nickname, new Client(socket, output, socket.getInetAddress().getHostAddress(), udpPort));
                output.println("OK");
                broadcast();
            }
            while (input.readLine() != null) { /* conexão aberta indica presença */ }
        } catch (IllegalArgumentException | IOException e) {
            System.err.println("Cliente desconectado: " + e.getMessage());
        } finally {
            if (nickname != null) {
                synchronized (clients) {
                    Client current = clients.get(nickname);
                    if (current != null && current.socket() == socket) {
                        clients.remove(nickname);
                        broadcast();
                    }
                }
            }
        }
    }

    private static void broadcast() {
        for (Client client : clients.values()) {
            client.output().println("PEERS " + clients.size());
            for (Map.Entry<String, Client> entry : clients.entrySet()) {
                Client peer = entry.getValue();
                String name = Base64.getEncoder().encodeToString(entry.getKey().getBytes(StandardCharsets.UTF_8));
                client.output().println("PEER " + name + " " + peer.host() + " " + peer.port());
            }
        }
    }
}
