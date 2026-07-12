# Phase 1 — Auth Service & Identity Foundation

## Objective

The auth service: realistic, non-self-elevating account creation, Argon2id password
hashing, HS256 JWTs (short access + rotating single-use refresh), login, logout,
session validation, and forgot-password. This is the security-critical phase — the
code below is verbatim for the parts where a subtle mistake is a real vulnerability.

The core service also needs to *validate* these JWTs offline; the shared-secret
validator + the RBAC primitives it depends on are specified at the end so Phase 2
onward can enforce roles.

## Depends on

Phase 0 (compose, shared DB, Flyway, gateway routing `/auth/**`).

## The identity model (read before writing DDL)

Two tables, **one shared Postgres** (see README decision log):

- `users` — the auth/authz source of truth: credentials + role. Owned by auth.
- `employees` — the directory profile: name, department, status. Owned by core
  (Phase 2), but the row is **created here at signup** in the same transaction,
  because we share the DB.

Signup creates a `users` row (role = `EMPLOYEE`, always) **and** the matching
`employees` row atomically. Because it's one DB and one transaction, there is no
cross-service call and no consistency problem. Role is a single column
(`users.role`) read by both the JWT issuer (here) and the directory screen
(Phase 2). One source of truth.

> **DB-per-service veto point:** if you insist on a separate auth DB, signup must
> then create the employee profile in core via an internal REST call, and role
> promotion in core must call back to auth to change the role claim source — two
> cross-service writes that need idempotency + retry to stay consistent. At
> hackathon scale this buys nothing and adds failure modes. The shared-DB default
> is strongly recommended. Everything below assumes it.

---

## Schema (Flyway migration in `auth-service`)

`V2__auth_identity.sql`:

```sql
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE'
                     CHECK (role IN ('EMPLOYEE','DEPARTMENT_HEAD','ASSET_MANAGER','ADMIN')),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,   -- store a HASH, never the raw token
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,                    -- non-null = revoked / rotated
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE password_reset_tokens (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `employees` table itself is defined in Phase 2's migration (core owns the DDL),
but signup inserts into it. If you're building strictly phase-by-phase, either land
Phase 2's `employees` migration first, or include a minimal `employees` table in an
auth migration and let Phase 2 `ALTER` it. Cleanest: **run Phase 2's master-data
migration before wiring signup**, since directory + departments are prerequisites
for a meaningful employee row anyway.

---

## Verbatim: Argon2id password encoder

Needs Bouncy Castle on the classpath. Add to `auth-service` (and `core-service` if
it ever verifies passwords, which it shouldn't):

```groovy
implementation 'org.springframework.security:spring-security-crypto'
implementation 'org.bouncycastle:bcprov-jdk18on:1.78.1'
```

```java
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // OWASP Argon2id params: saltLen=16, hashLen=32, parallelism=1,
        // memory=19456 KiB (19 MiB), iterations=2.
        return new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
    }
}
```

Hash on signup with `encoder.encode(rawPassword)`; verify on login with
`encoder.matches(rawPassword, storedHash)`. Never log the raw password.

---

## Verbatim: signup — Employee only, no role selection

The spec is explicit: signup creates an Employee account, no role field is accepted.
Reject any attempt to pass a role. Role assignment happens *only* in the Employee
Directory (Phase 2).

```java
public record SignupRequest(
    @NotBlank String name,
    @Email @NotBlank String email,
    @NotBlank @Size(min = 8, max = 100) String password,
    @NotNull Long departmentId
) {}   // NOTE: deliberately NO role field. Do not add one.

@Service
public class SignupService {

    private final UserRepository users;
    private final EmployeeRepository employees;   // core's table, same DB
    private final PasswordEncoder encoder;

