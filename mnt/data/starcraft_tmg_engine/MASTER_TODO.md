# StarCraft TMG Engine — Master TODO

Last updated: 2026-03-27

This is the single source of truth for what is still needed to move from playtest build to a fuller rules/content release.

---

## 1) Core Rules Completeness (Highest Priority)

### Assault phase parity
- [ ] Add remaining Assault actions beyond current set (Run, Hold, Declare Ranged, Declare Charge).
- [ ] Add explicit reaction windows with clear timing order.
- [ ] Add rule text surfaced in UI for each decision point.

**Definition of done**
- Assault action menu matches intended rules reference for both players.
- Tests cover all branch outcomes and invalid actions.

### Combat phase depth
- [ ] Expand combat queue step detail (declare/resolve subtiming, reactions, interrupts).
- [ ] Improve pile-in/consolidation tactical options (not just baseline movement hooks).
- [ ] Add clearer per-attack breakdown in UI (hit/wound/save/damage chain).

**Definition of done**
- Combat interactions are explainable from UI + logs without reading source.
- Scenario tests validate ordering and edge-case resolution.

---

## 2) Content Expansion (Cards, Factions, Missions)

### Tactical cards
- [ ] Expand card library significantly per faction.
- [ ] Add card identity boundaries (faction-specific packages and synergy constraints).
- [ ] Ensure each card has timing, targets, and expiry semantics documented.

### Faction gameplay identity
- [ ] Add unique faction mechanics wired through effects/modifier pipeline.
- [ ] Add data-driven faction package presets for quick skirmish setup.

### Missions/objectives
- [ ] Add more mission/deployment combinations.
- [ ] Add mission-specific scoring nuances and instant-win variants.

**Definition of done**
- Every faction has a coherent card package and distinct strategic pattern.
- Mission/deployment variety supports repeatable playtests.

---

## 3) Terrain + Board Interaction

- [ ] Expand terrain taxonomy beyond impassable + difficult + cover.
- [ ] Add line-of-sight/obscuration interactions where intended.
- [ ] Add richer terrain affordances in board rendering (legend/highlights).

### Grid-layout play style parity
- [x] Define whether grid mode is "practice-only" or a first-class rules variant. *(Decision: practice-only variant for quick playtests, not baseline balance mode.)*
- [ ] Add explicit measurement policy for diagonals/adjacency in grid mode.
- [ ] Add grid-aware engagement, charge range, and pile-in/consolidation edge-case rules.
- [ ] Add mission/objective templates balanced for square-grid play spaces.
- [ ] Add AI heuristics tuned for grid bottlenecks/chokepoints.
- [ ] Add dedicated grid-mode regression tests (movement legality, combat reach, objective control pacing).

**Definition of done**
- Terrain materially changes movement and target decisions in AI and player play.
- Terrain rules are visible and test-covered.
- Grid-mode outcomes are predictable, documented, and balance-tested against continuous-inch mode.

---

## 4) AI Quality and Decision Planning

- [ ] Upgrade AI from local heuristics toward multi-turn objective planning.
- [ ] Improve charge/ranged target valuation under terrain and mission context.
- [ ] Add explainability hooks (why this action was selected) for debugging.

**Definition of done**
- AI consistently pursues mission scoring over short-term damage traps.
- Regression harness tracks AI quality across matchup/mission matrix.

---

## 5) UX / Productization

- [x] Disabled-action reason tooltips for major action buttons.
- [x] Combat queue panel for queued attack visibility.
- [ ] “Why disabled” coverage for all interactive controls (including pass/cards edge states).
- [ ] Guided phase onboarding + contextual help.
- [ ] Better replayability tools (turn summary, event drill-down).

### Save/load hardening
- [ ] Add versioned save schema + migration path.
- [ ] Validate imported state more deeply and report field-level issues.
- [ ] Add deterministic replay export/import from action/event log.

**Definition of done**
- New testers can complete a full match without external explanation.
- Save/replay flows survive iterative engine changes.

---

## 6) Engineering Quality / Delivery

- [ ] Add CI gating for tests and lint/static checks.
- [ ] Add performance baseline scenarios for simulation-heavy turns.
- [ ] Add changelog/release notes discipline for playtest drops.
- [ ] Maintain this file as canonical backlog at end of each merged feature PR.

**Definition of done**
- Every PR updates tests + this backlog when scope changes.
- Team can identify “next best task” without ad-hoc rediscovery.

---

## Suggested execution order (practical)

1. Finish Assault/Combat rules parity.
2. Expand faction cards/content in parallel with rules.
3. Deepen terrain and AI together (they are tightly coupled).
4. Harden save/replay and onboarding UX.
5. CI/perf/release discipline pass.
