import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.DirectoryStream;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.logging.Logger;

public class FileClientHandler implements Runnable {
    private final Socket socket;
    private final Path storage;
    private final Logger logger;

    public FileClientHandler(Socket socket, Path storage, Logger logger) {
        this.socket = socket;
        this.storage = storage;
        this.logger = logger;
    }

    @Override
    public void run() {
        try (socket;
             DataInputStream input = new DataInputStream(socket.getInputStream());
             DataOutputStream output = new DataOutputStream(socket.getOutputStream())) {
            while (true) {
                int type;
                try {
                    type = input.readUnsignedByte();
                } catch (EOFException e) {
                    break; // O cliente fechou a conexão.
                }
                int command = input.readUnsignedByte();
                int nameSize = input.readUnsignedByte();
                String filename = Protocol.readFilename(input, nameSize);

                if (type != Protocol.REQUEST || command < 1 || command > 4) {
                    logger.warning("Solicitação inválida de " + socket.getRemoteSocketAddress());
                    break;
                }
                switch (command) {
                    case Protocol.ADD_FILE -> addFile(filename, input, output);
                    case Protocol.DELETE -> deleteFile(filename, output);
                    case Protocol.GET_FILES_LIST -> listFiles(nameSize, output);
                    case Protocol.GET_FILE -> getFile(filename, output);
                    default -> throw new IllegalStateException();
                }
            }
        } catch (IOException e) {
            logger.warning("Conexão encerrada com erro: " + e.getMessage());
        }
    }

    private void addFile(String filename, DataInputStream input, DataOutputStream output) throws IOException {
        long size = Protocol.readFileSize(input);
        Path target = storage.resolve(filename);
        if (!Protocol.validFilename(filename) || size == 0
                || Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            discardBytes(input, size);
            reply(output, Protocol.ADD_FILE, Protocol.ERROR, filename);
            return;
        }

        Path temporary = Files.createTempFile(storage.resolve(".tmp"), "upload-", ".tmp");
        try {
            try (OutputStream file = Files.newOutputStream(temporary)) {
                for (long i = 0; i < size; i++) {
                    file.write(input.readUnsignedByte()); // Transferência byte a byte.
                }
            }
            Files.move(temporary, target); // Falha se outro cliente criou o mesmo nome.
            reply(output, Protocol.ADD_FILE, Protocol.SUCCESS, filename);
        } catch (IOException e) {
            reply(output, Protocol.ADD_FILE, Protocol.ERROR, filename);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private void deleteFile(String filename, DataOutputStream output) throws IOException {
        if (!Protocol.validFilename(filename)) {
            reply(output, Protocol.DELETE, Protocol.ERROR, filename);
            return;
        }
        Path file = storage.resolve(filename);
        try {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
                reply(output, Protocol.DELETE, Protocol.ERROR, filename);
                return;
            }
            Files.delete(file);
            reply(output, Protocol.DELETE, Protocol.SUCCESS, filename);
        } catch (IOException e) {
            reply(output, Protocol.DELETE, Protocol.ERROR, filename);
        }
    }

    private void listFiles(int nameSize, DataOutputStream output) throws IOException {
        if (nameSize != 0) {
            reply(output, Protocol.GET_FILES_LIST, Protocol.ERROR, "nome deve ser vazio");
            return;
        }
        List<String> names = new ArrayList<>();
        try (DirectoryStream<Path> files = Files.newDirectoryStream(storage)) {
            for (Path file : files) {
                String name = file.getFileName().toString();
                if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
                        && Protocol.validFilename(name)) {
                    names.add(name);
                }
            }
        }
        Collections.sort(names);
        if (names.size() > 65535) {
            reply(output, Protocol.GET_FILES_LIST, Protocol.ERROR, "lista excede 65535 arquivos");
            return;
        }

        Protocol.sendResponse(output, Protocol.GET_FILES_LIST, Protocol.SUCCESS);
        output.writeShort(names.size());
        for (String name : names) {
            byte[] bytes = name.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            output.writeByte(bytes.length);
            output.write(bytes);
        }
        log(Protocol.GET_FILES_LIST, Protocol.SUCCESS, names.size() + " arquivo(s)");
    }

    private void getFile(String filename, DataOutputStream output) throws IOException {
        if (!Protocol.validFilename(filename)) {
            reply(output, Protocol.GET_FILE, Protocol.ERROR, filename);
            return;
        }
        Path file = storage.resolve(filename);
        try {
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
                reply(output, Protocol.GET_FILE, Protocol.ERROR, filename);
                return;
            }
            long size = Files.size(file);
            if (size == 0 || size > Protocol.MAX_FILE_SIZE) {
                reply(output, Protocol.GET_FILE, Protocol.ERROR, filename);
                return;
            }
            try (InputStream data = Files.newInputStream(file)) {
                Protocol.sendResponse(output, Protocol.GET_FILE, Protocol.SUCCESS);
                output.writeInt((int) size);
                for (long i = 0; i < size; i++) {
                    int byteValue = data.read();
                    if (byteValue == -1) {
                        throw new EOFException("Arquivo alterado durante o download");
                    }
                    output.writeByte(byteValue); // Transferência byte a byte.
                }
            }
            log(Protocol.GET_FILE, Protocol.SUCCESS, filename);
        } catch (IOException e) {
            log(Protocol.GET_FILE, Protocol.ERROR, filename + ": " + e.getMessage());
            throw e;
        }
    }

    private void discardBytes(DataInputStream input, long size) throws IOException {
        for (long i = 0; i < size; i++) {
            input.readUnsignedByte();
        }
    }

    private void reply(DataOutputStream output, int command, int status, String detail) throws IOException {
        Protocol.sendResponse(output, command, status);
        log(command, status, detail);
    }

    private void log(int command, int status, String detail) {
        logger.info(socket.getRemoteSocketAddress() + " comando=" + command
                + " status=" + (status == Protocol.SUCCESS ? "SUCCESS" : "ERROR")
                + " detalhe=" + detail);
    }
}
