package io.github.hainet50b.rdbrtt.domain.model.measurement;

import java.util.List;

import io.github.hainet50b.rdbrtt.domain.model.configuration.TestConfiguration;

public record MeasurementResult(
        TestConfiguration configuration,
        List<Measurement> executions) {
}
