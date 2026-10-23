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
| `unit/questions.test.js` | The 70 approved question texts, word for word, plus the section boundaries, the 1-5 scale and the interpretation bands. The instrument is the product: a reworded question silently changes what every score means and nothing else would notice |
| `unit/scoring.test.js` | Per-area means over answered items only (a skipped question is never a zero), the band boundaries including a perfect 5.00, ties kept as ties, areas with too few answers scoring nothing, and that a model doing the arithmetic wrong is caught rather than believed |
| `unit/funnel.test.js` | Drop-off arithmetic: loss per step, biggest leak vs steepest step, a later stage out-counting an earlier one, empty windows, tiny samples (no DB, no app) |
| `unit/compose-env.test.js` | Every setting documented in `.env.example` is actually passed through to the container that reads it, the feature switches default to off, and no passthrough is wired to a differently-named variable. Exists because this failed silently once: new settings reached `config.js` and `.env.example` but not `docker-compose.yml`, so Docker deployments quietly ran on defaults |
| `unit/paywall.test.js` | What stays free (the portrait and the child's letter) vs what is sold, findings withheld from the JSON, and the reminder rules — quiet hours across midnight, message content. Also the Telegram messages themselves: that the delivery message states the price **before** the parent taps through to a paywall, that a child's nickname cannot inject markup, and that a reminder with no absolute base URL is skipped rather than sent with a link Telegram will reject |
| `unit/bot-replies.test.js` | What the bot says back to `/start`, `/stop`, a shared or forwarded contact, an expired login and an unknown report. The API suites drive the real webhook shapes but swallow the bot's outbound sends, so nothing else looks at the replies; this stubs `fetch` and reads the `sendMessage` payloads. Every reply must be valid Telegram HTML — with `parse_mode` on, a stray `<` is a 400 and a message the parent never gets |
| `api/auth-test.js` | Telegram login gate: nonce → `/start` → Share-contact → parent token; unauthorized start refused, nonce single-use, returning adult skips the phone, logout revokes |
| `api/e2e-driver.js` | Full product flow: session → messages → contact → report → public report → admin (leads, detail, patch, stats, CSV) → parent dedupe |
| `api/one-call-test.js` | How many times a sitting talks to the model: **once**, for the report. Starting a sitting and answering seventy questions make no upstream call at all, and a re-requested report returns the stored one. Reads the stub's call counter, because a greeting nobody renders looks exactly like no greeting from the outside — which is how a 30-second wait sat in front of a database insert, and why two sittings back to back felt like the service hanging. Also reads the stored report, since a request that reached the model without a report request still returns 200 with a share token |
| `api/e2e-extra.js` | Retry idempotency, concurrent double-report, contact idempotency, cross-device resume |
| `api/delete-test.js` | Right-to-erasure: admin lead delete cascades to children/sessions/reports |
| `api/gate-test.js` | Report engagement gate: zero-answer report refused (even with model-emitted completion markers), allowed after a real answer |
| `api/stale-model-test.js` | Sessions stamped under one LLM provider keep working after switching providers |
| `api/payments-test.js` | Paid reports end to end. Payme's integration is inbound, so the driver **plays Payme** — the same JSON-RPC calls in the same order — and checks both the protocol answers (auth, error codes, idempotent retries, one live transaction per order) and their effect: the report unlocks on `PerformTransaction` and re-locks on a refund |
| `api/reminders-test.js` | Who gets chased and who does not: timing thresholds, the give-up window, paid reports excluded, opt-out and `/stop`, quiet hours, claim-once, and that a failed send releases the claim so it can be retried. Ages rows in the DB rather than waiting |
| `api/questions-test.js` | The admin question bank: reading it, editing a question, disabling one (the row is kept, so answers already given are not orphaned), tuning a score threshold, and the consequence that matters — a bank edit reaches the prompt and changes its version, because an edited bank is a different instrument |
| `api/payload-test.js` | What a cold visit downloads, and how many round trips the first question is behind. The landing was 610 KB over 15 requests, none of it compressed, with the runtime quietly downloading the 200 KB shell a second time and the inventory arriving in a request of its own — none of which is visible in a screenshot, in a content assertion, or on a laptop next to the server. It only shows up as "the page is slow", which is how it was reported. Thresholds are loose on purpose: they catch something switching off, not a few kilobytes |
| `unit/pdf.test.js` | The report as a file. It is drawn rather than screenshotted — the alternative is shipping a headless Chromium to print the existing page, which is pixel-perfect and costs a 300 MB image and a browser process per download. The price is that `services/pdf.js` and the print stylesheet are two descriptions of one design, so the rules that matter on paper are read straight out of the PDF's drawing operators: **nothing is a filled box** (a monochrome school printer, or a print dialog with background graphics off, turns a filled card into an empty rectangle — and that card is the letter meant to be read to the child aloud), the letter is one whole box at every content length, and the type is embedded rather than merely named |
| `unit/brand.test.js` | The product's name and the centre's two phone numbers, as the page carries them. A rename looks finished long before it is — the title, the wordmark, the report header, the bot's self-introduction and the system prompt all say the name. The numbers are written once in E.164 and formatted for display, and that formatter once collided with an existing method of the same name (the contact gate's input mask, which expects the nine local digits a parent types): the page showed "99 893-51-57" under a correct `tel:` link — a plausible Uzbek number belonging to nobody. The duplicate-method check is there because of it |
| `unit/fonts.test.js` | The typeface is self-hosted and the production CSP no longer allows Google's origins, which sets two traps: a re-added remote font fails in production only, and the italic face is a text subset of one fixed string on the landing page — edit the string without regenerating and the new letters render in Georgia mid-sentence. Both are asserted; neither is visible in a diff |
| `api/funnel-test.js` | Funnel tracking end to end: the collector accepts only client-observable stages (a forged `finished` is dropped), server-recorded stages fire on the real requests, reloads do not inflate counts, and marking a lead enrolled closes the funnel. Runs **last** — it asserts absolute counts |

