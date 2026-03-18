/**
 * RoutableEdge.jsx — Orthogonal edge routing
 *
 * ROUTING RULES (from user spec):
 *   - Always exit the source node straight DOWN from its bottom handle.
 *   - Always enter the target node straight UP into its top handle.
 *   - When nodes are offset horizontally, ONE horizontal jog at the midpoint Y
 *     between source and target — making a clean Z/S shape.
 *   - When nodes are vertically aligned (|dx| < 10), draw a straight vertical line.
 *   - Backward edges (target above source) wrap around the outside with a U-route.
 *   - Decision exit edges from side handles: horizontal out → corner → vertical down.
 *
 * MANUAL ROUTING:
 *   Auto-route is computed live every render from live source/target positions.
 *   When the user drags a segment, waypoints are stored and `manualRoute: true` is set.
 *   Edges with `manualRoute` use stored waypoints (with anchoring) instead of auto-route.
 *   Deleting stored waypoints (or clearing manualRoute) restores auto-route.
 */

import { useRef, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { OUTCOME_COLORS } from '../../lib/outcomeColors.js';

const NODE_WIDTH = 240;

// ── Orthogonal path builder ────────────────────────────────────────────────────

/**
 * Build visible points + segment metadata from an array of bend points.
 * Between any two consecutive points, inserts an auto-generated intermediate
 * point to make the polyline fully orthogonal (no diagonal segments).
 */
function buildOrthogonalRoute(src, waypoints, tgt) {
  const inp = [src, ...waypoints, tgt];
  const vpts = [src];
  const segIns = [];
  const vpOrigins = [{ type: 'src' }];

  for (let i = 1; i < inp.length; i++) {
    const prev = inp[i - 1];
    const curr = inp[i];
    const ins = i - 1;
    const isOnly = inp.length === 2;
    const isLast = i === inp.length - 1;

    const currOrigin = isLast
      ? { type: 'tgt' }
      : { type: 'wp', idx: i - 1 };

    if (Math.abs(prev.x - curr.x) < 0.5 || Math.abs(prev.y - curr.y) < 0.5) {
      // Already aligned — straight segment
      vpts.push(curr);
      segIns.push(ins);
      vpOrigins.push(currOrigin);
    } else if (isOnly) {
      // Direct diagonal — insert Z-bend at midY
      const midY = (prev.y + curr.y) / 2;
      vpts.push({ x: prev.x, y: midY }); segIns.push(ins); vpOrigins.push({ type: 'auto' });
      vpts.push({ x: curr.x, y: midY }); segIns.push(ins); vpOrigins.push({ type: 'auto' });
      vpts.push(curr);                    segIns.push(ins); vpOrigins.push(currOrigin);
    } else if (isLast) {
      vpts.push({ x: curr.x, y: prev.y }); segIns.push(ins); vpOrigins.push({ type: 'auto' });
      vpts.push(curr);                      segIns.push(ins); vpOrigins.push(currOrigin);
    } else {
      vpts.push({ x: prev.x, y: curr.y }); segIns.push(ins); vpOrigins.push({ type: 'auto' });
      vpts.push(curr);                      segIns.push(ins); vpOrigins.push(currOrigin);
    }
  }

  const segments = [];
  for (let i = 0; i < vpts.length - 1; i++) {
    const a = vpts[i];
    const b = vpts[i + 1];
    segments.push({
      a,
      b,
      mid:       { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      insertIdx: segIns[i],
      isH:       Math.abs(a.y - b.y) < 0.5,
      aOrigin:   vpOrigins[i],
      bOrigin:   vpOrigins[i + 1],
    });
  }

  return { visiblePoints: vpts, segments };
}

/**
 * Compute waypoints for a backward (upward) U-route.
 * Routes left or right based on where the source is relative to diagram center.
 */
function computeBackwardWaypoints(src, tgt, allNodes) {
  const DROP = 40;
  const PAD  = 60;

  let leftBound  =  Infinity;
  let rightBound = -Infinity;
  for (const n of allNodes) {
    const x = n.position?.x ?? 0;
    leftBound  = Math.min(leftBound,  x);
    rightBound = Math.max(rightBound, x + NODE_WIDTH);
  }
  if (!isFinite(leftBound))  leftBound  = Math.min(src.x, tgt.x);
  if (!isFinite(rightBound)) rightBound = Math.max(src.x, tgt.x) + NODE_WIDTH;

  const centerX = (leftBound + rightBound) / 2;
  const goRight = src.x > centerX;
  const sideX   = goRight ? rightBound + PAD : leftBound - PAD;

  return [
    { x: src.x, y: src.y + DROP },
    { x: sideX, y: src.y + DROP },
    { x: sideX, y: tgt.y - DROP },
    { x: tgt.x, y: tgt.y - DROP },
  ];
}

/**
 * Compute the automatic route for an edge.
 * Returns waypoints (bend points between source and target).
 * These are NOT stored — recomputed live every render.
 *
 * Rules:
 *   Forward aligned   → [] (straight vertical)
 *   Forward offset    → Z-bend: [{src.x, midY}, {tgt.x, midY}]
 *   Decision exit fwd → L-bend: [{tgt.x, src.y}] (horizontal out, vertical down)
 *   Backward          → U-bend: 4-point wrap around side
 */
function computeAutoRoute(src, tgt, data, allNodes) {
  const isBackward     = tgt.y < src.y - 30;
  const isSideways     = Math.abs(src.x - tgt.x) > 10;
  const isDecisionExit = data?.isDecisionExit === true;

  if (isBackward) {
    return computeBackwardWaypoints(src, tgt, allNodes);
  }

  if (isDecisionExit && isSideways) {
    // Side handle → horizontal to target X → vertical down into target
    return [{ x: tgt.x, y: src.y }];
  }

  if (isSideways) {
    // Standard forward Z-bend — one horizontal jog at midY
    const midY = (src.y + tgt.y) / 2;
    return [
      { x: src.x, y: midY },
      { x: tgt.x, y: midY },
    ];
  }

  return []; // Straight vertical line
}

/** SVG "M … L … L …" from an array of {x,y} */
function pointsToSvg(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RoutableEdge({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourceHandle,
  data,
  style,
  markerEnd,
  selected,
}) {
  const { getNodes, screenToFlowPosition } = useReactFlow();
  const smId      = useDiagramStore(s => s.activeSmId);
  const updateWP  = useDiagramStore(s => s.updateEdgeWaypoints);
  const pushHistory = useDiagramStore(s => s._pushHistory);

  const storedWaypoints = Array.isArray(data?.waypoints) ? data.waypoints : [];
  const isManual = data?.manualRoute === true && storedWaypoints.length > 0;

  const src = { x: sourceX, y: sourceY };
  const tgt = { x: targetX, y: targetY };

  // ── Determine waypoints to use ─────────────────────────────────────────────
  // Manual route: apply anchoring to keep first/last wps tracking src/tgt X.
  // Auto route:   compute live from current positions — always correct, never stale.
  let routeWps;
  if (isManual) {
    const isDecExit     = data?.isDecisionExit === true;
    const isBackwardEdge = targetY < sourceY - 30;
    routeWps = storedWaypoints.map((wp, i) => {
      if (isDecExit && !isBackwardEdge) {
        // Decision exit manual: keep corner at targetX, sourceY level
        if (i === 0) return { ...wp, x: targetX, y: sourceY };
        if (i === storedWaypoints.length - 1) return { ...wp, x: targetX };
        return wp;
      }
      // Standard: first wp tracks sourceX, last tracks targetX
      if (i === 0)                           return { ...wp, x: sourceX };
      if (i === storedWaypoints.length - 1)  return { ...wp, x: targetX };
      return wp;
    });
  } else {
    routeWps = computeAutoRoute(src, tgt, data, getNodes());
  }

  const { visiblePoints, segments } = buildOrthogonalRoute(src, routeWps, tgt);
  const pathD = pointsToSvg(visiblePoints);

  // ── Fresh waypoints from store for drag operations ─────────────────────────
  const freshWps = useCallback(() => {
    const st = useDiagramStore.getState();
    const currentSm = (st.project?.stateMachines ?? []).find(s => s.id === smId);
    const edge = (currentSm?.edges ?? []).find(e => e.id === id);
    const wps = edge?.data?.waypoints;
    return Array.isArray(wps) ? [...wps] : [];
  }, [smId, id]);

  // ── Segment drag — materializes manual waypoints on first drag ─────────────
  const onSegmentMouseDown = useCallback((e, seg, segIdx) => {
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    const startX = e.clientX;
    const startY = e.clientY;

    // If not yet manual, initialize stored waypoints from the current auto-route
    const initWps = isManual ? freshWps() : routeWps.map(p => ({ ...p }));
    let hasSaved = false;

    function onMove(ev) {
      const flow0 = screenToFlowPosition({ x: startX, y: startY });
      const flow1 = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = flow1.x - flow0.x;
      const dy = flow1.y - flow0.y;
      const wps = initWps.map(w => ({ ...w }));

      if (seg.isH) {
        // Horizontal segment → drag vertically
        const aIdx = seg.aOrigin?.type === 'wp' ? seg.aOrigin.idx
          : (segIdx === 0 ? null : seg.aOrigin?.type === 'auto' ? Math.max(0, segIdx - 1) : null);
        const bIdx = seg.bOrigin?.type === 'wp' ? seg.bOrigin.idx
          : (segIdx < wps.length - 1 ? seg.bOrigin?.type === 'auto' ? Math.min(wps.length - 1, segIdx) : null : null);
        if (aIdx != null && aIdx < wps.length) wps[aIdx] = { ...wps[aIdx], y: initWps[aIdx].y + dy };
        if (bIdx != null && bIdx < wps.length && bIdx !== aIdx) wps[bIdx] = { ...wps[bIdx], y: initWps[bIdx].y + dy };
      } else {
        // Vertical segment → drag horizontally
        const aIdx = seg.aOrigin?.type === 'wp' ? seg.aOrigin.idx : null;
        const bIdx = seg.bOrigin?.type === 'wp' ? seg.bOrigin.idx : null;
        if (aIdx != null && aIdx < wps.length) wps[aIdx] = { ...wps[aIdx], x: initWps[aIdx].x + dx };
        if (bIdx != null && bIdx < wps.length && bIdx !== aIdx) wps[bIdx] = { ...wps[bIdx], x: initWps[bIdx].x + dx };
      }

      // Save as manual on first actual movement
      if (!hasSaved) { hasSaved = true; }
      updateWP(smId, id, wps, true /* manualRoute */);
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [smId, id, screenToFlowPosition, updateWP, freshWps, pushHistory, isManual, routeWps]);

  // ── Styles ──────────────────────────────────────────────────────────────────
  const strokeColor = selected ? '#0072B5' : (style?.stroke ?? '#6b7280');
  const strokeW     = selected ? 3 : (style?.strokeWidth ?? 2);

  // ── Label helpers ──────────────────────────────────────────────────────────
  const isBackward     = targetY < sourceY - 30;
  const isSidewaysEdge = Math.abs(sourceX - targetX) > 10;

  return (
    <>
      {/* Fat invisible hit area */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke' }}
      />

      {/* Visible orthogonal path */}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeW}
        markerEnd={markerEnd}
        style={{ pointerEvents: 'none' }}
      />

      {/* Decision exit label pill */}
      {data?.isDecisionExit && data?.outcomeLabel && (() => {
        const isPass    = data.exitColor === 'pass';
        const isSingle  = data.exitColor === 'single';
        const bgColor   = isSingle ? '#6b7280' : isPass ? '#16a34a' : '#dc2626';
        const labelText = data.outcomeLabel;
        const charW     = 6.5;
        const pillW     = Math.max(80, labelText.length * charW + 20);

        if (!isBackward && !isSidewaysEdge) {
          // Straight down (single-exit from bottom): horizontal pill at midpoint
          const midX = (sourceX + targetX) / 2;
          const midY = (sourceY + targetY) / 2;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={midX - pillW / 2} y={midY - 10} width={pillW} height={20} rx={10} fill={bgColor} opacity={0.9} />
              <text x={midX} y={midY} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" style={{ userSelect: 'none' }}>{labelText}</text>
            </g>
          );
        }

        if (!isBackward && isSidewaysEdge) {
          // Sideways forward: label on the vertical drop segment
          // Vertical drop is at targetX, runs from sourceY to targetY — always use live positions
          const labelX = targetX;
          const labelY = (sourceY + targetY) / 2;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={labelX - 10} y={labelY - pillW / 2} width={20} height={pillW} rx={10} fill={bgColor} opacity={0.9} />
              <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" transform={`rotate(-90, ${labelX}, ${labelY})`} style={{ userSelect: 'none' }}>{labelText}</text>
            </g>
          );
        }

        // Backward: find the longest vertical segment (outer side of U)
        let labelSeg = segments[segments.length - 1];
        let bestLen  = 0;
        for (const seg of segments) {
          if (!seg.isH) {
            const len = Math.abs(seg.b.y - seg.a.y);
            if (len > bestLen) { bestLen = len; labelSeg = seg; }
          }
        }
        return (
          <g style={{ pointerEvents: 'none' }}>
            <rect x={labelSeg.mid.x - 10} y={labelSeg.mid.y - pillW / 2} width={20} height={pillW} rx={10} fill={bgColor} opacity={0.9} />
            <text x={labelSeg.mid.x} y={labelSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" transform={`rotate(-90, ${labelSeg.mid.x}, ${labelSeg.mid.y})`} style={{ userSelect: 'none' }}>{labelText}</text>
          </g>
        );
      })()}

      {/* Outcome label for branching edges (CheckResults + VisionInspect) — skip if already rendered as decision exit pill */}
      {(data?.conditionType === 'checkResult' || data?.conditionType === 'visionResult') && data?.outcomeLabel && !data?.isDecisionExit && segments.length > 0 && (() => {
        const isBack = isBackward && segments.length >= 3;
        let labelSeg;
        if (isBack) {
          let bestIdx = 1, bestLen = 0;
          for (let si = 0; si < segments.length; si++) {
            const s = segments[si];
            if (!s.isH) {
              const len = Math.abs(s.b.y - s.a.y);
              if (len > bestLen) { bestLen = len; bestIdx = si; }
            }
          }
          labelSeg = segments[bestIdx];
        } else {
          labelSeg = segments.length > 1 ? segments[1] : segments[0];
        }

        const outcomeIdx = data.outcomeIndex ?? 0;
        const bgColor    = OUTCOME_COLORS[outcomeIdx % OUTCOME_COLORS.length];
        const labelText  = data.outcomeLabel;
        const charW      = 6.5;
        const pillW      = Math.max(80, labelText.length * charW + 20);
        const isVert     = !labelSeg.isH && isBack;

        return (
          <g style={{ pointerEvents: 'none' }}>
            {isVert ? (
              <>
                <rect x={labelSeg.mid.x - 10} y={labelSeg.mid.y - pillW / 2} width={20} height={pillW} rx={10} fill={bgColor} opacity={0.9} />
                <text x={labelSeg.mid.x} y={labelSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" transform={`rotate(-90, ${labelSeg.mid.x}, ${labelSeg.mid.y})`} style={{ userSelect: 'none' }}>{labelText}</text>
              </>
            ) : (
              <>
                <rect x={labelSeg.mid.x - pillW / 2} y={labelSeg.mid.y - 10} width={pillW} height={20} rx={10} fill={bgColor} opacity={0.9} />
                <text x={labelSeg.mid.x} y={labelSeg.mid.y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={11} fontWeight="600" style={{ userSelect: 'none' }}>{labelText}</text>
              </>
            )}
          </g>
        );
      })()}

      {/* Segment drag overlays — show on selected edges (manual or auto) */}
      {selected && segments.map((seg, i) => {
        // Only drag segments that touch a waypoint (manual) OR any segment of auto-route
        const isDraggable = isManual
          ? (seg.aOrigin?.type === 'wp' || seg.bOrigin?.type === 'wp')
          : true; // auto-route: all segments are draggable (materializes on first drag)
        if (!isDraggable) return null;

        const cursor  = seg.isH ? 'ns-resize' : 'ew-resize';
        const segPath = `M ${seg.a.x} ${seg.a.y} L ${seg.b.x} ${seg.b.y}`;
        return (
          <path
            key={`seg-${i}`}
            d={segPath}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ cursor, pointerEvents: 'stroke' }}
            onMouseDown={(e) => onSegmentMouseDown(e, seg, i)}
          />
        );
      })}
    </>
  );
}
