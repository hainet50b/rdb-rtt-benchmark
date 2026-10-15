package io.github.hainet50b.rdbrtt.infrastructure.datasource.measurement;

import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Repository;

import io.github.hainet50b.rdbrtt.domain.datasource.measurement.QueryRepository;
import io.github.hainet50b.rdbrtt.domain.model.measurement.Query;

@Repository
public class QueryRepositoryImpl implements QueryRepository {

    private final QueryDao dao;

    private final Map<String, NamedSql> parsed = new HashMap<>();

    public QueryRepositoryImpl(QueryDao dao) {
        this.dao = dao;
    }

    @Override
    public int fetch(Query query) {
        NamedSql sql = parsed.computeIfAbsent(query.sql(), NamedSql::parse);
        return dao.select(sql, query.parameters(), query.fetchSize()).size();
    }
}
