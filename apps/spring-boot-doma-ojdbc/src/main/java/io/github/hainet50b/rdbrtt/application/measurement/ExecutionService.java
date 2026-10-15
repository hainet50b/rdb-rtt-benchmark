package io.github.hainet50b.rdbrtt.application.measurement;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import io.github.hainet50b.rdbrtt.domain.datasource.measurement.QueryRepository;
import io.github.hainet50b.rdbrtt.domain.datasource.measurement.SessionStatisticsRepository;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Measurement;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;

/**
 * Each method is one transaction, so the query and the statistics use the same connection.
 * Reading the statistics is outside T.
 */
@Service
public class ExecutionService {

    private final QueryRepository queryRepository;

    private final SessionStatisticsRepository statisticsRepository;

    public ExecutionService(QueryRepository queryRepository, SessionStatisticsRepository statisticsRepository) {
        this.queryRepository = queryRepository;
        this.statisticsRepository = statisticsRepository;
    }

    @Transactional
    public Measurement execute(Query query, long overheadRoundtrips) {
        long before = statisticsRepository.readRoundtrips();
        long start = System.nanoTime();
        int rows = queryRepository.fetch(query);
        long end = System.nanoTime();
        long after = statisticsRepository.readRoundtrips();
        return Measurement.succeeded((end - start) / 1e6, after - before - overheadRoundtrips, rows);
    }

    /** Reading the statistics is itself a round trip. Two reads with nothing in between show what to subtract. */
    @Transactional
    public long readOverheadRoundtrips() {
        long before = statisticsRepository.readRoundtrips();
        return statisticsRepository.readRoundtrips() - before;
    }
}