The suites run with authorization ON, as production does. Those written before
it exists call `installAuth()` from `api/auth-helper.js`, which performs the
handshake once and attaches the parent token to `POST /api/sessions` only —
each driver passing its **own** `chatId`, since one Telegram account is one
parent row and a shared id would merge their leads.

## Live smoke test (real model, costs money)

`BASE_URL=http://127.0.0.1:8080 node test/live-smoke.js` drives one REAL sitting
against a running app with a real LLM key. It costs about $0.02-0.10: the model
is called **once**, for the report. Starting the sitting and answering all
seventy questions cost nothing, so this is a test of the report — which is the
whole of what the model produces and the whole of what is sold.

It answers a child with a deliberate shape (high on building and science, low
on tidiness) and hard-asserts the wire contract plus that the scores it gets
back are that child's. The prose is judged in WARN lines — whether the report
writes about the areas the child actually scored highest on, whether it stays
inside what seventy agreement ratings can show, whether it is Uzbek — and the
link is printed for a human to read. Run it after every prompt change and
before every deploy; a stub cannot catch a model that stops following the
prompt. To compare models, point it at each in turn and read both reports.

Against a build with payments on, the public link shows only the free sections
— so for judging the whole report, run it against `PAYMENTS_ENABLED=false`.

## Browser suites (local only, not in CI)

Need Playwright + Chromium (`CHROMIUM_PATH` optional if Playwright's own
download is present). They serve `server/public` statically under the exact
production CSP — run `npm run build:web` in `server/` first:

```bash
node test/browser/render-check.js    # app mounts, zero console errors under prod CSP
node test/browser/start-btn-test.js  # start-button pending state; same-tick double-click fires ONE request
node test/browser/exit-test.js       # quit-without-report -> resume banner -> resume works
node test/browser/finish-test.js     # answer -> Yakunlash -> contact -> report on screen, with a way to keep it
node test/browser/back-to-back-test.js  # two children in a row: a clean form for the second, the first still resumable
node test/browser/consent-test.js    # adult-consent box: blocked unchecked, re-locks on uncheck, sent to API
node test/browser/auth-ui-test.js    # Telegram login card -> waiting state -> form unlocks from polling alone; survives reload
node test/browser/landing-claims-test.js  # landing copy matches the server's config (needs TWO apps: see below)
node test/browser/landing-scroll-test.js  # the scroll device: sheet fills, mobile bar, reduced-motion fallback
node test/browser/report-print-test.js    # the report as a FILE: what "PDF yuklab olish" actually produces
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

`report-print-test.js` covers the report as a **file** rather than a screen.
"PDF yuklab olish" is `window.print()`, so what a parent keeps, prints and shows
a teacher is this page under print media — and nothing else looks at it. It
drives a real paid report (it pays for one through the Payme endpoint, as
`payments-test.js` does) and asserts the rule that makes a printed report
survive: **on paper, contrast comes from ink, never from a fill.** Chrome's
print dialog ships with "Background graphics" OFF and that overrides
`print-color-adjust`, so a terracotta card with light text on it prints as an
empty rectangle. The letter to the child is such a card and is the one part of
the report meant to be read aloud, so a blank rectangle there reads as a
rendering bug rather than a missing letter. Also checks the chrome is dropped,
the frame colour belongs to the letter rather than another accent, and that the
letter is never split across a page break. Point it at the paid build with
`API_PAID=…`.

`finish-test.js` is the end of the sitting — the path the product exists for,
and the one the suite never walked. It had been broken outright: the finish gate
counted chat messages to decide whether the child had answered anything, and the
sitting stopped producing chat messages when the inventory became a form. After
seventy answers the count was still zero, "Yakunlash" always opened the "no
answers yet" dialog, and no report could be reached at all. `exit-test` presses
the same button with zero answers and asserts that dialog appears — correct for
that case, and the bug's behaviour for every other; the API tests post to
`/report` directly and never touch the button. So this one answers first.

`back-to-back-test.js` is the teacher's afternoon: one child, then the next. It
pins that returning to the setup screen opens a clean step 1 rather than the
previous child's step 2 (which skipped the two-step guard and left the wrong
name one tap from a new sitting), that the second sitting starts as quickly as
the first, and that the reset is not a wipe — an unfinished sitting is still
saved and still offered back.

The other suites mock the API with `page.route` and never reach a server,
so they call `stubLogin(page)` from `browser/auth-stub.js` **before**
`page.goto` — it seeds the parent token and stubs `/api/auth/me`, leaving the
page in the state an adult who logged in yesterday would see.

## Stubs

- `stubs/openrouter-stub.js` — OpenAI-format `/chat/completions`; rejects bare
  (slash-less) model ids with 400 like real OpenRouter. It answers the report
  request and nothing else worth faking: starting a sitting makes no model
  call, so a stub greeting would only hide one that should not happen.
- `stubs/anthropic-stub.js` — Anthropic `/v1/messages` format.

Both accept `STUB_PORT` to relocate.
