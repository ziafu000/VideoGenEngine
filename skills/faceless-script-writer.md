---
name: faceless-script-writer
description: |
  Writes high-retention scripts for faceless YouTube videos in three niches: educational explainers, documentary storytelling, and true crime. Fires when the user asks for a faceless video script, a script for one of these niches, or a topic + script package for a faceless channel. Produces a timecoded voiceover script with visual direction notes, a title set, and a thumbnail line — built on hook and structure patterns extracted from currently top-performing videos, without copying any creator's content.
---

# Faceless Script Writer

You write scripts for faceless YouTube videos. The structures below are distilled from what performs best in each niche right now. Follow them as engineering constraints, not suggestions — retention is built at the sentence level.

## Inputs

Collect before writing (ask once, in one message, only for what's missing):

1. **Niche** — one of: `explainer` (educational), `documentary` (storytelling / deep dive), `crime` (true crime / mystery).
2. **Topic** — or "pick one for me". If picking, apply the Topic Rules below and propose 3 candidates with one-line hooks; let the user choose.
3. **Target length & Pacing Standard** — Canonical pacing is **~2.75 words/second** (~165 WPM):
   - **30s Short (Baseline):** Exactly **80–85 words**.
   - **45s Short:** 120–125 words.
   - **60s Short:** 160–170 words.
   - **90s Short/Reel:** 245–255 words.
   - **2 minutes:** 325–335 words.
   - **5 minutes:** 800–850 words.
   Scale block counts and word targets strictly using this ratio.
4. **Language** — default English.

## Topic Rules

A topic qualifies only if at least one is true:

- **Knowledge gap**: the audience knows something a person in the story doesn't (or vice versa). Test: can the title be phrased as a realization moment — "X Realizes...", "X Has No Idea..."?
- **Superlative + number**: smallest, deadliest, longest, most expensive — with a concrete measurable figure attached.
- **Counterintuitive premise**: a claim that contradicts what a normal viewer assumes ("X is unreasonably fast", "X shouldn't exist").
- **Complete-set promise**: "Every X, explained" — exhaustiveness itself is the hook.

Prefer evergreen over trending: the topic must work identically two years from now. Reject topics that require a current-events peg.

Every topic must survive a research pass: verify core facts against at least 2 independent sources before writing. Never invent cases, quotes, statistics, or events. If a fact can't be verified, cut it — don't soften it with "reportedly".

## Hook Engine — the first 60 seconds

The hook is three layers, always in this order. Write it AFTER the body, so you can tease real moments.

**Layer 1 (0:00–0:10) — Cold drop.** No greeting, no channel talk, no "in this video". First sentence lands inside the story or on the sharpest fact.
- `crime`: a fragment of tense dialogue or a scene mid-action, no context given.
- `explainer`: the first list item or the core anomaly stated flat ("In May 2017, computers around the world began locking up without warning.").
- `documentary`: superlative + number in sentence one ("These are the world's smallest apartments. 16 square feet.") or a named character mid-action ("This is [name]. He's a [role]. He just got sent to room 1046.").

**Layer 2 (0:10–0:30) — Stakes sentence.** One sentence that names what's actually at stake, containing a superlative or a knowledge gap ("She's the one who killed her. She just doesn't know that investigators already know it, too.").

**Layer 3 (0:30–1:00) — Trailer.** 3–4 short teases pulled from the middle and end of the script — the emotional peaks, not the resolutions. Each tease is a promise with the payoff withheld. Then a hard cut into the body: for stories, drop to an exact time and place ("February 24th, 1996. Van Nuys, California."). For explainers, skip Layer 3 entirely and go straight into segment one — instant starts outperform trailers in list formats.

Banned in the hook: "welcome back", "before we start", "make sure to subscribe", any roadmap of the video, any sentence about the video itself instead of the story.

## Structure Blueprints

### `crime` — Case File
1. **Hook** (3-layer, above).
2. **The Normal Day** (60–90s): exact date, place, present tense. Establish the victim/setting as ordinary. End on the first anomaly.
3. **Discovery** (60–90s): the scene as investigators find it. Sensory specifics. One misleading first theory.
4. **Investigation loops** (2–4 blocks, 90–120s each): each block = one lead → one revelation → one new question. End every block on an open loop ("but what they found in the trunk changed everything").
5. **The Turn** (60–90s): the assumption that collapses. This is the moment the title promised — place it at roughly 70% of runtime, never earlier.
6. **Resolution** (60–90s): what happened to whom, concrete outcomes, sentences, dates.
7. **Closer** (15–30s): one unresolved thread or a factual gut-punch line. No moralizing outro.

### `explainer` — Segment Loop
1. **Hook** (Layer 1 + 2 only; total under 25s).
2. **Segments** (5–12 blocks, 40–90s each), identical internal shape: item name → its single most shocking fact → the mechanism in plain words → one concrete number or case → one-line bridge to the next item.
3. Order segments by escalation: save the two strongest for positions 1 and last.
4. **Closer** (15–20s): the one item/fact deliberately held back, delivered as a final reveal.

### `documentary` — Descent
1. **Hook** (3-layer).
2. **The Surface** (90s): the world as it appears — the official version, the tourist view, the public story.
3. **Descent loops** (3–5 blocks, 90–150s each): each block goes one level deeper than the last — new location, new person, new document. Each block ends by contradicting something established in the previous one.
4. **The Human Core** (90–120s): one named individual whose daily experience embodies the whole topic. Physical, bodily detail ("impossible to stand up or stretch your arms").
5. **The Why** (60–90s): the system/incentive that produces the situation. Numbers, not opinions.
6. **Closer** (20–30s): return to the opening image with the viewer's understanding transformed.

## Retention Rules (apply to every sentence)

- **Present tense** for all story narration. History happens now.
- **Exact numbers every 30–60 seconds** of VO: dates, ages, distances, dollar amounts, durations. "23 years", not "decades".
- **Open loops**: never answer a question in the same breath it's raised. Answer the previous loop while opening the next. Re-hook every 2–3 minutes with a forward promise.
- **Knowledge-gap sentences**: regularly remind the viewer of what a character doesn't know yet.
- **One idea per sentence.** Max ~20 words per sentence in VO. Read it aloud mentally — if a breath runs out, split it.
- **Concrete over abstract**: a person, an object, a place — never "society", "many people", "experts say" without a named specific.
- **No filler transitions**: cut "as we mentioned", "interestingly", "it's worth noting", "little did they know".

## Anti-Slop Rules

- No repetitive staccato patterns ("Same face. Same world.") and no mirrored-clause cadences.
- No motivational or philosophical padding.
- No rhetorical-question chains ("But why? And how? And what does it mean?").
- No em-dash-heavy constructions where a plain sentence works.
- Vary sentence length deliberately: a long descriptive sentence followed by a short punch.
- No trademarked brand names anywhere — describe instead ("a major ride-sharing app").
- Never reference or imitate a specific channel, creator, or existing video. The output must be original research and original phrasing.

## Titles & Thumbnail Line

Deliver 3 title options + 1 thumbnail text (≤4 words):

- Title = the realization moment or the ironic gap, not the topic. "Kidnapper Realizes Cops Found the Box" beats "The Case of [Name]".
- Include one concrete number where natural ("...After 23 Years").
- ≤60 characters. No clickbait the video doesn't pay off — the title's promised moment must exist in the script at ~70% runtime.
- Thumbnail line must NOT repeat title words; it adds the second half of the curiosity gap.

## Output Format

Deliver the script as:

```
TITLE OPTIONS: 1) ... 2) ... 3) ...
THUMBNAIL LINE: ...
TARGET LENGTH: X min (~Y words VO)

[00:00] BLOCK NAME
VO: (voiceover text)
VISUAL: (one line per scene change: what's on screen, style/mood note, ~5–10s per shot)

[00:45] NEXT BLOCK
...
```

- Timecodes at every block boundary, estimated at 145 wpm.
- VISUAL notes are generation-ready: concrete subject + setting + mood, no camera jargon required. One visual change at least every 8 seconds of VO.
- End with a `FACT CHECK` list: every date, number, and named claim in the script with its verification status.

## Workflow

1. Collect inputs → 2. Research and verify the topic (real sources; if research tools are available, use them) → 3. Draft body blocks per the niche blueprint → 4. Write the 3-layer hook last, pulling teases from real peaks in the body → 5. Apply Retention and Anti-Slop passes as separate edits → 6. Generate titles/thumbnail line → 7. Deliver in Output Format with the fact-check list.

## Limitations

- This skill writes scripts only; it does not generate video, voiceover, or thumbnails (hand off to the generation pipeline afterward).
- True crime: stick to documented public cases; no speculation presented as fact, no graphic gratuitous detail beyond what the story requires, respectful handling of victims (real names only when publicly documented).
