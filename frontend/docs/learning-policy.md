# Learning policy pilot 1.0

Status: accepted product policy, frozen as `learning-policy-1.0`; integration is phased. This guide specifies the pilot and its acceptance requirements, not a claim that every capability is implemented. [Learning architecture](learning.md) owns current routes and persistence. [The additive evidence RFC](../../backend/docs/learning-evidence-v1-rfc.md) was explicitly approved for additive implementation on 27 October 2026; its phased activation gates still apply.

## Scope and evidence

Use separate dimensions for recorded exposure, historical proficiency, later retention, current evidence, and review scheduling. A due review or later mistake does not erase a historical achievement. Evidence correction is explicit; a claim whose supporting evidence becomes invalid must not remain verified.

The initial goal is single-character mixed recall at a stated character WPM, using clean tones and open entry or a full-alphabet keyboard. Record exact playback settings and response interface. Restricted choices and known-pair drills are coaching. Group, word, callsign, and continuous-copy performance are different tasks; they do not automatically certify individual-character recall. A changed goal is not checked at that setting until compatible evidence exists.

Independent means unassisted, not statistically independent. On a valid assessed opportunity:

| Outcome                                                      | Independent success | Eligible opportunity |
| ------------------------------------------------------------ | ------------------- | -------------------- |
| Correct first response, no prior replay/help                 | 1                   | 1                    |
| Correct after replay/help                                    | 0                   | 1                    |
| Wrong first response, even if corrected later                | 0                   | 1                    |
| Explicit skip after valid playback                           | 0                   | 1                    |
| Invalid audio, invalidating interruption, or never attempted | 0                   | 0                    |

Unknown playback/help metadata cannot be treated as false. Preserve correctness and support use separately. Do not infer a skip from a short timeout. Response latency has no promotion cutoff; show it only as contextual response time, separated by input method and comparable conditions.

## Mixed checks and milestones

Freeze each check's owner, purpose, policy, goal, taught set, targets, ordered prompt identities, feedback rule, and evidence references before playback. Generate a fresh order; do not reveal item-specific feedback until the check ends. Replays remain available and count as support. Use at least `min(4, introduced-character count)` distinct symbols; initial K/M checks have a deliberately limited two-symbol scope.

Certify at most two target characters per check. Each target has ten valid opportunities; include four anchor opportunities from other taught symbols when available. A planned invalid presentation makes the block incomplete rather than allowing hidden replacement trials. The first presentation of each target precedes coaching of that target. Later repetitions in the block are consistency observations, not additional delayed-recall samples.

| Claim                                   | Pilot criterion                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proficiency / mixed recall demonstrated | The latest two completed compatible mixed checks within 14 elapsed days, inclusive, each contain ten valid target opportunities and at least nine independent successes. Different check IDs and fresh orders are required. No minimum delay is claimed.                                                                                                                        |
| Retention demonstrated                  | After proficiency, two later completed compatible mixed checks each have an independently correct first target probe and at least nine independent successes out of ten. Each first target probe follows at least 20 hours since its last recorded relevant exposure. The later first target probe starts at least seven elapsed days after the original proficiency milestone. |
| Current criterion met                   | Latest completed compatible check is within 14 elapsed days and has at least nine independent successes out of ten for the target.                                                                                                                                                                                                                                              |
| Current evidence uncertain              | No compatible complete check, insufficient valid opportunities, incomplete history, uncertain chronology, or evidence older than 14 days.                                                                                                                                                                                                                                       |

Only the first probe per target/check is delayed-retention evidence. Store actual observed gaps and conditions. The seven-day span is **not seven days without practice**, continuous stability, a recall probability, permanent mastery, or on-air readiness. Retention is optional and never gates new lessons. Frequent learners remain proficient; show “Longer-gap recall not yet checked” and permit normal practice. Do not recommend stopping practice for a milestone.

## Review scheduling

Use the elapsed-day ladder `[1, 3, 7, 14, 30]`. Proficiency starts rung zero, due one day later. A schedule is an actionable recommendation, not an estimate of forgetting probability. Each target has a stable due-cycle identity.

