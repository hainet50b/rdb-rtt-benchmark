package io.github.hainet50b.rdbrtt.domain.datasource.configuration;

import io.github.hainet50b.rdbrtt.domain.model.configuration.TestConfiguration;

public interface TestConfigurationRepository {

    TestConfiguration find();
}
