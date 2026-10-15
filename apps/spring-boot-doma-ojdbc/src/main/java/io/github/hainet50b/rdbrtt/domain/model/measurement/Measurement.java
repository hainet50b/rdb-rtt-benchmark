package io.github.hainet50b.rdbrtt.domain.model.measurement;

/** One execution of the query: the response time T, the round trips n, and the rows fetched. */
public record Measurement(
        Double elapsedMs,
        Long roundtrips,
        Integer fetchedRows,
        String error) {

    public static Measurement succeeded(double elapsedMs, long roundtrips, int fetchedRows) {
        return new Measurement(elapsedMs, roundtrips, fetchedRows, null);
    }

    public static Measurement failed(Exception e) {
        return new Measurement(null, null, null, e.toString());
    }
}
