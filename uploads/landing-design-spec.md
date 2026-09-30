# Landing page — design specification

Derived entirely from `uploads/project-definition.md`. Every decision below
traces to something in that file; where it does not, it is marked as a judgement
call so it can be argued with.

**Audience change from the definition:** teachers are no longer a secondary,
unadvertised use. Parents and teachers are **both primary**. The page is
designed for two adults, and for neither of them being a child.

**Purpose:** turn a visitor into a hot lead — an adult who completes the
Telegram login and starts a session. Not a click. The two measured leaks (40% at
the landing, 53% at the login) are the brief.

---

## 1. The two people

Same product, same evening, different reason for being on the page.

| | **The parent** | **The teacher** |
|---|---|---|
| Who | 28–42, child in grades 1–4, phone, Uzbek, Telegram-native | Primary-school teacher, 25–55, 25–35 pupils, often also a parent |
| The question in their head | *"Is my child good at something — and am I missing it?"* | *"I have a child I can't read, and a parent meeting on Friday."* |
| Emotional driver | Hope mixed with guilt | Professional competence; wanting to say something useful and specific |
| Trigger moment | A parent meeting, a cousin's child starting a to'garak, a school report | An individual pupil who puzzles them; end of term; a parent asking "what should we do with him?" |
| What they fear | A label on their child; wasting years on the wrong to'garak; being judged | More admin; a tool that contradicts them in front of a parent; something that ranks their pupils |
| Unit of use | One child, once, deeply | Several children, repeatedly, over a term |
| Who pays | Themselves | **Unresolved — see §10.** The single biggest open question |
| What converts them | "This is specific to *my* child" | "This gives me language for a conversation I already have to have" |

**What they share, and what the hero must speak to:** an adult sits with one
child for half an hour, reads questions aloud, listens properly, and ends up
able to say something true and specific about that child. Both audiences want
the same artefact for different reasons.

**Neither of them is a child.** No cartoon mascots, no primary-colour blocks, no
bouncing shapes, no "fun" typography. The child is the subject, never the
reader. This is the most common way a product like this gets designed wrong.

---

## 2. How one page serves both

**Recommendation: one page, parent-led, with a real teacher lane.**

Not an audience switcher at the top. A switcher forces a decision before the
visitor has received any value, splits the funnel into two weaker halves, and
doubles the maintenance. Teachers are self-directed — they will follow a clearly
marked path if one exists.

The structure:

- **The hero speaks the shared truth**, not "your child". Phrasing that works for
  both: *"Yarim soat — va siz bola haqida biladigan narsangiz o'zgaradi."*
  ("Half an hour — and what you know about the child changes.") The parent reads
  it as their child; the teacher reads it as their pupil. Neither is excluded.
- **A persistent teacher entry** in the nav: *"O'qituvchi sifatida"*. Quiet, not
  competing with the main CTA.
- **A dedicated teacher section** (§5, block 9) placed *after* the report proof —
  by then a teacher has seen the artefact and the question is only "does this
  work for my situation".
- **One CTA destination.** Both lanes end at the same Telegram login. No separate
  teacher funnel to maintain, and the analytics stay comparable.

**Where the lanes differ in copy, not layout:** the parent lane says *farzandingiz*
(your child), the teacher lane says *o'quvchingiz* (your pupil). Where a single
line must serve both, it says *bola* (the child).

---

## 3. What "hot lead" means here

In funnel terms, in priority order:

1. **Completed Telegram login** — they are now reachable. This is the conversion.
2. **Started a session** — they are committed to the evening.
3. Teacher variant: a school/centre enquiry (a secondary, lower-volume goal).

A click on "Boshlash" is *not* a lead. The page's job is not finished until the
visitor has been carried through a step that currently loses **53%** of the
people who begin it.

---

## 4. Visual direction — the pivot

### What we are moving away from, and why

The current system is near-white `#f3f2f2`, near-black ink, one hot red
`#ec3013`, 800-weight display type, hard 2px rules, square corners. It is
competent brutalist-editorial, and it is wrong for this product:

- **The red reads as alarm.** In a product whose first rule is *never diagnose,
  open with strengths*, the loudest colour on the page is the colour of a
  warning. When it marks a strength, the signal fights the meaning.
