package io.github.hainet50b.rdbrtt.domain.datasource.measurement;

public interface SessionStatisticsRepository {

    /** Returns the round trips that the current session has made so far. */
    long readRoundtrips();
}
