# Bank Login Test Bench

![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![Selenium](https://img.shields.io/badge/Selenium-43B02A?logo=selenium&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Postman](https://img.shields.io/badge/Postman-FF6C37?logo=postman&logoColor=white)
![Cucumber](https://img.shields.io/badge/BDD-Gherkin-23D96C?logo=cucumber&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-CDK-232F3E?logo=amazonwebservices&logoColor=white)
![Tests](https://github.com/abravebean/Bank-automation-test-bench/actions/workflows/playwright.yml/badge.svg)

**[Live test results →](https://abravebean.github.io/Bank-automation-test-bench/)** rebuilt by CI on every push to main: compliance evidence, API and security reports.

An end-to-end test automation suite for a demo bank login flow, built with **both Selenium WebDriver and Playwright**. It covers UI, API, database, performance and accessibility testing:

1. **A web dashboard** (Express + vanilla JS) that runs Selenium and Playwright tests side by side with one click and streams each test's steps live.
2. **A Playwright Test suite** using the Page Object Model, run cross-browser (Chromium, Firefox, WebKit) locally and in **GitHub Actions CI**, with HTML reports, traces, screenshots, and video on failure.
3. **API tests** for the dashboard's REST API: status codes, JSON Schema contract validation, NDJSON streaming, and malicious-input handling. They run first in CI.
4. **PostgreSQL run history** with **SQL data-integrity tests** that check the API against the database, the system of record.
5. **Performance tests** (p50/p95 latency) and **accessibility tests** (axe-core, WCAG 2.1 AA).
6. **A test recorder** with its own page in the dashboard: click through the bank site and watch each step appear live as plain English and Playwright code (Codegen). Secrets are moved to `.env` automatically, and you can review, edit, save and run recordings without leaving the browser.

7. **A compliance evidence report**: every test is linked to a requirement and a control (OWASP, WCAG, CWE). Each run produces an audit-ready report with the traceability matrix, step-by-step evidence, screenshots, coverage gaps and SHA-256 integrity hashes.

8. **Postman collections** run with **Newman**: chained API requests with test scripts, plus a data-driven security collection fed by a CSV of attack payloads.
9. **BDD scenarios** in Gherkin (`Given / When / Then`) for the login flow and the Recorder, with Cucumber-style step definitions on the Page Objects.
10. **AWS deployment** as code (CDK, TypeScript): Fargate behind a load balancer, private RDS PostgreSQL, Secrets Manager, with infrastructure tests and post-deploy smoke tests.

The Playwright suite is written in **TypeScript** (strict mode, type-checked in CI). The scope, risks and test strategy are in the **[Test Plan](TEST_PLAN.md)**.

> ⚠️ This project targets a **demo bank only**. It is not intended for, and should never be pointed at, a real banking site or real account.

![Dashboard running the test suite](docs/demo.gif)

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Using the Dashboard](#using-the-dashboard)
- [Playwright Test Suite](#playwright-test-suite)
- [API Tests](#api-tests)
- [Run History (PostgreSQL)](#run-history-postgresql)
- [Performance Tests](#performance-tests)
- [Accessibility Tests](#accessibility-tests)
- [Compliance Evidence Report](#compliance-evidence-report)
- [BDD Scenarios (Gherkin)](#bdd-scenarios-gherkin)
- [Postman Collections (Newman)](#postman-collections-newman)
- [Deploying to AWS](#deploying-to-aws)
- [TypeScript](#typescript)
- [Recording Tests (Codegen)](#recording-tests-codegen)
- [Continuous Integration](#continuous-integration)
- [Running with Docker](#running-with-docker)
- [Writing a New Test](#writing-a-new-test)
- [Project Structure](#project-structure)
- [Deploying Publicly](#deploying-publicly)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Two automation frameworks** — the same login scenarios implemented in Selenium WebDriver and Playwright, labeled by engine in the dashboard for side-by-side comparison.
- **One-click test runs** — run any test individually, or the full suite with **Run all tests**.
- **Live step logs** — each test streams its steps to the dashboard as it runs (NDJSON over HTTP), then reports pass/fail, message, and duration.
- **Page Object Model** — Playwright tests interact with the page through a typed Page Object, `playwright/pages/LoginPage.ts`.
- **TypeScript** — the Playwright suite, Page Object, reporter and configs are TypeScript in strict mode, with typed API responses; `npm run typecheck` runs in CI.
- **Compliance evidence** — requirement tags on every test feed a custom reporter that builds an audit-ready traceability and evidence report, merged across CI jobs.
- **Cross-browser** — the Playwright suite runs on Chromium, Firefox, and WebKit.
- **API testing** — Playwright `request` tests validate the dashboard's REST API against JSON Schemas (Ajv), including negative and security-focused cases.
- **CI/CD** — GitHub Actions runs API tests, then UI tests, on every push and pull request, and uploads both HTML reports.
- **Failure artifacts** — traces, screenshots, and video are kept automatically when a Playwright test fails.
- **Auto-discovered tests** — any `*.test.js` file in `/tests` appears in the dashboard automatically. No registration or wiring.
- **Shared driver and selectors** — one WebDriver builder (`lib/driver.js`), one Playwright launcher (`lib/pw-browser.js`), and one locator map per framework, so a UI change on the bank page is fixed in one place.
- **Run history in PostgreSQL** — every run is saved; `/api/runs` and `/api/stats` report pass rate, average duration, and flag flaky tests, all computed in SQL.
- **Data-integrity testing** — tests query the database directly with SQL and assert the API returns exactly what's stored.
- **Performance testing** — p50/p95 latency under sequential and concurrent load, with the numbers attached to the report.
- **Accessibility testing** — axe-core WCAG 2.1 A/AA scan and a keyboard-only navigation check on the dashboard.
- **Record-and-clean test creation** — Playwright Codegen records clicks as code; a post-processor moves URLs and credentials into env vars, removes redundant steps and names the test, with unit tests covering it.
- **Dockerized** — one image runs the dashboard with both engines against the system Chromium; `docker compose` adds PostgreSQL.
- **Headless or headed** — toggle with a single env variable: watch the browser locally, run headless on a server.
- **Config through environment variables** — no credentials in source code.

## How It Works

```
┌──────────────┐   HTTP    ┌──────────────┐  WebDriver/ ┌──────────────┐
│  Dashboard   │ ────────▶ │ Express API  │ Playwright▶ │   Chrome     │
│ (public/)    │ ◀──────── │ (server.js)  │ ◀────────── │ → Demo bank  │
└──────────────┘  results  └──────────────┘             └──────────────┘
                                  │
                                  ▼
                          tests/*.test.js
        (Selenium: lib/driver + lib/selectors,
         Playwright: lib/pw-browser + LoginPage)
```

1. The dashboard loads the list of tests discovered in `/tests`.
2. Clicking **Run** asks the Express server to execute that test.
3. The test opens Chrome through Selenium or Playwright, drives the demo bank's login page, and returns a message on success or throws an error on failure.
4. Each step is streamed back to the dashboard as it happens, followed by the final result and duration.

## Tech Stack

| Layer           | Tool                                                                  |
| --------------- | --------------------------------------------------------------------- |
| Test automation | [selenium-webdriver](https://www.npmjs.com/package/selenium-webdriver), [Playwright](https://playwright.dev) |
| Test runner     | [@playwright/test](https://www.npmjs.com/package/@playwright/test)     |
| Language        | TypeScript (strict) for the Playwright suite; [tsx](https://www.npmjs.com/package/tsx) lets the dashboard load the TypeScript Page Object |
| Reporting       | Playwright HTML, JUnit, and a custom compliance evidence reporter       |
| API contracts   | [Ajv](https://ajv.js.org) (JSON Schema validation)                    |
| Database        | PostgreSQL 16, [pg](https://www.npmjs.com/package/pg)                  |
| Accessibility   | [@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright) |
| Browser driver  | [chromedriver](https://www.npmjs.com/package/chromedriver)             |
| Server / API    | [Express](https://www.npmjs.com/package/express)                       |
| Configuration   | [dotenv](https://www.npmjs.com/package/dotenv)                         |
| Dashboard       | HTML, CSS, vanilla JavaScript                                          |
| CI/CD           | GitHub Actions                                                         |
| BDD             | Gherkin feature files, Cucumber expressions, [playwright-bdd](https://github.com/vitalets/playwright-bdd) |
| API collections | Postman, [Newman](https://www.npmjs.com/package/newman) (CLI, JUnit and HTML reports) |
| Containers      | Docker, Docker Compose                                                 |
| Cloud           | AWS CDK (TypeScript): ECS Fargate, ALB, RDS PostgreSQL, Secrets Manager, ECR; GitHub OIDC |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- Google Chrome installed locally
- A chromedriver version that matches your Chrome version (installed via npm)

### Installation

```bash
git clone https://github.com/abravebean/Bank-automation-test-bench.git
cd bank-automation-test-bench
npm install
npx playwright install --with-deps   # downloads Playwright's browsers
cp .env.example .env
```

Then fill in `.env` (see [Configuration](#configuration)) and start the server:

```bash
npm run start
```

Open **http://localhost:3000**.

## Configuration

All settings live in `.env`:

```env
BANK_URL=https://your-demo-bank.example.com/login
BANK_USERNAME=demo_user
BANK_PASSWORD=demo_pass
HEADLESS=true
PORT=3000
```

| Variable        | Description                                                        | Example                                     |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `BANK_URL`      | Login page URL of the demo bank under test                         | `https://your-demo-bank.example.com/login`  |
| `BANK_USERNAME` | Valid demo username, used by the happy-path login test             | `demo_user`                                 |
| `BANK_PASSWORD` | Valid demo password                                                | `demo_pass`                                 |
| `HEADLESS`      | `true` runs Chrome with no window; `false` shows the browser       | `true`                                      |
| `PORT`          | Port the dashboard runs on                                         | `3000`                                      |
| `DATABASE_URL`  | Optional. Enables run history in PostgreSQL                        | `postgres://testbench:testbench@localhost:5432/testbench` |
| `PERF_P95_BUDGET_MS` | Optional. p95 latency budget for performance tests           | `300`                                       |

> `.env` is git-ignored. Never commit real credentials.

**Tip:** set `HEADLESS=false` while writing or debugging a test so you can watch exactly what Selenium is doing.

## Using the Dashboard

- Every test in `/tests` is listed with its name, an engine badge (**Selenium** or **Playwright**), its description, and a **Run** button.
- **Run all tests** at the top executes the full suite.
- After each run, the result appears next to the test:
  - each step, streamed live as the test runs
  - ✅ / ❌ pass or fail
  - the message returned (or the error thrown)
  - how long the test took

### Included tests

| File                               | Engine     | What it checks                                         |
| ---------------------------------- | ---------- | ------------------------------------------------------ |
| `login.test.js`                    | Selenium   | A user with valid credentials can log in and log out.  |
| `invalid-login.test.js`            | Selenium   | Invalid credentials show an error.                     |
| `login-playwright.test.js`         | Playwright | A user with valid credentials can log in and log out.  |
| `invalid-login-playwright.test.js` | Playwright | Invalid credentials show an error and no welcome page. |

## Playwright Test Suite

Separate from the dashboard, `playwright/specs/` holds a Playwright Test suite built on the Page Object Model.

```bash
npm run test:pw            # everything: API tests + UI tests on all 3 browsers
npm run test:pw:chromium   # UI tests on Chromium only
npm run test:api           # API, database and performance tests
npm run test:a11y          # accessibility tests
npm run test:compliance    # suites that make up the compliance report
npm run test:bdd           # BDD scenarios (Gherkin)
npm run test:postman       # Postman collections with Newman
npm run typecheck          # TypeScript type check
npm run test:unit          # unit tests (Codegen clean-up)
npm run record -- <name>   # record a new test with Codegen
npm run test:ci            # everything that needs no bank credentials
npm run test:pw:headed     # watch it run in a real window
npm run test:pw:report     # open the last HTML report
```

| Spec                                       | What it checks                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| valid credentials reach the welcome screen | Login succeeds, welcome heading appears, logout returns to the form.  |
| invalid credentials show an error          | Error is visible and non-empty; welcome heading stays hidden.         |
| password field masks its input             | The password input is `type="password"`.                              |

Configuration lives in `playwright.config.ts`: retries in CI, parallel workers, and trace, screenshot, and video kept only when a test fails. Open a failure's trace with `npx playwright show-trace <path-to-trace.zip>` to step through it action by action.

## API Tests

`playwright/api/dashboard-api.spec.ts` tests the dashboard's Express REST API with Playwright's `request` client. Playwright starts the server automatically on port 3199 (`webServer` in `playwright.config.ts`), so there's nothing to run first.

```bash
npm run test:api
```

| Endpoint                     | What's checked                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/tests`             | 200 status, JSON content type, response matches the JSON Schema contract, every test listed once for both engines, response time under 1s |
| `POST /api/tests/:name/run`  | Unknown test → 404 with an error body matching its schema                       |
|                              | Malicious names (path traversal, script injection, SQL-style injection, 500-char input) → 404 |
|                              | `GET` on the run endpoint is rejected                                           |
|                              | Streams `application/x-ndjson`; every log event belongs to the test that was run; exactly one result event, last in the stream, matching its schema |

Response schemas live in `playwright/api/schemas.ts` and are validated with Ajv, so a change to the API's shape fails the build before it breaks the dashboard.

These tests need no bank credentials, so they pass on every build, including forks and pull requests.

## Run History (PostgreSQL)

Set `DATABASE_URL` and every test run is saved to the `test_runs` table (`db/schema.sql`). The dashboard shows the last 10 runs, and two endpoints expose the data:

| Endpoint | Returns |
| --- | --- |
| `GET /api/runs?limit=20&test=<name>` | Recent runs, newest first. `limit` must be 1–100, otherwise 400. |
| `GET /api/stats` | Per test: total runs, passed runs, pass rate, average duration, last run, and a `flaky` flag (has both passed and failed). |
| `GET /api/health` | `{ status, database: "up" \| "down" \| "disabled" }` |

Without `DATABASE_URL` the dashboard works exactly as before and these endpoints return 503.

```bash
docker compose up -d db                     # start PostgreSQL
DATABASE_URL=postgres://testbench:testbench@localhost:5432/testbench npm start
```

**Data-integrity tests** (`playwright/api/run-history.spec.ts`) treat the database as the system of record:

- Run a test through the API, then `SELECT` the saved row by id and compare every field to what was streamed to the user.
- Seed known rows with SQL, then check `/api/runs` returns the same ids in the same order and `/api/stats` matches a `COUNT(*)` / `AVG()` query, including the flaky flag.
- Reject bad `limit` values with 400 and prove a SQL-injection payload is treated as plain text (all queries are parameterized).
- Each run seeds its own uniquely named rows and deletes them afterwards, so tests are independent and safe to run in parallel.

## Performance Tests

`playwright/api/performance.spec.ts` sends 50 sequential and 20 concurrent requests to `GET /api/tests`, computes min/p50/p95/max, attaches the numbers to the HTML report, and fails the build if p95 goes over budget (default 300 ms, 3× that under concurrency). Override with `PERF_P95_BUDGET_MS`.

## Accessibility Tests

`playwright/a11y/dashboard-a11y.spec.ts` scans the dashboard with axe-core against WCAG 2.1 A/AA and fails on any violation (results attached to the report). A second test tabs through the page with the keyboard and confirms every Run button is reachable and has a unique accessible name, so screen readers say "Run login" instead of just "Run".

```bash
npm run test:a11y
```

## Compliance Evidence Report

Every Playwright test is tagged with the requirement it proves, and every requirement maps to a control:

```ts
test('invalid credentials show an error and stay on the login page', { tag: '@R2' }, async ({ page }, testInfo) => {
  await test.step('Submit a fake username and wrong password', async () => { /* ... */ });
  await test.step('An error is shown and no session starts', async () => {
    await expect(loginPage.errorMessage).toBeVisible();
    await captureEvidence(page, testInfo, 'Error shown for invalid credentials');
  });
});
```

The requirement catalog in [`compliance/requirements.json`](compliance/requirements.json) is the source of truth: ID, requirement, category, control (e.g. *OWASP Top 10 A07: Identification and Authentication Failures*, *WCAG 2.1 Level AA*, *CWE-798: Use of Hard-coded Credentials*) and risk (P1–P3).

![Compliance evidence report: summary, run details and traceability matrix](docs/compliance-report.png)

A custom reporter, `playwright/reporters/compliance-reporter.ts`, turns each run into an evidence package in `compliance-report/`:

| File | Contents |
| --- | --- |
| `index.html` | The report: run details (commit, branch, CI run, browsers, target host), a traceability matrix, gaps and exceptions, evidence for every requirement (each test, its steps, outcome per browser, screenshots), integrity hashes and a sign-off block. Prints cleanly to PDF. |
| `evidence.json` | The same data, machine-readable |
| `evidence.json.sha256` | Hash of `evidence.json`; check it with `sha256sum -c evidence.json.sha256` |
| `evidence/` | Screenshots, each named by its SHA-256 hash, so any edit after the run is detectable |
| `summary.md` | Short summary, posted to the GitHub Actions run page |

Each requirement gets one of four statuses:

| Status | Meaning |
| --- | --- |
| Passed | At least one linked test passed and none failed |
| Failed | A linked test failed (the error and a failure screenshot are included) |
| Not run | Every linked test was skipped; the reason is shown (e.g. `BANK_URL is not set`) |
| No tests | No test is linked: a coverage gap (R16, multi-factor authentication, is a known one) |

The report also flags tests that **passed only on retry** and tests **not linked to any requirement**, the first things an auditor asks about.

```bash
npm run test:compliance        # runs the suites that make up the report
```

Then open **Compliance report** in the dashboard, or `compliance-report/index.html` directly. Every Playwright run writes a report, so partial runs show the requirements they didn't cover as "No tests".

**In CI**, the API job and the cross-browser UI job each save raw results (Playwright blob reports). A third job merges them with `npx playwright merge-reports --config merge.config.ts`, so one report covers every requirement and browser. It runs even when tests fail, posts the summary table to the run page, and keeps the report as a build artifact for 90 days.

## BDD Scenarios (Gherkin)

Business-readable scenarios live in `features/`:

```gherkin
@R2
Scenario Outline: Wrong credentials are rejected: <case>
  When I sign in as "<username>" with password "<password>"
  Then I see a sign-in error
  And no session is started

  Examples:
    | case                  | username        | password                  |
    | unknown user          | not-a-real-user | definitely-wrong-password |
    | wrong password        | $BANK_USERNAME  | definitely-wrong-password |
    | SQL injection attempt | ' OR '1'='1     | ' OR '1'='1               |
```

| Feature | Scenarios | Runs in CI |
| --- | --- | --- |
| `login.feature` (R1–R3) | Sign in and out; wrong credentials (Scenario Outline, 3 examples); password masking | When the bank secrets are set |
| `recorder.feature` (R14, R15) | Record, review and save; stop early; invalid names (Scenario Outline, 4 examples) | Always, with the scripted Codegen stand-in |

Step definitions (`features/steps/*.ts`) use Cucumber expressions such as `{string}` and `{int}` and work through the Page Objects (`LoginPage`, `RecorderPage`), so a UI change is still fixed in one place. `$BANK_USERNAME` in a table means "read it from `.env`", so no real credentials live in feature files.

The scenarios run on the Playwright runner through [playwright-bdd](https://github.com/vitalets/playwright-bdd): `npx bddgen` turns each scenario into a Playwright test, so BDD gets the same traces, screenshots, parallel runs and CI as the rest of the suite. Gherkin tags such as `@R2` become Playwright tags, so **BDD scenarios show up in the compliance evidence report** with each `Given/When/Then` step listed as evidence.

```bash
npm run test:bdd
```

## Postman Collections (Newman)

`postman/` holds collections you can import into Postman or run from the command line:

| File | What it does |
| --- | --- |
| `bank-test-bench.postman_collection.json` | 13 requests in 5 folders: health and discovery, running a test (NDJSON stream), run history, negative and security cases, Recorder validation. Requests are **chained** with collection variables: the health check records whether the database is on, a test run's `runId` is then looked up in `/api/runs`. A collection-level script checks every response is JSON, never HTML. |
| `malicious-input.postman_collection.json` + `data/malicious-names.csv` | **Data-driven**: one request run once per CSV row (path traversal, script injection, SQL injection, command injection, oversized input), each with its expected status. |
| `local.postman_environment.json` | `baseUrl` for the Local environment |

```bash
npm run test:postman                                  # starts the dashboard, runs both collections, stops it
npm run test:postman -- --base-url http://my-host     # test an already-running or deployed copy
```

Reports land in `reports/newman/` (JUnit XML and an HTML report). The runner asks the server whether the Recorder is available and skips that folder when it isn't (Docker, AWS). CI runs the collections against the dashboard, against the **built Docker container**, and against the **live AWS deployment** after each deploy.

Writing the collection turned up a real inconsistency: unknown `/api` routes returned Express's default HTML error page. They now return a JSON 404.

## Deploying to AWS

`infra/` deploys the dashboard to AWS with the CDK (TypeScript): ECS Fargate behind an Application Load Balancer, RDS PostgreSQL 16 in isolated subnets, and credentials in Secrets Manager. It has its own infrastructure tests that check the security and cost rules in the generated CloudFormation (encrypted private database, no secrets in plain text, nothing open to the world, no NAT gateway), and CI runs them with a full `cdk synth` on every push. A manual GitHub Actions workflow deploys with OIDC (no stored AWS keys) and then runs the Postman collections against the live URL.

See **[infra/README.md](infra/README.md)** for setup, cost and teardown.

## TypeScript

The Playwright suite (specs, Page Object, reporter, helpers and configs) is TypeScript in strict mode. Playwright runs `.ts` files directly, so there is no build step: `npm run typecheck` only checks types, and runs first in CI.

- `playwright/support/api-types.ts` types every API response, mirroring the JSON Schemas in `playwright/api/schemas.ts`: the schemas check responses at runtime, the types check the test code at compile time.
- `playwright/support/schema.ts` and `playwright/support/evidence.ts` hold shared helpers (schema assertions, NDJSON parsing, screenshot evidence, environment variables).
- Recordings are saved as `.spec.ts` (Codegen's output is valid TypeScript). Older `.spec.js` recordings still load and run.
- The Express server and the dashboard tests in `/tests` stay JavaScript; the server registers [tsx](https://www.npmjs.com/package/tsx) so they can use the TypeScript Page Object.

Strict mode caught real issues during the conversion: the login tests passed a possibly-undefined `BANK_URL` to `page.goto()`, and a data-integrity test read a lookup result without checking it existed.

## Recording Tests (Codegen)

### From the dashboard

![Recorder page after a recording, showing plain-English steps and the cleaned code](docs/recorder.png)

Open **Recorder** in the dashboard (`http://localhost:3000/recorder.html`):

1. Enter a test name, the start page (defaults to `BANK_URL`), browser and screen size (desktop, iPhone, Pixel, iPad).
2. **Start recording.** A browser opens beside the Playwright Inspector. As you click and type, each step appears in the dashboard twice: as a numbered plain-English step ("Fill "input-username" with $BANK_USERNAME") and as live Playwright code. Use the Inspector toolbar to add checks.
3. Close the browser or press **Stop recording**. The dashboard switches to the **Cleaned** code and lists what changed (secrets moved to `.env`, extra clicks removed). **As recorded** still shows the raw Codegen output for comparison.
4. **Edit** the code if needed, then **Save test**. Saved recordings are listed below with **Run** (streams the Playwright output live), **View code** and **Delete**.

Updates reach the page over Server-Sent Events (`GET /api/recorder/events`). The recorder routes start processes and write files, so they only answer requests from `localhost`; on a public deployment or inside Docker they return 403 (set `RECORDER_ENABLED=false` to turn them off entirely).

| Endpoint | Purpose |
| --- | --- |
| `POST /api/recorder/start` | Start Codegen. 400 on an invalid name, URL, browser or device; 409 if a recording is already running |
| `GET /api/recorder/events` | Live stream of the recording: state, raw code, cleaned code, steps, clean-up report |
| `POST /api/recorder/stop` · `/save` · `/discard` | Finish, save (optionally with edited code) or throw away the recording |
| `GET/DELETE /api/recordings/:name` · `POST …/run` | Read, delete or run a saved recording |

**How it's tested:** the real Codegen window needs a person clicking, so automated tests swap in `playwright/fixtures/fake-codegen.js`, a stand-in that writes Codegen-style output a few lines at a time. `playwright/dashboard/recorder.spec.ts` then drives the Recorder page end to end (live steps, clean-up, edit, save, run, delete, stop early, accessibility) and checks the API's validation and error codes. It runs in CI.

### From the command line

```bash
npm run record -- transfer-between-accounts
npm run record -- mobile-login --device "iPhone 13"   # record on an emulated phone
```

A browser opens next to the Playwright Inspector. Every click and keystroke is written as Playwright code, and the Inspector toolbar adds assertions (visibility, text, value) by clicking an element. Codegen picks resilient locators: `data-testid` first (configured with `--test-id-attribute`), then roles and accessible names.

Close the browser to finish. `scripts/record.js` then cleans the raw recording with `lib/recording.js`:

| Raw Codegen output | After clean-up |
| --- | --- |
| `page.goto('https://demo-bank…')` | `page.goto(process.env.BANK_URL)` |
| `.fill('demo_user')`, `.fill('<password>')` | `.fill(process.env.BANK_USERNAME)`, `.fill(process.env.BANK_PASSWORD)` |
| `click()` immediately before every `fill()` | removed (`fill()` already focuses) |
| `test('test', …)` | `test('transfer-between-accounts', …)` plus a skip when `BANK_URL` isn't set |
| ES module `import` | CommonJS `require`, like the rest of the project |

It also warns if a credential still appears anywhere in the file. The result lands in `playwright/recorded/` and runs with `npm run test:recorded`.

Recordings are a starting point, not a finished test. Codegen records exactly what it sees, so review for:

- **Volatile values** in assertions, such as timings or dates (`toContainText('FAIL (0.0s)')` breaks on the next run)
- **Locators that match more than one element** (e.g. `getByRole('status')` when the page has several), which fail Playwright's strict mode

Then move flows you'll keep into the Page Object (see `playwright/recorded/README.md`).

The clean-up logic has its own unit tests (`playwright/unit/recording.spec.ts`, `npm run test:unit`) that run in CI.

## Continuous Integration

`.github/workflows/playwright.yml` runs two jobs on every push and pull request:

1. **Unit, API, database, dashboard, BDD, Postman and accessibility tests**: fast, no credentials needed. A PostgreSQL 16 service container is started for the data-integrity tests.
2. **UI tests** on Chromium, Firefox, and WebKit, which run only after the API tests pass.

Each job uploads its HTML report as a build artifact. The UI tests need these repository secrets under **Settings → Secrets and variables → Actions**:

- `BANK_URL`
- `BANK_USERNAME`
- `BANK_PASSWORD`

## Running with Docker

`.dockerignore` keeps `.env`, `node_modules` and local reports out of the image, and the container runs as the unprivileged `node` user.


```bash
docker compose up --build        # dashboard + PostgreSQL run history
# or, without the database:
docker build -t bank-test-bench .
docker run -p 3000:3000 --env-file .env bank-test-bench
```

The image installs the system Chromium and points both Selenium and Playwright at it, so no browser download is needed at runtime.

## Writing a New Test

Create a file in `/tests` ending in `.test.js` and export this shape (set `engine` to `'selenium'` or `'playwright'`):

```js
module.exports = {
  name: 'my-new-test',
  engine: 'playwright',
  description: 'What this test checks.',
  async run(log) {
    // Selenium:   lib/driver.js + lib/selectors.js
    // Playwright: lib/pw-browser.js + playwright/pages/LoginPage.ts
    // Call log('...') to stream a step to the dashboard

    // Success → return a string describing what passed
    // Failure → throw new Error('what went wrong')
  },
};
```

Restart the server and the test appears in the dashboard.

**Conventions**

- **One behavior per test.** Small, focused tests make failures easy to diagnose.
- **Locators live in one place.** `lib/selectors.js` for Selenium, `LoginPage.ts` for Playwright. Never hard-code them inside a test.
- **Fail loudly and specifically.** `throw new Error('Expected dashboard heading, got login page')` is far more useful than `throw new Error('failed')`.
- **Always clean up.** Quit the driver or close the browser in a `finally` block so failed tests don't leave Chrome processes running.

## Project Structure

```
bank-login-automation/
├── server.js              # Express API + static file server
├── lib/
│   ├── driver.js          # Shared Selenium WebDriver builder
│   ├── db.js              # PostgreSQL run history (optional)
│   ├── recorder.js        # Runs Codegen for the Recorder page
│   ├── recording.js       # Cleans up Codegen recordings
│   ├── steps.js           # Turns test code into plain-English steps
│   ├── pw-browser.js      # Shared Playwright browser launcher
│   └── selectors.js       # Selenium selectors for the demo bank
├── tests/                 # Dashboard tests (auto-discovered)
│   ├── login.test.js
│   ├── invalid-login.test.js
│   ├── login-playwright.test.js
│   └── invalid-login-playwright.test.js
├── playwright/
│   ├── pages/
│   │   ├── LoginPage.ts   # Typed Page Object for the login page
│   │   └── RecorderPage.ts # Page Object for the Recorder
│   ├── reporters/
│   │   └── compliance-reporter.ts # Builds the compliance evidence report
│   ├── support/
│   │   ├── api-types.ts   # Types for API responses
│   │   ├── evidence.ts    # Screenshot evidence + env helpers
│   │   └── schema.ts      # Schema assertions, NDJSON parsing
│   ├── specs/
│   │   └── login.spec.ts  # UI test suite
│   ├── api/
│   │   ├── dashboard-api.spec.ts  # API test suite
│   │   ├── run-history.spec.ts    # API vs. PostgreSQL data-integrity tests
│   │   ├── performance.spec.ts    # Latency percentiles
│   │   └── schemas.ts     # JSON Schemas for API responses
│   ├── a11y/
│   │   └── dashboard-a11y.spec.ts # axe-core WCAG + keyboard tests
│   ├── dashboard/
│   │   └── recorder.spec.ts       # Recorder page end-to-end tests
│   ├── fixtures/
│   │   └── fake-codegen.js        # Scripted stand-in for Codegen in tests
│   ├── recorded/          # Saved recordings
│   ├── recorded.config.ts # Config for running saved recordings
│   └── unit/
│       ├── recording.spec.ts      # Unit tests for the Codegen clean-up
│       └── steps.spec.ts          # Unit tests for code -> plain-English steps
├── db/
│   └── schema.sql         # test_runs table
├── scripts/
│   ├── record.js          # npm run record: Codegen + clean-up
│   └── run-postman.js     # npm run test:postman: Newman runner
├── docs/
│   └── demo.gif           # Dashboard demo
├── .github/workflows/
│   └── playwright.yml     # CI pipeline: API job → UI job
├── public/
│   ├── index.html         # Dashboard UI
│   ├── recorder.html      # Recorder UI
│   ├── recorder.js
│   ├── style.css
│   └── app.js
├── compliance/
│   └── requirements.json  # Requirement catalog: IDs, controls, risk
├── features/              # BDD: Gherkin feature files
│   ├── login.feature
│   ├── recorder.feature
│   └── steps/             # Step definitions + fixtures (TypeScript)
├── postman/               # Postman collections, environment, CSV test data
├── infra/                 # AWS CDK app, infrastructure tests, deploy guide
├── playwright.config.ts
├── merge.config.ts        # Merges CI jobs into one report
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml     # app + PostgreSQL
├── TEST_PLAN.md           # scope, risks, traceability matrix
├── package.json
├── .env.example
└── .gitignore
```

## Deploying Publicly

Because this runs against a demo bank, it's safe to host as a live demo on Render, Railway, Fly.io, a VPS, or similar. A few things to know:

- **Set secrets in the host, not the repo.** Add `BANK_URL`, `BANK_USERNAME`, and `BANK_PASSWORD` as environment variables in your hosting platform's dashboard.
- **The host needs a browser.** Most Node hosts don't ship with Chrome, so deploy with the included `Dockerfile`, which installs Chromium for both engines.
- **Run headless.** Servers have no display, so keep `HEADLESS=true`.
- **Demo targets only.** If this is ever pointed at a real bank, take the deployment down. Automating a real account login on a publicly reachable server is a completely different risk profile.

## Troubleshooting

| Problem                                              | Likely fix                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `session not created: This version of ChromeDriver only supports Chrome version X` | Chrome and chromedriver are out of sync. Update Chrome, or install the matching driver: `npm install chromedriver@<your-chrome-major-version>`. |
| Tests time out or can't find elements                | Check `BANK_URL`, then set `HEADLESS=false` to watch the run. The page may have changed; update `lib/selectors.js`. |
| Port already in use                                   | Change `PORT` in `.env`.                                                                       |
| `Executable doesn't exist` (Playwright)              | Run `npx playwright install --with-deps` to download Playwright's browsers.                    |
| A new test doesn't show up                           | Confirm the filename ends in `.test.js`, it lives in `/tests`, and restart the server.        |
| Leftover Chrome processes                            | Make sure each test quits its driver in a `finally` block.                                     |

---

Built by [Kevin Tran](https://github.com/abravebean) · [LinkedIn](https://linkedin.com/in/kevi-tran)
