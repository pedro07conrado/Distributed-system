import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class Protocol {
    public static final int REQUEST = 1;
    public static final int RESPONSE = 2;
    public static final int ADD_FILE = 1;
    public static final int DELETE = 2;
    public static final int GET_FILES_LIST = 3;
    public static final int GET_FILE = 4;
    public static final int SUCCESS = 1;
    public static final int ERROR = 2;
    public static final long MAX_FILE_SIZE = 0xFFFFFFFFL;

    public static String readFilename(DataInputStream input, int size) throws IOException {
        byte[] name = new byte[size];
        input.readFully(name);
        String filename = new String(name, StandardCharsets.UTF_8);
        if (!Arrays.equals(name, filename.getBytes(StandardCharsets.UTF_8))) {
            return ""; // Sequência UTF-8 inválida.
        }
        return filename;
    }

    public static boolean validFilename(String name) {
        int size = name.getBytes(StandardCharsets.UTF_8).length;
        return size >= 1 && size <= 255
                && !name.equals(".") && !name.equals("..")
                && !name.contains("/") && !name.contains("\\")
                && name.chars().noneMatch(c -> c < 32);
    }

    public static void sendResponse(DataOutputStream output, int command, int status) throws IOException {
        output.writeByte(RESPONSE);
        output.writeByte(command);
        output.writeByte(status);
    }

    public static long readFileSize(DataInputStream input) throws IOException {
        return Integer.toUnsignedLong(input.readInt());
    }
}
