import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public class TcpServer {
    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9000;
        Path base = Path.of("server-data").toAbsolutePath();
        Path usersFile = Path.of("users.properties");

        Properties users = new Properties();
        try (var reader = Files.newBufferedReader(usersFile)) {
            users.load(reader);
        }

        Files.createDirectories(base);
        try (ServerSocket server = new ServerSocket(port)) {
            System.out.println("Servidor ouvindo na porta " + port);
            while (true) {
                Socket socket = server.accept();
                Thread clientThread = new Thread(new ClientHandler(socket, base, users));
                clientThread.start();
            }
        }
    }
}
