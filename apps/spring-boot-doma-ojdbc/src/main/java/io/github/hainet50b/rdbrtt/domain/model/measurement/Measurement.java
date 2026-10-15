package io.github.hainet50b.rdbrtt.domain.model.measurement;

/**
 * One execution of the query in one transaction: the elapsed time and round trips of acquire, the query (T and n),
 * and commit, and the rows fetched.
 */
public record Measurement(
        Double acquireMs,
        Long acquireRoundtrips,
        Double queryMs,
        Long queryRoundtrips,
        Double commitMs,
        Long commitRoundtrips,
        Integer fetchedRows,
        String error) {

    public record Span(
            double elapsedMs,
            long roundtrips) {
    }

    public static Measurement succeeded(Span acquire, Span query, Span commit, int fetchedRows) {
        return new Measurement(
                acquire.elapsedMs(),
                acquire.roundtrips(),
                query.elapsedMs(),
                query.roundtrips(),
                commit.elapsedMs(),
                commit.roundtrips(),
                fetchedRows,
                null);
    }

    public static Measurement failed(Exception e) {
        return new Measurement(null, null, null, null, null, null, null, e.toString());
    }
}
