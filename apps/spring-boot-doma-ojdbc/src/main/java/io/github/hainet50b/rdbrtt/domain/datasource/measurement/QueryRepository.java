package io.github.hainet50b.rdbrtt.domain.datasource.measurement;

import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;

public interface QueryRepository {

    /** Runs the query through the data access framework and returns the rows fetched. One call is T. */
    int fetch(Query query);
}
