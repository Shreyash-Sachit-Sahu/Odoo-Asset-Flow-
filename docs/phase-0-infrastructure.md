# Phase 0 — Infrastructure & Scaffolding

## Objective

Stand up the runnable skeleton: Docker Compose (Postgres + Redis + the two Spring
services + gateway), the `btree_gist` extension enabled, Flyway wired correctly,
JVM pinned to UTC, working healthchecks, and a gateway that gives the browser one
origin with CORS configured once. Nothing domain-specific yet — the goal is `docker
compose up` brings everything green and the frontend can reach `/api/health`
through the gateway.

## Depends on

Nothing. This is first.

## Deliverables

- `docker-compose.yml` (verbatim below)
- `db/init/01-extensions.sql` (verbatim below — enables `btree_gist`)
- Two Spring Boot 3.5 projects: `auth-service`, `core-service` (skeletons)
- One Spring Cloud Gateway project: `gateway`
- Flyway baseline migration `V1__baseline.sql` in each service that owns tables
- Shared `application.yml` conventions (verbatim snippets below)

---

## Verbatim: `docker-compose.yml`

Reuses the Relay-validated Postgres healthcheck variable and adds Redis + gateway.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: assetflow
      POSTGRES_PASSWORD: assetflow
      POSTGRES_DB: assetflow
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      # NOTE: use the same user/db as above. Bare `pg_isready` without -U/-d
      # checks the wrong role and flaps green→unhealthy. (Relay lesson.)
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  auth-service:
    build: ./auth-service
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/assetflow
      SPRING_DATASOURCE_USERNAME: assetflow
      SPRING_DATASOURCE_PASSWORD: assetflow
      APP_JWT_SECRET: ${APP_JWT_SECRET:-change-me-in-a-real-env-please-32-bytes-min}
      # Force UTC so timestamptz math and range comparisons are unambiguous.
      JAVA_TOOL_OPTIONS: "-Duser.timezone=UTC"
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "8081:8080"

  core-service:
    build: ./core-service
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/assetflow
      SPRING_DATASOURCE_USERNAME: assetflow
      SPRING_DATASOURCE_PASSWORD: assetflow
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PORT: 6379
      APP_JWT_SECRET: ${APP_JWT_SECRET:-change-me-in-a-real-env-please-32-bytes-min}
      JAVA_TOOL_OPTIONS: "-Duser.timezone=UTC"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "8082:8080"

  gateway:
    build: ./gateway
    environment:
      APP_FRONTEND_ORIGIN: ${APP_FRONTEND_ORIGIN:-http://localhost:3000}
      JAVA_TOOL_OPTIONS: "-Duser.timezone=UTC"
    depends_on:
      - auth-service
      - core-service
    ports:
      - "8080:8080"

volumes:
  pgdata:
```

> The `$${POSTGRES_USER}` double-dollar is Compose escaping so the value is
> resolved by the shell inside the container, not by Compose. Do not simplify to a
> single `$`.

---

## Verbatim: `db/init/01-extensions.sql`

Runs once on first DB init (mounted into `/docker-entrypoint-initdb.d`). Without
`btree_gist`, the Phase 4 booking exclusion constraint **will not compile**.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

If Postgres was already initialised before this file existed, the extension won't
have run. Recreate the volume (`docker compose down -v`) or run the statement
manually once. Flyway migrations should also defensively `CREATE EXTENSION IF NOT
EXISTS btree_gist;` at the top of the migration that first needs it (Phase 4) so a
fresh clone that skips the init script still works.

---

## Verbatim: Flyway dependency & config (both Spring services)

The single most common Flyway-10-on-Postgres failure. Add **both** dependencies —
the core plus the Postgres-specific module — or Flyway 10 throws
`Unsupported Database: PostgreSQL` at startup. (Relay lesson.)

`build.gradle` (Kotlin or Groovy equivalently):

```groovy
dependencies {
    implementation 'org.flywaydb:flyway-core'
    implementation 'org.flywaydb:flyway-database-postgresql'   // <-- do not omit
    runtimeOnly 'org.postgresql:postgresql'
}
```

`application.yml` (shared conventions):

```yaml
spring:
  flyway:
    enabled: true
    baseline-on-migrate: true
    locations: classpath:db/migration
  jpa:
    hibernate:
      ddl-auto: validate      # Flyway owns the schema; Hibernate only validates
    properties:
      hibernate:
        jdbc:
          time_zone: UTC       # belt-and-suspenders with the JVM -Duser.timezone
    open-in-view: false        # avoids lazy-load-in-view surprises
  jackson:
    time-zone: UTC
```

- `ddl-auto: validate`, never `update` — Flyway is the source of truth for schema.
- `open-in-view: false` — forces you to load what you need in the service layer;
  prevents N+1s from sneaking in via the view layer (latency matters here).

---

## Verbatim: Gateway routing + single-origin CORS (`gateway`)

Spring Cloud Gateway. The browser sees only `:8080`. CORS is set **once**, here.

`application.yml`:

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      routes:
        - id: auth
          uri: http://auth-service:8080
          predicates:
            - Path=/auth/**
        - id: core
          uri: http://core-service:8080
          predicates:
            - Path=/api/**
        # Uncomment when the reports service exists (Phase 6, optional):
        # - id: reports
        #   uri: http://reports-service:8000
        #   predicates:
        #     - Path=/reports/**
      globalcors:
        cors-configurations:
          '[/**]':
            allowedOrigins:
              - ${APP_FRONTEND_ORIGIN}
            allowedMethods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
            allowedHeaders: ["*"]
            allowCredentials: true
```

> Because the browser only ever talks to the gateway origin, the downstream
> services **do not** configure CORS at all. If you find yourself adding
> `@CrossOrigin` in a service controller, stop — that means the browser is hitting
> the service directly and bypassing the gateway. Route it through the gateway
> instead.

---

## Skeleton structure (Claude Code generates)

```
assetflow/
├── docker-compose.yml
├── db/init/01-extensions.sql
├── gateway/            (Spring Cloud Gateway, Boot 3.5)
├── auth-service/       (Spring Boot 3.5, Web + Security + JPA + Flyway + Validation)
│   └── src/main/resources/db/migration/V1__baseline.sql
├── core-service/       (Spring Boot 3.5, Web + Security + JPA + Flyway + Validation
│                        + Redis + Bucket4j)
│   └── src/main/resources/db/migration/V1__baseline.sql
└── frontend/           (Next.js, scaffolded in Phase 7)
```

Each service exposes `GET /health` (or Actuator `/actuator/health`) returning 200
once DB connectivity is up. Verify `GET http://localhost:8080/api/health` returns
the core health through the gateway.

`V1__baseline.sql` can be an empty/no-op migration per service just to establish the
Flyway baseline; real tables arrive in later phases.

---

## Definition of done

- `docker compose up` → postgres, redis, both services, gateway all reach healthy.
- `SELECT * FROM pg_extension WHERE extname = 'btree_gist';` returns a row.
- `GET http://localhost:8080/api/health` returns 200 through the gateway.
- Flyway runs cleanly on both services (no `Unsupported Database` error).
- Container logs show JVM timezone is UTC (`-Duser.timezone=UTC` took effect).
- Hitting a service port directly from a browser (`:8082`) is **not** wired for
  CORS — only the gateway origin is. (Sanity: the frontend uses `:8080` only.)
