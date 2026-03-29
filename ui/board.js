import { getObjectiveControlSnapshot } from "../engine/objectives.js";
import { pathLength, pathTravelCost, gridDistance, distance } from "../engine/geometry.js";
import { canTargetWithRangedWeapon, getLeaderPoint, getLongRangeValue, hasLineOfSight } from "../engine/visibility.js";
import { getEffectiveRangedRange } from "../engine/support.js";
import { validateMove, validateDisengage } from "../engine/movement.js";
import { validateRun } from "../engine/assault.js";
import { validateDeploy } from "../engine/deployment.js";
import { validatePlaceForceField } from "../engine/force_fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}) {
  const e = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

function ownerClass(playerId) { return playerId === "playerA" ? "playerA" : "playerB"; }

function snap(model) {
  return { x: Math.round(model.x) - 0.5, y: Math.round(model.y) - 0.5 };
}

function aliveCount(unit) {
  return unit.modelIds.filter(id => unit.models[id].alive).length;
}

/* ── Board layers ── */

function addGrid(svg, w, h) {
  for (let x = 0; x <= w; x++) svg.appendChild(el("line", { x1: x, y1: 0, x2: x, y2: h, class: x === w / 2 ? "board-centerline" : "board-grid-line" }));
  for (let y = 0; y <= h; y++) svg.appendChild(el("line", { x1: 0, y1: y, x2: w, y2: y, class: y === h / 2 ? "board-centerline" : "board-grid-line" }));
}

function addZones(svg, state) {
  const d = state.deployment.zoneOfInfluenceDepth;
  svg.append(
    el("rect", { x: 0, y: 0, width: d, height: state.board.heightInches, class: "edge-zone playerA" }),
    el("rect", { x: state.board.widthInches - d, y: 0, width: d, height: state.board.heightInches, class: "edge-zone playerB" })
  );
}

function addTerrain(svg, terrain) {
  for (const p of terrain) {
    const klass = p.kind === "force_field" ? "terrain-force-field" : p.impassable ? "terrain-block" : "terrain-cover";
    svg.appendChild(el("rect", {
      x: p.rect.minX, y: p.rect.minY,
      width: p.rect.maxX - p.rect.minX, height: p.rect.maxY - p.rect.minY,
      class: klass
    }));
  }
}

function addObjectives(svg, objectives, snapshot, uiState, handlers) {
  for (const obj of objectives) {
    const r = snapshot[obj.id];
    let cls = "objective-ring neutral";
    if (r?.contested) cls = "objective-ring contested";
    if (r?.controller === "playerA") cls = "objective-ring playerA";
    if (r?.controller === "playerB") cls = "objective-ring playerB";
    const isFocused = uiState.hoveredObjectiveId === obj.id || uiState.selectedObjectiveId === obj.id;
    const marker = el("circle", {
      cx: obj.x,
      cy: obj.y,
      r: 0.75,
      class: `objective-marker ${isFocused ? "focused" : ""}`
    });
    const ring = el("circle", {
      cx: obj.x,
      cy: obj.y,
      r: 2,
      class: `${cls} ${isFocused ? "focused" : ""}`
    });
    for (const node of [ring, marker]) {
      node.addEventListener("mouseenter", () => handlers.onObjectiveHover?.(obj.id));
      node.addEventListener("mouseleave", () => handlers.onObjectiveHover?.(null));
      node.addEventListener("click", event => {
        event.stopPropagation();
        handlers.onObjectiveClick?.(obj.id);
      });
    }
    svg.appendChild(marker);
    svg.appendChild(ring);
  }
}

