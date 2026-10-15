package io.github.hainet50b.rdbrtt.presentation.measurement;

import java.util.Map;

import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The interface of a measurement application: environment variables that the driver sets for each launch.
 * The connection variables (BENCH_DB_HOST and others) are read by application.yaml.
 */
record MeasurementArguments(Map<String, String> environment) {

    private static final JsonMapper JSON = new JsonMapper();

    String databaseType() {
        return required("BENCH_DB_TYPE");
    }

    /** {@code BENCH_PARAMETERS={"rows": 100, "id": 42}} */
    Query query() {
        Map<String, Object> parameters = JSON.readValue(environment.getOrDefault("BENCH_PARAMETERS", "{}"),
                new TypeReference<>() {
                });
        return new Query(required("BENCH_QUERY"), parameters, Integer.parseInt(required("BENCH_FETCH_SIZE")));
    }

    int executions() {
        return Integer.parseInt(required("BENCH_EXECUTIONS"));
    }

    private String required(String name) {
        String value = environment.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is not set");
        }
        return value;
    }
}
