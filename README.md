# StarCraft TMG Engine - Phase 1 Foundation

This build is a rules-first rewrite of the uploaded grid mockup.

## What is playable right now

- alternating activation in Movement, Assault, and placeholder Combat phases
- all units begin in reserves
- supply pool and available supply
- deployment from entry edges
- normal move for unengaged units
- disengage for engaged units
- Run in Assault Phase (prototype action)
- Declare Ranged Attack in Assault (targets nearest in-range enemy in this prototype)
- hold
- pass and first-player-marker handoff
- AI opponent for Movement and Assault action selection with objective-aware target heuristics
- round advancement with supply escalation
- objective control by current supply at end of round
- round-end VP scoring and game winner on VP
- mission-card scoring framework (windows, specific marker scoring, instant-win checks)
- effect/modifier engine with timing hooks, duration tracking, and priority-based modifier stacking
- tactical card engine foundations (`PLAY_CARD`) with two starter cards and timing-bound effects
- validation harness tests for matchup sanity, mission scoring cadence, and edge-case scenarios

## What is deliberately not finished yet

- full Assault Phase action set (currently Run + Hold + Ranged declaration + Charge declaration)
- full Combat Phase action set (currently ranged + charge/melee resolution with stochastic dice)
- faction cards (modifier hooks are now in place)
- tactical cards
- advanced terrain interactions
- advanced melee pile-in/consolidation tactics (basic movement hooks are now in place)
- reserve arrival exceptions from special abilities

## How the board works

- the source of truth is continuous inches, not square occupancy
- the SVG grid is visual only
- movement uses a straight-line path in this build
- non-leading models are auto-set around the leading model

## Structure

- `data/` holds declarative unit, mission, and deployment data (including mission scoring windows and setup variants)
- `engine/` holds state, supply, activation, movement, deployment, and legality logic
- `ui/` renders the board and panels
- `ai/` picks from the same action system as the player

## Suggested next step

Build out card timing + tactical depth next:

1. card timing hooks
2. event-driven modifier pipeline
3. melee pile-in/consolidation movement
4. advanced charge reactions/overwatch (basic overwatch response hook now in place)
5. faction + tactical card content