function getObjectiveTeachingState(state, objective, result) {
  const nearbyUnits = Object.values(state.units)
    .filter(unit => unit.status.location === "battlefield")
    .map(unit => {
      const leader = getLeaderPoint(unit);
      if (!leader) return null;
      const objectiveDistance = distance(leader, objective);
      if (objectiveDistance > 3.01) return null;
      return {
        unit,
        distance: objectiveDistance
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  const blueUnits = nearbyUnits.filter(entry => entry.unit.owner === "playerA");
  const redUnits = nearbyUnits.filter(entry => entry.unit.owner === "playerB");
  const blueSupply = result?.playerASupply ?? 0;
  const redSupply = result?.playerBSupply ?? 0;
  const controller = result?.controller ? (result.controller === "playerA" ? "Blue" : "Red") : "No one";
  const margin = Math.abs(blueSupply - redSupply);
  let title = `${objective.id.toUpperCase()} Control Check`;
  let reason = `${controller} currently controls this objective because the nearby supply is ${blueSupply} for Blue versus ${redSupply} for Red.`;
  let teaching = result?.contested
    ? "This marker is contested, so neither player has clean control until one side removes supply or leaves the circle."
    : result?.controller
      ? `To flip this objective, the other side needs to overcome a ${margin} supply gap inside the 3\" control area.`
      : "No side has established control yet, so the next unit to add clear supply pressure here can swing scoring.";
  if (blueSupply === redSupply && blueSupply > 0) {
    reason = `Both sides have ${blueSupply} supply within 3", so this objective is tied up and no one controls it cleanly.`;
  } else if (!nearbyUnits.length) {
    reason = "No battlefield unit is currently within 3\" of this objective, so it is uncontrolled.";
    teaching = "Move a unit into the 3\" control area to start scoring pressure here.";
  }
  const metrics = [
    `${controller}${result?.contested ? " (contested)" : ""}`,
    `Blue ${blueSupply} supply`,
    `Red ${redSupply} supply`
  ];
  const contributors = nearbyUnits.slice(0, 4).map(entry => {
    const side = entry.unit.owner === "playerA" ? "Blue" : "Red";
    return `${side}: ${entry.unit.name} (${entry.unit.currentSupplyValue} SP at ${entry.distance.toFixed(1)}")`;
  });
  if (!contributors.length) {
    contributors.push("No units are close enough to contest this objective right now.");
  }
  return {
    title,
    reason,
    teaching,
    metrics,
    contributors
  };
}

function addPathPreview(svg, preview) {
  if (!preview?.path || preview.path.length < 2) return;
  const d = preview.path.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  svg.appendChild(el("path", { d, class: "path-preview" }));
  const total = pathLength(preview.path);
  if (total <= 0.01) return;
  const cost = preview.state?.rules?.gridMode
    ? gridDistance(preview.path[0], preview.path[preview.path.length - 1])
    : preview.state?.board?.terrain
      ? pathTravelCost(preview.path, preview.state.board.terrain) : total;
  const s = preview.path[0], e = preview.path[preview.path.length - 1];
  const label = el("text", { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 - 0.45, class: "path-preview-label" });
  label.textContent = preview.state?.rules?.gridMode
    ? `${cost.toFixed(0)} sq`
    : cost - total > 0.05 ? `${total.toFixed(1)}" (cost ${cost.toFixed(1)}")` : `${total.toFixed(1)}"`;
  svg.appendChild(label);
}

function addSelection(svg, state, uiState) {
  if (!uiState.selectedUnitId) return;
  const unit = state.units[uiState.selectedUnitId];
  if (!unit || unit.status.location !== "battlefield") return;
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null) return;
  const sq = snap(leader);
  svg.appendChild(el("rect", {
    x: sq.x - 0.15, y: sq.y - 0.15, width: 1.3, height: 1.3, rx: 0.15,
    class: "selection-ring"
  }));
}

function getFocusedCombatQueueEntry(state, uiState) {
  const index = uiState.hoveredCombatQueueIndex ?? uiState.selectedCombatQueueIndex;
  if (index == null) return null;
  const entry = state.combatQueue[index];
  if (!entry) return null;
  const attacker = state.units[entry.attackerId];
  const defender = state.units[entry.targetId];
  if (!attacker || !defender) return null;
  const attackerPoint = getLeaderPoint(attacker);
  const defenderPoint = getLeaderPoint(defender);
  if (!attackerPoint || !defenderPoint) return null;
  const isCharge = entry.type === "charge_attack";
  const weaponPool = isCharge ? attacker.meleeWeapons : attacker.rangedWeapons;
  const weapon = weaponPool?.find(candidate => candidate.id === entry.weaponId) ?? weaponPool?.[0] ?? null;
  const distanceToTarget = distance(attackerPoint, defenderPoint);
  return { index, entry, attacker, defender, attackerPoint, defenderPoint, weapon, isCharge, distanceToTarget };
}

function addCombatQueuePreview(svg, state, uiState) {
  const focus = getFocusedCombatQueueEntry(state, uiState);
  if (!focus) return;
  const attackerSq = snap(state.units[focus.attacker.id].models[focus.attacker.leadingModelId]);
  const defenderSq = snap(state.units[focus.defender.id].models[focus.defender.leadingModelId]);
  svg.appendChild(el("rect", {
    x: attackerSq.x - 0.18,
    y: attackerSq.y - 0.18,
    width: 1.36,
    height: 1.36,
    rx: 0.15,
    class: "queue-focus-ring attacker"
  }));
  svg.appendChild(el("rect", {
    x: defenderSq.x - 0.18,
    y: defenderSq.y - 0.18,
    width: 1.36,
    height: 1.36,
    rx: 0.15,
    class: "queue-focus-ring defender"
  }));
  svg.appendChild(el("line", {
    x1: focus.attackerPoint.x,
    y1: focus.attackerPoint.y,
    x2: focus.defenderPoint.x,
    y2: focus.defenderPoint.y,
    class: `queue-preview-line ${focus.isCharge ? "charge" : "ranged"}`
  }));
  const midpoint = {
    x: (focus.attackerPoint.x + focus.defenderPoint.x) / 2,
    y: (focus.attackerPoint.y + focus.defenderPoint.y) / 2
  };
  const label = el("text", {
    x: midpoint.x,
    y: midpoint.y - 0.3,
    class: "queue-preview-label"
  });
  label.textContent = `#${focus.index + 1} ${focus.isCharge ? "Charge" : "Shot"} ${focus.distanceToTarget.toFixed(1)}"`;
  svg.appendChild(label);
  const ringRadius = focus.isCharge
    ? 8
    : Math.max(focus.weapon?.rangeInches ?? 0, focus.weapon?.longRangeInches ?? focus.weapon?.longRange ?? 0);
  if (ringRadius > 0) {
    svg.appendChild(el("circle", {
      cx: focus.attackerPoint.x,
      cy: focus.attackerPoint.y,
      r: ringRadius,
      class: `range-ring queue-preview ${focus.isCharge ? "charge" : "ranged"}`
    }));
  }
}

function addAftermathHighlights(svg, state, uiState) {
  const highlights = uiState.boardHighlights ?? [];
  if (!highlights.length) return;
  const now = Date.now();
  for (const highlight of highlights) {
    if ((highlight.startsAt ?? 0) > now) continue;
    if (highlight.kind === "unit") {
      const unit = state.units[highlight.unitId];
      const point = highlight.point ?? (unit ? getLeaderPoint(unit) : null);
      if (!point) continue;
      svg.appendChild(el("circle", {
        cx: point.x,
        cy: point.y,
        r: highlight.tone === "destroyed" ? 1.14 : 0.92,
        class: `aftermath-ring ${highlight.tone ?? "attention"}`
      }));
      if (highlight.tone === "destroyed") {
        svg.appendChild(el("line", {
          x1: point.x - 0.62,
          y1: point.y - 0.62,
          x2: point.x + 0.62,
          y2: point.y + 0.62,
          class: "aftermath-cross"
        }));
        svg.appendChild(el("line", {
          x1: point.x + 0.62,
          y1: point.y - 0.62,
          x2: point.x - 0.62,
          y2: point.y + 0.62,
          class: "aftermath-cross"
        }));
      }
      const label = el("text", {
        x: point.x,
        y: point.y - (highlight.tone === "destroyed" ? 1.18 : 0.95),
        class: `aftermath-label ${highlight.tone ?? "attention"}`
      });
      label.textContent = highlight.label ?? "Update";
      svg.appendChild(label);
      continue;
    }
    if (highlight.kind === "objective") {
      const objective = state.deployment.missionMarkers.find(marker => marker.id === highlight.objectiveId);
      if (!objective) continue;
      svg.appendChild(el("circle", {
        cx: objective.x,
        cy: objective.y,
        r: 2.42,
        class: `aftermath-ring objective ${highlight.tone ?? "score"}`
      }));
      const label = el("text", {
        x: objective.x,
        y: objective.y - 2.7,
        class: `aftermath-label ${highlight.tone ?? "score"}`
      });
      label.textContent = highlight.label ?? "Objective";
      svg.appendChild(label);
    }
  }
}

/* ── Preview: single ghost block ── */
function addPreviewUnit(svg, state, uiState) {
  if (!uiState.previewUnit) return;
  const { leader } = uiState.previewUnit;
  const previewState = getPreviewOverlayState(state, uiState);
  if (uiState.previewUnit.kind === "force_field") {
    svg.appendChild(el("rect", {
      x: leader.x - 0.5, y: leader.y - 0.5, width: 1, height: 1, rx: 0.12,
      class: `force-field-preview ${previewState?.ok === false ? "invalid" : "valid"}`
    }));
    return;
  }
  const unit = state.units[uiState.previewUnit.unitId];
  if (!unit) return;
  const sq = { x: Math.round(leader.x) - 0.5, y: Math.round(leader.y) - 0.5 };
  svg.appendChild(el("rect", {
    x: sq.x, y: sq.y, width: 1, height: 1, rx: 0.12,
    class: `deploy-preview ${previewState?.ok === false ? "invalid" : "valid"}`
  }));
}

/* ── Legal destination overlay ── */
function addLegalOverlay(svg, state, uiState) {
  if (!uiState.selectedUnitId || !uiState.mode) return;
  const pts = uiState.legalDestinations ?? [];
  if (!pts.length) return;
  const g = el("g", { class: "legal-overlay" });
  for (const p of pts) {
    g.appendChild(el("rect", { x: p.x - 0.5, y: p.y - 0.5, width: 1, height: 1, class: "legal-square" }));
  }
  svg.appendChild(g);
}

/* ── Range rings ── */
function addRangeRings(svg, state, uiState) {
  if (!uiState.selectedUnitId) return;
  const unit = state.units[uiState.selectedUnitId];
  if (!unit || unit.owner !== "playerA" || unit.status.location !== "battlefield") return;
  const m = unit.models[unit.leadingModelId];
  if (!m || m.x == null) return;
  if (uiState.mode === "move" || uiState.mode === "run" || uiState.mode === "disengage") {
    svg.appendChild(el("circle", { cx: m.x, cy: m.y, r: unit.speed, class: "range-ring movement" }));
  }
  if (uiState.mode === "force_field") {
    svg.appendChild(el("circle", { cx: m.x, cy: m.y, r: 8, class: "range-ring support" }));
  }
  if (uiState.mode === "declare_ranged" && unit.rangedWeapons?.length) {
    const r = Math.max(...unit.rangedWeapons.map(w => w.rangeInches ?? 0));
    if (r > 0) svg.appendChild(el("circle", { cx: m.x, cy: m.y, r, class: "range-ring ranged" }));
  }
  if (uiState.mode === "declare_charge") {
    svg.appendChild(el("circle", { cx: m.x, cy: m.y, r: 8, class: "range-ring charge" }));
  }
}

/* ── Target highlights ── */
function addTargetHighlights(svg, state, uiState) {
  if (!uiState.selectedUnitId) return;
  if (uiState.mode !== "declare_ranged" && uiState.mode !== "declare_charge") return;
  const unit = state.units[uiState.selectedUnitId];
  if (!unit || unit.owner !== "playerA" || unit.status.location !== "battlefield") return;
  const lm = unit.models[unit.leadingModelId];
  if (!lm || lm.x == null) return;
  for (const t of Object.values(state.units)) {
    if (t.owner !== "playerB" || t.status.location !== "battlefield") continue;
    const tl = t.models[t.leadingModelId];
    if (!tl || tl.x == null) continue;
    const targeting = getTargetOverlayState(state, uiState, unit, t);
    if (!targeting) continue;
    const sq = snap(tl);
    svg.appendChild(el("rect", {
      x: sq.x - 0.2, y: sq.y - 0.2, width: 1.4, height: 1.4, rx: 0.15,
      class: `target-highlight ${targeting.ok ? "valid" : "invalid"} ${uiState.hoveredUnitId === t.id ? "hovered" : ""}`
    }));
    const label = el("text", {
      x: sq.x + 0.5,
      y: sq.y - 0.38,
      class: `target-status-label ${targeting.ok ? "valid" : "invalid"}`
    });
    label.textContent = targeting.ok ? "Valid" : "Blocked";
    svg.appendChild(label);
  }
}

function getRangedTargetOverlayState(state, attacker, target) {
  const weapon = attacker?.rangedWeapons?.[0] ?? null;
  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  if (!weapon || !attackerPoint || !targetPoint) return null;
  const maxRange = getEffectiveRangedRange(state, attacker, weapon) ?? getLongRangeValue(weapon) ?? weapon.rangeInches ?? 0;
  const targetDistance = distance(attackerPoint, targetPoint);
  if (targetDistance > maxRange + 1e-6) {
    return {
      ok: false,
      reason: `Out of range. ${weapon.name} reaches ${maxRange}" here, and this target is ${targetDistance.toFixed(1)}" away.`,
      distance: targetDistance,
      maxRange
    };
  }
  const targeting = canTargetWithRangedWeapon(state, attacker, target, weapon);
  const visible = hasLineOfSight(state, attacker, target);
  if (!targeting.ok) {
    return {
      ok: false,
      reason: targeting.reason,
      distance: targetDistance,
      maxRange,
      visible
    };
  }
  return {
    ok: true,
    reason: visible
      ? `Legal target. ${weapon.name} can reach ${targetDistance.toFixed(1)}" and line of sight is clear.`
      : `Legal target. ${weapon.name} can reach ${targetDistance.toFixed(1)}", and Indirect Fire is allowing the shot without line of sight.`,
    distance: targetDistance,
    maxRange,
    visible
  };
}

function getChargeTargetOverlayState(attacker, target) {
  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  if (!attackerPoint || !targetPoint) return null;
  const targetDistance = distance(attackerPoint, targetPoint);
  if (targetDistance > 8 + 1e-6) {
    return {
      ok: false,
      reason: `Outside charge declaration range. Charges must be declared within 8", and this target is ${targetDistance.toFixed(1)}" away.`,
      distance: targetDistance,
      maxRange: 8
    };
  }
  return {
    ok: true,
    reason: `Legal charge target. The declaration is within 8", then the actual charge roll will be Speed + 1D6 against the required distance.`,
    distance: targetDistance,
    maxRange: 8
  };
}

function getTargetOverlayState(state, uiState, attacker, target) {
  if (uiState.mode === "declare_ranged") return getRangedTargetOverlayState(state, attacker, target);
  if (uiState.mode === "declare_charge") return getChargeTargetOverlayState(attacker, target);
  return null;
}

function isFlyingUnit(unit) {
  return unit?.tags?.includes("Flying") || unit?.abilities?.includes("flying");
}

function getMovementMetrics(state, path) {
  if (!path?.length || path.length < 2) return null;
  const directDistance = pathLength(path);
  const travelCost = state.rules?.gridMode
    ? gridDistance(path[0], path[path.length - 1])
    : pathTravelCost(path, state.board.terrain);
  return { directDistance, travelCost };
}

function getPreviewOverlayState(state, uiState) {
  if (!uiState.selectedUnitId) return null;
  const unit = state.units[uiState.selectedUnitId];
  if (!unit || unit.owner !== "playerA") return null;

  if (uiState.mode === "move" || uiState.mode === "disengage" || uiState.mode === "run") {
    const path = uiState.previewPath?.path;
    if (!path?.length) return null;
    const metrics = getMovementMetrics(state, path);
    const validator = uiState.mode === "move"
      ? validateMove(state, "playerA", unit.id, unit.leadingModelId, path)
      : uiState.mode === "disengage"
        ? validateDisengage(state, "playerA", unit.id, unit.leadingModelId, path)
        : validateRun(state, "playerA", unit.id, unit.leadingModelId, path);
    const actionLabel = uiState.mode === "move" ? "Move" : uiState.mode === "disengage" ? "Disengage" : "Run";
    const movementNote = isFlyingUnit(unit)
      ? "Flying ignores blocked ground and normal enemy ground engagement when moving."
      : "Ground movement must respect terrain, bases, force fields, and enemy engagement distance.";
    return {
      ok: validator.ok,
      kicker: `${actionLabel} Check`,
      title: `${unit.name} → ${path[path.length - 1].x.toFixed(1)}", ${path[path.length - 1].y.toFixed(1)}"`,
      metrics: [
        metrics ? `${metrics.travelCost.toFixed(state.rules?.gridMode ? 0 : 1)}${state.rules?.gridMode ? " sq" : "\""} cost` : null,
        metrics && !state.rules?.gridMode && Math.abs(metrics.travelCost - metrics.directDistance) > 0.05
          ? `${metrics.directDistance.toFixed(1)}" straight-line`
          : null,
        validator.ok ? "Legal destination" : "Blocked destination"
      ].filter(Boolean),
      reason: validator.ok
        ? `${actionLabel} is legal here. ${movementNote}`
        : validator.message,
      teaching: validator.ok
        ? (uiState.mode === "disengage"
          ? "Disengage is the safe way to break out of melee, but the unit still needs enough movement to end clear."
          : uiState.mode === "run"
            ? "Run is mainly for repositioning in Assault. It gives extra distance but still follows movement-blocking rules."
            : "Normal Move is best for clean repositioning because it preserves future options and avoids melee penalties.")
        : null
    };
  }

  if (uiState.mode === "force_field") {
    const point = uiState.previewUnit?.leader;
    if (!point) return null;
    const validator = validatePlaceForceField(state, "playerA", unit.id, point);
    const leader = unit.models[unit.leadingModelId];
    return {
      ok: validator.ok,
      kicker: "Force Field Check",
      title: `${unit.name} → Force Field`,
      metrics: [
        leader?.x != null && leader?.y != null ? `${distance(leader, point).toFixed(1)}" from projector` : null,
        validator.ok ? "Legal placement" : "Blocked placement"
      ].filter(Boolean),
      reason: validator.ok
        ? "Legal placement. The token is within 8\", fully on the battlefield, and not overlapping other models or terrain."
        : validator.message,
      teaching: validator.ok
        ? "Smaller units will be blocked by this token, while size 3 or larger units can crash through and destroy it."
        : null
    };
  }

  if (uiState.mode === "deploy") {
    const path = uiState.previewPath?.path;
    const point = uiState.previewUnit?.leader;
    if (!path?.length || !point) return null;
    const entryPoint = path[0];
    const validator = validateDeploy(
      state,
      "playerA",
      unit.id,
      unit.leadingModelId,
      entryPoint,
      path,
      uiState.previewUnit.placements ?? null
    );
    const metrics = getMovementMetrics(state, path);
    return {
      ok: validator.ok,
      kicker: "Deploy Check",
      title: `${unit.name} → ${point.x.toFixed(1)}", ${point.y.toFixed(1)}"`,
      metrics: [
        metrics ? `${metrics.travelCost.toFixed(state.rules?.gridMode ? 0 : 1)}${state.rules?.gridMode ? " sq" : "\""} cost` : null,
        validator.ok ? "Legal deployment" : "Blocked deployment"
      ].filter(Boolean),
      reason: validator.ok
        ? "Legal deployment. The entry point, distance, and final position all satisfy the reserve rules for this unit."
        : validator.message,
      teaching: validator.ok
        ? "Deployment still follows movement limits from the entry point, so difficult ground and blocked landing spaces matter."
        : null
    };
  }

  return null;
}

function renderBattlefieldHint(state, uiState, handlers) {
  const hint = document.getElementById("battlefieldHint");
  if (!hint) return;
  const now = Date.now();
  const snapshot = getObjectiveControlSnapshot(state);
  const focusedObjectiveId = uiState.hoveredObjectiveId ?? uiState.selectedObjectiveId ?? null;
  const focusedQueueEntry = getFocusedCombatQueueEntry(state, uiState);
  if (!uiState.mode && focusedQueueEntry) {
    const weaponName = focusedQueueEntry.weapon?.name ?? (focusedQueueEntry.isCharge ? "melee attack" : "ranged attack");
    const likelyRules = [];
    if (focusedQueueEntry.entry.type === "overwatch_attack") likelyRules.push("Overwatch");
    if (focusedQueueEntry.isCharge) likelyRules.push("Charge", "Impact", "Fighting Rank");
    if (focusedQueueEntry.weapon?.keywords?.includes("surge") || focusedQueueEntry.weapon?.surge) likelyRules.push("Surge");
    if (focusedQueueEntry.weapon?.keywords?.includes("precision") || focusedQueueEntry.weapon?.precision) likelyRules.push("Precision");
    if (focusedQueueEntry.weapon?.keywords?.includes("burst_fire") || focusedQueueEntry.weapon?.burstFire) likelyRules.push("Burst Fire");
    hint.className = "battlefield-hint active neutral";
    hint.innerHTML = `
      <div class="battlefield-hint-kicker">Combat Queue Preview</div>
      <div class="battlefield-hint-title">#${focusedQueueEntry.index + 1} ${focusedQueueEntry.attacker.name} → ${focusedQueueEntry.defender.name}</div>
      <div class="battlefield-hint-metrics">
        <span>${focusedQueueEntry.entry.type === "charge_attack" ? "Charge attack" : focusedQueueEntry.entry.type === "overwatch_attack" ? "Overwatch attack" : "Ranged attack"}</span>
        <span>${focusedQueueEntry.distanceToTarget.toFixed(1)}" apart</span>
        <span>${weaponName}</span>
      </div>
      <div class="battlefield-hint-copy">${focusedQueueEntry.attacker.name} is already committed to attack ${focusedQueueEntry.defender.name} when this queue step resolves. The board preview shows who is involved and the lane between them.</div>
      <div class="battlefield-hint-copy secondary">${focusedQueueEntry.isCharge ? "Watch the charge lane first, then impact, melee ranks, and any overwatch or defensive reactions." : "Watch range, line of sight, and any attack keywords that will change how the shot converts into damage."}</div>
      <div class="battlefield-hint-copy secondary">${likelyRules.length ? `Likely rules in play: ${[...new Set(likelyRules)].join(", ")}.` : "This preview is here to show the committed attacker, target, and timing before dice are rolled."}</div>
    `;
    return;
  }
  if (!uiState.mode && focusedObjectiveId) {
    const objective = state.deployment.missionMarkers.find(marker => marker.id === focusedObjectiveId);
    if (objective) {
      const objectiveHint = getObjectiveTeachingState(state, objective, snapshot[objective.id]);
      const canDismiss = uiState.selectedObjectiveId === focusedObjectiveId;
      hint.className = "battlefield-hint active neutral";
      hint.innerHTML = `
        <div class="battlefield-hint-kicker">Objective Guide</div>
        <div class="battlefield-hint-head">
          <div class="battlefield-hint-title">${objectiveHint.title}</div>
          ${canDismiss ? '<button type="button" class="battlefield-hint-close" aria-label="Close objective guide">×</button>' : ""}
        </div>
        <div class="battlefield-hint-metrics">
          ${objectiveHint.metrics.map(metric => `<span>${metric}</span>`).join("")}
        </div>
        <div class="battlefield-hint-copy">${objectiveHint.reason}</div>
        <div class="battlefield-hint-copy secondary">${objectiveHint.teaching}</div>
        <div class="battlefield-hint-copy secondary">${objectiveHint.contributors.join(" • ")}</div>
      `;
      if (canDismiss) {
        hint.querySelector(".battlefield-hint-close")?.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          handlers?.onObjectiveClick?.(focusedObjectiveId);
        });
      }
      return;
    }
  }
  const aftermathNarrative = uiState.aftermathNarrative;
  if (
    !uiState.mode
    && !focusedObjectiveId
    && !focusedQueueEntry
    && aftermathNarrative
    && (aftermathNarrative.startsAt ?? 0) <= now
    && (aftermathNarrative.expiresAt ?? 0) > now
  ) {
    hint.className = "battlefield-hint active aftermath";
    hint.innerHTML = `
      <div class="battlefield-hint-kicker">Aftermath Sequence</div>
      <div class="battlefield-hint-title">${aftermathNarrative.title}</div>
      <div class="battlefield-hint-metrics">
        ${(aftermathNarrative.metrics ?? []).map(metric => `<span>${metric}</span>`).join("")}
      </div>
      <div class="battlefield-hint-copy">${aftermathNarrative.reason}</div>
      <div class="battlefield-hint-copy secondary">${aftermathNarrative.teaching}</div>
    `;
    return;
  }
  if (!uiState.selectedUnitId || !uiState.mode) {
    hint.className = "battlefield-hint";
    hint.innerHTML = "";
    return;
  }
  if (["move", "disengage", "run", "deploy", "force_field"].includes(uiState.mode)) {
    const previewState = getPreviewOverlayState(state, uiState);
    if (!previewState) {
      hint.className = "battlefield-hint active neutral";
      hint.innerHTML = `
        <div class="battlefield-hint-kicker">Battlefield Guide</div>
        <div class="battlefield-hint-title">Choose A Destination</div>
        <div class="battlefield-hint-copy">Move the cursor over the board to see whether that destination is legal and which movement rule is helping or blocking it.</div>
      `;
      return;
    }
    hint.className = `battlefield-hint active ${previewState.ok ? "valid" : "invalid"}`;
    hint.innerHTML = `
      <div class="battlefield-hint-kicker">${previewState.kicker}</div>
      <div class="battlefield-hint-title">${previewState.title}</div>
      <div class="battlefield-hint-metrics">
        ${previewState.metrics.map(metric => `<span>${metric}</span>`).join("")}
      </div>
      <div class="battlefield-hint-copy">${previewState.reason}</div>
      ${previewState.teaching ? `<div class="battlefield-hint-copy secondary">${previewState.teaching}</div>` : ""}
    `;
    return;
  }
  if (uiState.mode !== "declare_ranged" && uiState.mode !== "declare_charge") {
    hint.className = "battlefield-hint";
    hint.innerHTML = "";
    return;
  }
  const selected = state.units[uiState.selectedUnitId];
  const hovered = uiState.hoveredUnitId ? state.units[uiState.hoveredUnitId] : null;
  if (!selected || !hovered || hovered.owner !== "playerB") {
    const modeTitle = uiState.mode === "declare_ranged" ? "Choose A Ranged Target" : "Choose A Charge Target";
    const helper = uiState.mode === "declare_ranged"
      ? "Hover an enemy unit to see whether the shot is legal and which rule is helping or blocking it."
      : "Hover an enemy unit to see whether the charge can be declared and what the next roll will need to do.";
    hint.className = "battlefield-hint active neutral";
    hint.innerHTML = `
      <div class="battlefield-hint-kicker">Battlefield Guide</div>
      <div class="battlefield-hint-title">${modeTitle}</div>
      <div class="battlefield-hint-copy">${helper}</div>
    `;
    return;
  }
  const targeting = getTargetOverlayState(state, uiState, selected, hovered);
  if (!targeting) {
    hint.className = "battlefield-hint";
    hint.innerHTML = "";
    return;
  }
  hint.className = `battlefield-hint active ${targeting.ok ? "valid" : "invalid"}`;
  hint.innerHTML = `
    <div class="battlefield-hint-kicker">${uiState.mode === "declare_ranged" ? "Target Check" : "Charge Check"}</div>
    <div class="battlefield-hint-title">${selected.name} → ${hovered.name}</div>
    <div class="battlefield-hint-metrics">
      <span>${targeting.distance.toFixed(1)}" away</span>
      <span>${targeting.ok ? "Legal target" : "Blocked target"}</span>
    </div>
    <div class="battlefield-hint-copy">${targeting.reason}</div>
  `;
}

