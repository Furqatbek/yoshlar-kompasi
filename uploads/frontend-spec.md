# Frontend specification — Yosh Iste'dodlar Kompasi (web version)

## 1. What the frontend must achieve

The entire interface is designed around one physical situation: a parent or teacher holding a phone, sitting next to a 6–11-year-old, reading questions aloud and typing what the child says. Everything follows from that. The UI language is Uzbek; the person operating the screen is an adult; the child never touches the device. Build mobile-first (down to ~360 px wide) with desktop as a comfortable enlargement. Child-facing question text must be readable aloud at a glance — 18–20 px minimum. A session lasts 20–30 minutes with a small child present, so losing state on an accidental refresh is the worst possible bug: autosave is a core requirement, not polish.

Visual tone: warm and friendly but adult-facing — this is a tool for parents and teachers, not a game for kids. Playfulness lives inside the child-facing question cards; the chrome around them stays calm and clear.

## 2. Page map

Five screens plus two supporting pages. Ship v1 without user accounts (see section 7 for what accounts add later).

| # | Page | Suggested route | Job |
|---|------|-----------------|-----|
| 1 | Landing — Bosh sahifa | / | Explain the tool, build trust, one CTA |
| 2 | Session setup — Tayyorgarlik | /boshlash | Collect child info + consent, prep the adult |
| 3 | Live session — Mashg'ulot | /mashgulot | The chat: questions out, answers in |
| 4 | Report — Hisobot | /hisobot | Render the result; download, print, restart |
| 5 | Privacy — Maxfiylik siyosati | /maxfiylik | Required: you process children's data |
| 6 | About / FAQ — Metodika | /haqida | What it is and what it is not |
| — | "Generating" state | (between 3 and 4) | Loading state, not a separate page |

## 3. Page details

### 3.1 Landing — Bosh sahifa

Single job: get a qualified adult to press "Boshlash". Top to bottom: a one-sentence promise ("30 daqiqada farzandingizning kuchli tomonlari, o'quv yo'l xaritasi va mos sport tavsiyalari"); a three-step how-it-works strip (savolni o'qib berasiz → javobni yozasiz → hisobot olasiz); a sample report preview using an example child ("Ali, 2-sinf") — this is the strongest conversion element, people need to see what they will get; a trust block covering the three promises (bu tashxis emas; faqat ism so'raladi; mashg'ulotni kattalar olib boradi); footer links to privacy and FAQ. One primary button, repeated at top and bottom: Boshlash.

### 3.2 Session setup — Tayyorgarlik

A short form, not a chat. Fields: bolaning ismi yoki taxallusi (required, helper text: "Faqat ism — familiya kerak emas"); sinf (required — four large buttons, 1 / 2 / 3 / 4; this selects the difficulty band); yoshi (optional, 6–11); maqsad yoki orzu (optional single line, placeholder: "Masalan: matematikada kuchli bo'lish, futbolchi bo'lish…"); qo'shimcha izoh (optional, placeholder mentioning health limits or shyness). Below the fields, one required consent checkbox: "Men bolaning ota-onasi yoki o'qituvchisiman, 18 yoshdan kattaman va maxfiylik siyosatiga roziman."

Submitting reveals a short ready-checklist on the same page (tinch joy tanlang; bola yonizda va dam olgan bo'lsin; taxminan 30 daqiqa ajrating; savollarni ovoz chiqarib o'qib berasiz) and the real start button: Mashg'ulotni boshlash. On start, the form data goes to the backend, which opens the conversation — the model's first message should greet the adult, confirm the child's name and grade, and immediately offer the first batch of questions.

### 3.3 Live session — Mashg'ulot

The core screen, in three zones.

Header (sticky): child's nickname and grade on the left; three domain chips (Mantiq · Psixologiya · Harakat) that fill in as the session progresses; on the right, a pause button (Tanaffus) and an overflow menu containing Yakunlash.

Message area: model output has two visual layers. Child-facing text — what the adult reads aloud — renders as large cards (18–20 px, generous padding, soft accent background, small speaker icon). Adult-facing coaching ("Bola javob bergach, qanday hal qilganini ham yozib yuboring") renders as regular muted chat text. Implementation: add one line to the system prompt — "Bolaga ovoz chiqarib o'qib beriladigan har bir matnni blockquote (>) qilib yozing." — then have the frontend render Markdown blockquotes as the big cards. One line on the backend, and the read-aloud flow becomes visually obvious.

Input area: a text field (placeholder: "Bolaning javobini yozing…") with a send button, plus four quick-reply chips that insert standard messages so the adult never composes meta-answers while managing a child: Javob berolmadi · O'tkazib yuborish · Soddaroq savol bering · Tanaffus. The chips send plain text; the model already knows how to react from its instructions.

States this screen must handle: a "typing" indicator while the model responds; a network error shown inline on the failed message with a Qayta yuborish button that resends it (a typed answer must never be silently lost); a pause overlay (session frozen, one button: Davom etish); a finish confirmation if fewer than all three domains are covered ("Hisobot qisman ma'lumot asosida tuziladi. Davom etamizmi?").

Autosave: after every message, persist the full message array plus child meta to localStorage (fine on your own site) or to your server. On return, if an unfinished session exists, show a resume banner: "[Ism] bilan mashg'ulot yakunlanmagan — davom ettirasizmi?" with Davom etish / Yangi mashg'ulot.

### 3.4 Report — Hisobot

Triggered by Yakunlash: the frontend sends a final "generate the report" turn, shows the generating state (calm loader, "[Ism]ning hisoboti tayyorlanmoqda…", typically 10–30 s), then renders the result as a document, not a chat bubble. Sections in order, each styled distinctly: Surat (strengths, short cards or a clean list); Hozirgi o'rni (three rows — Mantiq, Psixologiya, Harakat — each with a level badge Shakllanmoqda / Me'yorda / Kuchli plus the observation paragraph); Maqsad va yo'l xaritasi (milestones as a simple vertical timeline); Nimani o'rganish va mashq qilish; Tavsiya etilgan sportlar (2–3 cards, each with its one-line reason); [Ism] uchun xat (a warm highlighted card — the emotional payoff of the whole product, make it beautiful); Kattalar uchun. Every report carries the footer disclaimer: "Bu hisobot tashxis emas, yo'l-yo'riq vositasi. Qobiliyatlar mashq bilan o'sadi."

