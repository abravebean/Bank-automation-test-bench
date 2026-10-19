# Recorded tests

Tests in this folder (`.spec.ts`) are created with `npm run record -- <test-name>`, which opens Playwright Codegen, records what you click and type as code, then cleans it up (see `scripts/record.js` and `lib/recording.js`).

Workflow:

1. **Record:** `npm run record -- transfer-between-accounts`
2. **Add assertions** while recording using the Inspector toolbar (*Assert visibility*, *Assert text*, *Assert value*). A recording with no assertions only proves the clicks didn't crash.
3. **Review** the saved file: rename vague locators, delete accidental steps.
4. **Run it:** `npx playwright test --project=recorded --headed`
5. **Promote** flows you'll keep into the Page Object (`playwright/pages/`) and move the test into `playwright/specs/`, so the next UI change is fixed in one place.
