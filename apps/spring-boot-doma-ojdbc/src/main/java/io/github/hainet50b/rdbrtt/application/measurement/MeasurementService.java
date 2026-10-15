package io.github.hainet50b.rdbrtt.application.measurement;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import io.github.hainet50b.rdbrtt.domain.datasource.configuration.TestConfigurationRepository;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Measurement;
import io.github.hainet50b.rdbrtt.domain.model.measurement.MeasurementResult;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;

@Service
public class MeasurementService {

    private final TestConfigurationRepository configurationRepository;

    private final ExecutionService executionService;

    public MeasurementService(TestConfigurationRepository configurationRepository, ExecutionService executionService) {
        this.configurationRepository = configurationRepository;
        this.executionService = executionService;
    }

    public MeasurementResult measure(Query query, int executions) {
        List<Measurement> measurements = new ArrayList<>(executions);
        for (int i = 0; i < executions; i++) {
            try {
                measurements.add(executionService.execute(query));
            } catch (RuntimeException e) {
                measurements.add(Measurement.failed(e));
            }
        }
        return new MeasurementResult(configurationRepository.find(), measurements);
    }
}
