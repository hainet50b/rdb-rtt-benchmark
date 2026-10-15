package io.github.hainet50b.rdbrtt.domain.model.measurement;

import java.util.Map;

public record Query(
        String sql,
        Map<String, Object> parameters,
        int fetchSize) {
}
