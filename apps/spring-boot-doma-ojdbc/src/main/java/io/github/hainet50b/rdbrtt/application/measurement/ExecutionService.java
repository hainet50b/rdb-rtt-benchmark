package io.github.hainet50b.rdbrtt.application.measurement;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;

import io.github.hainet50b.rdbrtt.domain.datasource.measurement.QueryRepository;
import io.github.hainet50b.rdbrtt.domain.datasource.measurement.SessionStatisticsRepository;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Measurement;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;

/**
 * Runs the query in one transaction and measures three spans: acquire, the query, and commit.
 * The statistics are read between the spans, outside the measured time.
 */
@Service
public class ExecutionService {

    private final PlatformTransactionManager transactionManager;

    private final QueryRepository queryRepository;

    private final SessionStatisticsRepository statisticsRepository;

    public ExecutionService(
            PlatformTransactionManager transactionManager,
            QueryRepository queryRepository,
            SessionStatisticsRepository statisticsRepository) {
        this.transactionManager = transactionManager;
        this.queryRepository = queryRepository;
        this.statisticsRepository = statisticsRepository;
    }

    public Measurement execute(Query query) {
        long beforeAcquire = statisticsRepository.readRoundtrips();
        long acquireStart = System.nanoTime();
        TransactionStatus transaction = transactionManager.getTransaction(TransactionDefinition.withDefaults());
        long acquireEnd = System.nanoTime();
        try {
            long beforeQuery = statisticsRepository.readRoundtrips();
            long queryStart = System.nanoTime();
            int rows = queryRepository.fetch(query);
            long queryEnd = System.nanoTime();
            long beforeCommit = statisticsRepository.readRoundtrips();
            long commitStart = System.nanoTime();
            transactionManager.commit(transaction);
            long commitEnd = System.nanoTime();
            long afterCommit = statisticsRepository.readRoundtrips();
            return Measurement.succeeded(
                    new Measurement.Span(milliseconds(acquireStart, acquireEnd), beforeQuery - beforeAcquire),
                    new Measurement.Span(milliseconds(queryStart, queryEnd), beforeCommit - beforeQuery),
                    new Measurement.Span(milliseconds(commitStart, commitEnd), afterCommit - beforeCommit),
                    rows);
        } catch (RuntimeException e) {
            if (!transaction.isCompleted()) {
                transactionManager.rollback(transaction);
            }
            throw e;
        }
    }

    private static double milliseconds(long start, long end) {
        return (end - start) / 1e6;
    }
}
