# syntax=docker/dockerfile:1
# Built with apps/ as the context. The source is shared with the other spring-boot-doma applications.
FROM maven:3.10-eclipse-temurin-25-noble AS build
WORKDIR /src
COPY spring-boot-doma-ojdbc/pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline
COPY spring-boot-doma-ojdbc/src src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q package

FROM eclipse-temurin:25-jre
COPY --from=build /src/target/rdb-rtt-benchmark.jar /app/rdb-rtt-benchmark.jar
ENV SPRING_DATASOURCE_TYPE=com.zaxxer.hikari.HikariDataSource
ENTRYPOINT ["java", "-jar", "/app/rdb-rtt-benchmark.jar"]
