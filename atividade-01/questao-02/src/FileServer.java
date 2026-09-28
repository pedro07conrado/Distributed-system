import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.logging.FileHandler;
import java.util.logging.Logger;
import java.util.logging.SimpleFormatter;

public class FileServer {
    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9001;
        Path storage = Path.of("server-data").toAbsolutePath();
        Files.createDirectories(storage);
        Files.createDirectories(storage.resolve(".tmp"));
        Files.createDirectories(Path.of("logs"));

        Logger logger = Logger.getLogger("FileServer");
        FileHandler logFile = new FileHandler("logs/server.log", true);
        logFile.setEncoding("UTF-8");
        logFile.setFormatter(new SimpleFormatter());
        logger.addHandler(logFile);

        try (ServerSocket server = new ServerSocket(port)) {
            System.out.println("Servidor de arquivos ouvindo na porta " + port);
            while (true) {
                Socket socket = server.accept();
                new Thread(new FileClientHandler(socket, storage, logger)).start();
            }
        } finally {
            logFile.close();
        }
    }
}
