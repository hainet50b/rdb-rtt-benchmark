package io.github.hainet50b.rdbrtt;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class RdbRttBenchmarkApplication {

    public static void main(String[] args) {
        System.exit(SpringApplication.exit(SpringApplication.run(RdbRttBenchmarkApplication.class, args)));
    }
}
