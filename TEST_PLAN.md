# Test Plan: Bank Login Test Bench

| | |
|---|---|
| **Version** | 2.1 |
| **Author** | Kevin Tran |
| **System under test** | (1) Ledgerline, the built-in demo bank: sign-in, accounts, transfers, history; (2) an external demo bank login (optional); (3) the Test Bench dashboard and its REST API; (4) the PostgreSQL run history |

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
- Payments to other customers or external banks (Ledgerline only supports transfers between a customer's own accounts)
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
| Public results page | The GitHub Pages site: every playground attack is blocked by the real bank engine, CI results render (passing, failing, missing via mocked responses), WCAG 2.1 AA in light and dark, no horizontal scroll on phones | Playwright Test, `page.route`, axe-core | CI, every push |
| BDD | Business-readable scenarios for login and the Recorder (Scenario Outlines for data variations) | Gherkin, playwright-bdd | CI, every push |
| API collections | Chained requests, data-driven security payloads from CSV | Postman, Newman | CI (dashboard and Docker container), after every AWS deploy |
| Infrastructure | Security and cost rules in the generated CloudFormation | AWS CDK assertions, node:test | CI, every push; before every deploy |
| Smoke (post-deploy) | Postman collections against the live AWS URL | Newman | After every deploy |
| Manual / exploratory | New UI changes, visual review of the dashboard | Browser, `HEADLESS=false` | Before a release |

The same login scenarios exist in both Selenium and Playwright so the two frameworks can be compared side by side.

## 4. Risk-based priorities

| Risk | Impact | Likelihood | Priority | Covered by |
|---|---|---|---|---|
| Money moves to the wrong customer or out of someone else's account | High | Low | **P1** | `bank/bank-api.spec.ts` (IDOR), `unit/demo-bank.spec.ts` |
| Overdraft or double spending under concurrent requests or double clicks | High | Medium | **P1** | `bank/bank-api.spec.ts` (concurrency, idempotency), `bank/bank-ui.spec.ts` |
| Balances drift from the ledger (money created or lost) | High | Low | **P1** | `unit/demo-bank.spec.ts` (500 random transfers), `bank/bank-api.spec.ts` |
| Amount or limit validation wrong at the boundaries | High | Medium | **P1** | Boundary tests in unit, API, UI and `transfer.feature` |
| Brute-force sign-in or username discovery | High | Medium | **P1** | Lockout and enumeration tests |
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
| R17 | Transfer amounts validated at their boundaries | Boundary value analysis | `unit/demo-bank.spec.ts`, `bank/bank-api.spec.ts`, `bank/bank-ui.spec.ts`, `transfer.feature` |
| R18 | Balance and $2,500.00 daily limit enforced | Business rules | same as R17 |
| R19 | Customers only see and move their own money | OWASP A01 (IDOR) | `bank/bank-api.spec.ts`, `bank/bank-ui.spec.ts` |
| R20 | Lockout after 3 failures; no username enumeration | OWASP A07 | `unit/demo-bank.spec.ts`, `bank/bank-api.spec.ts`, `bank/bank-ui.spec.ts` |
| R21 | Money never created or destroyed; ledgers reconcile | Ledger reconciliation | `unit/demo-bank.spec.ts`, `bank/bank-api.spec.ts` |
| R22 | No double spending (idempotency, concurrency) | CWE-362 | `unit/demo-bank.spec.ts`, `bank/bank-api.spec.ts`, `bank/bank-ui.spec.ts` |
| R23 | Secure session cookie; sign-out ends the session | CWE-1004, OWASP A07 | `bank/bank-api.spec.ts`, `bank/bank-ui.spec.ts` |
| R24 | Bank pages meet WCAG 2.1 AA | WCAG 2.1 AA | `bank/bank-ui.spec.ts` |
| R25 | Public results page shows the latest CI result; its playground enforces the bank rules | Functional, WCAG 2.1 AA | `site/live-site.spec.ts` |

## 6. Test data

- **Login:** credentials come from environment variables / CI secrets, never from source code. Negative tests use obviously fake values.
- **Bank:** every bank test creates its own customer through a test-only route, so balances, daily limits and lockout counters never leak between tests running in parallel. Time-based rules (lockout expiry, daily limit reset) use an injected clock.
- **Database:** `run-history.spec.ts` seeds its own rows with a unique test name, asserts against them, and deletes them afterwards, so tests never depend on leftover data and can run in parallel.

## 7. Environments

| Environment | How |
|---|---|
| Local | `npm start`, optional `docker compose up -d db` for run history |
| Docker | `docker compose up --build` (app + PostgreSQL) |
| CI | GitHub Actions: Postgres service container, Chromium/Firefox/WebKit, Docker build |
| AWS | ECS Fargate + RDS PostgreSQL via CDK (`infra/`), deployed on demand |

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
