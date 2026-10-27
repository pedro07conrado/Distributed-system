package br.edu.rpc.client;

import br.edu.rpc.movies.MovieServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import java.util.concurrent.TimeUnit;

/** Canal gRPC e stub tipado gerado a partir de proto/movies.proto. */
public final class MovieConnection implements AutoCloseable {
    private final ManagedChannel channel;
    private final MovieServiceGrpc.MovieServiceBlockingStub stub;

    public MovieConnection(String host, int port) {
        channel = ManagedChannelBuilder.forAddress(host, port).usePlaintext().build();
        stub = MovieServiceGrpc.newBlockingStub(channel);
    }

    public MovieServiceGrpc.MovieServiceBlockingStub stub() {
        return stub.withDeadlineAfter(15, TimeUnit.SECONDS);
    }

    @Override
    public void close() {
        channel.shutdownNow();
        try {
            channel.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }
}