- **It is severe where the voice is warm.** The definition calls for "a
  knowledgeable colleague, never an examiner". Hard rules and heavy black type
  read as examiner.
- **It looks like a design portfolio**, not like something trustworthy about a
  child. For a parent deciding whether to hand over an evening, credibility
  beats style.

### Where we are going: **warm paper, deep ink, growth-green**

The governing metaphor is **a considered document about a child** — something a
parent would keep, a teacher would print. Not an app. Not a brochure.

**Palette** (starting values, to be refined in comps):

| Role | Value | Where |
|---|---|---|
| Paper | `#FAF7F2` | Page background — warm off-white, not screen-white |
| Paper raised | `#FFFDFA` | Cards, the report sheet |
| Ink | `#1E2422` | Primary text — deep charcoal with a green cast, softer than black |
| Ink muted | `#5B615C` | Secondary text |
| Hairline | `#E2DDD4` | Rules and borders |
| **Growth** | `#1F6F5C` | Primary accent: deep teal-green. Strengths, progress, CTAs |
| Growth pale | `#E6EFEA` | Washes, filled states |
| **Warmth** | `#C36A3C` | Terracotta. The letter, human moments, the child's own words |
| Warmth pale | `#FAEDE3` | The letter's background |

Green for growth is not decoration — it is the answer to the definition's own
question, *"how does a strength look that is not alarm-coloured"*. Terracotta is
reserved almost entirely for the letter, so that when it appears it means
something.

**The levels problem, solved.** *Shakllanmoqda / Me'yorda / Kuchli* must never
read as red/amber/green — that is a ranking, which the product forbids. Instead:
**three dots in one colour family, filling left to right.** One filled = forming,
two = on track, three = strong. A ramp, not a verdict. Nothing on the scale
looks like failure, which is exactly the product's position.

**Typography.**

- **Headings: a humanist serif** — Literata, Source Serif 4 or Petrona. A serif
  says "document about a person", where a heavy grotesque says "startup". This
  single choice does more than the palette to move the page from agency to
  trustworthy.
- **Body and UI: a clean humanist sans** — Inter or Public Sans.
- **Weights come down.** 600–700 for headings instead of 800. The page should
  feel calm at 21:00 on a phone.

> **Font selection constraint, non-obvious and important:** Uzbek Latin needs
> `oʻ` and `gʻ` — the modifier letter turned comma (U+02BB) and apostrophe
> (U+02BC). Many otherwise-good fonts render these as a straight quote, or at
> the wrong height, or not at all. **Every candidate font must be proofed with
> the words *oʻqituvchi*, *gʻayrat*, *toʻgarak* before it is chosen.** This is
> the most likely way the typography quietly fails.

**Form language.**

- Hairline `1px` rules instead of hard 2px; **soft 6px radius** on cards.
- The report sample gets **paper treatment** — raised surface, soft warm shadow —
  because it is the artefact being sold. Everything else stays flat.
- Generous vertical rhythm. Space is what makes a page feel considered rather
  than urgent, and this product must never feel urgent.

**Evening mode.** Peak use is ~21:00 on a phone. A **warm dark theme** (ink
`#15100D` family, paper becomes `#1A1512`, growth lifts to `#3E9A80`) is worth
building, triggered by `prefers-color-scheme`. Judgement call — nice-to-have,
not blocking.

### What to keep from the current build

The colour was the problem, not everything:

- **The self-writing report sheet.** As the reader descends, a sample report
  fills in, line by line. It is derived directly from the product's truth — the
  report *is* built line by line from a child's answers — and it tested well. Keep
  the mechanism; re-clothe it in paper and green, slow it down, and drop the
  flash-highlight on each new row.
- **The Telegram pre-sell** (a three-frame walkthrough: page → bot → back).
  It is the single highest-value block on the page.
- **The "what this is not" section.** Refusals buy trust. Keep it.

---

## 5. The page, section by section

Eleven blocks. For each: its job, and which audience it is carrying.

