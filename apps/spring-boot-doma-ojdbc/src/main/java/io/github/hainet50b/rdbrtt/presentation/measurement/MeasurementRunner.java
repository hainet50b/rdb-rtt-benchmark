package io.github.hainet50b.rdbrtt.presentation.measurement;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import io.github.hainet50b.rdbrtt.application.measurement.MeasurementService;
import io.github.hainet50b.rdbrtt.domain.model.measurement.MeasurementResult;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;

/** Measures the query given in the environment and writes the result to standard output as JSON. */
@Component
public class MeasurementRunner implements ApplicationRunner {

    private static final JsonMapper JSON = JsonMapper.builder()
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build();

    private final MeasurementService service;

    public MeasurementRunner(MeasurementService service) {
        this.service = service;
    }

    @Override
    public void run(ApplicationArguments applicationArguments) {
        MeasurementArguments arguments = new MeasurementArguments(System.getenv());
        if (!arguments.databaseType().equals("oracle")) {
            throw new IllegalArgumentException("This application connects to oracle, not " + arguments.databaseType());
        }
        MeasurementResult result = service.measure(arguments.query(), arguments.executions());
        System.out.println(JSON.writeValueAsString(result));
    }
}
