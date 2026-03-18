/**
 * SDC State Logic Builder - Zustand Store
 * Central state management for all diagrams and UI state.
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import * as projectApi from '../lib/projectApi.js';

// Tiny ID generator (avoid nanoid async import issues)
let _id = Date.now();
const uid = () => `id_${(_id++).toString(36)}`;

// ─── Initial State ───────────────────────────────────────────────────────────

const defaultProject = {
  name: 'New Project',
  stateMachines: [],
  partTracking: { fields: [] },
  signals: [],
  recipes: [],           // [{ id, name, description, isDefault, customSequence }]
  recipeOverrides: {},    // { [recipeId]: { positions, timers, speeds, skippedNodes } }
};

// ─── Recipe-aware SM helpers ─────────────────────────────────────────────────
// These are defined outside the store so every action can reference them.

/** Return the correct SM array (base or custom) for the current recipe context. */
function _getSmArray(state) {
  const { activeRecipeId, project } = state;
  if (!activeRecipeId) return project.stateMachines ?? [];
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);
  if (!recipe?.customSequence) return project.stateMachines ?? [];
  const customSMs = project.recipeOverrides?.[activeRecipeId]?.customSMs;
  return customSMs ?? project.stateMachines ?? [];
}

/** Apply an updater function to the correct SM array and return the new project. */
function _updateProject(state, smsUpdater) {
  const { activeRecipeId, project } = state;
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);
  const isCustom = recipe?.customSequence && project.recipeOverrides?.[activeRecipeId]?.customSMs;

  if (isCustom) {
    const overrides = { ...project.recipeOverrides };
    const recipeOv = { ...overrides[activeRecipeId] };
    recipeOv.customSMs = smsUpdater(recipeOv.customSMs);
    overrides[activeRecipeId] = recipeOv;
    return { ...project, recipeOverrides: overrides };
  }
  return { ...project, stateMachines: smsUpdater(project.stateMachines ?? []) };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDiagramStore = create(
  subscribeWithSelector(
  persist(
    (set, get) => ({
      // ── Data ──────────────────────────────────────────────────────────────
      project: defaultProject,
      activeSmId: null,
      currentFilename: null,   // filename of the active project on the server
      serverAvailable: false,  // true when the project API server is detected

      // ── Recipe state ──────────────────────────────────────────────────────
      activeRecipeId: null,
      showRecipeManager: false,

      // ── UI State ──────────────────────────────────────────────────────────
      selectedNodeId: null,
      selectedEdgeId: null,

      // Modals
      showNewSmModal: false,
      showProjectManager: false,
      showAddDeviceModal: false,
      showEditDeviceModal: false,
      editDeviceId: null,
      showActionModal: false,
      actionModalNodeId: null,
      actionModalActionId: null, // null = add new, string = edit existing
      showTransitionModal: false,
      transitionModalEdgeId: null,
      pendingEdgeData: null, // used when connecting two nodes
      openPickerOnNodeId: null, // signals a node to auto-open its inline picker
      _closePickerSignal: 0,   // increment to close all inline pickers
      _isDrawingConnection: false, // true while user is dragging from a handle
      _drawingWaypoints: [],       // waypoints placed by clicking during connection

      // ── Computed helpers ──────────────────────────────────────────────────
      getActiveSm() {
        return _getSmArray(get()).find(sm => sm.id === get().activeSmId) ?? null;
      },

      getSmById(id) {
        return _getSmArray(get()).find(sm => sm.id === id) ?? null;
      },

      getSelectedNode() {
        const sm = get().getActiveSm();
        const id = get().selectedNodeId;
        if (!sm || !id) return null;
        return (sm.nodes ?? []).find(n => n.id === id) ?? null;
      },

      getSelectedEdge() {
        const sm = get().getActiveSm();
        const id = get().selectedEdgeId;
        if (!sm || !id) return null;
        return (sm.edges ?? []).find(e => e.id === id) ?? null;
      },

      // ── Undo / Redo ────────────────────────────────────────────────────────
      _past: [],     // snapshots before each mutation
      _future: [],   // snapshots after undo (cleared on new mutations)

      /** Capture current project state before a mutation. */
      _pushHistory() {
        const { project, _past } = get();
        const snapshot = JSON.stringify(project);
        const newPast = [..._past, snapshot];
        if (newPast.length > 50) newPast.shift();
        set({ _past: newPast, _future: [] });
      },

      undo() {
        const { _past, _future, project } = get();
        if (_past.length === 0) return;
        const newPast = [..._past];
        const previous = newPast.pop();
        const currentSnapshot = JSON.stringify(project);
        set({
          project: JSON.parse(previous),
          _past: newPast,
          _future: [currentSnapshot, ..._future],
        });
      },

      redo() {
        const { _past, _future, project } = get();
        if (_future.length === 0) return;
        const newFuture = [..._future];
        const next = newFuture.shift();
        const currentSnapshot = JSON.stringify(project);
        set({
          project: JSON.parse(next),
          _past: [..._past, currentSnapshot],
          _future: newFuture,
        });
      },

      // ── Project actions ───────────────────────────────────────────────────
      setProjectName(name) {
        get()._pushHistory();
        set(s => ({ project: { ...s.project, name } }));
      },

      loadProject(project) {
        // Ensure partTracking exists for older projects
        if (!project.partTracking) project.partTracking = { fields: [] };
        // Migrate referencePositions → signals (position type)
        if (!project.signals) {
          project.signals = [];
          // Convert legacy referencePositions to signals with type='position'
          for (const rp of (project.referencePositions ?? [])) {
            project.signals.push({
              id: rp.id,
              name: rp.name,
              description: rp.description ?? '',
              type: 'position',
              axes: (rp.axes ?? []).map(a => ({
                smId: a.smId,
                deviceId: a.axisDeviceId,
                deviceName: a.axisDeviceId,
                positionName: a.positionName,
                tolerance: a.tolerance,
              })),
            });
          }
          // Convert legacy smOutputs from each SM → signals with type='state'
          for (const sm of (project.stateMachines ?? [])) {
            for (const o of (sm.smOutputs ?? [])) {
              project.signals.push({
                id: o.id,
                name: o.name,
                description: o.description ?? '',
                type: 'state',
                smId: sm.id,
                stateNodeId: o.activeNodeId ?? null,
                stateName: o.name,
              });
            }
          }
        }
        // Remove legacy referencePositions field
        delete project.referencePositions;
        // Ensure recipe fields exist for older projects
        if (!project.recipes) project.recipes = [];
        if (!project.recipeOverrides) project.recipeOverrides = {};
        // Migration: remove legacy _autoVision Parameter devices (replaced by Part Tracking)
        for (const sm of (project.stateMachines ?? [])) {
          if (sm.devices) {
            sm.devices = sm.devices.filter(d => !d._autoVision);
          }
          // Keep smOutputs on SM for backward compat rendering but also ensure it exists
          if (!sm.smOutputs) sm.smOutputs = [];
          // Migration: convert old latch-pattern (triggerNodeId/clearNodeId/autoClear) to new OTE model (activeNodeId)
          sm.smOutputs = sm.smOutputs.map(o => {
            if ('triggerNodeId' in o || 'clearNodeId' in o || 'autoClear' in o) {
              const { triggerNodeId, clearNodeId, autoClear, ...rest } = o;
              return { ...rest, activeNodeId: triggerNodeId ?? o.activeNodeId ?? null };
            }
            return o;
          });
        }
        // Migration: ensure all ServoAxis devices have Slow + Fast speed profiles
        for (const sm of (project.stateMachines ?? [])) {
          for (const dev of (sm.devices ?? [])) {
            if (dev.type === 'ServoAxis') {
              if (!dev.speedProfiles) dev.speedProfiles = [];
              if (!dev.speedProfiles.find(p => p.name === 'Slow')) {
                dev.speedProfiles.push({ name: 'Slow', speed: 100, accel: 1000, decel: 1000 });
              }
              if (!dev.speedProfiles.find(p => p.name === 'Fast')) {
                dev.speedProfiles.push({ name: 'Fast', speed: 2500, accel: 25000, decel: 25000 });
              }
            }
          }
        }
        set({
          project,
          activeSmId: project.stateMachines[0]?.id ?? null,
          selectedNodeId: null,
          selectedEdgeId: null,
          _past: [],
          _future: [],
        });
      },

      // ── State Machine actions ─────────────────────────────────────────────
      addStateMachine({ name, stationNumber, description }) {
        get()._pushHistory();
        const id = uid();
        const sm = {
          id,
          name: name.replace(/[^a-zA-Z0-9_]/g, ''),
          displayName: name,
          stationNumber: Number(stationNumber) || 1,
          description: description ?? '',
          devices: [],
          nodes: [],
          edges: [],
          smOutputs: [],
        };
        set(s => ({
          project: { ...s.project, stateMachines: [...s.project.stateMachines, sm] },
          activeSmId: id,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return id;
      },

      updateStateMachine(id, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === id ? { ...sm, ...updates } : sm
            )),
        }));
      },

      deleteStateMachine(id) {
        get()._pushHistory();
        set(s => {
          const remaining = s.project.stateMachines.filter(sm => sm.id !== id);
          return {
            project: { ...s.project, stateMachines: remaining },
            activeSmId: remaining[0]?.id ?? null,
            selectedNodeId: null,
            selectedEdgeId: null,
          };
        });
      },

      setActiveSm(id) {
        set({ activeSmId: id, selectedNodeId: null, selectedEdgeId: null });
      },

      // ── Device actions ────────────────────────────────────────────────────
      addDevice(smId, deviceData) {
        get()._pushHistory();
        const device = { id: uid(), ...deviceData };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: [...sm.devices, device] }
                : sm
            )),
        }));
        // After adding a VisionSystem device, sync vision PT fields
        if (deviceData.type === 'VisionSystem') {
          get().syncVisionPartTracking(smId);
        }
        return device.id;
      },

      updateDevice(smId, deviceId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.map(d => d.id === deviceId ? { ...d, ...updates } : d) }
                : sm
            )),
        }));
        // After updating a VisionSystem device, sync vision PT fields
        const dev = get().project?.stateMachines?.find(s => s.id === smId)?.devices?.find(d => d.id === deviceId);
        if (dev?.type === 'VisionSystem') {
          get().syncVisionPartTracking(smId);
        }
      },

      /**
       * Refresh subjects: re-sync auto-vision params, clean up orphans,
       * and force a state update so nodes pick up any device changes.
       */
      refreshSubjects(smId) {
        const sm = get().project?.stateMachines?.find(s => s.id === smId);
        if (!sm) return;
        // Sync vision params
        get().syncVisionPartTracking(smId);
        // Force a shallow-copy of devices array to trigger re-render
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
              sm2.id === smId
                ? { ...sm2, devices: [...sm2.devices] }
                : sm2
            )),
        }));
      },

      deleteDevice(smId, deviceId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, devices: sm.devices.filter(d => d.id !== deviceId) }
                : sm
            )),
        }));
      },

      /** Remove duplicate / orphaned _autoVision Parameter devices and fix names. */
      deduplicateAutoVisionParams() {
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              // Build set of valid keys from current vision device job definitions
              const validKeys = new Set();
              for (const vd of (sm.devices ?? []).filter(d => d.type === 'VisionSystem')) {
                for (const job of (vd.jobs ?? [])) {
                  for (const outcome of (job.outcomes ?? ['Pass', 'Fail'])) {
                    validKeys.add(`${vd.id}|${job.name}|${outcome}`);
                  }
                }
              }

              const seen = new Set();
              const cleaned = (sm.devices ?? []).map(d => {
                if (!d._autoVision) return d;
                const key = `${d._visionDeviceId}|${d._visionJobName}|${d._outcomeLabel}`;
                if (!validKeys.has(key)) return null;   // orphaned
                if (seen.has(key)) return null;          // duplicate
                seen.add(key);
                // Normalize name/displayName to just the outcome label
                const correctName = (d._outcomeLabel || 'Result').replace(/[^a-zA-Z0-9_]/g, '');
                const correctDisplay = d._outcomeLabel || 'Result';
                if (d.name !== correctName || d.displayName !== correctDisplay) {
                  return { ...d, name: correctName, displayName: correctDisplay };
                }
                return d;
              }).filter(Boolean);
              return cleaned.length === (sm.devices ?? []).length &&
                cleaned.every((d, i) => d === (sm.devices ?? [])[i])
                ? sm : { ...sm, devices: cleaned };
            })),
        }));
      },

      /**
       * Sync Part Tracking fields for vision jobs.
       * For every vision device + job, ensures a PT field exists.
       * No longer creates auto-vision Parameter devices.
       */
      syncVisionPartTracking(smId) {
        const sm = get().project?.stateMachines?.find(s => s.id === smId);
        if (!sm) return;

        const visionDevices = (sm.devices ?? []).filter(d => d.type === 'VisionSystem');
        if (visionDevices.length === 0) return;

        const ptFields = get().project?.partTracking?.fields ?? [];

        for (const vd of visionDevices) {
          for (const job of (vd.jobs ?? [])) {
            const ptName = job.name;
            if (!ptName) continue;
            const exists = ptFields.some(f => f.name === ptName && f._visionLinked);
            if (!exists) {
              get().addTrackingField({
                name: ptName,
                type: 'boolean',
                description: `Vision job result — auto-linked from ${vd.displayName ?? vd.name}`,
                _visionLinked: true,
                _visionDeviceId: vd.id,
              });
            }
          }
        }
      },

      // ── Node (State Step) actions ─────────────────────────────────────────
      onNodesChange(smId, changes) {
        if (changes.some(c => c.type === 'remove')) get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, nodes: applyNodeChanges(changes, sm.nodes) }
                : sm
            )),
        }));
      },

      addNode(smId, options = {}) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const stepNum = sm.nodes.length;
        const id = uid();
        const node = {
          id,
          type: 'stateNode',
          position: options.position ?? {
            x: 300,
            y: 80 + stepNum * 200,
          },
          data: {
            stepNumber: stepNum,
            label: options.label ?? (stepNum === 0 ? 'Wait for Index Complete' : `Step ${stepNum}`),
            actions: [],
            isInitial: stepNum === 0,
          },
        };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, nodes: [...sm.nodes, node] } : sm
            )),
          selectedNodeId: id,
          selectedEdgeId: null,
        }));
        return id;
      },

      addDecisionNode(smId, nodeConfig) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const node = {
          type: 'decisionNode',
          ...nodeConfig,
        };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, nodes: [...sm.nodes, node] } : sm
            )),
          selectedNodeId: node.id,
          selectedEdgeId: null,
        }));
        return node.id;
      },

      addDecisionBranches(smId, nodeId, exit1Label, exit2Label) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const decisionNode = sm.nodes.find(n => n.id === nodeId);
        if (!decisionNode) return;

        // Don't create duplicates if branches already exist
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const passId = uid();
        const failId = uid();
        const passEdgeId = uid();
        const failEdgeId = uid();

        const passNode = {
          id: passId,
          type: 'stateNode',
          position: { x: decisionNode.position.x - 280, y: decisionNode.position.y + 220 },
          data: { label: exit1Label, actions: [], isInitial: false, stepNumber: sm.nodes.length },
        };
        const failNode = {
          id: failId,
          type: 'stateNode',
          position: { x: decisionNode.position.x + 280, y: decisionNode.position.y + 220 },
          data: { label: exit2Label, actions: [], isInitial: false, stepNumber: sm.nodes.length + 1 },
        };

        const passEdge = {
          id: passEdgeId,
          source: nodeId,
          sourceHandle: 'exit-pass',
          target: passId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: exit1Label,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: exit1Label, outcomeLabel: exit1Label, isDecisionExit: true, exitColor: 'pass' },
        };
        const failEdge = {
          id: failEdgeId,
          source: nodeId,
          sourceHandle: 'exit-fail',
          target: failId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#dc2626', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#dc2626' },
          label: exit2Label,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#dc2626', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'ready', label: exit2Label, outcomeLabel: exit2Label, isDecisionExit: true, exitColor: 'fail' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, passNode, failNode],
                edges: [...sm.edges, passEdge, failEdge],
              }
            )),
        }));
      },

      addDecisionSingleBranch(smId, nodeId, exitLabel) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const decisionNode = sm.nodes.find(n => n.id === nodeId);
        if (!decisionNode) return;

        // Don't create duplicates if branches already exist
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const nextId = uid();
        const edgeId = uid();

        const nextNode = {
          id: nextId,
          type: 'stateNode',
          position: { x: decisionNode.position.x, y: decisionNode.position.y + 180 },
          data: { label: exitLabel, actions: [], isInitial: false, stepNumber: sm.nodes.length },
        };

        const edge = {
          id: edgeId,
          source: nodeId,
          sourceHandle: 'exit-single',
          target: nextId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: exitLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          // No outcomeLabel on single-exit — the wait condition is the node itself, no branch label needed
          data: { conditionType: 'ready', label: exitLabel, isDecisionExit: true, exitColor: 'pass' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, nextNode],
                edges: [...sm.edges, edge],
              }
            )),
        }));
      },

      // ── Vision node branches (side-exit like DecisionNode) ────────────────

      addVisionBranches(smId, nodeId, passLabel, failLabel, ptFieldName) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const visionNode = sm.nodes.find(n => n.id === nodeId);
        if (!visionNode) return;

        // Don't create duplicates if branches already exist
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const passId = uid();
        const failId = uid();
        const passEdgeId = uid();
        const failEdgeId = uid();

        // Pass branch node (left) — blank node (PT updated inside vision node)
        const passNode = {
          id: passId,
          type: 'stateNode',
          position: { x: visionNode.position.x - 280, y: visionNode.position.y + 220 },
          data: {
            label: passLabel,
            actions: [],
            isInitial: false,
          },
        };
        // Fail branch node (right) — blank node (PT updated inside vision node)
        const failNode = {
          id: failId,
          type: 'stateNode',
          position: { x: visionNode.position.x + 280, y: visionNode.position.y + 220 },
          data: {
            label: failLabel,
            actions: [],
            isInitial: false,
          },
        };

        const passEdge = {
          id: passEdgeId,
          source: nodeId,
          sourceHandle: 'exit-pass',
          target: passId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#16a34a', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#16a34a' },
          label: passLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#16a34a', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: passLabel, outcomeLabel: passLabel, isDecisionExit: true, exitColor: 'pass' },
        };
        const failEdge = {
          id: failEdgeId,
          source: nodeId,
          sourceHandle: 'exit-fail',
          target: failId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#dc2626', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#dc2626' },
          label: failLabel,
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#dc2626', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: failLabel, outcomeLabel: failLabel, isDecisionExit: true, exitColor: 'fail' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, passNode, failNode],
                edges: [...sm.edges, passEdge, failEdge],
              }
            )),
        }));
      },

      addVisionSingleBranch(smId, nodeId, exitLabel, ptFieldName) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const visionNode = sm.nodes.find(n => n.id === nodeId);
        if (!visionNode) return;

        // Don't create duplicates
        const existingOut = sm.edges.filter(e => e.source === nodeId);
        if (existingOut.length > 0) return;

        const nextId = uid();
        const edgeId = uid();

        // Single branch node below — blank node (PT updated inside vision node)
        const nextNode = {
          id: nextId,
          type: 'stateNode',
          position: { x: visionNode.position.x, y: visionNode.position.y + 220 },
          data: {
            label: exitLabel,
            actions: [],
            isInitial: false,
          },
        };

        const edge = {
          id: edgeId,
          source: nodeId,
          sourceHandle: 'exit-single',
          target: nextId,
          targetHandle: null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
          label: 'Pass / Fail',
          labelStyle: { fill: '#fff', fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: '#6b7280', rx: 4, ry: 4 },
          labelBgPadding: [4, 8],
          data: { conditionType: 'visionResult', label: 'Pass / Fail', outcomeLabel: 'Pass / Fail', isDecisionExit: true, exitColor: 'single' },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                nodes: [...sm.nodes, nextNode],
                edges: [...sm.edges, edge],
              }
            )),
        }));
      },

      updateNodeData(smId, nodeId, dataUpdates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, ...dataUpdates } }
                        : n
                    ),
                  }
                : sm
            )),
        }));
      },

      deleteNode(smId, nodeId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.filter(n => n.id !== nodeId),
                    edges: sm.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
                  }
                : sm
            )),
          selectedNodeId: null,
        }));
      },

      renumberSteps(smId) {
        get()._pushHistory();
        // Renumber all nodes by topological order (or current order)
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              if (sm.id !== smId) return sm;
              const nodes = sm.nodes.map((n, i) => ({
                ...n,
                data: { ...n.data, stepNumber: i, isInitial: i === 0 },
              }));
              return { ...sm, nodes };
            })),
        }));
      },

      // ── Edge (Transition) actions ─────────────────────────────────────────
      onEdgesChange(smId, changes) {
        if (changes.some(c => c.type === 'remove')) get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, edges: applyEdgeChanges(changes, sm.edges) }
                : sm
            )),
        }));
      },

      addEdge(smId, connection, conditionData) {
        get()._pushHistory();
        const id = uid();
        const label = conditionData?.label ?? 'Ready';
        const isDecExit = conditionData?.isDecisionExit === true;
        const isPass = conditionData?.exitColor === 'pass';
        const decColor = isPass ? '#16a34a' : '#dc2626';
        const edge = {
          id,
          source: connection.source,
          sourceHandle: connection.sourceHandle ?? null,
          target: connection.target,
          targetHandle: connection.targetHandle ?? null,
          type: 'routableEdge',
          animated: false,
          style: { stroke: isDecExit ? decColor : '#6b7280', strokeWidth: 2 },
          markerEnd: { type: 'ArrowClosed', color: isDecExit ? decColor : '#6b7280' },
          label,
          labelStyle: isDecExit
            ? { fill: '#fff', fontWeight: 600, fontSize: 11 }
            : { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace', whiteSpace: 'pre-line', textAlign: 'left', lineHeight: '1.3' },
          labelBgStyle: isDecExit
            ? { fill: decColor, rx: 4, ry: 4 }
            : { fill: '#f9fafb', fillOpacity: 0.95 },
          ...(isDecExit ? { labelBgPadding: [4, 8] } : {}),
          data: conditionData ?? { conditionType: 'ready', label: 'Ready' },
        };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId ? { ...sm, edges: [...sm.edges, edge] } : sm
            )),
        }));
        return id;
      },

      updateEdge(smId, edgeId, conditionData) {
        get()._pushHistory();
        const label = conditionData?.label ?? 'Ready';
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    edges: sm.edges.map(e =>
                      e.id === edgeId ? { ...e, label, data: conditionData } : e
                    ),
                  }
                : sm
            )),
        }));
      },

      /** Persist the waypoints array for a routable edge (called on every drag tick). */
      updateEdgeWaypoints(smId, edgeId, waypoints, manualRoute = false) {
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id !== smId ? sm : {
                ...sm,
                edges: sm.edges.map(e =>
                  e.id !== edgeId ? e : {
                    ...e,
                    data: { ...e.data, waypoints, ...(manualRoute ? { manualRoute: true } : {}) },
                  }
                ),
              }
            )),
        }));
      },

      deleteEdge(smId, edgeId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, edges: sm.edges.filter(e => e.id !== edgeId) }
                : sm
            )),
          selectedEdgeId: null,
        }));
      },

      // ── Action (within a node) actions ────────────────────────────────────
      addAction(smId, nodeId, actionData) {
        get()._pushHistory();
        const action = { id: uid(), ...actionData };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, actions: [...n.data.actions, action] } }
                        : n
                    ),
                  }
                : sm
            )),
        }));
        return action.id;
      },

      updateAction(smId, nodeId, actionId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              actions: n.data.actions.map(a =>
                                a.id === actionId ? { ...a, ...updates } : a
                              ),
                            },
                          }
                        : n
                    ),
                  }
                : sm
            )),
        }));
      },

      deleteAction(smId, nodeId, actionId) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, data: { ...n.data, actions: n.data.actions.filter(a => a.id !== actionId) } }
                        : n
                    ),
                  }
                : sm
            )),
        }));
      },

      reorderDevices(smId, movedDeviceId, targetDeviceId, insertAfter) {
        if (movedDeviceId === targetDeviceId) return;
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm => {
              if (sm.id !== smId) return sm;
              const devices = [...(sm.devices ?? [])];
              const fromIdx = devices.findIndex(d => d.id === movedDeviceId);
              let toIdx = devices.findIndex(d => d.id === targetDeviceId);
              if (fromIdx < 0 || toIdx < 0) return sm;
              const [moved] = devices.splice(fromIdx, 1);
              // Recalculate toIdx after removal
              toIdx = devices.findIndex(d => d.id === targetDeviceId);
              const insertIdx = insertAfter ? toIdx + 1 : toIdx;
              devices.splice(insertIdx, 0, moved);
              return { ...sm, devices };
            })),
        }));
      },

      // ── Part Tracking actions ─────────────────────────────────────────────
      addTrackingField(fieldData) {
        get()._pushHistory();
        const field = { id: uid(), name: 'NewField', dataType: 'boolean', description: '', ...fieldData };
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: [...(s.project.partTracking?.fields ?? []), field],
            },
          },
        }));
        return field.id;
      },

      updateTrackingField(fieldId, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: (s.project.partTracking?.fields ?? []).map(f =>
                f.id === fieldId ? { ...f, ...updates } : f
              ),
            },
          },
        }));
      },

      deleteTrackingField(fieldId) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            partTracking: {
              ...s.project.partTracking,
              fields: (s.project.partTracking?.fields ?? []).filter(f => f.id !== fieldId),
            },
          },
        }));
      },

      reorderTrackingFields(fromIdx, toIdx) {
        get()._pushHistory();
        set(s => {
          const fields = [...(s.project.partTracking?.fields ?? [])];
          const [moved] = fields.splice(fromIdx, 1);
          fields.splice(toIdx, 0, moved);
          return {
            project: {
              ...s.project,
              partTracking: { ...s.project.partTracking, fields },
            },
          };
        });
      },

      // ── Signal actions (unified: replaces referencePositions + smOutputs) ──
      addSignal(data) {
        get()._pushHistory();
        const signal = { id: uid(), name: 'NewSignal', description: '', type: 'position', axes: [], ...data };
        set(s => ({
          project: {
            ...s.project,
            signals: [...(s.project.signals ?? []), signal],
          },
        }));
        return signal.id;
      },

      updateSignal(id, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            signals: (s.project.signals ?? []).map(sig =>
              sig.id === id ? { ...sig, ...updates } : sig
            ),
          },
        }));
      },

      deleteSignal(id) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            signals: (s.project.signals ?? []).filter(sig => sig.id !== id),
          },
        }));
      },

      // ── Legacy SM Output actions (kept for backward compat with existing data) ──
      addSmOutput(smId, data) {
        get()._pushHistory();
        const output = { id: uid(), name: 'NewOutput', description: '', activeNodeId: null, ...data };
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: [...(sm.smOutputs ?? []), output] }
                : sm
            )),
        }));
        return output.id;
      },

      updateSmOutput(smId, id, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: (sm.smOutputs ?? []).map(o => o.id === id ? { ...o, ...updates } : o) }
                : sm
            )),
        }));
      },

      deleteSmOutput(smId, id) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? { ...sm, smOutputs: (sm.smOutputs ?? []).filter(o => o.id !== id) }
                : sm
            )),
        }));
      },

      // ── Selection ─────────────────────────────────────────────────────────
      setSelectedNode(id) {
        set({ selectedNodeId: id, selectedEdgeId: null });
      },

      setSelectedEdge(id) {
        set({ selectedEdgeId: id, selectedNodeId: null });
      },

      clearSelection() {
        set({ selectedNodeId: null, selectedEdgeId: null });
      },

      // ── Modal controls ────────────────────────────────────────────────────
      openNewSmModal() { set({ showNewSmModal: true }); },
      closeNewSmModal() { set({ showNewSmModal: false }); },

      openAddDeviceModal() { set({ showAddDeviceModal: true }); },
      closeAddDeviceModal() { set({ showAddDeviceModal: false }); },

      openEditDeviceModal(deviceId) { set({ showEditDeviceModal: true, editDeviceId: deviceId }); },
      closeEditDeviceModal() { set({ showEditDeviceModal: false, editDeviceId: null }); },

      openActionModal(nodeId, actionId = null) {
        set({ showActionModal: true, actionModalNodeId: nodeId, actionModalActionId: actionId });
      },
      closeActionModal() {
        set({ showActionModal: false, actionModalNodeId: null, actionModalActionId: null });
      },

      openTransitionModal(edgeId) {
        set({ showTransitionModal: true, transitionModalEdgeId: edgeId });
      },
      closeTransitionModal() {
        set({ showTransitionModal: false, transitionModalEdgeId: null, pendingEdgeData: null });
      },

      setPendingEdge(data) {
        set({ pendingEdgeData: data });
      },

      // ── Inline picker control ───────────────────────────────────────────
      setOpenPickerOnNode(nodeId) {
        set({ openPickerOnNodeId: nodeId });
      },
      clearOpenPickerOnNode() {
        set({ openPickerOnNodeId: null });
      },

      // ── Verify helpers (auto-create / manage verify devices) ────────────

      /** Find or create an auto-verify CheckResults device for a given node. */
      findOrCreateVerifyDevice(smId, nodeId) {
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const node = sm.nodes.find(n => n.id === nodeId);
        if (!node) return null;

        // Look for existing auto-verify device already linked to this node via an action
        const existingAction = (node.data?.actions ?? []).find(a => {
          const dev = sm.devices.find(d => d.id === a.deviceId);
          return dev?.type === 'CheckResults' && dev._autoVerify;
        });
        if (existingAction) {
          return sm.devices.find(d => d.id === existingAction.deviceId);
        }

        // Create new hidden CheckResults device
        const existingCount = (sm.devices ?? []).filter(d => d.type === 'CheckResults' && d._autoVerify).length;
        const num = existingCount + 1;
        const deviceId = get().addDevice(smId, {
          type: 'CheckResults',
          displayName: `Verify ${num}`,
          name: `Verify${num}`,
          _autoVerify: true,
          _sourceNodeId: nodeId,
          outcomes: [],
        });
        const freshSm = _getSmArray(get()).find(s => s.id === smId);
        return freshSm?.devices?.find(d => d.id === deviceId) ?? null;
      },

      /** Add a verify condition to a node's auto-verify device. */
      addVerifyCondition(smId, nodeId, inputRef, condition, label) {
        const device = get().findOrCreateVerifyDevice(smId, nodeId);
        if (!device) return null;

        const outcomeId = `out_${Date.now()}`;
        const newOutcome = {
          id: outcomeId,
          inputRef,
          condition,
          label: label || '',
          retry: false,
          maxRetries: 3,
          faultStep: 137,
        };

        const updatedOutcomes = [...(device.outcomes ?? []), newOutcome];
        get().updateDevice(smId, device.id, { outcomes: updatedOutcomes });

        // Ensure the node has a Check action for this device
        const sm = _getSmArray(get()).find(s => s.id === smId);
        const node = sm?.nodes?.find(n => n.id === nodeId);
        const hasAction = (node?.data?.actions ?? []).some(a => a.deviceId === device.id);
        if (!hasAction) {
          get().addAction(smId, nodeId, { deviceId: device.id, operation: 'Check' });
        }

        // If we just went from 1→2 outcomes, retroactively update existing edges
        if (updatedOutcomes.length === 2) {
          const freshSm = _getSmArray(get()).find(s => s.id === smId);
          const existingEdges = (freshSm?.edges ?? []).filter(e => e.source === nodeId);
          for (const edge of existingEdges) {
            if (edge.data?.conditionType === 'verify' || (edge.data?.conditionType !== 'checkResult' && edge.data?.conditionType !== 'ready')) {
              get().updateEdge(smId, edge.id, {
                conditionType: 'checkResult',
                deviceId: device.id,
                outcomeId: updatedOutcomes[0].id,
                outcomeLabel: updatedOutcomes[0].label,
                outcomeIndex: 0,
                label: updatedOutcomes[0].label || 'Branch 1',
                inputRef: updatedOutcomes[0].inputRef,
                condition: updatedOutcomes[0].condition,
              });
              break;
            }
          }
        }

        return { deviceId: device.id, outcomeId };
      },

      /** Remove a verify condition from a node's auto-verify device. */
      removeVerifyCondition(smId, nodeId, outcomeId) {
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return;
        const node = sm.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const verifyAction = (node.data?.actions ?? []).find(a => {
          const dev = sm.devices.find(d => d.id === a.deviceId);
          return dev?.type === 'CheckResults' && dev._autoVerify;
        });
        if (!verifyAction) return;

        const device = sm.devices.find(d => d.id === verifyAction.deviceId);
        if (!device) return;

        const updatedOutcomes = (device.outcomes ?? []).filter(o => o.id !== outcomeId);

        if (updatedOutcomes.length === 0) {
          // Remove action and device entirely
          get().deleteAction(smId, nodeId, verifyAction.id);
          get().deleteDevice(smId, device.id);
        } else {
          get().updateDevice(smId, device.id, { outcomes: updatedOutcomes });

          // 2→1: convert remaining checkResult edges back to verify
          if (updatedOutcomes.length === 1) {
            const freshSm = _getSmArray(get()).find(s => s.id === smId);
            const existingEdges = (freshSm?.edges ?? []).filter(e => e.source === nodeId);
            for (const edge of existingEdges) {
              if (edge.data?.conditionType === 'checkResult' && edge.data?.deviceId === device.id) {
                if (edge.data.outcomeId === updatedOutcomes[0].id) {
                  get().updateEdge(smId, edge.id, {
                    conditionType: 'verify',
                    label: updatedOutcomes[0].label || 'Verify',
                  });
                } else {
                  // Orphaned edge — clear its condition
                  get().updateEdge(smId, edge.id, {
                    conditionType: 'ready',
                    label: 'Ready',
                  });
                }
              }
            }
          }
        }
      },

      // ── Duplicate node ──────────────────────────────────────────────────
      duplicateNode(smId, nodeId) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const sourceNode = sm.nodes.find(n => n.id === nodeId);
        if (!sourceNode) return null;

        const newId = uid();
        const newNode = {
          ...sourceNode,
          id: newId,
          position: {
            x: sourceNode.position.x + 50,
            y: sourceNode.position.y + 80,
          },
          data: {
            ...sourceNode.data,
            stepNumber: sm.nodes.length,
            isInitial: false,
            label: `${sourceNode.data.label} (copy)`,
            actions: sourceNode.data.actions.map(a => ({ ...a, id: uid() })),
          },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 =>
              sm2.id === smId ? { ...sm2, nodes: [...sm2.nodes, newNode] } : sm2
            )),
          selectedNodeId: newId,
          selectedEdgeId: null,
        }));
        return newId;
      },

      /** Generic node update — merges top-level fields and data sub-fields. */
      updateNode(smId, nodeId, updates) {
        get()._pushHistory();
        set(s => ({
          project: _updateProject(s, sms => sms.map(sm =>
              sm.id === smId
                ? {
                    ...sm,
                    nodes: sm.nodes.map(n =>
                      n.id === nodeId
                        ? { ...n, ...updates, data: { ...n.data, ...(updates.data || {}) } }
                        : n
                    ),
                  }
                : sm
            )),
        }));
      },

      /**
       * Replace a state node with a decision node at the same position.
       * Rewires all incoming edges that pointed at the old node to the new decision node.
       * The old node is removed.
       */
      replaceNodeWithDecision(smId, oldNodeId, decisionData) {
        get()._pushHistory();
        const sm = _getSmArray(get()).find(s => s.id === smId);
        if (!sm) return null;
        const oldNode = sm.nodes.find(n => n.id === oldNodeId);
        if (!oldNode) return null;

        const newId = decisionData.id ?? `id_${(Date.now()).toString(36)}`;
        // Center decision node horizontally under the old node
        // StateNode renders at ~300px wide; DecisionNode is 240px
        const srcWidth = oldNode.measured?.width ?? oldNode.width ?? 240;
        const decWidth = 240;
        const centeredPosition = {
          x: oldNode.position.x + (srcWidth - decWidth) / 2,
          y: oldNode.position.y,
        };
        const newNode = {
          id: newId,
          type: 'decisionNode',
          position: centeredPosition,
          data: {
            label: 'Decision',
            decisionType: 'signal',
            exitCount: 2,
            exit1Label: 'Pass',
            exit2Label: 'Fail',
            updatePartTracking: false,
            ...decisionData,
          },
        };

        set(s => ({
          project: _updateProject(s, sms => sms.map(sm2 => {
              if (sm2.id !== smId) return sm2;
              const nodes = sm2.nodes
                .filter(n => n.id !== oldNodeId)
                .concat(newNode);
              const edges = sm2.edges.map(e =>
                e.target === oldNodeId
                  ? { ...e, target: newId, targetHandle: 'input' }
                  : e
              ).filter(e => e.source !== oldNodeId); // remove outgoing edges from old node
              return { ...sm2, nodes, edges };
            })),
          selectedNodeId: newId,
          selectedEdgeId: null,
        }));
        return newId;
      },

      // ── Recipe Management ──────────────────────────────────────────────

      openRecipeManager()  { set({ showRecipeManager: true }); },
      closeRecipeManager() { set({ showRecipeManager: false }); },

      setActiveRecipe(recipeId) {
        set({ activeRecipeId: recipeId });
      },

      addRecipe({ name, description = '', customSequence = false }) {
        get()._pushHistory();
        const id = uid();
        const recipes = [...(get().project.recipes ?? [])];
        const isDefault = recipes.length === 0;
        recipes.push({ id, name, description, isDefault, customSequence });
        const overrides = { ...(get().project.recipeOverrides ?? {}), [id]: { positions: {}, timers: {}, speeds: {}, skippedNodes: {} } };
        set(s => ({
          project: { ...s.project, recipes, recipeOverrides: overrides },
          activeRecipeId: s.activeRecipeId ?? id,
        }));
        return id;
      },

      updateRecipe(recipeId, updates) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            recipes: (s.project.recipes ?? []).map(r =>
              r.id === recipeId ? { ...r, ...updates } : r
            ),
          },
        }));
      },

      deleteRecipe(recipeId) {
        get()._pushHistory();
        const recipes = (get().project.recipes ?? []).filter(r => r.id !== recipeId);
        const overrides = { ...(get().project.recipeOverrides ?? {}) };
        delete overrides[recipeId];
        // If deleted recipe was default, make first remaining the default
        if (recipes.length > 0 && !recipes.some(r => r.isDefault)) {
          recipes[0].isDefault = true;
        }
        set(s => ({
          project: { ...s.project, recipes, recipeOverrides: overrides },
          activeRecipeId: s.activeRecipeId === recipeId
            ? (recipes[0]?.id ?? null)
            : s.activeRecipeId,
        }));
      },

      duplicateRecipe(recipeId, newName) {
        get()._pushHistory();
        const id = uid();
        const source = (get().project.recipes ?? []).find(r => r.id === recipeId);
        if (!source) return null;
        const sourceOverrides = (get().project.recipeOverrides ?? {})[recipeId] ?? {};
        const recipes = [...(get().project.recipes ?? []), {
          id, name: newName, description: source.description, isDefault: false, customSequence: source.customSequence,
        }];
        const overrides = {
          ...(get().project.recipeOverrides ?? {}),
          [id]: JSON.parse(JSON.stringify(sourceOverrides)),
        };
        set(s => ({ project: { ...s.project, recipes, recipeOverrides: overrides } }));
        return id;
      },

      setDefaultRecipe(recipeId) {
        get()._pushHistory();
        set(s => ({
          project: {
            ...s.project,
            recipes: (s.project.recipes ?? []).map(r => ({
              ...r, isDefault: r.id === recipeId,
            })),
          },
        }));
      },

      /** Toggle custom sequence for a recipe. Copies or discards SM data. */
      toggleCustomSequence(recipeId) {
        get()._pushHistory();
        const { project } = get();
        const recipe = (project.recipes ?? []).find(r => r.id === recipeId);
        if (!recipe) return;

        const newCustom = !recipe.customSequence;
        const overrides = { ...(project.recipeOverrides ?? {}) };
        const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };

        if (newCustom) {
          // Deep-copy all SMs into customSMs so this recipe gets its own sequence
          recipeOv.customSMs = JSON.parse(JSON.stringify(project.stateMachines));
        } else {
          // Discard custom SMs — revert to base sequence
          delete recipeOv.customSMs;
        }

        overrides[recipeId] = recipeOv;
        const recipes = (project.recipes ?? []).map(r =>
          r.id === recipeId ? { ...r, customSequence: newCustom } : r
        );
        set({ project: { ...project, recipes, recipeOverrides: overrides } });
      },

      // Recipe override mutations
      setRecipeOverride(recipeId, category, key, value) {
        get()._pushHistory();
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          recipeOv[category] = { ...recipeOv[category], [key]: value };
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      clearRecipeOverride(recipeId, category, key) {
        get()._pushHistory();
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          const catObj = { ...recipeOv[category] };
          delete catObj[key];
          recipeOv[category] = catObj;
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      toggleNodeSkip(recipeId, smId, nodeId) {
        get()._pushHistory();
        const key = `${smId}:${nodeId}`;
        set(s => {
          const overrides = { ...(s.project.recipeOverrides ?? {}) };
          const recipeOv = { ...(overrides[recipeId] ?? { positions: {}, timers: {}, speeds: {}, skippedNodes: {} }) };
          const skipped = { ...recipeOv.skippedNodes };
          if (skipped[key]) delete skipped[key];
          else skipped[key] = true;
          recipeOv.skippedNodes = skipped;
          overrides[recipeId] = recipeOv;
          return { project: { ...s.project, recipeOverrides: overrides } };
        });
      },

      /** Check if a node is skipped in the currently active recipe */
      isNodeSkipped(smId, nodeId) {
        const { activeRecipeId, project } = get();
        if (!activeRecipeId) return false;
        const key = `${smId}:${nodeId}`;
        return !!(project.recipeOverrides?.[activeRecipeId]?.skippedNodes?.[key]);
      },

      /** Get effective value for a parameter (active recipe override or device default) */
      getEffectiveValue(category, key, defaultValue) {
        const { activeRecipeId, project } = get();
        if (!activeRecipeId) return defaultValue;
        const val = project.recipeOverrides?.[activeRecipeId]?.[category]?.[key];
        return val !== undefined ? val : defaultValue;
      },

      // ── Multi-project management ──────────────────────────────────────

      openProjectManager()  { set({ showProjectManager: true }); },
      closeProjectManager() { set({ showProjectManager: false }); },

      /** Save current project to its file on the server. */
      async saveCurrentProject() {
        let { currentFilename, project, serverAvailable, activeSmId } = get();
        // Re-check availability in case it started after page load
        if (!serverAvailable) {
          const available = await projectApi.isServerAvailable();
          if (!available) throw new Error('No save server available. Use the Download button to save your project as a local file.');
          set({ serverAvailable: true });
          serverAvailable = true;
        }
        // If no filename yet, derive one from the project name and persist it
        if (!currentFilename) {
          currentFilename = projectApi.toFilename(project.name || 'New Project');
          set({ currentFilename });
        }
        // Persist the last-active SM so we can restore it when switching back
        const dataToSave = { ...project, _lastActiveSmId: activeSmId };
        await projectApi.saveProject(currentFilename, dataToSave);
      },

      /** Switch to a different project. Saves current first. */
      async switchProject(filename) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) return;

        // Save current project before switching (preserves last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before switch failed:', err);
          }
        }

        // Load target project
        try {
          const loaded = await projectApi.loadProject(filename);
          // Restore the last-active SM tab (or fall back to the first SM)
          const restoredSmId = loaded._lastActiveSmId;
          const validSmId = (loaded.stateMachines ?? []).some(sm => sm.id === restoredSmId)
            ? restoredSmId
            : loaded.stateMachines?.[0]?.id ?? null;
          set({
            project: loaded,
            currentFilename: filename,
            activeSmId: validSmId,
            selectedNodeId: null,
            selectedEdgeId: null,
            showProjectManager: false,
          });
        } catch (err) {
          alert(`Failed to load project: ${err.message}`);
        }
      },

      /** Create a brand new project and switch to it. */
      async createNewProject(name) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();

        // Cloud / offline mode: create project in memory without saving to server
        if (!serverAvailable) {
          const newProject = { name: name || 'New Project', stateMachines: [], partTracking: { fields: [] }, signals: [] };
          set({
            project: newProject,
            currentFilename: null,
            activeSmId: null,
            selectedNodeId: null,
            selectedEdgeId: null,
            showProjectManager: false,
            showNewSmModal: true,
          });
          return;
        }

        const filename = projectApi.toFilename(name);

        // Check if a project with this name already exists
        try {
          const existing = await projectApi.listProjects();
          const match = existing.find(p => p.filename === filename);
          if (match) {
            const openExisting = confirm(
              `A project named "${name}" already exists.\n\nClick OK to open it, or Cancel to pick a different name.`
            );
            if (openExisting) {
              await get().switchProject(filename);
            }
            return; // Don't create a duplicate either way
          }
        } catch { /* ignore — proceed with create */ }

        // Save current project first (preserve last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before create failed:', err);
          }
        }

        const newProject = { name: name || 'New Project', stateMachines: [], partTracking: { fields: [] }, signals: [] };

        try {
          await projectApi.saveProject(filename, newProject);
          set({
            project: newProject,
            currentFilename: filename,
            activeSmId: null,
            selectedNodeId: null,
            selectedEdgeId: null,
            showProjectManager: false,
            showNewSmModal: true,    // Auto-open "New SM" modal so user isn't on a blank canvas
          });
        } catch (err) {
          alert(`Failed to create project: ${err.message}`);
        }
      },

      /** Delete a project from the server. Switches away if it's the current one. */
      async deleteProjectFile(filename) {
        const { currentFilename, serverAvailable } = get();
        if (!serverAvailable) return;

        try {
          await projectApi.deleteProjectFile(filename);
        } catch (err) {
          alert(`Failed to delete: ${err.message}`);
          return;
        }

        // If we deleted the active project, switch to another
        if (filename === currentFilename) {
          try {
            const remaining = await projectApi.listProjects();
            if (remaining.length > 0) {
              await get().switchProject(remaining[0].filename);
            } else {
              await get().createNewProject('New Project');
            }
          } catch (err) {
            console.error('Switch after delete failed:', err);
          }
        }
      },

      /** Rename a project (save with new filename, delete old). */
      async renameProject(oldFilename, newName) {
        const { currentFilename, serverAvailable } = get();
        if (!serverAvailable) return;

        const newFilename = projectApi.toFilename(newName);
        if (newFilename === oldFilename) {
          // Same filename — just update the name inside the file
          if (oldFilename === currentFilename) {
            set(s => ({ project: { ...s.project, name: newName } }));
            await get().saveCurrentProject();
          } else {
            try {
              const data = await projectApi.loadProject(oldFilename);
              data.name = newName;
              await projectApi.saveProject(oldFilename, data);
            } catch (err) {
              console.error('Rename failed:', err);
            }
          }
          return;
        }

        try {
          // Load old, save as new, delete old
          let data;
          if (oldFilename === currentFilename) {
            data = { ...get().project, name: newName };
          } else {
            data = await projectApi.loadProject(oldFilename);
            data.name = newName;
          }

          await projectApi.saveProject(newFilename, data);
          await projectApi.deleteProjectFile(oldFilename);

          if (oldFilename === currentFilename) {
            set({ currentFilename: newFilename, project: data });
          }
        } catch (err) {
          alert(`Failed to rename: ${err.message}`);
        }
      },

      /** Import a JSON project as a new file on the server, then switch to it. */
      async importProject(projectData) {
        const { currentFilename, project, serverAvailable, activeSmId } = get();
        if (!serverAvailable) {
          // Fallback: just load into memory (old behavior)
          get().loadProject(projectData);
          return;
        }

        // Save current project first (preserve last-active SM)
        if (currentFilename) {
          try {
            const dataToSave = { ...project, _lastActiveSmId: activeSmId };
            await projectApi.saveProject(currentFilename, dataToSave);
          } catch (err) {
            console.error('Save before import failed:', err);
          }
        }

        // Use the project's name as the filename — overwrite if it exists
        const filename = projectApi.toFilename(projectData.name || 'Imported');

        try {
          await projectApi.saveProject(filename, projectData);
          const restoredSmId = projectData._lastActiveSmId;
          const validSmId = (projectData.stateMachines ?? []).some(sm => sm.id === restoredSmId)
            ? restoredSmId
            : projectData.stateMachines?.[0]?.id ?? null;
          set({
            project: projectData,
            currentFilename: filename,
            activeSmId: validSmId,
            selectedNodeId: null,
            selectedEdgeId: null,
          });
        } catch (err) {
          alert(`Failed to import: ${err.message}`);
        }
      },

      /** Bootstrap: detect server, load or create initial project. */
      async initializeProjects() {
        const available = await projectApi.isServerAvailable();
        set({ serverAvailable: available });
        if (!available) return;

        /** Restore _lastActiveSmId from project data (or fall back to first SM). */
        function pickActiveSmId(data) {
          const restored = data._lastActiveSmId;
          if (restored && (data.stateMachines ?? []).some(sm => sm.id === restored)) {
            return restored;
          }
          return data.stateMachines?.[0]?.id ?? null;
        }

        try {
          const projects = await projectApi.listProjects();

          // If we already have a currentFilename from localStorage, try loading it
          const { currentFilename } = get();
          if (currentFilename) {
            const exists = projects.find(p => p.filename === currentFilename);
            if (exists) {
              const data = await projectApi.loadProject(currentFilename);
              set({
                project: data,
                activeSmId: pickActiveSmId(data),
              });
              return;
            }
          }

          // Otherwise load the most recent project, or create a default
          if (projects.length > 0) {
            projects.sort((a, b) => b.lastModified - a.lastModified);
            const latest = projects[0];
            const data = await projectApi.loadProject(latest.filename);
            set({
              project: data,
              currentFilename: latest.filename,
              activeSmId: pickActiveSmId(data),
            });
          } else {
            // No projects exist — save the current in-memory project (might be from localStorage)
            const { project } = get();
            const filename = projectApi.toFilename(project.name || 'New Project');
            await projectApi.saveProject(filename, project);
            set({ currentFilename: filename });
          }
          // One-time cleanup: remove duplicate auto-vision params from earlier bug
          get().deduplicateAutoVisionParams();
        } catch (err) {
          console.error('Project initialization failed:', err);
        }
      },
    }),
    {
      name: 'sdc-state-logic-v1',
      // Only persist the project data, not UI state
      partialize: (state) => ({
        project: state.project,
        activeSmId: state.activeSmId,
        activeRecipeId: state.activeRecipeId,
        currentFilename: state.currentFilename,
      }),
      // Migration: strip legacy _autoVision params on rehydrate, add new fields
      onRehydrateStorage: () => (state) => {
        if (state?.project) {
          // Migrate referencePositions → signals on rehydrate
          if (!state.project.signals) {
            state.project.signals = [];
            for (const rp of (state.project.referencePositions ?? [])) {
              state.project.signals.push({
                id: rp.id,
                name: rp.name,
                description: rp.description ?? '',
                type: 'position',
                axes: (rp.axes ?? []).map(a => ({
                  smId: a.smId,
                  deviceId: a.axisDeviceId,
                  deviceName: a.axisDeviceId,
                  positionName: a.positionName,
                  tolerance: a.tolerance,
                })),
              });
            }
            for (const sm of (state.project.stateMachines ?? [])) {
              for (const o of (sm.smOutputs ?? [])) {
                state.project.signals.push({
                  id: o.id,
                  name: o.name,
                  description: o.description ?? '',
                  type: 'state',
                  smId: sm.id,
                  stateNodeId: o.activeNodeId ?? null,
                  stateName: o.name,
                });
              }
            }
          }
          delete state.project.referencePositions;
          if (state.project.stateMachines) {
            for (const sm of state.project.stateMachines) {
              if (sm.devices) {
                sm.devices = sm.devices.filter(d => !d._autoVision);
              }
              if (!sm.smOutputs) sm.smOutputs = [];

              // Migrate old vision nodes: add visionExitMode if missing
              for (const node of (sm.nodes ?? [])) {
                const d = node.data ?? {};
                const actions = d.actions ?? [];
                const hasVision = actions.some(a => {
                  const dev = (sm.devices ?? []).find(dv => dv.id === a.deviceId);
                  return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
                });
                if (hasVision && !d.visionExitMode) {
                  // Check if this node already has side-exit edges
                  const edges = sm.edges ?? [];
                  const hasPassEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-pass');
                  const hasFailEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-fail');
                  const hasSingleEdge = edges.some(e => e.source === node.id && e.sourceHandle === 'exit-single');
                  if (hasPassEdge && hasFailEdge) {
                    node.data.visionExitMode = '2-node';
                  } else if (hasSingleEdge) {
                    node.data.visionExitMode = '1-node';
                  }
                  // If no exit edges exist yet, leave visionExitMode unset — user picks on Done
                }
              }

              // Migrate: ensure all ServoAxis devices have Slow + Fast speed profiles
              for (const dev of (sm.devices ?? [])) {
                if (dev.type === 'ServoAxis') {
                  if (!dev.speedProfiles) dev.speedProfiles = [];
                  if (!dev.speedProfiles.find(p => p.name === 'Slow')) {
                    dev.speedProfiles.push({ name: 'Slow', speed: 100, accel: 1000, decel: 1000 });
                  }
                  if (!dev.speedProfiles.find(p => p.name === 'Fast')) {
                    dev.speedProfiles.push({ name: 'Fast', speed: 2500, accel: 25000, decel: 25000 });
                  }
                }
              }

              // Ensure recipes array exists
              if (!state.project.recipes) state.project.recipes = [];
            }
          }
        }
      },
    }
  )
  )
);

// ── Auto-save DISABLED — user must click Save manually ───────────────────────
// Previously auto-saved on every change, which caused data loss when stale
// localStorage overwrote good server data on page load.