| # | Block | Job | Audience |
|---|---|---|---|
| 1 | **Hero** | Name the outcome in one breath; make the next step feel small | Both |
| 2 | **Recognition** | "That is my exact thought" | Both, split copy |
| 3 | **The shift** | One grade vs seven lenses | Both |
| 4 | **The seven lenses** | Substance and breadth, in plain Uzbek | Both |
| 5 | **The report** | Prove it is real and specific; state the price | Both |
| 6 | **The letter** | The emotional core, given its own room | Both |
| 7 | **Telegram, explained** | Kill the 53% | Both |
| 8 | **What this is not** | Trust through refusal | Both |
| 9 | **For teachers** | The professional case | **Teachers** |
| 10 | **Questions** | Remove the last objections | Both |
| 11 | **Close** | Ask for the evening, not the click | Both |

### 1 · Hero

Must carry, in this order: **what happens**, **how long**, **who does it**, and
**what the next step is**.

- Headline speaks to both: *"Yarim soat — va siz bola haqida biladigan
  narsangiz o'zgaradi."*
- One line of mechanics: you read the questions aloud, the child answers, you
  type. The phone never leaves your hand.
- **The Telegram step is named here**, under the CTA, in plain words: *"Keyingi
  qadam: Telegramda bitta «Start». Hisobot o'sha chatga keladi."* The 53% leak is
  a surprise problem; the cure begins in the hero.
- Badges: session free · ~30–40 min · only the child's first name · Telegram login.
- A small, quiet teacher line: *"O'qituvchimisiz? →"*.
- The report sheet enters here, empty, with the child's name on it.

**Judgement call:** the hero should not say *farzandingiz*. It costs a little
parental intimacy and buys the teacher's attention. The intimacy returns in
block 2, where the lanes split.

### 2 · Recognition

Two columns, explicitly labelled — the first place the lanes separate.

- **Parent column:** the four sentences already tested well — *"Farzandim nimaga
  qobiliyatli — aniq bilmayman."* etc.
- **Teacher column:** the professional equivalents — *"Sinfimda bitta bola bor,
  uni hech tushunolmayapman."* · *"Ota-onaga aytadigan aniq gapim yo'q."* ·
  *"Baho qo'yaman, lekin bu bola haqida hech narsa aytmaydi."*

### 3 · The shift

One mark against seven lenses. Visual: a single filled cell versus a row of
seven. The argument of the page in one image.

### 4 · The seven lenses

Seven rows, plain Uzbek, no jargon. Each row shows **what it writes into the
report** — this is what ties the section to the sheet filling alongside it.
Numbers turn from ink to growth-green as each is passed.

### 5 · The report

The centrepiece. Show the artefact, do not describe it.

- Ten parts, laid out as a real document on raised paper.
- **01 and 10 marked free**, the other eight marked as unlocking on payment.
- **The price is stated here**, inside the sample, before the ask: *"01 va 10 —
  bepul. Qolgan sakkiz qism — 49 000 so'm, bir marta."* A parent decides whether
  to spend the evening at this exact point; discovering the cost later would be
  us misleading them.

### 6 · The letter

Full-bleed, terracotta, generous space, nothing else on screen. One real
sentence, large, warm:

> *«Ali, sen qiyin savollardan qo'rqmaysan — bu katta kuch!»*