/* ── Unactivated indicators ── */
function addActivationIndicators(svg, state) {
  if (state.activePlayer !== "playerA") return;
  for (const unit of Object.values(state.units)) {
    if (unit.owner !== "playerA" || unit.status.location !== "battlefield") continue;
    const m = unit.models[unit.leadingModelId];
    if (!m || m.x == null) continue;
    const activated = state.phase === "movement" ? unit.status.movementActivated
      : state.phase === "assault" ? unit.status.assaultActivated
      : state.phase === "combat" ? unit.status.combatActivated : true;
    if (!activated) {
      const sq = snap(m);
      svg.appendChild(el("rect", {
        x: sq.x - 0.25, y: sq.y - 0.25, width: 1.5, height: 1.5, rx: 0.15, class: "needs-activation-ring"
      }));
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   SINGLE-BLOCK UNIT RENDERING
   One block per unit at the leader's grid position.
   Shows: abbreviated name, model count, supply.
   ══════════════════════════════════════════════════════════════ */

function abbreviateName(name) {
  // Short names stay. Long names get first word or initials.
  if (name.length <= 8) return name;
  const words = name.split(/[\s_-]+/);
  if (words.length === 1) return name.slice(0, 7);
  // First word if short, otherwise initials
  if (words[0].length <= 6) return words[0];
  return words.map(w => w[0]).join("").toUpperCase();
}

function addUnits(svg, state, uiState, onModelClick, onModelHover) {
  const gridMode = Boolean(state.rules?.gridMode);

  for (const unit of Object.values(state.units)) {
    if (unit.status.location !== "battlefield") continue;
    const leader = unit.models[unit.leadingModelId];
    if (!leader?.alive || leader.x == null) continue;

    const sq = snap(leader);
    const alive = aliveCount(unit);
    const owner = ownerClass(unit.owner);
    const isSelected = uiState.selectedUnitId === unit.id;
    const activated = state.phase === "movement" ? unit.status.movementActivated
      : state.phase === "assault" ? unit.status.assaultActivated
      : state.phase === "combat" ? unit.status.combatActivated : false;

    // Engagement ring (1" around the unit block)
    if (unit.tags.includes("Ground")) {
      svg.appendChild(el("circle", {
        cx: sq.x + 0.5, cy: sq.y + 0.5, r: 1.5, class: "engagement-ring"
      }));
    }

    // Unit block — single square
    const block = el("rect", {
      x: sq.x, y: sq.y, width: 1, height: 1, rx: 0.12, ry: 0.12,
      class: `unit-block ${owner} ${isSelected ? "selected" : ""} ${activated ? "activated" : ""}`,
      "data-unit-id": unit.id
    });
    block.addEventListener("click", event => {
      event.stopPropagation();
      onModelClick(unit.id, unit.leadingModelId);
    });
    block.addEventListener("mouseenter", () => onModelHover?.(unit.id));
    block.addEventListener("mouseleave", () => onModelHover?.(null));

    // Tooltip
    const title = el("title");
    const wpnInfo = unit.rangedWeapons?.length
      ? unit.rangedWeapons.map(w => `${w.name} ${w.rangeInches}" ${w.hitTarget}+`).join(", ")
      : unit.meleeWeapons?.length
        ? unit.meleeWeapons.map(w => `${w.name} ${w.hitTarget}+`).join(", ")
        : "No weapons";
    title.textContent = `${unit.name} (${unit.owner === "playerA" ? "You" : "Enemy"})\nSupply: ${unit.currentSupplyValue} | Speed: ${unit.speed} | Models: ${alive}/${unit.modelIds.length}\n${wpnInfo}${unit.status.engaged ? "\nENGAGED" : ""}`;
    block.appendChild(title);
    svg.appendChild(block);

    // Unit name — abbreviated, above the block
    const nameText = el("text", {
      x: sq.x + 0.5, y: sq.y - 0.12,
      class: `unit-label ${owner}`
    });
    nameText.textContent = abbreviateName(unit.name);
    svg.appendChild(nameText);

    // Model count + supply inside the block
    const infoText = el("text", {
      x: sq.x + 0.5, y: sq.y + 0.55,
      class: "unit-info-text"
    });
    infoText.textContent = `${alive}×${unit.currentSupplyValue}`;
    svg.appendChild(infoText);

    // Engaged indicator
    if (unit.status.engaged) {
      const engBadge = el("text", {
        x: sq.x + 0.5, y: sq.y + 1.25,
        class: "unit-engaged-badge"
      });
      engBadge.textContent = "ENG";
      svg.appendChild(engBadge);
    }
  }
}

export function screenToBoardPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const t = pt.matrixTransform(svg.getScreenCTM().inverse());
  const w = Number(svg.dataset.boardWidth ?? 36);
  const h = Number(svg.dataset.boardHeight ?? 36);
  return { x: Math.max(0, Math.min(w, t.x)), y: Math.max(0, Math.min(h, t.y)) };
}

export function renderLegalOverlay() {}
export function renderUnitGhost() {}

export function renderBoard(state, uiState, handlers) {
  const svg = document.getElementById("battlefield");
  svg.setAttribute("viewBox", `0 0 ${state.board.widthInches} ${state.board.heightInches}`);
  svg.dataset.boardWidth = String(state.board.widthInches);
  svg.dataset.boardHeight = String(state.board.heightInches);
  svg.innerHTML = "";
  const snap = getObjectiveControlSnapshot(state);
  addZones(svg, state);
  addGrid(svg, state.board.widthInches, state.board.heightInches);
  addTerrain(svg, state.board.terrain);
  addObjectives(svg, state.deployment.missionMarkers, snap, uiState, handlers);
  addLegalOverlay(svg, state, uiState);
  addActivationIndicators(svg, state);
  addRangeRings(svg, state, uiState);
  addTargetHighlights(svg, state, uiState);
  addCombatQueuePreview(svg, state, uiState);
  addAftermathHighlights(svg, state, uiState);
  addPathPreview(svg, uiState.previewPath);
  addSelection(svg, state, uiState);
  addPreviewUnit(svg, state, uiState);
  addUnits(svg, state, uiState, handlers.onModelClick, handlers.onModelHover);
  renderBattlefieldHint(state, uiState, handlers);

  svg.onclick = event => {
    const point = screenToBoardPoint(svg, event.clientX, event.clientY);
    handlers.onBoardClick(point);
  };
}
