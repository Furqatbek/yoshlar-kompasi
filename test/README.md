# Test suites

Three layers, all runnable without any LLM key — the LLM is replaced by local
stubs that speak the real wire formats (OpenRouter validates model-slug shape
like the live service does).

## API + unit (the main suite; used by CI)

Needs Node 20+ and a **throwaway** Postgres database (rows are created and
deleted; count assertions assume a fresh schema):

```bash
cd server && npm ci && cd ..
DATABASE_URL=postgres://user:pass@localhost:5432/yik_test bash test/run-api-tests.sh
```

The runner migrates + seeds, boots the OpenRouter stub (`:5602`) and the app
(`:8091`, override with `PORT`), then runs:

| Suite | Covers |
|---|---|
| `unit/openrouter-adapter.test.js` | Provider dispatch, request/response wire shapes, retryable-error classification, cross-provider `modelFor` resolution (self-contained — spins its own stub on `:5698`) |
| `api/e2e-driver.js` | Full product flow: session → messages → contact → report → public report → admin (leads, detail, patch, stats, CSV) → parent dedupe |
| `api/e2e-extra.js` | Retry idempotency, concurrent double-report, contact idempotency, cross-device resume |
| `api/delete-test.js` | Right-to-erasure: admin lead delete cascades to children/sessions/reports |
| `api/gate-test.js` | Report engagement gate: zero-answer report refused (even with model-emitted completion markers), allowed after a real answer |
| `api/stale-model-test.js` | Sessions stamped under one LLM provider keep working after switching providers |

## Live smoke test (real model, costs money)

`BASE_URL=http://127.0.0.1:8080 node test/live-smoke.js` drives one short REAL
session (greeting + 2 turns + report, ~$0.05-0.20) against a running app with a
real LLM key. Hard-asserts the wire contract (session, report, ## sections,
JSON levels block); prints WARN lines for prompt-quality signals (premature
markers, fabricated-looking levels) and the report link for human review. Run
after every prompt change and before every deploy — stub tests cannot catch a
model that stops following the prompt.

## Browser suites (local only, not in CI)

Need Playwright + Chromium (`CHROMIUM_PATH` optional if Playwright's own
download is present). They serve `server/public` statically under the exact
production CSP — run `npm run build:web` in `server/` first:

```bash
node test/browser/render-check.js    # app mounts, zero console errors under prod CSP
node test/browser/start-btn-test.js  # start-button pending state; same-tick double-click fires ONE request
node test/browser/exit-test.js       # quit-without-report -> resume banner -> resume works
node test/browser/consent-test.js    # adult-consent box: blocked unchecked, re-locks on uncheck, sent to API
```

## Stubs

- `stubs/openrouter-stub.js` — OpenAI-format `/chat/completions`; rejects bare
  (slash-less) model ids with 400 like real OpenRouter; `STUB_MODE=realistic`
  makes the greeting markerless (no `[YAKUN]`) as a real greeting would be.
- `stubs/anthropic-stub.js` — Anthropic `/v1/messages` format.

Both accept `STUB_PORT` to relocate.
