package io.github.hainet50b.rdbrtt.domain.datasource.measurement;

public interface SessionStatisticsRepository {

    /** Returns the round trips that the session of the pooled connection has made so far, without using it. */
    long readRoundtrips();
}