Below it, quietly: *"Uni ekrandan emas, sizning ovozingizdan eshitadi."* ("They
hear it in your voice, not from a screen.")

This is the most emotional thing the product has. It gets its own screen and
nothing competes with it.

### 7 · Telegram, explained

**The highest-value block on the page.** Three frames — *this page → the bot →
back here* — plus four short answers:

- **Nega kerak?** The report comes back to that chat and cannot be lost.
- **Qancha vaqt?** Seconds. No password, no code, no form. The page waits for you.
- **Biz nimani ko'ramiz?** Your Telegram name, to send you the report. Not your
  messages, contacts or password.
- **Keyin-chi?** `/stop` in the bot ends all reminders. The report still arrives.

The phone step appears here **only if the server actually asks for it**.

### 8 · What this is not

Four refusals, equal weight: **not a diagnosis · not an IQ test · not a ranking ·
not data for sale.** Counter-intuitively the strongest trust section on the page,
because every line is true and checkable.

### 9 · For teachers

Placed after the proof, where a teacher's remaining question is only logistics.

- **What it gives them:** language for a parent conversation, grounded in what
  the child actually said; a second read on a pupil who puzzles them; a written
  record they did not have to compose.
- **What it costs them:** half an hour per child, run one-to-one — the same
  half-hour a parent spends. No class-wide admin, no accounts to manage, no
  training.
- **What it is not:** not a class ranking, not an assessment instrument, not
  something that goes in a pupil's file. It never compares one pupil to another,
  which is the professional risk a teacher will worry about first.
- A clear next step, and an enquiry route for a school or centre wanting several.

**This block cannot be finished until §10's pricing question is answered.**

### 10 · Questions

Short accordion: price, age range, "does AI judge my child", data, time, a shy
child. Teacher-specific: can I run it for several pupils, what do I tell the
parent, does the school need an account.

### 11 · Close

Ask for the evening. *"Bugun kechqurun: telefon, bola va yarim soat."* CTA, and
the Telegram step named one last time.

---

## 6. Conversion mechanics

**CTAs.** Five or six, never identically worded — each matched to how warm the
reader is at that point: *Boshlash* → *Bolamning hisobotini olish* → *Tushunarli,
boshlaymiz* → *Bugun kechqurun boshlash*. Every one carries a one-line note
underneath naming the Telegram step. Repetition of that note is the fix for the
53%; by the time a visitor presses the button they should have read it four
times.

**Mobile sticky bar.** A persistent bottom bar on phones with the CTA and the
progress of the report sheet. It must never cover text, and must disappear for
reduced-motion and low-end devices — where the plain CTA bar remains instead.

**Price placement.** Inside the sample report (block 5) and again in the
questions (block 10). Never first, never only at the paywall.

**No urgency devices.** No countdowns, no scarcity, no "only today". The anxiety
in this market is real and pre-existing; amplifying it would be ugly and would
contradict the voice.

---

## 7. Mobile, because mobile is the product

- Design at **360px first**, then 390, then desktop. Desktop is the minority case.
- **44px minimum touch targets**, 16px side gutters, no horizontal scroll.
- Target a **mid-range Android at 21:00 on a slow connection**: system fonts as
  fallback, no blocking webfonts, no heavy imagery, motion limited to
  opacity/transform.
- **Uzbek runs 15–20% longer than English.** Every headline must be designed at
  its longest plausible string. No lorem ipsum in comps — it hides exactly the
  overflow this page will hit.

---

## 8. What must never appear

Non-negotiable, straight from the definition's §8:

- Invented social proof — no stock testimonials, no borrowed logos, no user
  counts we do not have.
- Any number about a child: score, percentile, IQ, rank.
- Comparison between children, in any form, including implied.
- Diagnostic or clinical language.
- Label phrasing — "a visual child", "a shy child".
- Countdowns, fake scarcity, manufactured urgency.
- Children as the addressed reader: no mascots, no cartoons, no primary-colour
  play. The child is the subject; two adults are the readers.

---

## 9. How this will be judged

1. Does the Telegram step feel small and expected **before** the reader reaches it?
2. Would a tired parent at 21:00 on a phone still be reading at block 6?
3. Does a teacher recognise themselves within the first two screens?
4. Is every claim true in both the paid and free builds?
5. Does it look like a document about a child, rather than a landing page?
6. **Do the two numbers move?** Landing→start under 25% loss; login completion
   above 70%.

---

## 10. Open decisions — blocking

1. **Teacher pricing.** A parent buys one report. A teacher with 30 pupils faces
   1 470 000 so'm at the individual price, which is not a product. Options: a
   per-class or per-school licence; teachers use the free parts and the school
   buys full reports selectively; a centre subscription. **Block 9 cannot be
   written honestly until this is decided**, and a teacher will ask within thirty
   seconds of arriving.
2. **Scope of the visual pivot** — landing only, or the whole product? The
   definition flags this: re-colouring the landing alone puts a visible seam at
   the moment of commitment. My recommendation is the whole product, sequenced:
   landing and report first (what a lead sees), then setup and session, then
   admin.
3. **Does the teacher lane need its own URL** for sharing in teacher groups
   (`#/oqituvchilar`)? Cheap to add later; worth knowing now.
4. **Evening/dark mode** — build now or defer?
