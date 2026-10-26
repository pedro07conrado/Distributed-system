import java.io.IOException;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.SocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public class UdpFileServer {
    private static final int START = 1, DATA = 2, END = 3, ACK = 4;
    private static final long START_SEQ = 0xffffffffL, END_SEQ = 0xfffffffeL;
    private static final long SESSION_TIMEOUT_MS = 120_000;
    private static final Map<String, Transfer> transfers = new HashMap<>();
    private static final Map<String, Long> completed = new HashMap<>();
    private static Path storage;

    private static class Transfer {
        final String name;
        final long size;
        final Path temporary;
        final OutputStream output;
        final MessageDigest digest;
        final Instant started = Instant.now();
        final SocketAddress sender;
        long received;
        long nextSequence;
        long lastSeen = System.currentTimeMillis();

        Transfer(String name, long size, SocketAddress sender) throws IOException {
            this.name = name;
            this.size = size;
            this.sender = sender;
            temporary = Files.createTempFile(storage, ".upload-", ".tmp");
            output = Files.newOutputStream(temporary);
            try { digest = MessageDigest.getInstance("SHA-1"); }
            catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        }

        void discard() throws IOException { output.close(); Files.deleteIfExists(temporary); }
    }

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 9003;
        storage = Path.of("server-data").toAbsolutePath();
        Files.createDirectories(storage);
        try (DatagramSocket socket = new DatagramSocket(port)) {
            System.out.println("Upload UDP na porta " + port + "; destino: " + storage);
            byte[] buffer = new byte[1200];
            while (true) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);
                try { handle(socket, packet); }
                catch (Exception e) { System.err.println("Pacote rejeitado de " + packet.getSocketAddress() + ": " + e.getMessage()); }
                cleanup();
            }
        }
    }

    private static void handle(DatagramSocket socket, DatagramPacket packet) throws IOException {
        byte[] bytes = Arrays.copyOfRange(packet.getData(), packet.getOffset(), packet.getOffset() + packet.getLength());
        if (bytes.length < 5) return;
        ByteBuffer data = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN);
        int type = Byte.toUnsignedInt(data.get());
        long id = Integer.toUnsignedLong(data.getInt());
        String key = packet.getSocketAddress() + "/" + id;
        if (type == START) {
            if (bytes.length < 14) return;
            long size = data.getLong();
            int nameSize = Byte.toUnsignedInt(data.get());
            if (bytes.length != 14 + nameSize || size < 0 || nameSize == 0) return;
            byte[] rawName = new byte[nameSize];
            data.get(rawName);
            String name = new String(rawName, StandardCharsets.UTF_8);
            if (!validName(name, rawName) || Files.exists(storage.resolve(name))) {
                ack(socket, packet, id, START_SEQ, 2); return;
            }
            if (!transfers.containsKey(key)) {
                transfers.put(key, new Transfer(name, size, packet.getSocketAddress()));
                System.out.printf("INICIO %s origem=%s nome=%s tamanho=%d%n", Instant.now(), packet.getSocketAddress(), name, size);
            }
            ack(socket, packet, id, START_SEQ, 1);
        } else if (type == DATA) {
            if (bytes.length < 11) return;
            long sequence = Integer.toUnsignedLong(data.getInt());
            int length = Short.toUnsignedInt(data.getShort());
            if (length < 1 || length > 1024 || bytes.length != 11 + length) return;
            Transfer transfer = transfers.get(key);
            if (transfer == null) return;
            transfer.lastSeen = System.currentTimeMillis();
            if (sequence == transfer.nextSequence && transfer.received + length <= transfer.size) {
                transfer.output.write(bytes, 11, length);
                transfer.digest.update(bytes, 11, length);
                transfer.received += length;
                transfer.nextSequence++;
                ack(socket, packet, id, sequence, 1);
            } else if (sequence < transfer.nextSequence) ack(socket, packet, id, sequence, 1);
            else ack(socket, packet, id, sequence, 2);
        } else if (type == END) {
            if (bytes.length != 25) return;
            Transfer transfer = transfers.get(key);
            if (transfer == null) {
                if (completed.containsKey(key)) ack(socket, packet, id, END_SEQ, 1);
                return;
            }
            transfer.lastSeen = System.currentTimeMillis();
            if (transfer.received != transfer.size) { ack(socket, packet, id, END_SEQ, 2); return; }
            byte[] expected = Arrays.copyOfRange(bytes, 5, 25);
            transfer.output.close();
            boolean valid = MessageDigest.isEqual(expected, transfer.digest.digest());
            if (valid) {
                try { Files.move(transfer.temporary, storage.resolve(transfer.name)); }
                catch (IOException e) { valid = false; }
            }
            if (!valid) Files.deleteIfExists(transfer.temporary);
            transfers.remove(key);
            if (valid) completed.put(key, System.currentTimeMillis());
            System.out.printf("FIM %s origem=%s nome=%s tamanho=%d inicio=%s status=%s%n",
                    Instant.now(), transfer.sender, transfer.name, transfer.size, transfer.started, valid ? "OK" : "ERRO SHA-1/arquivo");
            ack(socket, packet, id, END_SEQ, valid ? 1 : 2);
        }
    }

    private static boolean validName(String name, byte[] raw) {
        return Arrays.equals(raw, name.getBytes(StandardCharsets.UTF_8)) && !name.equals(".") && !name.equals("..")
                && !name.contains("/") && !name.contains("\\") && name.chars().noneMatch(c -> c < 32 || c == 127);
    }

    private static void ack(DatagramSocket socket, DatagramPacket request, long id, long sequence, int status) throws IOException {
        ByteBuffer response = ByteBuffer.allocate(10).order(ByteOrder.BIG_ENDIAN);
        response.put((byte) ACK).putInt((int) id).putInt((int) sequence).put((byte) status);
        byte[] bytes = response.array();
        socket.send(new DatagramPacket(bytes, bytes.length, request.getSocketAddress()));
    }

    private static void cleanup() throws IOException {
        long now = System.currentTimeMillis();
        var iterator = transfers.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            if (now - entry.getValue().lastSeen > SESSION_TIMEOUT_MS) {
                entry.getValue().discard();
                iterator.remove();
            }
        }
        completed.entrySet().removeIf(entry -> now - entry.getValue() > SESSION_TIMEOUT_MS);
    }
}
