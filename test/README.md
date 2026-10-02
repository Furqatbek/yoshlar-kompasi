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
| `unit/funnel.test.js` | Drop-off arithmetic: loss per step, biggest leak vs steepest step, a later stage out-counting an earlier one, empty windows, tiny samples (no DB, no app) |
| `unit/compose-env.test.js` | Every setting documented in `.env.example` is actually passed through to the container that reads it, the feature switches default to off, and no passthrough is wired to a differently-named variable. Exists because this failed silently once: new settings reached `config.js` and `.env.example` but not `docker-compose.yml`, so Docker deployments quietly ran on defaults |
| `unit/paywall.test.js` | What stays free (the portrait and the child's letter) vs what is sold, findings withheld from the JSON, and the reminder rules — quiet hours across midnight, message content |
| `api/auth-test.js` | Telegram login gate: nonce → `/start` → Share-contact → parent token; unauthorized start refused, nonce single-use, returning adult skips the phone, logout revokes |
| `api/e2e-driver.js` | Full product flow: session → messages → contact → report → public report → admin (leads, detail, patch, stats, CSV) → parent dedupe |
| `api/e2e-extra.js` | Retry idempotency, concurrent double-report, contact idempotency, cross-device resume |
| `api/delete-test.js` | Right-to-erasure: admin lead delete cascades to children/sessions/reports |
| `api/gate-test.js` | Report engagement gate: zero-answer report refused (even with model-emitted completion markers), allowed after a real answer |
| `api/stale-model-test.js` | Sessions stamped under one LLM provider keep working after switching providers |
| `api/payments-test.js` | Paid reports end to end. Payme's integration is inbound, so the driver **plays Payme** — the same JSON-RPC calls in the same order — and checks both the protocol answers (auth, error codes, idempotent retries, one live transaction per order) and their effect: the report unlocks on `PerformTransaction` and re-locks on a refund |
| `api/reminders-test.js` | Who gets chased and who does not: timing thresholds, the give-up window, paid reports excluded, opt-out and `/stop`, quiet hours, claim-once, and that a failed send releases the claim so it can be retried. Ages rows in the DB rather than waiting |
| `api/funnel-test.js` | Funnel tracking end to end: the collector accepts only client-observable stages (a forged `finished` is dropped), server-recorded stages fire on the real requests, reloads do not inflate counts, and marking a lead enrolled closes the funnel. Runs **last** — it asserts absolute counts |

The suites run with authorization ON, as production does. Those written before
it exists call `installAuth()` from `api/auth-helper.js`, which performs the
handshake once and attaches the parent token to `POST /api/sessions` only —
each driver passing its **own** `chatId`, since one Telegram account is one
parent row and a shared id would merge their leads.

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
node test/browser/auth-ui-test.js    # Telegram login card -> waiting state -> form unlocks from polling alone; survives reload
node test/browser/landing-claims-test.js  # landing copy matches the server's config (needs TWO apps: see below)
node test/browser/landing-scroll-test.js  # the scroll device: sheet fills, mobile bar, reduced-motion fallback
```

`auth-ui-test.js` stands in for Telegram by posting the real webhook update
shapes against a running app, so it exercises the browser half of the login
without a bot token — including the part no API test can reach: that the page
flips from "waiting" to "unlocked" on its own, with no reload.

`landing-claims-test.js` drives the landing page against **two** running apps —
one with payments and the login gate on, one with both off — and checks the page
tells the truth in each: no "bepul" promise when the report is sold, the price
quoted up front and before the sample, the Telegram detour walked through when
it exists and *absent* when it does not, and the sample report showing what the
prompt now actually assesses. Point it at both with
`API_PAID=… API_FREE=… node test/browser/landing-claims-test.js`. Marketing copy
is what nobody re-reads after shipping a feature, which is why it is pinned.

Each assertion there pins a **claim, not a sentence** — the copy gets rewritten
and the claim has to survive the rewrite. The warm-paper redesign reworded every
one of them (`Emotsional intellekt` → `His-tuyg'ular`, a step counter → a
three-frame walkthrough) and the only change needed here was re-pointing the
matchers; a failure means a claim was *dropped*, so check which before touching
a matcher.

`landing-scroll-test.js` covers the landing's scroll device — the sample
report that writes itself as the reader descends. It proves the sheet fills,
that it is **forward-only** (scrolling back must not undo the reader's
progress), that the mobile bottom bar carries the sheet's progress and the CTA
without covering text, that reduced motion and low-end devices get a complete
static sheet and a plain CTA bar that needs no scrolling, and that none of it
runs on other routes. It also asserts there is **exactly one** bottom bar: two
stacked CTAs is what a superseded bar from an older design looks like, and it is
invisible in a screenshot taken at the top of the page. Point it at the paid
build with `API_PAID=…`.

The other three suites mock the API with `page.route` and never reach a server,
so they call `stubLogin(page)` from `browser/auth-stub.js` **before**
`page.goto` — it seeds the parent token and stubs `/api/auth/me`, leaving the
page in the state an adult who logged in yesterday would see.

## Stubs

- `stubs/openrouter-stub.js` — OpenAI-format `/chat/completions`; rejects bare
  (slash-less) model ids with 400 like real OpenRouter; `STUB_MODE=realistic`
  makes the greeting markerless (no `[YAKUN]`) as a real greeting would be.
- `stubs/anthropic-stub.js` — Anthropic `/v1/messages` format.

Both accept `STUB_PORT` to relocate.
