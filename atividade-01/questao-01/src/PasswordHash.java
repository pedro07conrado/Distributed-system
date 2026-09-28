import java.security.MessageDigest;
import java.util.HexFormat;

public class PasswordHash {
    public static boolean matches(String receivedHash, String savedHash) {
        if (!receivedHash.matches("[0-9a-fA-F]{128}") || !savedHash.matches("[0-9a-fA-F]{128}")) {
            return false;
        }

        byte[] received = HexFormat.of().parseHex(receivedHash.toLowerCase());
        byte[] saved = HexFormat.of().parseHex(savedHash.toLowerCase());
        return MessageDigest.isEqual(received, saved);
    }
}