Actions: PDF yuklab olish (a print stylesheet plus the browser's print-to-PDF is enough for v1 — skip server-side PDF generation) and Yangi mashg'ulot (returns to setup, clears session state). Have the backend request the report as structured Markdown with the fixed headings from the system prompt's template so the frontend can split and style sections reliably.

### 3.5 Privacy and FAQ

Not decoration — you are processing data about children even if only nicknames. The privacy page states in plain Uzbek: what is collected (nickname, grade, age, answers), where it goes (your server and the Claude API for processing), how long it is kept (v1 recommendation: nothing stored server-side after the report is delivered; session data lives only in the adult's browser), and that surnames, photos, and children's contact details are never requested. The FAQ / Metodika page answers: bu qanday ishlaydi; bu nima EMAS (tashxis emas, IQ testi emas, kelajakni bashorat qilmaydi); kimlar uchun; qancha vaqt oladi.

## 4. User flows

Happy path:

1. Landing → Boshlash.
2. Setup form → fill fields, tick consent → ready checklist → Mashg'ulotni boshlash.
3. Session: model greets the adult and offers the first batch (2–4 questions) → adult reads aloud, types the child's answer → repeat; the model alternates the three domains and adapts difficulty; domain chips fill in.
4. Model announces all domains are covered → adult presses Yakunlash va hisobot olish.
5. Generating state → report renders.
6. PDF yuklab olish, or Yangi mashg'ulot → back to a clean setup form for the next child.

Alternate flows. Pause/resume: Tanaffus at any time; state is already autosaved; returning shows the resume banner. Skip or can't answer: the chips send it as the answer — the model records it and moves on (this is signal, not failure). Early finish: confirmation dialog, then a report explicitly marked as based on partial data. Connection error: inline error with Qayta yuborish; the composed answer is preserved. Wellbeing pause: if the model raises a concern per its instructions (distress, bullying), the frontend renders it as a normal adult-facing message — do not suppress or restyle it; the adult decides how to proceed. Second child: Yangi mashg'ulot always starts from a clean form; never reuse the previous child's conversation.

## 5. Client state and data

The client owns: `child` (nickname, grade, age, goal, notes); `messages` (the full array, resent to your backend on every turn because the API is stateless); `progress` (domains the model has announced complete — parse its section announcements, or fall back to a simple batch counter if that proves brittle); `status` (setup | active | paused | generating | done). Send only `child` and `messages` to the backend; the backend attaches the system prompt and calls the API. Store nothing about the child on your server in v1 — if you add accounts later, that changes, and the privacy page must change with it.

## 6. Uzbek UI strings

| Where | String |
|---|---|
| Landing CTA | Boshlash |
| Setup title | Mashg'ulotga tayyorgarlik |
| Name helper | Faqat ism — familiya kerak emas |
| Consent | Men bolaning ota-onasi yoki o'qituvchisiman, 18 yoshdan kattaman va maxfiylik siyosatiga roziman |
| Start session | Mashg'ulotni boshlash |
| Input placeholder | Bolaning javobini yozing… |
| Quick chips | Javob berolmadi · O'tkazib yuborish · Soddaroq savol bering · Tanaffus |
| Resume banner | [Ism] bilan mashg'ulot yakunlanmagan — davom ettirasizmi? |
| Resume actions | Davom etish · Yangi mashg'ulot |
| Finish | Yakunlash va hisobot olish |
| Partial-finish confirm | Hisobot qisman ma'lumot asosida tuziladi. Davom etamizmi? |
| Generating | [Ism]ning hisoboti tayyorlanmoqda… |
| Report actions | PDF yuklab olish · Yangi mashg'ulot |
| Disclaimer | Bu hisobot tashxis emas, yo'l-yo'riq vositasi. Qobiliyatlar mashq bilan o'sadi. |
| Error | Xabar yuborilmadi. Qayta yuborish |

## 7. Phase 2 (after v1 works)

Accounts for teachers and parents, a dashboard listing children by nickname with their past reports, and re-assessment: running the same child again after 3–6 months and showing progress against the previous report is the feature that brings people back — the roadmap becomes a living document. Also worth queuing: a Russian-language toggle, and a teacher mode (a class of nicknames with individual reports per child — still no ranking, per the system prompt's rules).
