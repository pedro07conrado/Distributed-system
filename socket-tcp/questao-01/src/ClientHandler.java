import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.DirectoryStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Properties;

public class ClientHandler implements Runnable {
    private final Socket socket;
    private final Path base;
    private final Properties users;
    private Path home;
    private Path current;

    public ClientHandler(Socket socket, Path base, Properties users) {
        this.socket = socket;
        this.base = base;
        this.users = users;
    }

    @Override
    public void run() {
        try (socket;
             DataInputStream input = new DataInputStream(socket.getInputStream());
             DataOutputStream output = new DataOutputStream(socket.getOutputStream())) {

            while (true) {
                String request = input.readUTF();
                if (request.equals("EXIT")) {
                    break;
                }
                process(request, output);
            }
        } catch (IOException e) {
            System.out.println("Cliente desconectado: " + socket.getRemoteSocketAddress());
        }
    }

    private void process(String request, DataOutputStream output) throws IOException {
        if (request.startsWith("CONNECT ")) {
            connect(request.substring("CONNECT ".length()), output);
        } else if (home == null) {
            output.writeUTF("ERROR");
        } else if (request.equals("PWD")) {
            output.writeUTF(pathForClient());
        } else if (request.startsWith("CHDIR ")) {
            changeDirectory(request.substring("CHDIR ".length()), output);
        } else if (request.equals("GETFILES")) {
            sendNames(output, false);
        } else if (request.equals("GETDIRS")) {
            sendNames(output, true);
        } else {
            output.writeUTF("ERROR");
        }
    }

    private void connect(String arguments, DataOutputStream output) throws IOException {
        home = null;
        current = null;
        String[] parts = arguments.split(",", 2);
        if (parts.length != 2) {
            output.writeUTF("ERROR");
            return;
        }

        String username = parts[0].trim();
        String passwordHash = parts[1].trim();
        String savedHash = users.getProperty(username);
        if (!username.matches("[a-zA-Z0-9_-]+") || savedHash == null
                || !PasswordHash.matches(passwordHash, savedHash)) {
            output.writeUTF("ERROR");
            return;
        }

        Path userHome = base.resolve(username);
        Files.createDirectories(userHome);
        Path realHome = userHome.toRealPath();
        if (!realHome.startsWith(base.toRealPath())) {
            output.writeUTF("ERROR");
            return;
        }
        home = realHome;
        current = home;
        output.writeUTF("SUCCESS");
    }

    private void changeDirectory(String path, DataOutputStream output) throws IOException {
        try {
            Path destination = path.startsWith("/")
                    ? home.resolve(path.substring(1))
                    : current.resolve(path);
            destination = destination.toRealPath();
            if (destination.startsWith(home) && Files.isDirectory(destination)) {
                current = destination;
                output.writeUTF("SUCCESS");
            } else {
                output.writeUTF("ERROR");
            }
        } catch (IOException | RuntimeException e) {
            output.writeUTF("ERROR");
        }
    }

    private String pathForClient() {
        String relative = home.relativize(current).toString().replace('\\', '/');
        return relative.isEmpty() ? "/" : "/" + relative;
    }

    private void sendNames(DataOutputStream output, boolean directories) throws IOException {
        List<String> names = new ArrayList<>();

        try (DirectoryStream<Path> entries = Files.newDirectoryStream(current)) {
            for (Path entry : entries) {
                if (Files.isSymbolicLink(entry)) {
                    continue;
                }

                if (directories && Files.isDirectory(entry)) {
                    names.add(entry.getFileName().toString());
                } else if (!directories && Files.isRegularFile(entry)) {
                    names.add(entry.getFileName().toString());
                }
            }
        }

        Collections.sort(names);
        output.writeUTF(Integer.toString(names.size()));
        for (String name : names) {
            output.writeUTF(name);
        }
    }
}
