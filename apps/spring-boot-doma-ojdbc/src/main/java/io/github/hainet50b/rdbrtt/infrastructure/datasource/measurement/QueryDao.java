package io.github.hainet50b.rdbrtt.infrastructure.datasource.measurement;

import java.util.List;
import java.util.Map;

import org.seasar.doma.Dao;
import org.seasar.doma.MapKeyNamingType;
import org.seasar.doma.boot.ConfigAutowireable;
import org.seasar.doma.jdbc.Config;
import org.seasar.doma.jdbc.builder.SelectBuilder;

/** The query comes from the driver at run time, so the DAO builds it with {@link SelectBuilder}. */
@Dao
@ConfigAutowireable
interface QueryDao {

    @SuppressWarnings("unchecked")
    default List<Map<String, Object>> select(NamedSql sql, Map<String, Object> parameters, int fetchSize) {
        SelectBuilder builder = SelectBuilder.newInstance(Config.get(this));
        for (NamedSql.Segment segment : sql.segments()) {
            switch (segment) {
                case NamedSql.Text text -> builder.sql(text.sql());
                case NamedSql.Parameter parameter -> {
                    Object value = parameters.get(parameter.name());
                    if (value == null) {
                        throw new IllegalArgumentException("No value for :" + parameter.name());
                    }
                    builder.param((Class<Object>) value.getClass(), value);
                }
            }
        }
        builder.fetchSize(fetchSize);
        return builder.getMapResultList(MapKeyNamingType.NONE);
    }
}