    // One transaction: user + profile created together. Shared DB → no saga.
    @Transactional
    public void signup(SignupRequest req) {
        if (users.existsByEmail(req.email())) {
            throw new EmailAlreadyUsedException(req.email());
        }
        User user = new User();
        user.setEmail(req.email());
        user.setPasswordHash(encoder.encode(req.password()));
        user.setRole(Role.EMPLOYEE);          // hardcoded — never from the request
        user.setActive(true);
        users.save(user);

        Employee emp = new Employee();
        emp.setUserId(user.getId());
        emp.setName(req.name());
        emp.setEmail(req.email());
        emp.setDepartmentId(req.departmentId());
        emp.setStatus(EmployeeStatus.ACTIVE);
        employees.save(emp);
    }
}
```

There is no code path anywhere that lets a signup, profile update, or self-service
call set `role` to anything but `EMPLOYEE`. The only writer of elevated roles is the
Admin promotion endpoint in Phase 2.

---

## Verbatim: JWT issuance + rotating refresh (the parts that bite)

Access token: short-lived (15 min), carries `sub` (user id), `email`, `role`.
Refresh token: opaque random string, **stored hashed**, single-use, rotated on every
refresh, revoked on logout.

Two gotchas from Faraday are baked into the code below:

1. **`@Transactional` rollback undoing security writes** — the refresh-token
   persistence on rotation must survive even if a *later* step fails. Keep the
   rotation write in its own committed unit; don't nest it inside a broader
   transaction that can roll back the new token away.
2. **Sign-out race** — revocation and rotation both mutate the same token row;
   make the "consume this refresh token" step atomic so a concurrent logout can't
   leave a rotated-but-live token.

```java
@Service
public class TokenService {

    private final RefreshTokenRepository refreshTokens;
    private final JwtEncoderComponent jwt;   // wraps HS256 signing with APP_JWT_SECRET
    private final PasswordEncoder hasher;     // reuse Argon2 to hash refresh tokens
    private final SecureRandom random = new SecureRandom();

    private static final Duration ACCESS_TTL  = Duration.ofMinutes(15);
    private static final Duration REFRESH_TTL = Duration.ofDays(7);

    public TokenPair issueFor(User user) {
        String access = jwt.sign(user.getId(), user.getEmail(), user.getRole(), ACCESS_TTL);
        String rawRefresh = newOpaqueToken();
        persistRefresh(user.getId(), rawRefresh);
        return new TokenPair(access, rawRefresh);
    }

    // Atomic consume-and-rotate. The UPDATE ... WHERE revoked_at IS NULL RETURNING
    // pattern means only ONE concurrent caller can consume a given token; a racing
    // logout that already set revoked_at makes this return 0 rows → we reject.
    @Transactional
    public TokenPair rotate(String rawRefresh) {
        String hash = hasher.encode(rawRefresh); // NOTE: see caveat below on salted hashes
        RefreshToken row = refreshTokens.findLiveByHash(hash, Instant.now())
            .orElseThrow(InvalidRefreshTokenException::new);

        int consumed = refreshTokens.revokeIfLive(row.getId(), Instant.now());
        if (consumed == 0) throw new InvalidRefreshTokenException(); // lost the race

        User user = row.getUser();
        return issueFor(user);
    }

    @Transactional
    public void revokeAll(Long userId) {          // logout everywhere
        refreshTokens.revokeAllForUser(userId, Instant.now());
    }

    private void persistRefresh(Long userId, String rawRefresh) {
        RefreshToken t = new RefreshToken();
        t.setUserId(userId);
        t.setTokenHash(hasher.encode(rawRefresh));
        t.setExpiresAt(Instant.now().plus(REFRESH_TTL));
        refreshTokens.save(t);
    }

