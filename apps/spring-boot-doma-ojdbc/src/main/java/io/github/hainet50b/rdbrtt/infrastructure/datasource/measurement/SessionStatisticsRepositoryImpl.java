package io.github.hainet50b.rdbrtt.infrastructure.datasource.measurement;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.stereotype.Repository;

import io.github.hainet50b.rdbrtt.domain.datasource.measurement.SessionStatisticsRepository;

/**
 * Reads the round trips of the measured session from V$SESSTAT through a monitoring connection outside the pool,
 * so reading them adds no round trips to the measured session. The pool has one connection, so the measured session
 * is the session of that connection.
 */
@Repository
public class SessionStatisticsRepositoryImpl implements SessionStatisticsRepository {

    private static final String SESSION_ID = "SELECT sys_context('USERENV', 'SID') FROM dual";

    private static final String ROUNDTRIPS = """
            SELECT s.value
              FROM v$sesstat s
              JOIN v$statname n ON n.statistic# = s.statistic#
             WHERE s.sid = ?
               AND n.name = 'SQL*Net roundtrips to/from client'""";

    private final JdbcTemplate pooled;

    private final JdbcTemplate monitoring;

    private Long sessionId;

    public SessionStatisticsRepositoryImpl(
            JdbcTemplate pooled,
            @Value("${spring.datasource.url}") String url,
            @Value("${spring.datasource.username}") String username,
            @Value("${spring.datasource.password}") String password) {
        this.pooled = pooled;
        this.monitoring = new JdbcTemplate(new SingleConnectionDataSource(url, username, password, true));
    }

    @Override
    public long readRoundtrips() {
        if (sessionId == null) {
            sessionId = pooled.queryForObject(SESSION_ID, Long.class);
        }
        return monitoring.queryForObject(ROUNDTRIPS, Long.class, sessionId);
    }
}
