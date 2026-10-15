package io.github.hainet50b.rdbrtt.infrastructure.datasource.measurement;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import io.github.hainet50b.rdbrtt.domain.datasource.measurement.SessionStatisticsRepository;

/** Reads the round trips of the current session from V$MYSTAT. */
@Repository
public class SessionStatisticsRepositoryImpl implements SessionStatisticsRepository {

    private static final String SQL = """
            SELECT s.value
              FROM v$mystat s
              JOIN v$statname n ON n.statistic# = s.statistic#
             WHERE n.name = 'SQL*Net roundtrips to/from client'""";

    private final JdbcTemplate jdbc;

    public SessionStatisticsRepositoryImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public long readRoundtrips() {
        return jdbc.queryForObject(SQL, Long.class);
    }
}