    private String newOpaqueToken() {
        byte[] b = new byte[32];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
```

> **Caveat on hashing refresh tokens with Argon2:** Argon2 uses a random salt, so
> `encode()` produces a *different* hash each time — you can't look up by
> re-encoding. Two clean options: (a) hash refresh tokens with **SHA-256** (fast,
> deterministic, fine because the token is already 256 bits of entropy — no
> brute-force concern), then `WHERE token_hash = :sha256`; or (b) store a random
> `selector` alongside, look up by selector, then `encoder.matches()` the
> `verifier` half. **Recommend SHA-256 for hackathon simplicity.** Update
> `revokeIfLive`/`findLiveByHash` accordingly:

```java
// Deterministic hash for lookup — refresh tokens are high-entropy already.
private String sha256(String s) {
    return HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
}
```

Repository queries:

```java
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {

    @Query("""
      SELECT r FROM RefreshToken r
      WHERE r.tokenHash = :hash AND r.revokedAt IS NULL AND r.expiresAt > :now
    """)
    Optional<RefreshToken> findLiveByHash(String hash, Instant now);

    @Modifying
    @Query("UPDATE RefreshToken r SET r.revokedAt = :now WHERE r.id = :id AND r.revokedAt IS NULL")
    int revokeIfLive(Long id, Instant now);   // returns rows affected — 0 means lost race

    @Modifying
    @Query("UPDATE RefreshToken r SET r.revokedAt = :now WHERE r.userId = :userId AND r.revokedAt IS NULL")
    void revokeAllForUser(Long userId, Instant now);
}
```

---

## Endpoints (auth-service, under `/auth`)

| Method | Path                 | Body / notes                                  | Auth |
|--------|----------------------|-----------------------------------------------|------|
| POST   | `/auth/signup`       | `SignupRequest` → 201, Employee only          | none |
| POST   | `/auth/login`        | `{email,password}` → `{access, refresh}`      | none |
| POST   | `/auth/refresh`      | `{refresh}` → new `{access, refresh}` (rotates)| none |
| POST   | `/auth/logout`       | revokes caller's refresh tokens               | bearer |
| GET    | `/auth/me`           | validates session, returns `{id,email,role}`  | bearer |
| POST   | `/auth/forgot`       | `{email}` → issues reset token (log/stub email)| none |
| POST   | `/auth/reset`        | `{token,newPassword}` → sets new hash          | none |

Forgot-password email delivery can be stubbed (log the reset link) for the
hackathon — the token lifecycle (`password_reset_tokens`, single-use, expiry) is the
part that matters. Don't reveal whether an email exists (`/auth/forgot` returns 200
regardless).

---

## Core-service side: offline JWT validation + RBAC primitives (needed from Phase 2 on)

Core validates the access token locally with the shared `APP_JWT_SECRET` — no call
to auth per request. Build a `OncePerRequestFilter` that parses the bearer token,
verifies the HS256 signature + expiry, and populates the `SecurityContext` with the
authorities `ROLE_EMPLOYEE` / `ROLE_DEPARTMENT_HEAD` / `ROLE_ASSET_MANAGER` /
`ROLE_ADMIN` from the `role` claim.

Then RBAC is declarative via method security:

```java
@Configuration
@EnableMethodSecurity          // enables @PreAuthorize
public class SecurityConfig {

    @Bean
    SecurityFilterChain chain(HttpSecurity http, JwtAuthFilter jwtAuthFilter) throws Exception {
        http
          .csrf(csrf -> csrf.disable())                 // stateless JWT API
          .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
          .authorizeHttpRequests(a -> a
              .requestMatchers("/api/health").permitAll()
              .anyRequest().authenticated())
          .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

Usage on controllers/services in later phases, e.g.:

```java
@PreAuthorize("hasRole('ADMIN')")                       // org setup
@PreAuthorize("hasAnyRole('ASSET_MANAGER','ADMIN')")    // register/allocate assets
@PreAuthorize("hasAnyRole('DEPARTMENT_HEAD','ASSET_MANAGER','ADMIN')")  // approve transfers
```

The **RBAC matrix** each later phase must enforce is repeated in each brief. Source
of truth for role → capability is the User Roles section of the problem statement.

---

## Definition of done

- Signup creates a `users` row with role `EMPLOYEE` **and** an `employees` profile
  row, in one transaction. No request field can set any other role.
- Login returns a signed access token + a refresh token; the stored refresh token
  is a hash, never the raw value.
- `/auth/refresh` rotates: the old refresh token is single-use and immediately
  revoked; a replay of the old token is rejected.
- Concurrent `refresh` + `logout` cannot leave a live token (the `revokeIfLive`
  rows-affected check proves atomicity).
- Core validates a token issued by auth **offline** (shared secret) and populates
  `ROLE_*` authorities; a `@PreAuthorize("hasRole('ADMIN')")` endpoint rejects an
  employee token with 403.
- Forgot/reset uses single-use, expiring tokens and doesn't leak account existence.
