# Test Plan: Bank Login Test Bench

| | |
|---|---|
| **Version** | 2.1 |
| **Author** | Kevin Tran |
| **System under test** | (1) Demo bank login flow, (2) the Test Bench dashboard and its REST API, (3) the PostgreSQL run history |

## 1. Objective

Make sure that a customer can log in and out of the demo bank, that bad credentials are rejected, and that the tooling which runs and records those checks (dashboard, API, database) is correct, fast, secure and accessible. A release is blocked if any high-risk test fails.

## 2. Scope

**In scope**

- Login and logout with valid credentials
- Rejection of invalid credentials and the error shown to the user
- Password masking
- Dashboard REST API: response contracts, status codes, input validation, streaming
- Run history: every test run is saved correctly and the API reports exactly what the database holds
- API performance (response time under load)
- Dashboard accessibility (WCAG 2.1 A/AA, keyboard navigation)
- Cross-browser behavior (Chromium, Firefox, WebKit)

**Out of scope**

- Multi-factor authentication flows (selector exists; scenario not yet automated)
- Account features after login (balances, transfers)
- Load testing beyond 20 concurrent requests
- Real banking sites. This project must only target a demo bank.

## 3. Approach

| Level | What | Tool | Where it runs |
|---|---|---|---|
| UI / end-to-end | Login scenarios through a real browser, Page Object Model | Playwright Test, Selenium WebDriver | CI (3 browsers), dashboard |
| API | Status codes, JSON Schema contracts, negative and security inputs, NDJSON stream | Playwright `request`, Ajv | CI, every push |
| Data integrity | API responses compared to direct SQL queries against PostgreSQL | `pg`, SQL | CI with a Postgres service container |
| Performance | p50 / p95 latency, sequential and concurrent | Playwright `request` | CI, every push |
| Accessibility | axe-core WCAG 2.1 A/AA scan, keyboard-only navigation | `@axe-core/playwright` | CI, every push |
| Recorded | New flows captured with Playwright Codegen, then reviewed and cleaned (secrets → env vars) | `npm run record` | Locally, then promoted to the suite |
| Unit | Helper logic: Codegen clean-up, code → plain-English steps | Playwright Test | CI, every push |
| Dashboard UI | Recorder page end to end, with a scripted stand-in for Codegen | Playwright Test, axe-core | CI, every push |
| Manual / exploratory | New UI changes, visual review of the dashboard | Browser, `HEADLESS=false` | Before a release |

The same login scenarios exist in both Selenium and Playwright so the two frameworks can be compared side by side.

## 4. Risk-based priorities

| Risk | Impact | Likelihood | Priority | Covered by |
|---|---|---|---|---|
| Valid user cannot log in | High | Medium | **P1** | `login.spec.ts`, `login.test.js`, `login-playwright.test.js` |
| Invalid credentials are accepted | High | Low | **P1** | `login.spec.ts`, `invalid-login*.test.js` |
| Password shown in plain text | High | Low | **P1** | `login.spec.ts` (password masking) |
| Injection through API input (path, script, SQL) | High | Medium | **P1** | `dashboard-api.spec.ts`, `run-history.spec.ts` |
| Run history disagrees with what actually ran | Medium | Medium | **P2** | `run-history.spec.ts` |
| API response shape changes and breaks the dashboard | Medium | Medium | **P2** | JSON Schema contract tests |
| API slows down | Medium | Low | **P2** | `performance.spec.ts` |
| Dashboard unusable with a keyboard or screen reader | Medium | Medium | **P2** | `dashboard-a11y.spec.ts` |
| A browser engine behaves differently | Medium | Low | **P3** | Cross-browser Playwright projects |

## 5. Traceability matrix

The requirement catalog lives in [`compliance/requirements.json`](compliance/requirements.json) (ID, requirement, category, control, risk). Each test is tagged with the requirement it proves (`{ tag: '@R1' }`), and every run generates the traceability matrix and evidence automatically in `compliance-report/index.html`. See the README's *Compliance Evidence Report* section.

| Req ID | Requirement | Control | Test(s) |
|---|---|---|---|
| R1 | Valid credentials sign in and sign out | OWASP A07 | `specs/login.spec.ts` |
| R2 | Invalid credentials are rejected, no session | OWASP A07 | `specs/login.spec.ts` |
| R3 | Password field masks input | OWASP A07 | `specs/login.spec.ts` |
| R4 | `GET /api/tests` matches its JSON contract | Interface spec | `api/dashboard-api.spec.ts` |
| R5 | Unknown or malicious test names return 404 | OWASP A01, A03 | `api/dashboard-api.spec.ts` |
| R6 | A run streams steps, then exactly one result | Interface spec | `api/dashboard-api.spec.ts` |
| R7 | Every execution is recorded | Audit trail | `api/run-history.spec.ts` |
| R8 | API run history reconciles to the database | Data integrity | `api/run-history.spec.ts` |
| R9 | Flaky tests are flagged | Data quality | `api/run-history.spec.ts` |
| R10 | Bad parameters return 400; SQL injection has no effect | OWASP A03 | `api/run-history.spec.ts` |
| R11 | p95 latency within budget | Service level | `api/performance.spec.ts`, `api/dashboard-api.spec.ts` |
| R12 | WCAG 2.1 AA and keyboard access | WCAG 2.1 AA | `a11y/dashboard-a11y.spec.ts`, `dashboard/recorder.spec.ts` |
| R13 | No hard-coded URLs or credentials in recordings | CWE-798 | `unit/recording.spec.ts` |
| R14 | Recorder works end to end | Functional | `dashboard/recorder.spec.ts`, `unit/steps.spec.ts` |
| R15 | Recorder input validation, no path traversal | OWASP A01, A03 | `dashboard/recorder.spec.ts` |
| R16 | Multi-factor challenge shown when required | OWASP A07 | **No automated test (known gap; see Scope)** |

## 6. Test data

- **Login:** credentials come from environment variables / CI secrets, never from source code. Negative tests use obviously fake values.
- **Database:** `run-history.spec.ts` seeds its own rows with a unique test name, asserts against them, and deletes them afterwards, so tests never depend on leftover data and can run in parallel.

## 7. Environments

| Environment | How |
|---|---|
| Local | `npm start`, optional `docker compose up -d db` for run history |
| Docker | `docker compose up --build` (app + PostgreSQL) |
| CI | GitHub Actions: Postgres service container, Chromium/Firefox/WebKit |

## 8. Entry and exit criteria

**Entry:** code builds, `npm ci` succeeds, environment variables set for the suites being run.

**Exit (release-ready):**
- The compliance report shows no **Failed** requirements, and every P1 requirement is **Passed** (not just "Not run")
- 100% of P1 tests pass on all three browsers
- No open WCAG 2.1 A/AA violations
- API p95 within budget
- Any failure has a trace, screenshot and video attached in the CI report and a root cause logged

## 9. Defect handling

Failures in CI keep a Playwright trace, screenshot and video. Each defect is logged with steps to reproduce, expected vs. actual, severity, and the trace link. A retest plus the full regression suite runs before the fix is merged.

## 10. Reporting

- Compliance evidence report (traceability matrix, step-by-step evidence, screenshots, gaps, SHA-256 hashes), merged across CI jobs and kept 90 days

- HTML report and JUnit XML uploaded as CI artifacts on every run
- Latency numbers and axe-core results attached to the HTML report
- Pass rate, average duration and flaky flags per test at `GET /api/stats`
