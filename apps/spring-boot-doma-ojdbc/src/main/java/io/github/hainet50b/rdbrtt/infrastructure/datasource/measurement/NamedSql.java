package io.github.hainet50b.rdbrtt.infrastructure.datasource.measurement;

import java.util.ArrayList;
import java.util.List;

/** SQL with named parameters such as {@code :rows}. Parameters in string literals and comments stay as text. */
record NamedSql(List<Segment> segments) {

    sealed interface Segment permits Text, Parameter {
    }

    record Text(String sql) implements Segment {
    }

    record Parameter(String name) implements Segment {
    }

    static NamedSql parse(String sql) {
        String s = sql.strip();
        if (s.endsWith(";")) {
            s = s.substring(0, s.length() - 1);
        }
        List<Segment> segments = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == '\'') {
                int end = s.indexOf('\'', i + 1);
                end = end < 0 ? s.length() : end + 1;
                text.append(s, i, end);
                i = end;
            } else if (s.startsWith("--", i)) {
                int end = s.indexOf('\n', i);
                end = end < 0 ? s.length() : end;
                text.append(s, i, end);
                i = end;
            } else if (c == ':' && i + 1 < s.length() && Character.isJavaIdentifierStart(s.charAt(i + 1))
                    && (i == 0 || s.charAt(i - 1) != ':')) {
                int end = i + 1;
                while (end < s.length() && Character.isJavaIdentifierPart(s.charAt(end))) {
                    end++;
                }
                segments.add(new Text(text.toString()));
                text.setLength(0);
                segments.add(new Parameter(s.substring(i + 1, end)));
                i = end;
            } else {
                text.append(c);
                i++;
            }
        }
        segments.add(new Text(text.toString()));
        return new NamedSql(List.copyOf(segments));
    }
}
