package br.edu.rpc.client;

import br.edu.rpc.movies.Movie;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.protobuf.Descriptors.FieldDescriptor;
import com.google.protobuf.util.JsonFormat;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Lê um filme local e registra todos os campos enviados, inclusive listas vazias. */
public record MovieInput(Movie movie, List<String> fields) {
    public static MovieInput read(String filename) throws IOException {
        String text = Files.readString(Path.of(filename), StandardCharsets.UTF_8).replaceFirst("^\uFEFF", "");
        JsonElement parsed = JsonParser.parseString(text);
        if (!parsed.isJsonObject()) throw new IllegalArgumentException("O arquivo deve conter um objeto JSON.");
        JsonObject json = parsed.getAsJsonObject();
        List<String> fields = new ArrayList<>(json.keySet());
        for (String name : fields) {
            FieldDescriptor field = Movie.getDescriptor().findFieldByName(name);
            if (field == null || name.equals("id") || name.equals("lastupdated")) {
                throw new IllegalArgumentException("Campo não editável: " + name);
            }
            JsonElement value = json.get(name);
            if (value.isJsonNull()) throw new IllegalArgumentException(name + " não pode ser nulo.");
            if (name.equals("year") && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
                try {
                    json.addProperty(name, value.getAsBigDecimal().toBigIntegerExact().toString());
                    value = json.get(name);
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException("year deve ser um ano inteiro ou um intervalo.");
                }
            }
            if (field.isRepeated()) {
                if (!value.isJsonArray()) throw new IllegalArgumentException(name + " deve ser uma lista de textos.");
                for (JsonElement item : value.getAsJsonArray()) requireString(name, item);
            } else if (field.getJavaType() == FieldDescriptor.JavaType.STRING) {
                requireString(name, value);
            } else if (field.getJavaType() == FieldDescriptor.JavaType.INT) {
                if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
                    throw new IllegalArgumentException(name + " deve ser um inteiro de 32 bits.");
                }
                try {
                    value.getAsBigDecimal().toBigIntegerExact().intValueExact();
                } catch (ArithmeticException error) {
                    throw new IllegalArgumentException(name + " deve ser um inteiro de 32 bits.");
                }
            }
        }
        Movie.Builder movie = Movie.newBuilder();
        JsonFormat.parser().merge(json.toString(), movie);
        return new MovieInput(movie.build(), List.copyOf(fields));
    }

    private static void requireString(String name, JsonElement value) {
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException(name + " deve conter texto.");
        }
    }
}
