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
| Valid user cannot log in | High | Medium | **P1** | `login.spec.js`, `login.test.js`, `login-playwright.test.js` |
| Invalid credentials are accepted | High | Low | **P1** | `login.spec.js`, `invalid-login*.test.js` |
| Password shown in plain text | High | Low | **P1** | `login.spec.js` (password masking) |
| Injection through API input (path, script, SQL) | High | Medium | **P1** | `dashboard-api.spec.js`, `run-history.spec.js` |
| Run history disagrees with what actually ran | Medium | Medium | **P2** | `run-history.spec.js` |
| API response shape changes and breaks the dashboard | Medium | Medium | **P2** | JSON Schema contract tests |
| API slows down | Medium | Low | **P2** | `performance.spec.js` |
| Dashboard unusable with a keyboard or screen reader | Medium | Medium | **P2** | `dashboard-a11y.spec.js` |
| A browser engine behaves differently | Medium | Low | **P3** | Cross-browser Playwright projects |

## 5. Traceability matrix

| Req ID | Requirement | Test(s) |
|---|---|---|
| R1 | A user with valid credentials reaches the welcome screen and can log out | `specs/login.spec.js` › valid credentials…; `tests/login*.test.js` |
| R2 | Invalid credentials show an error and never reach the welcome screen | `specs/login.spec.js` › invalid credentials…; `tests/invalid-login*.test.js` |
| R3 | The password field masks input | `specs/login.spec.js` › password field masks its input |
| R4 | `GET /api/tests` returns every test once, matching its JSON contract | `api/dashboard-api.spec.js` |
| R5 | Unknown or malicious test names return 404 and run nothing | `api/dashboard-api.spec.js` |
| R6 | A test run streams logs, then exactly one result | `api/dashboard-api.spec.js` › streams NDJSON… |
| R7 | Every run is saved to `test_runs` with the same values the user saw | `api/run-history.spec.js` › running a test writes… |
| R8 | `/api/runs` and `/api/stats` match the database exactly | `api/run-history.spec.js` |
| R9 | Flaky tests (mixed pass/fail) are flagged | `api/run-history.spec.js` › stats… flag flaky tests |
| R10 | Invalid query parameters return 400; SQL injection is harmless | `api/run-history.spec.js` |
| R11 | `GET /api/tests` p95 latency stays under budget (default 300 ms) | `api/performance.spec.js` |
| R12 | Dashboard has no WCAG 2.1 A/AA violations and is keyboard-operable | `a11y/dashboard-a11y.spec.js` |
| R13 | Recorded tests never contain hard-coded URLs or credentials | `unit/recording.spec.js` |
| R14 | The Recorder shows each step live, cleans the code, and saves/runs/deletes recordings | `dashboard/recorder.spec.js` |
| R15 | Recorder input is validated (name, URL, browser, device), only one recording runs at a time, and saved files can't be reached by path traversal | `dashboard/recorder.spec.js` › Recorder API |

## 6. Test data

- **Login:** credentials come from environment variables / CI secrets, never from source code. Negative tests use obviously fake values.
- **Database:** `run-history.spec.js` seeds its own rows with a unique test name, asserts against them, and deletes them afterwards, so tests never depend on leftover data and can run in parallel.

## 7. Environments

| Environment | How |
|---|---|
| Local | `npm start`, optional `docker compose up -d db` for run history |
| Docker | `docker compose up --build` (app + PostgreSQL) |
| CI | GitHub Actions: Postgres service container, Chromium/Firefox/WebKit |

## 8. Entry and exit criteria

**Entry:** code builds, `npm ci` succeeds, environment variables set for the suites being run.

**Exit (release-ready):**
- 100% of P1 tests pass on all three browsers
- No open WCAG 2.1 A/AA violations
- API p95 within budget
- Any failure has a trace, screenshot and video attached in the CI report and a root cause logged

## 9. Defect handling

Failures in CI keep a Playwright trace, screenshot and video. Each defect is logged with steps to reproduce, expected vs. actual, severity, and the trace link. A retest plus the full regression suite runs before the fix is merged.

## 10. Reporting

- HTML report and JUnit XML uploaded as CI artifacts on every run
- Latency numbers and axe-core results attached to the HTML report
- Pass rate, average duration and flaky flags per test at `GET /api/stats`
