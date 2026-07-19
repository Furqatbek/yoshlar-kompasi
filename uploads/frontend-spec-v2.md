# Frontend specification v2 — updates for lead capture and admin

This document updates `frontend-spec.md` for the database-backed version. Everything not mentioned here (landing content, session screen anatomy, the two-layer message styling, quick chips, error states, report section styling, UI strings) stays exactly as in v1.

## 1. Updated page map

Parent-facing:

| # | Page | Route | Change vs v1 |
|---|------|-------|--------------|
| 1 | Landing — Bosh sahifa | / | unchanged |
| 2 | Session setup — Tayyorgarlik | /boshlash | consent text simplified (see 3) |
| 3 | Live session — Mashg'ulot | /mashgulot/:token | resume now server-side via session token |
| — | Contact gate — Hisobotni olish | (step inside 3→4) | NEW: the lead capture moment |
| 4 | Report — Hisobot | /hisobot/:share_token | now a shareable tokenized URL, delivered by SMS/Telegram |
| 5 | Privacy — Maxfiylik siyosati | /maxfiylik | rewritten: server storage, retention, deletion, contact use |
| 6 | About / FAQ — Metodika | /haqida | unchanged |

Admin-facing (separate section, behind login, desktop-first is fine):

| # | Page | Route | Job |
|---|------|-------|-----|
| A1 | Admin login | /admin | email + password |
| A2 | Leads list | /admin/leads | table: parent, phone, children, sessions, last report, lead status; filters by status/date/grade; CSV export button |
| A3 | Lead detail | /admin/leads/:id | parent contact + consent record, children with their session history and report links, status dropdown, notes field |
| A4 | Stats | /admin/stats | weekly funnel: sessions started → finished → contacts left → reports delivered |

## 2. Updated user flow

1. Landing → Boshlash.
2. Setup form (child info + assessment consent) → ready checklist → Mashg'ulotni boshlash. Backend creates the session and returns the token; the frontend puts it in the URL and localStorage.
3. Live session, exactly as v1. Autosave is now trivial: the server already stores every message, so "resume" is just loading `/mashgulot/:token` — from any device.
4. When the model announces completion and the adult presses Yakunlash → **contact gate** (see below).
5. Contact submitted → generating state → report renders at its shareable URL, and the same link arrives on the parent's phone.
6. PDF yuklab olish / Yangi mashg'ulot as in v1.

Alternate flows from v1 all still apply. One addition — gate refusal: if the parent declines to leave a phone, still show the report in the browser (they earned it; holding it hostage creates resentment, and an angry parent is not a lead). The phone field is strongly encouraged ("Hisobot havolasini yuboramiz — keyin ham ochib ko'ra olasiz"), not technically mandatory. You will still capture the large majority, and the ones you capture actually want to hear from you.

## 3. The contact gate (new step)

Shown after Yakunlash, before generation, as a single focused card:

Title: "Hisobot tayyor! Qayerga yuboraylik?" Fields: ismingiz (parent's name, required); telefon raqamingiz (with +998 mask); two checkboxes — first, required, short reconfirmation tied to delivery ("Hisobot havolasi shu raqamga yuborilishiga roziman"); second, OPTIONAL and unchecked by default: "Markazning dasturlari va tadbirlari haqida xabar olishga roziman." Button: "Hisobotni olish". Below, a quiet secondary link: "Hisobotni faqat shu yerda ko'rish" (view without leaving contact).

Design notes: this is the single highest-stakes screen for the business — no distractions, no navigation, the child's name in the title ("Alining hisoboti tayyor!") to keep the emotional momentum. The marketing checkbox must be visibly separate and skippable; bundled consent poisons the lead list with people who never agreed to be called.

At setup (page 2), the v1 consent line is accordingly simplified to the assessment itself: "Men bolaning ota-onasi yoki o'qituvchisiman, 18 yoshdan kattaman va maxfiylik siyosatiga roziman." Contact and marketing consent now live at the gate, where they belong.

## 4. Report page changes

The report lives at `/hisobot/:share_token` — an unguessable URL that works without login, which is what makes SMS/Telegram delivery possible. Add a small footer block for the centre: logo, one line about programs matched to the report's recommendations, and a single CTA ("Bepul sinov darsiga yozilish" or a phone number). Keep it to one block — the report must read as the child's document, not an advertisement, or parents will stop sharing it. A shared report circulating in family group chats is your best organic marketing.

## 5. New UI strings

| Where | String |
|---|---|
| Gate title | [Ism]ning hisoboti tayyor! Qayerga yuboraylik? |
| Parent name | Ismingiz |
| Phone | Telefon raqamingiz |
| Delivery consent (required) | Hisobot havolasi shu raqamga yuborilishiga roziman |
| Marketing consent (optional) | Markazning dasturlari va tadbirlari haqida xabar olishga roziman |
| Gate button | Hisobotni olish |
| View-only link | Hisobotni faqat shu yerda ko'rish |
| Delivery confirmation | Havola telefoningizga yuborildi |
| Report CTA (footer) | Bepul sinov darsiga yozilish |

## 6. Phase 2 (updated)

The parent cabinet becomes natural once phones are verified: a parent logs in by SMS code and sees their children, past reports, and progress between assessments — which doubles as the re-engagement surface ("6 oy o'tdi, qayta baholaymizmi?"). Teacher/class mode and the Russian toggle remain queued as in v1.
