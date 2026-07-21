# iOS Storefront — white-label shop app

A self-contained mobile-web storefront in Uzbek (Cyrillic), implemented from
the Claude Design project **“White-label iOS Shopping App”**. Lives alongside
the Kompas product in this repo but shares nothing with it except the `x-dc`
runtime (`support.js`).

| File | Role |
|---|---|
| `iOS Storefront.dc.html` | The imported design (source of truth for visuals): phone-frame mockup with a reviewer panel, accessibility notes and demo tips |
| `Storefront.dc.html` | The implementation: a full-viewport, hash-routed, installable-feeling web app built on the same `x-dc` runtime |
| `test/browser/storefront-test.js` | End-to-end browser suite driving every flow (local-only, like the other browser suites) |

## What the implementation adds over the design

The design is a 375×667 mockup inside a phone bezel with a fake status bar and
a review panel. The implementation drops those design-canvas artifacts and
turns the screens into a real app:

- **Full-viewport layout** — fills the browser/device (max-width 448px,
  centered on desktop), `viewport-fit=cover` with `env(safe-area-inset-*)`
  paddings for notches and home indicators.
- **Hash routing** — every screen is a deep-linkable URL (see routes below);
  in-app «Орқага» follows real browser history with a sensible parent
  fallback for direct deep links. Route guards redirect: checkout with an
  empty cart → cart, OTP without a phone → sign-in, unknown product/order →
  home / not-found.
- **Persistence** — cart, wishlist, checkout contact info, sign-in, points,
  orders and notification state survive reloads (`localStorage`, one keyspace
  per tenant: `sf:<tenant>:v1`).
- **System dark mode** — `appearance` prop defaults to `auto`
  (`prefers-color-scheme`), with forced `light`/`dark` still available.
- **Real semantics** — every tappable is a `<button>`, icon-only controls
  carry Uzbek `aria-label`s, sheets/alerts are `role="dialog"`/`alertdialog`
  with Escape-to-close, toasts are `role="status"` live regions, the points
  toggle is a real `role="switch"`, tab bar is a `<nav>` with
  `aria-current="page"`.
- **Real dates** — orders are stamped with the actual date/time (the design
  used «ҳозир»); order numbers come from a persisted per-tenant counter.
- The design's status-chip icon for new orders referenced an undefined
  `--i-clock` icon; the implementation defines it and uses the intended
  per-status icons (clock / check / truck / check).

Deliberately kept from the design (it is a front-end demo — there is no shop
backend): the three-tenant demo catalog, coupon `SALOM10` (10% off from
50 000 сўм), 12 000 demo loyalty points, OTP that accepts any 6 digits
(`000000` shows the error state), «Янгилаш» advancing the order status, and
the two seeded demo orders that appear after sign-in.

## Preview

Any static server from the repo root (React loads from unpkg via
`support.js`, or is preloaded like `build-web.js` does — see the test for the
offline trick):

```bash
python3 -m http.server 8000
# open http://localhost:8000/Storefront.dc.html
```

Or open it in the Claude Design canvas, where the **Tweaks** panel exposes the
props.

## White-label props (`data-props`)

| Prop | Values | Default |
|---|---|---|
| `tenant` | `grocery` (Баракат маркет) · `electronics` (Техноплюс) · `clothing` (Либос) | `grocery` |
| `appearance` | `auto` · `light` · `dark` | `auto` |
| `textSize` | `default` · `accessibility-xl` | `default` |

Each tenant carries its own brand hue (oklch 155/245/340), name, categories
and catalog. Switching tenants at runtime resets the session and loads that
tenant's persisted state.

## Routes

`#/` home · `#/qidiruv` search · `#/savat` cart · `#/profil` account ·
`#/mahsulot/:id` product · `#/rasmiylashtirish` checkout · `#/qabul/:no`
order placed · `#/kuzatish/:no` tracking · `#/kirish` phone sign-in ·
`#/tasdiqlash` SMS code · `#/buyurtmalar` orders · `#/sevimlilar` wishlist ·
`#/kuponlar` coupons · `#/bildirishnomalar` notifications

## Testing

```bash
CHROMIUM_PATH=/path/to/chromium node test/browser/storefront-test.js
```

Serves a temp copy with vendored React preloaded (offline-safe) and drives:
catalog/filters, search, product stepper, cart + coupon (wrong code, minimum
purchase, apply/remove), guest checkout with region/village sheets, order
success + tracking advance, history-correct back navigation, phone+OTP
sign-in (including the `000000` error), wishlist, points, notifications,
reload persistence, deep-link guards, system dark mode and runtime tenant
switching.
