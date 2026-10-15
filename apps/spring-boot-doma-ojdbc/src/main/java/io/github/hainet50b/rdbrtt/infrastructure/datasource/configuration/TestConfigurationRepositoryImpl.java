package io.github.hainet50b.rdbrtt.infrastructure.datasource.configuration;

import java.io.IOException;
import java.io.InputStream;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import javax.sql.DataSource;

import org.seasar.doma.jdbc.Config;
import org.springframework.boot.SpringBootVersion;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.zaxxer.hikari.HikariDataSource;

import io.github.hainet50b.rdbrtt.domain.datasource.configuration.TestConfigurationRepository;
import io.github.hainet50b.rdbrtt.domain.model.configuration.TestConfiguration;
import io.github.hainet50b.rdbrtt.domain.model.configuration.TestConfiguration.Component;
import oracle.ucp.jdbc.PoolDataSource;

@Repository
public class TestConfigurationRepositoryImpl implements TestConfigurationRepository {

    private static final String RELEASE = " Release ";

    /** A result cache would hide round trips, so its settings are part of the test configuration. */
    private static final String RESULT_CACHE_PARAMETERS =
            "SELECT name, value FROM v$parameter WHERE name IN ('result_cache_mode', 'client_result_cache_size')";

    private final DataSource dataSource;

    private final JdbcTemplate jdbc;

    public TestConfigurationRepositoryImpl(DataSource dataSource, JdbcTemplate jdbc) {
        this.dataSource = dataSource;
        this.jdbc = jdbc;
    }

    @Override
    public TestConfiguration find() {
        List<Component> driverAndDatabase = jdbc.execute((ConnectionCallback<List<Component>>) connection -> {
            DatabaseMetaData metaData = connection.getMetaData();
            return List.of(new Component(metaData.getDriverName(), metaData.getDriverVersion()), database(metaData));
        });
        Map<String, String> parameters = new LinkedHashMap<>();
        jdbc.query(RESULT_CACHE_PARAMETERS, rs -> {
            parameters.put(rs.getString(1), rs.getString(2));
        });
        return new TestConfiguration(
                new Component("Java", Runtime.version().toString()),
                new Component("Spring Boot", SpringBootVersion.getVersion()),
                new Component("Doma", Config.class.getPackage().getImplementationVersion()),
                pool(),
                driverAndDatabase.get(0),
                driverAndDatabase.get(1),
                parameters);
    }

    /** Splits a banner such as "Oracle AI Database 26ai Free Release 23.26.0.0.0 - ..." into name and version. */
    private static Component database(DatabaseMetaData metaData) throws SQLException {
        String banner = metaData.getDatabaseProductVersion().lines().findFirst().orElse("");
        int release = banner.indexOf(RELEASE);
        if (release < 0) {
            return new Component(metaData.getDatabaseProductName(), banner);
        }
        return new Component(banner.substring(0, release), banner.substring(release + RELEASE.length()).split(" ")[0]);
    }

    /** The DB connection pool that Spring Boot configured from spring.datasource.type. */
    private Component pool() {
        if (dataSource instanceof HikariDataSource) {
            return new Component("HikariCP", mavenVersion("com.zaxxer", "HikariCP"));
        }
        if (dataSource instanceof PoolDataSource) {
            return new Component("Oracle UCP", PoolDataSource.class.getPackage().getImplementationVersion());
        }
        return new Component(dataSource.getClass().getName(), null);
    }

    /** HikariCP does not write its version to the manifest, so it is read from the Maven metadata in the JAR. */
    private static String mavenVersion(String groupId, String artifactId) {
        String resource = "META-INF/maven/" + groupId + "/" + artifactId + "/pom.properties";
        try (InputStream in = TestConfigurationRepositoryImpl.class.getClassLoader().getResourceAsStream(resource)) {
            Properties properties = new Properties();
            properties.load(in);
            return properties.getProperty("version");
        } catch (IOException | NullPointerException e) {
            return null;
        }
    }
}
