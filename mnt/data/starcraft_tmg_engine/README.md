# StarCraft TMG Engine - Assault/Combat Playtest Build

This build is a rules-first rewrite of the uploaded grid mockup.

## Current implementation status (March 2026)

This build now supports full turn cadence through **Movement → Assault → Combat → Cleanup** with interactive Combat-phase activations and round scoring.

## What is shipped and playable

- alternating activation in Movement, Assault, and Combat
- all units begin in reserves
- supply pool and available supply
- deployment from entry edges
- normal move for unengaged units
- disengage for engaged units
- Run in Assault Phase
- Declare Ranged Attack in Assault (explicit target selection supported in UI)
- hold
- pass and first-player-marker handoff
- AI opponent for Movement and Assault action selection with objective-aware target heuristics and tactical card play
- round advancement with supply escalation
- objective control by current supply at end of round
- round-end VP scoring and game winner on VP
- mission-card scoring framework (windows, specific marker scoring, instant-win checks)
- effect/modifier engine with timing hooks, duration tracking, and priority-based modifier stacking
- tactical cards playable from the UI during valid phases (including faction package cards)
- terrain interaction: impassable blockers, ranged cover defense bonuses, and difficult-terrain movement cost through cover
- optional Grid Mode for quick practice (1 square = 1 inch movement, snapped destinations)
- validation harness tests for matchup sanity, mission scoring cadence, and edge-case scenarios

## Known limitations / still in progress

- full Assault Phase action set (currently Run + Hold + Ranged declaration + Charge declaration)
- full Combat Phase action set (combat queue is now interactive, but reactions/step detail are still streamlined)
- faction cards (modifier hooks are now in place)
- larger tactical card library and faction-specific card identities
- richer terrain rule variety beyond current impassable + difficult cover movement
- advanced melee pile-in/consolidation tactics (basic movement hooks are now in place)
- additional reserve-arrival abilities beyond the current deep strike exception

## How the board works

- the source of truth is continuous inches, not square occupancy
- the SVG grid is visual only
- movement uses a straight-line path in this build
- non-leading models are auto-set around the leading model

### Grid Mode policy

- Grid Mode is a **practice-only variant** for quick playtests.
- Baseline balance and rules validation should be treated as continuous-inch mode first.

## Default skirmish setup

- Terran package: Jim Raynor, Marine T2, Marauder T1 ×3, Medic T1 with cards Barracks (Proxy), Academy, Orbital Command.
- Zerg package: Kerrigan, Raptor (Zergling) T2, Roach T3, Zergling T3, Zergling T2 with cards Lair, Evolution Chamber, Roach Warren, Malignant Creep.

## Structure

- `data/` holds declarative unit, mission, and deployment data (including mission scoring windows and setup variants)
- `engine/` holds state, supply, activation, movement, deployment, and legality logic
- `ui/` renders the board and panels
- `ai/` picks from the same action system as the player

## Suggested next engineering steps

Build out card timing + tactical depth next:

1. card timing hooks
2. event-driven modifier pipeline (basic event-expiry hooks now in place)
3. melee pile-in/consolidation movement
4. advanced charge reactions/overwatch (basic overwatch response hook now in place)
5. faction + tactical card content

For the maintained backlog and execution order, see `MASTER_TODO.md`.
