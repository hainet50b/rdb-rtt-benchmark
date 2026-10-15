package io.github.hainet50b.rdbrtt.domain.model.configuration;

import java.util.Map;

public record TestConfiguration(
        Component language,
        Component framework,
        Component dataAccess,
        Component pool,
        Component driver,
        Component database,
        Map<String, String> databaseParameters) {

    public record Component(
            String name,
            String version) {
    }
}
