# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

DitPath serves three audiences equally:

- **Radio amateurs preparing for Morse or licence tests.** Need structured lessons, reliable feedback, and confidence in their readiness.
- **Experienced operators.** Want efficient, uninterrupted practice to maintain or improve their Morse recognition speed.
- **Curious beginners.** Want an approachable introduction without technical knowledge or commitment.

All three want to recognize Morse by ear, understand their progress, and know what to practise next.

Learners use DitPath on desktop and mobile browsers, with or without an account.

## Product Purpose

DitPath is a free, open-source, sound-first Morse code trainer. It combines guided Koch lessons, continuous copy practice, progress tracking, and a community forum.

The goal is to make learning Morse approachable, effective, and self-directed. Learners should develop auditory recognition rather than depend on visually decoding dots and dashes.

Success means that a complete beginner can confidently start learning, an experienced operator can practise without friction, and every learner understands their progress and next useful step.

## Positioning

**Learn Morse by ear. Practise with purpose. Know what comes next.**

DitPath offers a focused learning experience combining structured progression, independent practice, and meaningful feedback.

Its value comes from clarity and accessibility rather than feature quantity. The interface should make a potentially intimidating skill feel manageable without oversimplifying the learning process.

The Koch method and these capabilities are not exclusive to DitPath. Do not invent differentiating features or make unsupported claims.

## Operating Context

Learners interact primarily through audio, using keyboard or touch controls. Sessions should feel focused, responsive, and free from unnecessary interruptions.

The product has several connected experiences:

- **Guided learning:** Progressive lessons with warm-up, auditory recognition, feedback, and results.
- **Free practice:** Continuous copy training at a learner-selected difficulty.
- **Progress and history:** Evidence of learning, current ability, and areas needing review.
- **Reference and settings:** Supporting tools available without disrupting training.
- **Community:** A forum for participating learners.

Guest users can complete the training experience without registration. Optional accounts provide synchronization and community participation.

The interface supports light and dark themes and five languages: English, German, Japanese, Simplified Chinese, and Traditional Chinese.

### Design workflow

DitPath uses Penpot as its design source of truth.

- Inspect existing designs and components before proposing changes.
- For exploratory redesigns, create a separate Penpot page instead of modifying existing work.
- Preserve established designs unless changes are explicitly authorized.
- Review desktop, mobile, and relevant interaction states.
- Do not modify application code unless implementation is explicitly requested.
- Treat generated images as inspiration, not implementation specifications.

## Capabilities and Constraints

**Sound-first assessment:** During assessed recognition, never reveal Morse notation, animated decoding hints, or other visual answers. Reference and explanation views may show notation.

**Learning progression:** Guided lessons use recorded performance to determine progress and recommendations. Preserve the distinction between past proficiency, current recall, review readiness, and insufficient evidence. Never invent progress or change learning rules as part of visual design.

**Independent practice:** Free practice supports letters, words, callsigns, and simulated exchanges. Its history is recorded, but it does not unlock guided lessons or count as guided recognition evidence.

**Account independence:** Training must remain usable without registration. Synchronization and community features are optional additions.

**Implementation boundaries:** Design must respect existing capabilities and behavior. Do not invent targeted drills, native apps, offline support, analytics, or other unimplemented functionality.

**Naming:** DitPath is the current product name; OpenCW is the former name. Use DitPath in new user-facing designs. Do not rename technical identifiers or infrastructure without separate authorization.

## Brand Commitments

DitPath should feel **clear, approachable, focused, and trustworthy**.

- **Voice:** Plain, direct, encouraging, and never patronizing.
- **Visual character:** Calm, modern, purposeful, and minimally distracting.
- **Interaction:** One clear primary action, concise guidance, and immediate understandable feedback.
- **Complexity:** Simple enough for beginners without restricting experienced operators.
- **Trust:** Honest progress reporting and no exaggerated claims.
- **Openness:** Free, independent, Apache-2.0 open source, without advertising or third-party analytics.

Use existing approved Penpot components and visual conventions as the baseline. Detailed visual rules belong in the design system.

## Evidence on Hand

DitPath has an existing functional application with guided lessons, practice, learning history, progress, settings, and a community forum.

The repository and acceptance notes document implemented behavior. Editable Penpot designs cover existing interface flows.

The About page documents the author's radio amateur background. No verified testimonials, user statistics, performance benchmarks, or partnerships are available.

Some existing interface copy still uses OpenCW and requires migration. Do not interpret planned functionality or design concepts as implemented features.

## Product Principles

1. **Train the ear, not the chart.** Auditory recognition is fundamental. Visual decoding must never undermine assessment.
2. **Always show the next useful step.** Learners should know what to do and why without unnecessary explanation.
3. **Let evidence guide learning.** Communicate progress accurately, including uncertainty and areas needing review.
4. **Keep learning accessible.** Registration is optional, controls are discoverable, and the experience works across devices.
5. **Make simplicity intentional.** Remove unnecessary friction and visual noise without hiding essential information or functionality.

## Accessibility & Inclusion

Accessibility is a fundamental design requirement, particularly because Morse training depends on audio.

- Provide clear audio playback and replay controls.
- Support keyboard and touch interaction with visible focus states.
- Use touch targets of at least 44 × 44 CSS pixels, with appropriate spacing.
- Communicate success, errors, and progress without relying solely on color.
- Support enlarged text and reduced-motion preferences.
- Maintain usable layouts across mobile and desktop devices.
- Avoid introducing visual assistance that compromises auditory assessment.

Real-device and screen-reader validation remain open work. No formal WCAG conformance level has been established; do not claim certification or verified compliance.