- A complete compatible due check passes only with a cold independently correct first probe and at least 9/10 independent successes. Consume its due cycle once, advance one rung, and set the next due date from check completion using the new interval. At the last rung, keep 30 days. Late returns cannot skip rungs.
- A valid due failure resets to rung zero and is due one day after completion. An early check below 9/10 uses the earlier of the existing due time and completion plus one day. Early success never postpones a due date or consumes a cycle.
- Recent rehearsal can delay cold eligibility without moving the due anchor. `actionableAt = max(dueAt, coldEligibleAt)`. Evaluate targets separately; one recently rehearsed target must not prevent checking another.
- Incomplete or clock-uncertain checks never advance a rung. A complete compatible non-cold check below 9/10 can shorten recovery: when due, consume that cycle and schedule one day after completion; when early, preserve the earlier due time.
- Concurrent checks cannot advance the same due cycle twice. Ambiguous chronology leaves the schedule in need of a check rather than awarding extra interval credit.

Recorded relevant exposure includes deliberate sound presentation, replay, correction, or retrieval of the sound mapping in guided work, reference playback, pair coaching, and group/word practice. Ordinary text navigation is not exposure. Use a conservative per-character last-played bound or end-of-playback bound for passages. Freeze the pre-block bound before a target's first sound; later trials do not invalidate that already-observed initial gap.

Use monotonic time within a process and preserve wall-clock uncertainty separately. Conservative gap = earliest plausible first-presentation time minus latest plausible prior exposure. Unknown, overlapping, or implausible bounds cannot establish a delayed claim. Server receipt time is not playback time. External practice and unsynchronized devices are not observable; claims are always scoped to available recorded history.

## Recommendation and coaching

Order recommendations: recover active/unsaved work; resolve missing evidence; screen after 14 days without compatible assessment; repair demonstrated difficulty; offer an eligible due check; introduce the next character when proficiency/current-check criteria permit; offer contextual practice. Existing lessons stay accessible and a due review alone never relocks them.

A return screening has eight first-listen prompts sampling up to eight previously attained characters. It creates observations only for sampled sounds; it cannot award proficiency/retention or advance the review ladder. Do not invent prior attainment from a legacy score.

A pair-coaching round has 12 prompts, half for the pair and half for other taught sounds where available. Give immediate feedback and replay; this remains coaching even with typed input because its answer space is constrained. It cannot award milestones or extend review intervals. Limit repeated repair rounds and offer a break or settings check rather than an endless loop.

For repeated difficulty, require at least three non-successes across the latest two completed target checks within 14 days, including at least one in each. A directional confusion additionally requires at least three matching expected-to-entered first-response errors across two checks, ten expected-character opportunities, and a rate of at least 20%, within 14 days/latest 40 target opportunities. These are recommendation heuristics, not diagnoses.

## Phased integration and compatibility

The pure policy and its scenario tests can ship independently. Existing immutable attempts can support a labeled historical estimate, but cannot establish valid mixed blocks, first-listen context, comprehensive exposure gaps, or the new milestones. Legacy `automatic`/`stable` values must not be reinterpreted as pilot proficiency.

The initial coaching/screening pilot uses a **separate owner-scoped local database**, truthful purpose labels, immutable plans/first attempts, and explicit “Saved on this device” status. It does not upload new sessions as old guided lessons or continuous-copy practice. Existing genuine lessons/practice keep their current synchronization behavior. New local records are not automatically imported or uploaded when an account changes.

Prospective mixed assessment requires observation context and exposure coverage before enabling stronger claims. Synchronized milestones additionally require the approved evidence contract, additive migrations, shared frontend/backend fixtures, complete evidence dependencies, auditable corrections, and deployment authorization. The existing server snapshot policy remains unchanged until a separately approved migration.

## Acceptance and research limits

Check 9/10 twice versus 8/10 + 10/10; one-block insufficiency; 14-day boundaries; slow input; assistance in the denominator; invalid audio; purpose/profile mismatch; first cold-probe failure; 20-hour/168-hour boundaries; early practice; duplicate due cycles; late exposure correction; account switching; restart/lost-write recovery; and deterministic replay with out-of-order delivery. Verify all five locales, themes, keyboard/touch and screen-reader behavior for integrated UI.

Counts, intervals, thresholds, and gaps above are pilot product defaults, not universal scientific constants. Retrieval practice and spacing motivate delayed checks, but the cited tasks do not validate exact Morse cutoffs: [Roediger & Karpicke, 2006](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.2006.01693.x/), [Cepeda et al., 2008](https://doi.org/10.1111/j.1467-9280.2008.02209.x), [Kornell & Bjork, 2008](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Kornell_Bjork_2008_PsychScience.pdf). Evaluate delayed first-probe recall, assistance, failures, practice time, return behavior, and fresh contextual performance before replacing the ladder with a fitted model.
