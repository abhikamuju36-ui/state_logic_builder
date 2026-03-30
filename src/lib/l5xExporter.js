/**
 * L5X Exporter v2 — State_Engine_128Max Pattern
 *
 * Generates L5X matching CE's Studio 5000 output:
 *  - State_Engine_128Max AOI with StateLogicControl / StateLogicStatus UDTs
 *  - Steps numbered by 3s starting at 10 (10, 13, 16, 19, …)
 *  - Auto-generated Wait (state 10) and Complete bookend states
 *  - R00_Main       — 3 JSR calls
 *  - R01_Inputs     — inverted-sensor → delay timer (1-sensor devices only)
 *  - R02_StateTransitions — XIC(Status.State[N]) + verify conditions + MOVE + AOI call
 *  - R03_StateLogic — OTE branch/latch per device, complementary outputs
 *  - No R04/R20     — fault detection via AOI FaultTime
 *
 * Reference: S01_CoreCoverLoadPNP.L5X (CE gold standard)
 */

import {
  getOutputTagForOperation,
  getSensorTagForOperation,
  getDelayTimerForOperation,
  getParameterTag,
  buildProgramName,
  getDeviceTags,
  getAxisTag,
} from './tagNaming.js';
import { DEVICE_TYPES, getSensorConfigKey } from './deviceTypes.js';

// ── Unified inputRef → tag resolver ─────────────────────────────────────────
//
// inputRef format:  "deviceId:key"   or   "deviceId:cross:smId"
//   key = ext | ret | eng | dis | vac | sensor | param | trigReady | {positionName/setpointName}
//
// Returns the L5X tag string (e.g. "i_CylExt", "q_MyParam", "MyServoHomeRC.In_Range")
// or null if unresolvable.

function resolveInputRefTag(inputRef, devices, allSMs = [], trackingFields = []) {
  if (!inputRef) return null;
  const parts = inputRef.split(':');
  if (parts.length < 2) return null;

  const deviceId = parts[0];
  const key = parts[1];

  // Part Tracking field reference: "_tracking:fieldId"
  if (deviceId === '_tracking') {
    // "All Pass" — AND of all tracking fields
    if (key === '_allPass') {
      if (!trackingFields || trackingFields.length === 0) return null;
      return trackingFields.map(f => `PartTracking.${f.name}`).join(' AND ');
    }
    const field = trackingFields.find(f => f.id === key);
    if (field) return `PartTracking.${field.name}`;
    return null;
  }

  // Cross-SM parameter:  "deviceId:cross:smId"
  if (key === 'cross' && parts[2]) {
    const crossSmId = parts[2];
    const crossSm = allSMs.find(s => s.id === crossSmId);
    if (!crossSm) return null;
    const dev = (crossSm.devices ?? []).find(d => d.id === deviceId);
    if (!dev) return null;
    const pfx = dev.dataType === 'boolean' ? 'q_' : 'p_';
    const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
    return `\\${progName}.${pfx}${dev.name}`;
  }

  // Local device lookup
  const dev = devices.find(d => d.id === deviceId);
  if (!dev) return null;

  switch (dev.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      if (key === 'ext') return `i_${dev.name}Ext`;
      if (key === 'ret') return `i_${dev.name}Ret`;
      break;
    case 'PneumaticGripper':
      if (key === 'eng') return `i_${dev.name}Engage`;
      if (key === 'dis') return `i_${dev.name}Disengage`;
      break;
    case 'PneumaticVacGenerator':
      if (key === 'vac') return `i_${dev.name}VacOn`;
      break;
    case 'DigitalSensor':
      if (key === 'sensor') return `i_${dev.name}`;
      break;
    case 'AnalogSensor':
      // key = setpointName → "{name}{setpointName}RC.In_Range"
      return `${dev.name}${key}RC.In_Range`;
    case 'ServoAxis':
      // key = positionName → "{name}{positionName}RC.In_Range"
      return `${dev.name}${key}RC.In_Range`;
    case 'Parameter': {
      const pfx = dev.dataType === 'boolean' ? 'q_' : 'p_';
      return `${pfx}${dev.name}`;
    }
    case 'VisionSystem':
      if (key === 'trigReady') return `i_${dev.name}TrigRdy`;
      if (key === 'resultReady') return `i_${dev.name}ResultReady`;
      if (key === 'inspPass') return `i_${dev.name}InspPass`;
      break;
  }
  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_REV = '1.0';
const SOFTWARE_REV = '37.00';
const STEP_BASE = 10;         // Wait/Home state = 10 (SDC standard: steps start at 10, 13, 16, …)
const STEP_INCREMENT = 3;     // First action = 13, then 16, 19, …
const DEFAULT_FAULT_TIME = 5000;
const CONTROLLER_NAME = 'SDCController';

// ── Date helper (Studio 5000 expects C ctime format: "Mon Dec 15 15:57:26 2025") ──────────

function toCTimeString(date) {
  const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad2 = n => String(n).padStart(2, '0');
  // ctime pads single-digit day with a space: " 5" vs "15"
  const day = String(date.getDate()).padStart(2, ' ');
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${day} ` +
         `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ` +
         `${date.getFullYear()}`;
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cdata(str) {
  return `<![CDATA[${str}]]>`;
}

// ── Node ordering (topological sort) ─────────────────────────────────────────

function orderNodes(nodes, edges) {
  if (!nodes || nodes.length === 0) return [];

  const start =
    nodes.find((n) => n.data.isInitial) ??
    [...nodes].sort((a, b) => a.data.stepNumber - b.data.stepNumber)[0];
  if (!start) return nodes;

  const visited = new Set();
  const ordered = [];

  function dfs(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    if (node) ordered.push(node);
    const outEdges = edges.filter((e) => e.source === nodeId);
    for (const e of outEdges) {
      dfs(e.target);
    }
  }

  dfs(start.id);

  // Append unreachable nodes
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n);
  }

  return ordered;
}

// ── Step map (start at 4, increment by 3) ────────────────────────────────────
//
// State 1 = auto-generated Wait/Home state
// States 4, 7, 10, … = user's action nodes
// Last step + 3 = auto-generated Complete state

function buildStepMap(orderedNodes, devices) {
  const map = {};
  let currentStep = STEP_BASE; // starts at 10 (wait state)

  orderedNodes.forEach((n) => {
    currentStep += STEP_INCREMENT;
    map[n.id] = currentStep;

    // VisionSystem Inspect nodes consume 4 sub-states (N, N+3, N+6, N+9)
    const hasVisionInspect = (n.data?.actions ?? []).some(a => {
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
    });
    if (hasVisionInspect) {
      currentStep += STEP_INCREMENT * 3; // consumed 3 extra slots (4 total sub-states)
    }
  });

  return map;
}

/** Get the vision sub-step numbers for a node, or null if not a vision node */
function getVisionSubSteps(node, devices, stepMap) {
  const baseStep = stepMap[node.id];
  if (baseStep === undefined) return null;
  const hasVisionInspect = (node.data?.actions ?? []).some(a => {
    const dev = (devices ?? []).find(d => d.id === a.deviceId);
    return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
  });
  if (!hasVisionInspect) return null;
  return [baseStep, baseStep + STEP_INCREMENT, baseStep + STEP_INCREMENT * 2, baseStep + STEP_INCREMENT * 3];
}

function getWaitStep() {
  return STEP_BASE; // always 10
}

function getCompleteStep(orderedNodes, devices) {
  // Calculate total step slots used (accounting for vision multi-step nodes)
  let totalSlots = orderedNodes.length;
  for (const n of orderedNodes) {
    const hasVisionInspect = (n.data?.actions ?? []).some(a => {
      const dev = (devices ?? []).find(d => d.id === a.deviceId);
      return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
    });
    if (hasVisionInspect) totalSlots += 3; // 3 extra sub-state slots (4 total sub-states)
  }
  return STEP_BASE + STEP_INCREMENT * (totalSlots + 1);
}

// ── State description for Status tag comments ────────────────────────────────

function getStateDescription(node, devices) {
  const actions = node?.data?.actions ?? [];
  if (actions.length === 0) return node?.data?.label ?? 'Empty State';

  return actions
    .map((a) => {
      const dev = devices.find((d) => d.id === a.deviceId);
      if (!dev) return a.operation ?? '?';
      if (a.operation === 'ServoMove') {
        return `Move ${dev.displayName} to ${a.positionName ?? '?'}`;
      }
      if (a.operation === 'ServoIncr') {
        return a.positionName
          ? `Increment ${dev.displayName} — ${a.positionName} (${a.incrementDist ?? 1}mm)`
          : `Increment ${dev.displayName} (${a.incrementDist ?? 1}mm)`;
      }
      if (a.operation === 'ServoIndex') {
        return a.positionName
          ? `Index ${dev.displayName} — ${a.positionName} (${a.indexStations ?? 6}-pos)`
          : `Index ${dev.displayName} (${a.indexStations ?? 6}-pos)`;
      }
      if (a.operation === 'VisionInspect') {
        return `${dev.displayName} Inspect ${a.jobName ?? ''}`;
      }
      return `${a.operation} ${dev.displayName}`;
    })
    .join(', ');
}

// ── Rung builder ─────────────────────────────────────────────────────────────

function buildRung(number, comment, text) {
  let xml = `\n<Rung Number="${number}" Type="N">`;
  if (comment) {
    xml += `\n<Comment>\n${cdata(comment)}\n</Comment>`;
  }
  xml += `\n<Text>\n${cdata(text)}\n</Text>`;
  xml += `\n</Rung>`;
  return xml;
}

// ── Tag XML builders ─────────────────────────────────────────────────────────

function buildTimerTagXml(name, description, preMs) {
  return `
<Tag Name="${name}" TagType="Base" DataType="TIMER" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(`[0,${preMs},0]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="TIMER">
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="${preMs}"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

function buildBoolTagXml(name, description, usage, externalAccess = 'Read/Write') {
  const usageAttr = usage ? ` Usage="${usage}"` : '';
  return `
<Tag Name="${name}" TagType="Base" DataType="BOOL" Radix="Decimal"${usageAttr} Constant="false" ExternalAccess="${externalAccess}" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata('0')}
</Data>
<Data Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</Data>
</Tag>`;
}

function buildDintTagXml(name, description, defaultValue = 0) {
  return `
<Tag Name="${name}" TagType="Base" DataType="DINT" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue))}
</Data>
<Data Format="Decorated">
<DataValue DataType="DINT" Radix="Decimal" Value="${defaultValue}"/>
</Data>
</Tag>`;
}

function buildRealTagXml(name, description, defaultValue = 0.0) {
  return `
<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue.toFixed(6)))}
</Data>
<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="${defaultValue.toFixed(6)}"/>
</Data>
</Tag>`;
}

// ── Servo-specific tag XML builders ──────────────────────────────────────────

function buildAxisTagXml(name, description) {
  return `
<Tag Name="${name}" TagType="Base" DataType="AXIS_CIP_DRIVE" Usage="InOut" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
</Tag>`;
}

function buildMotionInstructionTagXml(name, description) {
  // MOTION_INSTRUCTION is a system-defined type whose members vary by firmware.
  // Omit Data sections — the controller initialises defaults on import.
  return `
<Tag Name="${name}" TagType="Base" DataType="MOTION_INSTRUCTION" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
</Tag>`;
}

function buildMAMParamTagXml(name) {
  return `
<Tag Name="${name}" TagType="Base" DataType="MAMParam" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0.00000000e+000,0.00000000e+000,0.00000000e+000,0.00000000e+000]')}
</Data>
<Data Format="Decorated">
<Structure DataType="MAMParam">
<DataValueMember Name="MoveType" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Position" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Speed" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Accel" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Decel" DataType="REAL" Radix="Float" Value="0.0"/>
</Structure>
</Data>
</Tag>`;
}

function buildRangeCheckTagXml(name, description) {
  return `
<Tag Name="${name}" TagType="Base" DataType="AOI_RangeCheck" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata('[1,0.00000000e+000,0.00000000e+000,0.00000000e+000,0.00000000e+000,0]')}
</Data>
<Data Format="Decorated">
<Structure DataType="AOI_RangeCheck">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
<DataValueMember Name="Value" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Deadband" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="Actual" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="In_Range" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

function buildRealParamTagXml(name, description, defaultValue = 0.0, usage = 'Local') {
  // Only include Usage attribute for 'Public' or 'InOut'; omit for local scope
  const usageAttr = (usage && usage !== 'Local') ? ` Usage="${usage}"` : '';
  return `
<Tag Name="${name}" TagType="Base" DataType="REAL" Radix="Float"${usageAttr} Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata(description)}
</Description>
<Data Format="L5K">
${cdata(String(defaultValue.toFixed(6)))}
</Data>
<Data Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="${defaultValue.toFixed(6)}"/>
</Data>
</Tag>`;
}

// ── 128-element BOOL array helpers ───────────────────────────────────────────

function generate128BoolL5K() {
  return Array(128).fill('2#0').join(',');
}

function generate128BoolDecorated() {
  const lines = [];
  for (let i = 0; i < 128; i++) {
    lines.push(`<Element Index="[${i}]" Value="0"/>`);
  }
  return lines.join('\n');
}

// ── Control tag (StateLogicControl UDT) ──────────────────────────────────────

function buildControlTagXml() {
  return `
<Tag Name="Control" TagType="Base" DataType="StateLogicControl" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0,0,0]')}
</Data>
<Data Format="Decorated">
<Structure DataType="StateLogicControl">
<DataValueMember Name="StateReg" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EnaFaultDetect" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnaTransitionTimer" DataType="BOOL" Value="0"/>
<DataValueMember Name="FaultTime" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="TransitionTime" DataType="DINT" Radix="Decimal" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── Status tag (StateLogicStatus UDT) with state comments ────────────────────

function buildStatusTagXml(orderedNodes, stepMap, devices) {
  // Build state comments
  const waitStep = getWaitStep();
  const completeStep = getCompleteStep(orderedNodes, devices);
  const comments = [];

  comments.push(
    `<Comment Operand=".STATE[${waitStep}]">\n${cdata('Wait For Ready')}\n</Comment>`
  );

  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    const desc = getStateDescription(node, devices);
    const visionSubs = getVisionSubSteps(node, devices, stepMap);

    if (visionSubs) {
      // Vision sub-state comments (4 sub-states)
      const visionDevice = (devices ?? []).find(d => {
        return d.type === 'VisionSystem' && (node.data?.actions ?? []).some(a => a.deviceId === d.id);
      });
      const devName = visionDevice?.displayName ?? 'Vision';
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[0]}]">\n${cdata(`${devName} - Verify Trigger Ready`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[1]}]">\n${cdata(`${devName} - Wait Timer`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[2]}]">\n${cdata(`${devName} - Trigger`)}\n</Comment>`
      );
      comments.push(
        `<Comment Operand=".STATE[${visionSubs[3]}]">\n${cdata(`${devName} - Check Results`)}\n</Comment>`
      );
    } else {
      comments.push(
        `<Comment Operand=".STATE[${step}]">\n${cdata(desc)}\n</Comment>`
      );
    }
  }

  comments.push(
    `<Comment Operand=".STATE[${completeStep}]">\n${cdata('Complete')}\n</Comment>`
  );

  const boolL5K = generate128BoolL5K();
  const boolDec = generate128BoolDecorated();

  return `
<Tag Name="Status" TagType="Base" DataType="StateLogicStatus" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Comments>
${comments.join('\n')}
</Comments>
<Data Format="L5K">
${cdata(`[[${boolL5K}],0,0]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="StateLogicStatus">
<ArrayMember Name="State" DataType="BOOL" Dimensions="128" Radix="Decimal">
${boolDec}
</ArrayMember>
<DataValueMember Name="PreviousState" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="StateChangeOccurred_OS" DataType="BOOL" Value="0"/>
<DataValueMember Name="TimeoutFlt" DataType="BOOL" Value="0"/>
<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── StateEngine tag (AOI instance) ───────────────────────────────────────────

function buildStateEngineTagXml() {
  const boolL5K = generate128BoolL5K();

  return `
<Tag Name="StateEngine" TagType="Base" DataType="State_Engine_128Max" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata(`[1,[1,0,0,0,0,0,0,0,0,4,0,0],0,0,[1,0,0,0,0,0,0,0,0,4,0,0],[[${boolL5K}],0,0],0]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="State_Engine_128Max">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
</Structure>
</Data>
</Tag>`;
}

// ── StateHistory tag (SINT[10]) ──────────────────────────────────────────────

function buildStateHistoryTagXml() {
  return `
<Tag Name="StateHistory" TagType="Base" DataType="SINT" Dimensions="10" Radix="Decimal" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
${cdata('[0,0,0,0,0,0,0,0,0,0]')}
</Data>
<Data Format="Decorated">
<Array DataType="SINT" Dimensions="10" Radix="Decimal">
<Element Index="[0]" Value="0"/>
<Element Index="[1]" Value="0"/>
<Element Index="[2]" Value="0"/>
<Element Index="[3]" Value="0"/>
<Element Index="[4]" Value="0"/>
<Element Index="[5]" Value="0"/>
<Element Index="[6]" Value="0"/>
<Element Index="[7]" Value="0"/>
<Element Index="[8]" Value="0"/>
<Element Index="[9]" Value="0"/>
</Array>
</Data>
</Tag>`;
}

// ── Generate all program tags ────────────────────────────────────────────────

function generateAllTags(sm, orderedNodes, stepMap, trackingFields = []) {
  const tags = [];
  const seen = new Set();

  function addTag(xml, name) {
    if (!seen.has(name)) {
      seen.add(name);
      tags.push(xml);
    }
  }

  // State engine infrastructure tags
  addTag(buildControlTagXml(), 'Control');
  addTag(buildStatusTagXml(orderedNodes, stepMap, sm.devices ?? []), 'Status');
  addTag(buildStateEngineTagXml(), 'StateEngine');
  addTag(buildStateHistoryTagXml(), 'StateHistory');

  // q_Ready — Public so other programs can reference \ProgramName.q_Ready
  addTag(
    buildBoolTagXml('q_Ready', 'Station Ready', 'Public', 'Read Only'),
    'q_Ready'
  );

  // Per-device tags (I/O + delay timers, NO debounce, NO fault timers)
  for (const device of sm.devices ?? []) {
    const typeDef = DEVICE_TYPES[device.type];
    if (!typeDef) continue;
    const patterns = typeDef.tagPatterns;
    const sensorConfig = getSensorConfigKey(device);

    switch (device.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        // Sensor inputs
        if (sensorConfig === 'both') {
          addTag(
            buildBoolTagXml(
              patterns.inputExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Extended`,
              'Input'
            ),
            patterns.inputExt.replace(/\{name\}/g, device.name)
          );
          addTag(
            buildBoolTagXml(
              patterns.inputRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Retracted`,
              'Input'
            ),
            patterns.inputRet.replace(/\{name\}/g, device.name)
          );
          // 2-sensor: NO delay timers needed (direct sensor checks)
        } else if (sensorConfig === 'retractOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Retracted`,
              'Input'
            ),
            patterns.inputRet.replace(/\{name\}/g, device.name)
          );
          // 1-sensor (Ret only): need ExtDelay timer for R01 pattern
          addTag(
            buildTimerTagXml(
              patterns.timerExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Extended Delay Timer`,
              device.extTimerMs ?? typeDef.defaultTimerPreMs
            ),
            patterns.timerExt.replace(/\{name\}/g, device.name)
          );
        } else if (sensorConfig === 'extendOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputExt.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Extended`,
              'Input'
            ),
            patterns.inputExt.replace(/\{name\}/g, device.name)
          );
          addTag(
            buildTimerTagXml(
              patterns.timerRet.replace(/\{name\}/g, device.name),
              `${device.displayName} Retracted Delay Timer`,
              device.retTimerMs ?? typeDef.defaultTimerPreMs
            ),
            patterns.timerRet.replace(/\{name\}/g, device.name)
          );
        }

        // Output solenoids
        addTag(
          buildBoolTagXml(
            patterns.outputExtend.replace(/\{name\}/g, device.name),
            `Extend ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputExtend.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputRetract.replace(/\{name\}/g, device.name),
            `Retract ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputRetract.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'PneumaticGripper': {
        // Sensor inputs (only if device has sensors)
        if (sensorConfig === 'both' || sensorConfig === 'engageOnly') {
          addTag(
            buildBoolTagXml(
              patterns.inputEngage.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Engaged`,
              'Input'
            ),
            patterns.inputEngage.replace(/\{name\}/g, device.name)
          );
        }
        if (sensorConfig === 'both') {
          addTag(
            buildBoolTagXml(
              patterns.inputDisengage.replace(/\{name\}/g, device.name),
              `${device.displayName} Is Disengaged`,
              'Input'
            ),
            patterns.inputDisengage.replace(/\{name\}/g, device.name)
          );
        }

        // Output solenoids
        addTag(
          buildBoolTagXml(
            patterns.outputEngage.replace(/\{name\}/g, device.name),
            `Engage ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputEngage.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputDisengage.replace(/\{name\}/g, device.name),
            `Disengage ${device.displayName}`,
            'Output',
            'Read Only'
          ),
          patterns.outputDisengage.replace(/\{name\}/g, device.name)
        );

        // Delay timers (always needed — gripper uses inline TON in R02)
        addTag(
          buildTimerTagXml(
            patterns.timerEngage.replace(/\{name\}/g, device.name),
            `${device.displayName} Engage Delay Timer`,
            device.engageTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerEngage.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildTimerTagXml(
            patterns.timerDisengage.replace(/\{name\}/g, device.name),
            `${device.displayName} Disengage Delay Timer`,
            device.disengageTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerDisengage.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'PneumaticVacGenerator': {
        addTag(
          buildBoolTagXml(
            patterns.inputVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vacuum Established`,
            'Input'
          ),
          patterns.inputVacOn.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac On`,
            'Output',
            'Read Only'
          ),
          patterns.outputVacOn.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildBoolTagXml(
            patterns.outputVacOff.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac Off`,
            'Output',
            'Read Only'
          ),
          patterns.outputVacOff.replace(/\{name\}/g, device.name)
        );
        addTag(
          buildTimerTagXml(
            patterns.timerVacOn.replace(/\{name\}/g, device.name),
            `${device.displayName} Vac On Delay Timer`,
            device.vacOnTimerMs ?? typeDef.defaultTimerPreMs
          ),
          patterns.timerVacOn.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'Timer': {
        addTag(
          buildTimerTagXml(
            device.name,
            `${device.displayName} - Dwell Timer`,
            device.timerMs ?? typeDef.defaultTimerPreMs
          ),
          device.name
        );
        break;
      }

      case 'DigitalSensor': {
        addTag(
          buildBoolTagXml(
            patterns.inputTag.replace(/\{name\}/g, device.name),
            `${device.displayName} Sensor Input`,
            'Input'
          ),
          patterns.inputTag.replace(/\{name\}/g, device.name)
        );
        break;
      }

      case 'Parameter': {
        // Cross-SM parameters are defined in the source program — no local tag needed
        if (device.paramScope !== 'cross-sm') {
          const paramPrefix = device.dataType === 'boolean' ? 'q_' : 'p_';
          const paramTagName = `${paramPrefix}${device.name}`;
          if (device.dataType === 'numeric') {
            addTag(
              buildRealTagXml(paramTagName, `${device.displayName} - Parameter`),
              paramTagName
            );
          } else {
            addTag(
              buildBoolTagXml(paramTagName, `${device.displayName} - Parameter`, 'Public'),
              paramTagName
            );
          }
        }
        break;
      }

      case 'ServoAxis': {
        const sp = DEVICE_TYPES.ServoAxis.tagPatterns;
        const axisTag = getAxisTag(device);
        const mamTag = sp.mamControl.replace(/\{name\}/g, device.name);
        const motionParamTag = sp.motionParam.replace(/\{name\}/g, device.name);

        // Axis tag (AXIS_CIP_DRIVE, InOut)
        addTag(buildAxisTagXml(axisTag, `${device.displayName} - CIP Axis`), axisTag);

        // MAM control tag (MOTION_INSTRUCTION)
        addTag(buildMotionInstructionTagXml(mamTag, `${device.displayName} - MAM`), mamTag);

        // Motion parameters tag (MAMParam UDT)
        addTag(buildMAMParamTagXml(motionParamTag), motionParamTag);

        // Position parameters and per-position Range Check tags
        if (device.positions) {
          for (const pos of device.positions) {
            const posTag = sp.positionParam
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, pos.name);
            const rcTag = sp.positionRC
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, pos.name);
            const usage = pos.isRecipe ? 'Public' : 'Local';

            addTag(
              buildRealParamTagXml(
                posTag,
                `${device.displayName} - ${pos.name} Position`,
                pos.defaultValue ?? 0.0,
                usage
              ),
              posTag
            );
            addTag(
              buildRangeCheckTagXml(rcTag, `${device.displayName} - At ${pos.name} Position`),
              rcTag
            );
          }
        }
        // Increment parameter tag (for ServoIncr operations)
        if (sp.incrementParam) {
          const incrTag = sp.incrementParam.replace(/\{name\}/g, device.name);
          addTag(
            buildRealParamTagXml(incrTag, `${device.displayName} - Increment Distance`, 0.0, 'Public'),
            incrTag
          );
        }
        // Index Angle parameter tag (for ServoIndex operations)
        if (sp.indexAngleParam) {
          const indexTag = sp.indexAngleParam.replace(/\{name\}/g, device.name);
          addTag(
            buildRealParamTagXml(indexTag, `${device.displayName} - Index Angle`, 0.0, 'Public'),
            indexTag
          );
        }
        break;
      }

      case 'VisionSystem': {
        const vp = DEVICE_TYPES.VisionSystem.tagPatterns;
        const trigReadyTag = vp.triggerReady.replace(/\{name\}/g, device.name);
        const triggerTag   = vp.trigger.replace(/\{name\}/g, device.name);
        const waitTimerTag = vp.waitTimer.replace(/\{name\}/g, device.name);
        const trigDwellTag = vp.trigDwell.replace(/\{name\}/g, device.name);

        // Trigger Ready input
        addTag(
          buildBoolTagXml(trigReadyTag, `${device.displayName} - Trigger Ready`, 'Input'),
          trigReadyTag
        );
        // Trigger output
        addTag(
          buildBoolTagXml(triggerTag, `${device.displayName} - Camera Trigger`, 'Output', 'Read Only'),
          triggerTag
        );
        // Wait Timer (between trigger ready and trigger)
        addTag(
          buildTimerTagXml(waitTimerTag, `${device.displayName} - Wait Timer`, device.waitTimerMs ?? 100),
          waitTimerTag
        );
        // Trigger Dwell Timer (after trigger, before next state)
        addTag(
          buildTimerTagXml(trigDwellTag, `${device.displayName} - Trigger Dwell`, device.trigDwellMs ?? 500),
          trigDwellTag
        );
        // Result Ready input
        const resultReadyTag = vp.resultReady.replace(/\{name\}/g, device.name);
        addTag(
          buildBoolTagXml(resultReadyTag, `${device.displayName} - Result Ready`, 'Input'),
          resultReadyTag
        );
        // Inspection Pass input
        const inspPassTag = vp.inspPass.replace(/\{name\}/g, device.name);
        addTag(
          buildBoolTagXml(inspPassTag, `${device.displayName} - Inspection Pass`, 'Input'),
          inspPassTag
        );
        // Search Timeout timer (for continuous mode — check if any action uses continuous)
        const searchTimeoutTag = vp.searchTimeout.replace(/\{name\}/g, device.name);
        addTag(
          buildTimerTagXml(searchTimeoutTag, `${device.displayName} - Search Timeout`, 5000),
          searchTimeoutTag
        );
        break;
      }
    }
  }

  // Retry counter tags for CheckResults outcomes with retry enabled
  for (const device of sm.devices ?? []) {
    if (device.type !== 'CheckResults') continue;
    for (const outcome of device.outcomes ?? []) {
      if (!outcome.retry) continue;
      const counterTag = `${device.name}_${outcome.id}_RetryCnt`;
      addTag(
        buildDintTagXml(counterTag, `${device.displayName} Branch retry counter`),
        counterTag
      );
      const maxTag = `${device.name}_${outcome.id}_MaxRetries`;
      addTag(
        buildDintTagXml(maxTag, `${device.displayName} Branch max retries`, outcome.maxRetries ?? 3),
        maxTag
      );
    }
  }

  // PartTracking tag instance (if any fields are defined)
  if (trackingFields.length > 0) {
    // Build L5K and Decorated data for the UDT instance
    const sintCount = Math.ceil(trackingFields.length / 8);
    const l5kData = Array(sintCount).fill('0').join(',');
    let decoratedMembers = '';
    trackingFields.forEach((f, i) => {
      const sintIdx = Math.floor(i / 8);
      const bitNum = i % 8;
      decoratedMembers += `<DataValueMember Name="${escapeXml(f.name)}" DataType="BOOL" Value="0"/>\n`;
    });
    addTag(`
<Tag Name="PartTracking" TagType="Base" DataType="PartTracking_UDT" Usage="Public" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
${cdata('Part Tracking Data')}
</Description>
<Data Format="L5K">
${cdata(`[${l5kData}]`)}
</Data>
<Data Format="Decorated">
<Structure DataType="PartTracking_UDT">
${decoratedMembers}</Structure>
</Data>
</Tag>`, 'PartTracking');
  }

  // SM Output BOOL tags (p_OutputName) — one per smOutput entry
  for (const smOut of sm.smOutputs ?? []) {
    if (!smOut.name) continue;
    const tag = `p_${smOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
    const desc = smOut.description ? smOut.description : `SM Output: ${smOut.name}`;
    addTag(buildBoolTagXml(tag, desc, 'Public'), tag);
  }

  return tags.join('\n');
}

// ── R00_Main ─────────────────────────────────────────────────────────────────

function generateR00Main() {
  const rungs = [
    buildRung(0, 'Subroutine Calls', 'JSR(R01_Inputs,0);'),
    buildRung(1, null, 'JSR(R02_StateTransitions,0);'),
    buildRung(2, null, 'JSR(R03_StateLogic,0);'),
  ];

  return `
<Routine Name="R00_Main" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── R01_Inputs ───────────────────────────────────────────────────────────────
//
// Only for 1-sensor pneumatic actuators:
//   XIO(existing_sensor) → TON(delay_timer,?,?)
// Derives the "missing" sensor via time delay.

function generateR01Inputs(sm) {
  const rungs = [];
  let rungNum = 0;
  let addedComment = false;

  for (const device of sm.devices ?? []) {
    if (
      device.type !== 'PneumaticLinearActuator' &&
      device.type !== 'PneumaticRotaryActuator'
    )
      continue;

    const sensorConfig = getSensorConfigKey(device);
    const patterns = DEVICE_TYPES[device.type]?.tagPatterns;
    if (!patterns) continue;

    if (sensorConfig === 'retractOnly') {
      // XIO(i_{name}Ret) → TON({name}ExtDelay,?,?)
      const retSensor = patterns.inputRet.replace(/\{name\}/g, device.name);
      const extDelay = patterns.timerExt.replace(/\{name\}/g, device.name);
      rungs.push(
        buildRung(
          rungNum++,
          !addedComment ? 'Sensors' : null,
          `XIO(${retSensor})TON(${extDelay},?,?);`
        )
      );
      addedComment = true;
    } else if (sensorConfig === 'extendOnly') {
      const extSensor = patterns.inputExt.replace(/\{name\}/g, device.name);
      const retDelay = patterns.timerRet.replace(/\{name\}/g, device.name);
      rungs.push(
        buildRung(
          rungNum++,
          !addedComment ? 'Sensors' : null,
          `XIO(${extSensor})TON(${retDelay},?,?);`
        )
      );
      addedComment = true;
    }
    // 2-sensor: no R01 rung needed
  }

  if (rungs.length === 0) {
    rungs.push(buildRung(0, 'No sensor input processing required', 'NOP();'));
  }

  return `
<Routine Name="R01_Inputs" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── Verify condition builder ─────────────────────────────────────────────────
//
// Given a source state's actions, build the ladder rung condition text
// that verifies all actions completed before allowing transition.
//
// Patterns (matching CE output):
//   2-sensor cylinder Extend:  XIC(i_{name}Ext)XIO(i_{name}Ret)
//   2-sensor cylinder Retract: XIC(i_{name}Ret)XIO(i_{name}Ext)
//   1-sensor (Ret) Extend:     XIC({name}ExtDelay.DN)
//   1-sensor (Ret) Retract:    XIC(i_{name}Ret)
//   Gripper (any):             TON({name}XXXDelay,?,?)XIC({name}XXXDelay.DN)
//   Timer/Dwell:               TON({name},?,?)XIC({name}.DN)
//   DigitalSensor WaitOn:      XIC(i_{name})
//   DigitalSensor WaitOff:     XIO(i_{name})
//   VacGenerator VacOn:        XIC(i_{name}VacOn)

function buildVerifyConditions(node, devices, allSMs = [], trackingFields = []) {
  const actions = node?.data?.actions ?? [];
  if (actions.length === 0) return '';

  let conditions = '';

  for (const action of actions) {
    // Skip tracking actions — they are output latches, not verify conditions
    if (action.deviceId === '_tracking') continue;

    const device = devices.find((d) => d.id === action.deviceId);
    if (!device) continue;

    // CheckResults with 2+ outcomes: branching handled in R02 (skip here)
    // CheckResults with 1 outcome: single-condition verify (generate XIC/XIO inline)
    if (device.type === 'CheckResults') {
      const outcomes = device.outcomes ?? [];
      if (outcomes.length === 1 && outcomes[0].inputRef) {
        const out = outcomes[0];
        const tag = resolveInputRefTag(out.inputRef, devices, allSMs, trackingFields);
        if (tag) {
          const isOff = out.condition === 'off' || out.condition === 'outOfRange';
          // _allPass returns "tag1 AND tag2 …" — expand to multiple XIC/XIO
          const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
          for (const t of tagList) {
            conditions += isOff ? `XIO(${t})` : `XIC(${t})`;
          }
        }
      }
      continue;
    }
    // VisionSystem has internal sub-state transitions — handled separately in R02
    if (device.type === 'VisionSystem') continue;

    const typeDef = DEVICE_TYPES[device.type];
    if (!typeDef) continue;
    const patterns = typeDef.tagPatterns;
    const sensorConfig = getSensorConfigKey(device);

    switch (device.type) {
      case 'PneumaticLinearActuator':
      case 'PneumaticRotaryActuator': {
        if (sensorConfig === 'both') {
          if (action.operation === 'Extend') {
            const extTag = patterns.inputExt.replace(/\{name\}/g, device.name);
            const retTag = patterns.inputRet.replace(/\{name\}/g, device.name);
            conditions += `XIC(${extTag})XIO(${retTag})`;
          } else if (action.operation === 'Retract') {
            const retTag = patterns.inputRet.replace(/\{name\}/g, device.name);
            const extTag = patterns.inputExt.replace(/\{name\}/g, device.name);
            conditions += `XIC(${retTag})XIO(${extTag})`;
          }
        } else if (sensorConfig === 'retractOnly') {
          if (action.operation === 'Extend') {
            const delayTag = patterns.timerExt.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${delayTag}.DN)`;
          } else if (action.operation === 'Retract') {
            const retTag = patterns.inputRet.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${retTag})`;
          }
        } else if (sensorConfig === 'extendOnly') {
          if (action.operation === 'Extend') {
            const extTag = patterns.inputExt.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${extTag})`;
          } else if (action.operation === 'Retract') {
            const delayTag = patterns.timerRet.replace(
              /\{name\}/g,
              device.name
            );
            conditions += `XIC(${delayTag}.DN)`;
          }
        }
        break;
      }

      case 'PneumaticGripper': {
        if (action.operation === 'Engage') {
          const tmr = patterns.timerEngage.replace(/\{name\}/g, device.name);
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        } else if (action.operation === 'Disengage') {
          const tmr = patterns.timerDisengage.replace(
            /\{name\}/g,
            device.name
          );
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        }
        break;
      }

      case 'PneumaticVacGenerator': {
        if (action.operation === 'VacOn') {
          const sensorTag = patterns.inputVacOn.replace(
            /\{name\}/g,
            device.name
          );
          conditions += `XIC(${sensorTag})`;
        } else if (action.operation === 'VacOff') {
          const tmr = patterns.timerVacOn.replace(/\{name\}/g, device.name);
          conditions += `TON(${tmr},?,?)XIC(${tmr}.DN)`;
        }
        break;
      }

      case 'ServoAxis': {
        const mamTag = patterns.mamControl.replace(/\{name\}/g, device.name);
        conditions += `XIC(${mamTag}.PC)`;
        // Position In_Range only for ServoMove (not ServoIncr/ServoIndex)
        if (action.operation === 'ServoMove') {
          const posName = action.positionName ?? '';
          if (posName) {
            const rcTag = patterns.positionRC
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, posName);
            conditions += `XIC(${rcTag}.In_Range)`;
          }
        }
        break;
      }

      case 'Timer': {
        conditions += `TON(${device.name},?,?)XIC(${device.name}.DN)`;
        break;
      }

      case 'DigitalSensor': {
        const sensorTag = patterns.inputTag.replace(
          /\{name\}/g,
          device.name
        );
        if (
          action.operation === 'WaitOn' ||
          action.operation === 'Verify'
        ) {
          conditions += `XIC(${sensorTag})`;
        } else if (action.operation === 'WaitOff') {
          conditions += `XIO(${sensorTag})`;
        }
        break;
      }

      case 'AnalogSensor': {
        // VerifyValue: check AOI_RangeCheck In_Range bit for the selected setpoint
        const spName = action.setpointName ?? '';
        if (spName) {
          const rcTag = patterns.rangeCheckInst
            .replace(/\{name\}/g, device.name)
            .replace(/\{setpointName\}/g, spName);
          conditions += `XIC(${rcTag}.In_Range)`;
        }
        break;
      }

      case 'Parameter': {
        // WaitOn → XIC(p_Name), WaitOff → XIO(p_Name)
        // SetOn/SetOff/SetValue are outputs (handled in R03) — no verify condition
        const paramTag = getParameterTag(device, allSMs);
        if (action.operation === 'WaitOn') {
          conditions += `XIC(${paramTag})`;
        } else if (action.operation === 'WaitOff') {
          conditions += `XIO(${paramTag})`;
        }
        break;
      }
    }
  }

  return conditions;
}

// ── Home verify conditions ──────────────────────────────────────────────────
//
// Build verify conditions for the wait→first action transition.
// Checks that all devices with a homePosition are in their home state.
// Reuses the same verify patterns as buildVerifyConditions.

function buildHomeVerifyConditions(devices, allSMs = [], trackingFields = []) {
  // Create virtual actions from each device's home position
  // Fall back to defaultHomePosition from device type if not explicitly set
  const virtualActions = (devices ?? [])
    .map(d => ({
      deviceId: d.id,
      operation: d.homePosition || DEVICE_TYPES[d.type]?.defaultHomePosition,
    }))
    .filter(a => a.operation);

  if (virtualActions.length === 0) return '';

  const virtualNode = { data: { actions: virtualActions } };
  return buildVerifyConditions(virtualNode, devices, allSMs, trackingFields);
}

// ── R02_StateTransitions ─────────────────────────────────────────────────────

function generateR02StateTransitions(sm, orderedNodes, stepMap, allSMs = [], trackingFields = []) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];
  const waitStep = getWaitStep();

  // Check for explicit complete node — if present, use its step instead of auto-calculated
  const explicitCompleteNode = orderedNodes.find(n => n.data?.isComplete);
  const completeStep = explicitCompleteNode
    ? stepMap[explicitCompleteNode.id]
    : getCompleteStep(orderedNodes, devices);

  // Rung 0: Complete → Wait (loop back)
  rungs.push(
    buildRung(
      rungNum++,
      `State ${waitStep}: Wait For Ready`,
      `XIC(Status.State[${completeStep}])MOVE(${waitStep},Control.StateReg);`
    )
  );

  // Rung 1: Wait → first action state (with home position verify conditions)
  if (orderedNodes.length > 0) {
    const firstStep = stepMap[orderedNodes[0].id];
    const homeConditions = buildHomeVerifyConditions(devices, allSMs, trackingFields);
    rungs.push(
      buildRung(
        rungNum++,
        `State ${firstStep}: ${getStateDescription(orderedNodes[0], devices)}`,
        `XIC(Status.State[${waitStep}])${homeConditions}MOVE(${firstStep},Control.StateReg);`
      )
    );
  }

  // Rungs for each transition between action states
  const edges = sm.edges ?? [];
  // Track nodes that we've already generated branching rungs for
  const branchHandled = new Set();

  for (let i = 0; i < orderedNodes.length - 1; i++) {
    const srcNode = orderedNodes[i];
    const srcStep = stepMap[srcNode.id];

    // Skip complete nodes — they just loop back to wait (handled by the Complete→Wait rung above)
    if (srcNode.data?.isComplete) continue;

    // Check if this node has a CheckResults action with 2+ outcomes → branching
    const checkAction = (srcNode.data?.actions ?? []).find(a => {
      const dev = devices.find(d => d.id === a.deviceId);
      return dev?.type === 'CheckResults' && (dev.outcomes ?? []).length >= 2;
    });

    if (checkAction) {
      branchHandled.add(srcNode.id);
      const checkDevice = devices.find(d => d.id === checkAction.deviceId);
      const outcomes = checkDevice?.outcomes ?? [];

      // Find outgoing edges from this node
      const outEdges = edges.filter(e => e.source === srcNode.id);

      for (const outEdge of outEdges) {
        const tgtNode = orderedNodes.find(n => n.id === outEdge.target);
        if (!tgtNode) continue;
        const tgtStep = stepMap[tgtNode.id];
        if (tgtStep === undefined) continue;

        const outcomeId = outEdge.data?.outcomeId;
        const outcomeLabel = outEdge.data?.outcomeLabel ?? 'branch';
        const desc = getStateDescription(tgtNode, devices);

        // Find the matching outcome to get its per-outcome param data
        const outcome = outcomes.find(o => o.id === outcomeId);

        // Resolve per-outcome branch condition — unified inputRef or legacy sourceType
        let branchCond = '';
        if (outcome?.inputRef) {
          // New unified format: inputRef = "deviceId:key" or "deviceId:cross:smId" or "_tracking:fieldId"
          const tag = resolveInputRefTag(outcome.inputRef, devices, allSMs, trackingFields);
          if (tag) {
            const isOff = outcome.condition === 'off' || outcome.condition === 'outOfRange';
            // _allPass returns "tag1 AND tag2 …" — expand to multiple XIC/XIO
            const tagList = tag.includes(' AND ') ? tag.split(' AND ') : [tag];
            branchCond = tagList.map(t => isOff ? `XIO(${t})` : `XIC(${t})`).join('');
          }
        } else if (outcome?.sourceType === 'digitalSensor' && outcome?.sensorDeviceId) {
          // Legacy: DigitalSensor
          const sensorDev = devices.find(d => d.id === outcome.sensorDeviceId);
          if (sensorDev) branchCond = outcome.condition === 'off' ? `XIO(i_${sensorDev.name})` : `XIC(i_${sensorDev.name})`;
        } else if (outcome?.sourceType === 'analogSensor' && outcome?.sensorDeviceId) {
          // Legacy: AnalogSensor
          const sensorDev = devices.find(d => d.id === outcome.sensorDeviceId);
          if (sensorDev) {
            const rcTag = `${sensorDev.name}${outcome.setpointName ?? ''}RC.In_Range`;
            branchCond = outcome.condition === 'outOfRange' ? `XIO(${rcTag})` : `XIC(${rcTag})`;
          }
        } else if (outcome?.paramDeviceId) {
          // Legacy: Parameter
          let paramDev = devices.find(d => d.id === outcome.paramDeviceId);
          const pfx = paramDev?.dataType === 'boolean' ? 'q_' : 'p_';
          let paramTag = paramDev ? `${pfx}${paramDev.name}` : '';
          if (outcome.paramScope === 'cross-sm' && outcome.crossSmId) {
            const crossSm = allSMs.find(s => s.id === outcome.crossSmId);
            if (crossSm) {
              const crossParamDev = (crossSm.devices ?? []).find(d => d.id === outcome.paramDeviceId);
              if (crossParamDev) {
                const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
                paramTag = `\\${progName}.${crossParamDev.dataType === 'boolean' ? 'q_' : 'p_'}${crossParamDev.name}`;
              }
            }
          }
          if (paramTag) branchCond = outcome.condition === 'off' ? `XIO(${paramTag})` : `XIC(${paramTag})`;
        }

        // Retry logic: if outcome has retry, generate fault-check + increment rungs
        if (outcome?.retry && checkDevice) {
          const counterTag = `${checkDevice.name}_${outcome.id}_RetryCnt`;
          const maxTag = `${checkDevice.name}_${outcome.id}_MaxRetries`;
          const faultStep = 127; // SDC standard: all faults → state 127

          // Rung 1: condition met AND counter >= max → fault
          rungs.push(
            buildRung(
              rungNum++,
              `State ${faultStep}: FAULT — ${outcomeLabel} retries exceeded`,
              `XIC(Status.State[${srcStep}])${branchCond}GEQ(${counterTag},${maxTag})MOVE(${faultStep},Control.StateReg);`
            )
          );
          // Rung 2: condition met AND counter < max → increment + go to recovery path
          rungs.push(
            buildRung(
              rungNum++,
              `State ${tgtStep}: ${desc} [${outcomeLabel}] (retry)`,
              `XIC(Status.State[${srcStep}])${branchCond}LES(${counterTag},${maxTag})[ADD(${counterTag},1,${counterTag}),MOVE(${tgtStep},Control.StateReg)];`
            )
          );
        } else {
          // No retry — collect counter resets from sibling outcomes that have retry
          let resetRungs = '';
          if (checkDevice) {
            for (const sib of outcomes) {
              if (sib.retry && sib.id !== outcome?.id) {
                const sibCounter = `${checkDevice.name}_${sib.id}_RetryCnt`;
                resetRungs += `MOVE(0,${sibCounter})`;
              }
            }
          }

          rungs.push(
            buildRung(
              rungNum++,
              `State ${tgtStep}: ${desc} [${outcomeLabel}]`,
              `XIC(Status.State[${srcStep}])${branchCond}${resetRungs}MOVE(${tgtStep},Control.StateReg);`
            )
          );
        }
      }
    } else {
      // Check if this node has a VisionSystem Inspect action → multi-step
      const visionSubs = getVisionSubSteps(srcNode, devices, stepMap);

      if (visionSubs) {
        // VisionSystem generates 4 internal sub-state transitions:
        //   [0] Verify Trigger Ready → [1] Wait Timer → [2] Trigger → [3] Check Results
        const visionAction = (srcNode.data?.actions ?? []).find(a => {
          const dev = devices.find(d => d.id === a.deviceId);
          return dev?.type === 'VisionSystem' && (a.operation === 'Inspect' || a.operation === 'VisionInspect');
        });
        const visionDevice = visionAction ? devices.find(d => d.id === visionAction.deviceId) : null;

        if (visionDevice) {
          const trigReadyTag  = DEVICE_TYPES.VisionSystem.tagPatterns.triggerReady.replace(/\{name\}/g, visionDevice.name);
          const waitTimerTag  = DEVICE_TYPES.VisionSystem.tagPatterns.waitTimer.replace(/\{name\}/g, visionDevice.name);
          const trigDwellTag  = DEVICE_TYPES.VisionSystem.tagPatterns.trigDwell.replace(/\{name\}/g, visionDevice.name);
          const resultReadyTag = DEVICE_TYPES.VisionSystem.tagPatterns.resultReady.replace(/\{name\}/g, visionDevice.name);

          // Sub-state [0]→[1]: Verify Trigger Ready → Wait Timer
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[1]}: ${visionDevice.displayName} - Wait Timer`,
              `XIC(Status.State[${visionSubs[0]}])XIC(${trigReadyTag})MOVE(${visionSubs[1]},Control.StateReg);`
            )
          );

          // Sub-state [1]→[2]: Wait Timer → Trigger
          // waitTimerTag runs while in state [1] (before trigger fires)
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[2]}: ${visionDevice.displayName} - Trigger`,
              `XIC(Status.State[${visionSubs[1]}])TON(${waitTimerTag},?,?)XIC(${waitTimerTag}.DN)MOVE(${visionSubs[2]},Control.StateReg);`
            )
          );

          // Sub-state [2]→[3]: Trigger → Check Results
          // trigDwellTag ensures trigger is held for minimum dwell time AND result is ready
          rungs.push(
            buildRung(
              rungNum++,
              `State ${visionSubs[3]}: ${visionDevice.displayName} - Check Results`,
              `XIC(Status.State[${visionSubs[2]}])TON(${trigDwellTag},?,?)XIC(${trigDwellTag}.DN)XIC(${resultReadyTag})MOVE(${visionSubs[3]},Control.StateReg);`
            )
          );

          // Sub-state [3] → branching (if VisionInspect with outcomes) or linear (old Inspect)
          const hasOutcomes = visionAction.operation === 'VisionInspect' && visionAction.outcomes?.length >= 2;

          if (hasOutcomes) {
            // Mark as branch-handled so we don't generate a normal transition
            branchHandled.add(srcNode.id);
            const inspPassTag = DEVICE_TYPES.VisionSystem.tagPatterns.inspPass.replace(/\{name\}/g, visionDevice.name);

            // Find outgoing edges from this node for VisionInspect branching
            const outEdges = edges.filter(e => e.source === srcNode.id);

            // Branch rungs for all configured outcomes (same for snap & continuous)
            for (const outEdge of outEdges) {
              const tgtNode = orderedNodes.find(n => n.id === outEdge.target);
              if (!tgtNode) continue;
              const tgtStep = stepMap[tgtNode.id];
              if (tgtStep === undefined) continue;

              const outcomeLabel = outEdge.data?.outcomeLabel ?? 'branch';
              const outcomeIdx = outEdge.data?.outcomeIndex ?? 0;
              const desc = getStateDescription(tgtNode, devices);

              // Default 2-outcome: Pass = XIC(InspPass), Fail = XIO(InspPass)
              const isPass = outcomeIdx === 0;
              const inspCond = isPass ? `XIC(${inspPassTag})` : `XIO(${inspPassTag})`;

              rungs.push(
                buildRung(
                  rungNum++,
                  `State ${tgtStep}: ${desc} [${outcomeLabel}]`,
                  `XIC(Status.State[${visionSubs[3]}])${inspCond}MOVE(${tgtStep},Control.StateReg);`
                )
              );
            }

            if (visionAction.continuous) {
              // Continuous mode extras: non-matching → loop back, timeout → fault 127
              const searchTimeoutTag = DEVICE_TYPES.VisionSystem.tagPatterns.searchTimeout.replace(/\{name\}/g, visionDevice.name);

              // Non-matching result → loop back to sub-state [0] (re-trigger)
              // This rung catches anything not already handled by the branch rungs above
              rungs.push(
                buildRung(
                  rungNum++,
                  `${visionDevice.displayName} - Search Loop (no match → re-trigger)`,
                  `XIC(Status.State[${visionSubs[3]}])MOVE(${visionSubs[0]},Control.StateReg);`
                )
              );

              // Timeout → fault 127 (accumulates across retries from sub-state [0])
              rungs.push(
                buildRung(
                  rungNum++,
                  `${visionDevice.displayName} - Search Timeout → Fault`,
                  `XIC(Status.State[${visionSubs[0]}])TON(${searchTimeoutTag},?,?)XIC(${searchTimeoutTag}.DN)MOVE(127,Control.StateReg);`
                )
              );
            }
          } else {
            // Old-style linear: Sub-state [3]→next node
            const tgtNode = orderedNodes[i + 1];
            if (tgtNode) {
              const tgtStep = stepMap[tgtNode.id];
              const desc = getStateDescription(tgtNode, devices);
              rungs.push(
                buildRung(
                  rungNum++,
                  `State ${tgtStep}: ${desc}`,
                  `XIC(Status.State[${visionSubs[3]}])MOVE(${tgtStep},Control.StateReg);`
                )
              );
            }
          }
        }
      } else {
        // Normal linear transition
        const tgtNode = orderedNodes[i + 1];
        const tgtStep = stepMap[tgtNode.id];
        const conditions = buildVerifyConditions(srcNode, devices, allSMs, trackingFields);
        const desc = getStateDescription(tgtNode, devices);

        rungs.push(
          buildRung(
            rungNum++,
            `State ${tgtStep}: ${desc}`,
            `XIC(Status.State[${srcStep}])${conditions}MOVE(${tgtStep},Control.StateReg);`
          )
        );
      }
    }
  }

  // Last action → Complete (only if it wasn't already handled as a branch or explicit complete node)
  // If there's an explicit complete node, edges from preceding nodes handle the transition
  if (orderedNodes.length > 0 && !explicitCompleteNode) {
    const lastNode = orderedNodes[orderedNodes.length - 1];
    const lastStep = stepMap[lastNode.id];
    const lastVisionSubs = getVisionSubSteps(lastNode, devices, stepMap);
    // For vision nodes, the "last step" is the last sub-state (index 3 = Check Results)
    const effectiveLastStep = lastVisionSubs ? lastVisionSubs[3] : lastStep;

    if (!branchHandled.has(lastNode.id)) {
      let conditions;
      if (lastVisionSubs) {
        // Vision node: sub-state [3] (Check Results) already verified result,
        // so transition to Complete is unconditional from that sub-state
        conditions = '';
      } else {
        conditions = buildVerifyConditions(lastNode, devices, allSMs, trackingFields);
      }

      rungs.push(
        buildRung(
          rungNum++,
          `State ${completeStep}: Complete`,
          `XIC(Status.State[${effectiveLastStep}])${conditions}MOVE(${completeStep},Control.StateReg);`
        )
      );
    }
  }

  // Final rung: State_Engine_128Max AOI call
  rungs.push(
    buildRung(
      rungNum++,
      null,
      'State_Engine_128Max(StateEngine,Control,Status,StateHistory);'
    )
  );

  return `
<Routine Name="R02_StateTransitions" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── R03_StateLogic ───────────────────────────────────────────────────────────
//
// OTE branch/latch pattern per device (matches CE output):
//
// For each device "primary direction" (e.g. Extend):
//   [XIC(Status.State[SET_STATE]) ,XIC(output) XIO(Status.State[CLEAR_STATE]) ]OTE(output);
//
// Multiple SET states:
//   [[XIC(Status.State[S1]) ,XIC(Status.State[S2]) ] ,XIC(output) XIO(Status.State[C1]) XIO(Status.State[C2]) ]OTE(output);
//
// Complementary output:
//   XIO(primary_output)OTE(complement_output);

function generateR03StateLogic(sm, orderedNodes, stepMap, allSMs = [], trackingFields = []) {
  const rungs = [];
  let rungNum = 0;
  const devices = sm.devices ?? [];
  const waitStep = getWaitStep();

  // CE pattern: ONE OTE per device (primary direction only).
  // The opposing direction is always XIO(primary)OTE(opposing) — pure complement.
  //
  // Primary directions:
  //   Extend (cylinders), Engage (grippers), VacOn (vacuum)
  // Opposing (complement only):
  //   Retract, Disengage, VacOff

  const PRIMARY_OPS = new Set(['Extend', 'Engage', 'VacOn', 'VacOnEject']);

  const OPPOSING_PAIRS = {
    Extend: 'Retract',
    Retract: 'Extend',
    Engage: 'Disengage',
    Disengage: 'Engage',
    VacOn: 'VacOff',
    VacOff: 'VacOn',
    VacOnEject: 'VacOff',
  };

  // Per-device: collect setSteps (primary op) and clearSteps (opposing op)
  const deviceMap = {}; // keyed by device.id

  // Helper to ensure a device entry exists
  function ensureEntry(device) {
    if (!deviceMap[device.id]) {
      deviceMap[device.id] = {
        device,
        primaryTag: null,
        opposingTag: null,
        setSteps: [],
        clearSteps: [],
      };
    }
    return deviceMap[device.id];
  }

  // 1) Process home positions for the wait state
  //    If home = primary direction (Extend, Engage, VacOn) → waitStep is a set step
  //    If home = opposing direction (Retract, Disengage, VacOff) → waitStep is a clear step
  for (const device of devices) {
    const homeOp = device.homePosition || DEVICE_TYPES[device.type]?.defaultHomePosition;
    if (!homeOp) continue;
    if (device.type === 'Timer' || device.type === 'DigitalSensor') continue;

    const outputTag = getOutputTagForOperation(device, homeOp);
    if (!outputTag) continue;

    const entry = ensureEntry(device);

    if (PRIMARY_OPS.has(homeOp)) {
      // Home is primary direction → set during wait
      entry.setSteps.push(waitStep);
      if (!entry.primaryTag) entry.primaryTag = outputTag;
      const oppOp = OPPOSING_PAIRS[homeOp];
      if (oppOp && !entry.opposingTag) entry.opposingTag = getOutputTagForOperation(device, oppOp);
    } else {
      // Home is opposing direction → clear during wait (primary OFF)
      entry.clearSteps.push(waitStep);
      if (!entry.primaryTag) {
        const primOp = OPPOSING_PAIRS[homeOp];
        if (primOp) {
          entry.primaryTag = getOutputTagForOperation(device, primOp);
          entry.opposingTag = outputTag;
        }
      }
    }
  }

  // 2) Process action nodes
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device) continue;
      if (device.type === 'Timer' || device.type === 'DigitalSensor' || device.type === 'Parameter' || device.type === 'CheckResults' || device.type === 'VisionSystem') continue;

      const outputTag = getOutputTagForOperation(device, action.operation);
      if (!outputTag) continue;

      const entry = ensureEntry(device);

      if (PRIMARY_OPS.has(action.operation)) {
        // Primary operation → set step
        entry.setSteps.push(step);
        entry.primaryTag = outputTag;
        const oppOp = OPPOSING_PAIRS[action.operation];
        if (oppOp) entry.opposingTag = getOutputTagForOperation(device, oppOp);
      } else {
        // Opposing operation (Retract, Disengage, VacOff) → clear step
        entry.clearSteps.push(step);
        // If primary hasn't been set yet (opposing action before primary), derive it
        if (!entry.primaryTag) {
          const primOp = OPPOSING_PAIRS[action.operation];
          if (primOp) {
            entry.primaryTag = getOutputTagForOperation(device, primOp);
            entry.opposingTag = outputTag;
          }
        }
      }
    }
  }

  // Generate rungs: ONE OTE + ONE complement per device
  for (const [, entry] of Object.entries(deviceMap)) {
    const { device, primaryTag, opposingTag, setSteps, clearSteps } = entry;
    if (!primaryTag || setSteps.length === 0) continue;

    // Branch 1: SET states (turn primary ON)
    let setBranch;
    if (setSteps.length === 1) {
      setBranch = `XIC(Status.State[${setSteps[0]}])`;
    } else {
      const parts = setSteps.map((s) => `XIC(Status.State[${s}])`);
      setBranch = `[${parts.join(' ,')}]`;
    }

    // Branch 2: Self-latch — primary already ON + NOT in any clear state
    let latchBranch = `XIC(${primaryTag})`;
    for (const cs of clearSteps) {
      latchBranch += ` XIO(Status.State[${cs}])`;
    }

    const rungText = `[${setBranch} ,${latchBranch} ]OTE(${primaryTag});`;

    rungs.push(
      buildRung(rungNum++, `${device.displayName} Control`, rungText)
    );

    // Complement: opposing = NOT primary
    if (opposingTag) {
      rungs.push(
        buildRung(rungNum++, null, `XIO(${primaryTag})OTE(${opposingTag});`)
      );
    }
  }

  // ── Parameter OTL / OTU rungs ─────────────────────────────────────────────
  // SetOn  → OTL(p_Name) when in the set state (latch ON, stays until explicitly cleared)
  // SetOff → OTU(p_Name) when in the clear state (unlatch OFF)
  // WaitOn / WaitOff are transition conditions only (no R03 rung needed)
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device || device.type !== 'Parameter') continue;
      const paramTag = getParameterTag(device, allSMs);
      if (action.operation === 'SetOn') {
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set ON`,
            `XIC(Status.State[${step}])OTL(${paramTag});`
          )
        );
      } else if (action.operation === 'SetOff') {
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set OFF`,
            `XIC(Status.State[${step}])OTU(${paramTag});`
          )
        );
      } else if (action.operation === 'SetValue') {
        // Numeric parameter set — use MOV instruction
        const numVal = action.setValue ?? 0;
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Set Value`,
            `XIC(Status.State[${step}])MOV(${numVal},${paramTag});`
          )
        );
      }
    }
  }

  // ── Part Tracking OTE / OTU rungs ──────────────────────────────────────
  // TrackSet  → OTE(PartTracking.FieldName) when in the set state
  // TrackClear → OTU(PartTracking.FieldName) when in the clear state
  for (const node of orderedNodes) {
    const step = stepMap[node.id];
    for (const action of node.data.actions ?? []) {
      if (action.deviceId !== '_tracking') continue;
      const field = trackingFields.find(f => f.id === action.trackingFieldId);
      if (!field) continue;
      const ptTag = `PartTracking.${field.name}`;
      if (action.operation === 'TrackSet') {
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${field.name} Set`,
            `XIC(Status.State[${step}])OTE(${ptTag});`
          )
        );
      } else if (action.operation === 'TrackClear') {
        rungs.push(
          buildRung(
            rungNum++,
            `Part Tracking: ${field.name} Clear`,
            `XIC(Status.State[${step}])OTU(${ptTag});`
          )
        );
      }
    }
  }

  // ── ServoAxis MAM motion commands ────────────────────────────────────────
  // Per axis: 1) position selection  2) MAM execute  3) range checks
  {
    const servoMoveMap = {}; // deviceId -> { device, moves: [{ step, positionName }] }

    for (const node of orderedNodes) {
      const step = stepMap[node.id];
      for (const action of node.data.actions ?? []) {
        const device = devices.find(d => d.id === action.deviceId);
        if (!device || device.type !== 'ServoAxis') continue;
        if (action.operation !== 'ServoMove' && action.operation !== 'ServoIncr' && action.operation !== 'ServoIndex') continue;

        if (!servoMoveMap[device.id]) {
          servoMoveMap[device.id] = { device, moves: [] };
        }
        servoMoveMap[device.id].moves.push({ step, positionName: action.positionName ?? '', operation: action.operation });
      }
    }

    for (const [, entry] of Object.entries(servoMoveMap)) {
      const { device, moves } = entry;
      const sp = DEVICE_TYPES.ServoAxis.tagPatterns;
      const axisTag = getAxisTag(device);
      const mamTag = sp.mamControl.replace(/\{name\}/g, device.name);
      const motionParamTag = sp.motionParam.replace(/\{name\}/g, device.name);

      // Rung A: Position Selection — conditional MOVE of target position per state
      if (moves.length > 0) {
        const moveBranches = moves.map(m => {
          if (m.operation === 'ServoIncr') {
            const incrTag = sp.incrementParam.replace(/\{name\}/g, device.name);
            return `XIC(Status.State[${m.step}]) [MOVE(${incrTag},${motionParamTag}.Position) ,MOVE(1,${motionParamTag}.MoveType) ]`;
          } else if (m.operation === 'ServoIndex') {
            const indexTag = sp.indexAngleParam.replace(/\{name\}/g, device.name);
            return `XIC(Status.State[${m.step}]) [MOVE(${indexTag},${motionParamTag}.Position) ,MOVE(1,${motionParamTag}.MoveType) ]`;
          } else {
            const posTag = sp.positionParam
              .replace(/\{name\}/g, device.name)
              .replace(/\{positionName\}/g, m.positionName);
            return `XIC(Status.State[${m.step}]) [MOVE(${posTag},${motionParamTag}.Position) ,MOVE(0,${motionParamTag}.MoveType) ]`;
          }
        });
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Position Selection`,
            `[${moveBranches.join(' ,')} ];`
          )
        );
      }

      // Rung B: MAM Execute — triggers on any servo move state for this axis
      {
        const triggerParts = moves.map(m => `XIC(Status.State[${m.step}])`);
        const triggerText = triggerParts.length === 1
          ? triggerParts[0]
          : `[${triggerParts.join(' ,')}]`;

        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Motion Command`,
            `${triggerText}MAM(${axisTag},${mamTag},${motionParamTag}.MoveType,${motionParamTag}.Position,${motionParamTag}.Speed,Units per sec,${motionParamTag}.Accel,Units per sec2,${motionParamTag}.Decel,Units per sec2,Trapezoidal,0,0,Units per sec3,Disabled,0,0,None,0,0);`
          )
        );
      }

      // Rung C: Range Checks — AOI_RangeCheck per position (continuous monitoring)
      const positions = device.positions ?? [];
      if (positions.length > 0) {
        const rcBranches = positions.map(pos => {
          const rcTag = sp.positionRC
            .replace(/\{name\}/g, device.name)
            .replace(/\{positionName\}/g, pos.name);
          const posTag = sp.positionParam
            .replace(/\{name\}/g, device.name)
            .replace(/\{positionName\}/g, pos.name);
          return `AOI_RangeCheck(${rcTag},${posTag},0.5,${axisTag}.ActualPosition)`;
        });
        rungs.push(
          buildRung(
            rungNum++,
            `${device.displayName} Position Monitoring`,
            `[${rcBranches.join(' ,')} ];`
          )
        );
      }
    }
  }

  // ── Analog Sensor AOI_RangeCheck continuous monitoring ────────────────────
  {
    const analogSensors = devices.filter(d => d.type === 'AnalogSensor');
    for (const device of analogSensors) {
      const setpoints = device.setpoints ?? [];
      if (setpoints.length === 0) continue;

      const ap = DEVICE_TYPES.AnalogSensor.tagPatterns;
      const inputTag = ap.inputTag.replace(/\{name\}/g, device.name);

      const rcBranches = setpoints.map(sp => {
        const rcTag = ap.rangeCheckInst
          .replace(/\{name\}/g, device.name)
          .replace(/\{setpointName\}/g, sp.name);
        const spTag = ap.setpointParam
          .replace(/\{name\}/g, device.name)
          .replace(/\{setpointName\}/g, sp.name);
        return `AOI_RangeCheck(${rcTag},${spTag},${device.tolerance ?? 0.5},${inputTag})`;
      });
      rungs.push(
        buildRung(
          rungNum++,
          `${device.displayName} Range Monitoring`,
          `[${rcBranches.join(' ,')} ];`
        )
      );
    }
  }

  // ── VisionSystem trigger output OTE ──────────────────────────────────────
  // Energize camera trigger only during the trigger sub-state
  for (const node of orderedNodes) {
    for (const action of node.data.actions ?? []) {
      const device = devices.find((d) => d.id === action.deviceId);
      if (!device || device.type !== 'VisionSystem') continue;
      if (action.operation !== 'Inspect' && action.operation !== 'VisionInspect') continue;

      const visionSubs = getVisionSubSteps(node, devices, stepMap);
      if (!visionSubs) continue;

      const triggerTag = DEVICE_TYPES.VisionSystem.tagPatterns.trigger.replace(/\{name\}/g, device.name);

      // Trigger fires during sub-state [2] (Trigger)
      rungs.push(
        buildRung(
          rungNum++,
          `${device.displayName} Camera Trigger`,
          `XIC(Status.State[${visionSubs[2]}])OTE(${triggerTag});`
        )
      );
    }
  }

  // ── Vision Result Parameter OTL / OTU ────────────────────────────────────
  // Auto-created vision outcome parameters (Pass/Fail) are latched/unlatched
  // at the check-results sub-state based on the inspection result.
  for (const node of orderedNodes) {
    for (const action of node.data.actions ?? []) {
      const device = devices.find(d => d.id === action.deviceId);
      if (!device || device.type !== 'VisionSystem') continue;
      if (action.operation !== 'VisionInspect') continue;
      if (!action.outcomes || action.outcomes.length < 2) continue;

      const visionSubs = getVisionSubSteps(node, devices, stepMap);
      if (!visionSubs) continue;

      const inspPassTag = DEVICE_TYPES.VisionSystem.tagPatterns.inspPass.replace(/\{name\}/g, device.name);

      // Find auto-vision Parameter devices for each outcome (match by stable label, not ephemeral id)
      const outcomeParams = action.outcomes.map(outcome => {
        const paramDev = devices.find(d =>
          d._autoVision && d._visionDeviceId === device.id &&
          d._visionJobName === action.jobName && d._outcomeLabel === outcome.label
        );
        if (!paramDev) return null;
        const paramTag = getParameterTag(paramDev, allSMs);
        return { outcome, paramDev, paramTag };
      }).filter(Boolean);

      if (outcomeParams.length === 0) continue;

      // For default 2-outcome (Pass/Fail): Pass = XIC(InspPass), Fail = XIO(InspPass)
      for (let oi = 0; oi < outcomeParams.length; oi++) {
        const { outcome, paramDev, paramTag } = outcomeParams[oi];
        const isPass = oi === 0;
        const inspCond = isPass ? `XIC(${inspPassTag})` : `XIO(${inspPassTag})`;

        // OTL this outcome's parameter
        rungs.push(
          buildRung(
            rungNum++,
            `${paramDev.displayName} — Latch`,
            `XIC(Status.State[${visionSubs[3]}])${inspCond}OTL(${paramTag});`
          )
        );

        // OTU all other outcome parameters (mutually exclusive)
        for (let oj = 0; oj < outcomeParams.length; oj++) {
          if (oj === oi) continue;
          rungs.push(
            buildRung(
              rungNum++,
              `${outcomeParams[oj].paramDev.displayName} — Unlatch`,
              `XIC(Status.State[${visionSubs[3]}])${inspCond}OTU(${outcomeParams[oj].paramTag});`
            )
          );
        }
      }
    }
  }

  // ── SM Output OTE rungs ──────────────────────────────────────────────────
  // Each SM Output is TRUE only while the SM is in the specified state (OTE pattern).
  // Tag: p_OutputName
  // Rung: XIC(Status.State[N]) OTE(p_OutputName);
  for (const smOut of sm.smOutputs ?? []) {
    if (!smOut.name || !smOut.activeNodeId) continue;
    const step = stepMap[smOut.activeNodeId];
    if (step == null) continue;
    const tag = `p_${smOut.name.replace(/[^a-zA-Z0-9_]/g, '')}`;
    rungs.push(
      buildRung(
        rungNum++,
        smOut.description ? `SM Output: ${smOut.name} — ${smOut.description}` : `SM Output: ${smOut.name}`,
        `XIC(Status.State[${step}])OTE(${tag});`
      )
    );
  }

  // q_Ready: set when in Wait state
  rungs.push(
    buildRung(
      rungNum++,
      'Station Ready',
      `XIC(Status.State[${waitStep}])OTE(q_Ready);`
    )
  );

  if (rungs.length === 1) {
    // Only the q_Ready rung — no devices
    rungs.unshift(buildRung(0, 'No output devices defined', 'NOP();'));
    // Renumber
    rungs.forEach((_, i) => {
      // Already numbered correctly from buildRung calls
    });
  }

  return `
<Routine Name="R03_StateLogic" Type="RLL">
<RLLContent>${rungs.join('')}
</RLLContent>
</Routine>`;
}

// ── UDT Definitions ──────────────────────────────────────────────────────────

function generateDataTypes(hasServos = false, trackingFields = []) {
  let servoUDT = '';
  if (hasServos) {
    servoUDT = `
<DataType Name="MAMParam" Family="NoFamily" Class="User">
<Members>
<Member Name="MoveType" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Position" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Speed" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Accel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
<Member Name="Decel" DataType="REAL" Dimension="0" Radix="Float" Hidden="false" ExternalAccess="Read/Write"/>
</Members>
</DataType>`;
  }

  let partTrackingUDT = '';
  if (trackingFields.length > 0) {
    const members = trackingFields.map(f =>
      `<Member Name="${escapeXml(f.name)}" DataType="BOOL" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata(f.description || `Part Tracking: ${f.name}`)}
</Description>
</Member>`
    );
    // PartTracking UDT requires a hidden backing SINT for BOOL bit-packing
    const hiddenMembers = [];
    const boolCount = trackingFields.length;
    const sintCount = Math.ceil(boolCount / 8);
    for (let si = 0; si < sintCount; si++) {
      hiddenMembers.push(
        `<Member Name="ZZZZZZZZZZPartTrack${si}" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>`
      );
    }
    const boolMembers = trackingFields.map((f, i) => {
      const sintIdx = Math.floor(i / 8);
      const bitNum = i % 8;
      return `<Member Name="${escapeXml(f.name)}" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZPartTrack${sintIdx}" BitNumber="${bitNum}" ExternalAccess="Read/Write">
<Description>
${cdata(f.description || `Part Tracking: ${f.name}`)}
</Description>
</Member>`;
    });
    partTrackingUDT = `
<DataType Name="PartTracking_UDT" Family="NoFamily" Class="User">
<Members>
${hiddenMembers.join('\n')}
${boolMembers.join('\n')}
</Members>
</DataType>`;
  }

  return `
<DataTypes Use="Context">${servoUDT}${partTrackingUDT}
<DataType Name="StateLogicControl" Family="NoFamily" Class="User">
<Members>
<Member Name="StateReg" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Register')}
</Description>
</Member>
<Member Name="ZZZZZZZZZZState_Logi1" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="EnaFaultDetect" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi1" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('Enable Fault Detection')}
</Description>
</Member>
<Member Name="EnaTransitionTimer" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi1" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('Enable State Transition Timer')}
</Description>
</Member>
<Member Name="FaultTime" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Timeout Fault Time (Msec)')}
</Description>
</Member>
<Member Name="TransitionTime" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Transition preset time (ms)')}
</Description>
</Member>
</Members>
</DataType>
<DataType Name="StateLogicStatus" Family="NoFamily" Class="User">
<Members>
<Member Name="State" DataType="BOOL" Dimension="128" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('State Control Bits')}
</Description>
</Member>
<Member Name="PreviousState" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">
<Description>
${cdata('Previous State')}
</Description>
</Member>
<Member Name="ZZZZZZZZZZState_Logi2" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="StateChangeOccurred_OS" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="0" ExternalAccess="Read/Write">
<Description>
${cdata('State Change Occurred')}
</Description>
</Member>
<Member Name="TimeoutFlt" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="1" ExternalAccess="Read/Write">
<Description>
${cdata('State Timeout Fault')}
</Description>
</Member>
<Member Name="TransitionTimerDone" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZState_Logi2" BitNumber="2" ExternalAccess="Read/Write">
<Description>
${cdata('State Transition Time Done')}
</Description>
</Member>
</Members>
</DataType>
</DataTypes>`;
}

// ── AOI_RangeCheck Definition ─────────────────────────────────────────────────

function generateAOIRangeCheck() {
  return `
<AddOnInstructionDefinition Name="AOI_RangeCheck" Class="Standard" Revision="0.1" ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2010-03-29T16:58:02.278Z" CreatedBy="SDC" EditedDate="2024-01-01T00:00:00.000Z" EditedBy="SDC" SoftwareRevision="v37.00">
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Input - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Output - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="Value" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="Deadband" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="Actual" TagType="Base" DataType="REAL" Usage="Input" Radix="Float" Required="true" Visible="true" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</Parameter>
<Parameter Name="In_Range" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="true" ExternalAccess="Read Only">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="BOOL" Radix="Decimal" Value="0"/>
</DefaultData>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="Max" DataType="REAL" Radix="Float" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="Min" DataType="REAL" Radix="Float" ExternalAccess="Read/Write">
<DefaultData Format="L5K">
${cdata('0.00000000e+000')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="REAL" Radix="Float" Value="0.0"/>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N">
<Text>
${cdata('[ADD(Value,Deadband,Max) ,SUB(Value,Deadband,Min) ];')}
</Text>
</Rung>
<Rung Number="1" Type="N">
<Text>
${cdata('LIMIT(Min,Actual,Max)OTE(In_Range);')}
</Text>
</Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>`;
}

// ── AOI Definition (State_Engine_128Max) ─────────────────────────────────────

function generateAOI(hasServos = false) {
  const boolL5K = generate128BoolL5K();
  const boolDec = generate128BoolDecorated();

  // FBD_TIMER default data (used for StateDurationTimer and FaultTimer local tags)
  const fbdTimerL5K = '[1,0,0,0,0,0,0,0,0,4,0,0]';
  const fbdTimerDec = `<Structure DataType="FBD_TIMER">
<DataValueMember Name="EnableIn" DataType="BOOL" Value="1"/>
<DataValueMember Name="TimerEnable" DataType="BOOL" Value="0"/>
<DataValueMember Name="PRE" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="Reset" DataType="BOOL" Value="0"/>
<DataValueMember Name="EnableOut" DataType="BOOL" Value="0"/>
<DataValueMember Name="ACC" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="EN" DataType="BOOL" Value="0"/>
<DataValueMember Name="TT" DataType="BOOL" Value="0"/>
<DataValueMember Name="DN" DataType="BOOL" Value="0"/>
<DataValueMember Name="Status" DataType="DINT" Radix="Hex" Value="16#0000_0000"/>
<DataValueMember Name="InstructFault" DataType="BOOL" Value="0"/>
<DataValueMember Name="PresetInv" DataType="BOOL" Value="0"/>
</Structure>`;

  // StateLogicStatus default for localStatus local tag
  const localStatusL5K = `[[${boolL5K}],0,0]`;
  const localStatusDec = `<Structure DataType="StateLogicStatus">
<ArrayMember Name="State" DataType="BOOL" Dimensions="128" Radix="Decimal">
${boolDec}
</ArrayMember>
<DataValueMember Name="PreviousState" DataType="DINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="StateChangeOccurred_OS" DataType="BOOL" Value="0"/>
<DataValueMember Name="TimeoutFlt" DataType="BOOL" Value="0"/>
<DataValueMember Name="TransitionTimerDone" DataType="BOOL" Value="0"/>
</Structure>`;

  // Structured Text logic lines
  const stLines = [
    'StateDurationTimer.Reset := 0;',
    'StateDurationTimer.PRE := 2147483647;',
    'SIZE(StateHistoryArray,0,HistoryArraySize);',
    '',
    'TONR(StateDurationTimer);',
    '',
    'COP(StateLogicStatus, localStatus, 1); //localStatus used so all Status updates at the same time, at the end of this code.',
    'If (StateLogicControl.StateReg = StateReg_Prev) THEN',
    '\t//Previous State equal to Current State: Still in the same state as the last scan.',
    '\tlocalStatus.StateChangeOccurred_OS := 0;',
    '',
    '\t//State Duration Timer',
    '\tStateDurationTimer.TimerEnable := 1;',
    '',
    '\t//State Fault Timer',
    '\tIF (StateDurationTimer.ACC >= StateLogicControl.FaultTime ) THEN',
    '\t\tlocalStatus.TimeoutFlt := 1;',
    '\tELSE',
    '\t\tlocalStatus.TimeoutFlt := 0;',
    '\tEND_IF;',
    '',
    '',
    '\t//State Transition Timer',
    '\tIF (StateDurationTimer.ACC >= StateLogicControl.TransitionTime) THEN',
    '\t\tlocalStatus.TransitionTimerDone := 1;',
    '\tELSE',
    '\t\tlocalStatus.TransitionTimerDone := 0;',
    '\tEND_IF;',
    'ELSE',
    '\t//Previous State not Current State: State Change Occurred.',
    '\tlocalStatus.StateChangeOccurred_OS := 1;',
    '\tlocalStatus.PreviousState := StateReg_Prev;',
    '\tStateReg_Prev := StateLogicControl.StateReg;',
    '\t',
    '\t//Shift state history array and store last state in index 0',
    '\tif HistoryArraySize > 1 then //history array size of 1 would cause an array index out of bounds controller fault',
    '\t\tfor i := HistoryArraySize-1 to 1 by -1 do',
    '\t\t\tStateHistoryArray[i] := StateHistoryArray[i-1];',
    '\t\tend_for;',
    '\tend_if;',
    '\tStateHistoryArray[0] := StateReg_Prev;',
    '',
    '\tStateDurationTimer.Reset := 1;',
    '\tStateDurationTimer.TimerEnable := 0;',
    '\t//Default to DINT Max value.',
    '\t//EnaTransitionTimer and EnaFaultTimer bits kept for legacy compatibility',
    '\tStateLogicControl.TransitionTime := 2147483647;',
    '\tStateLogicControl.FaultTime := 2147483647;',
    '',
    '\tlocalStatus.TimeoutFlt := 0;',
    '\tlocalStatus.TransitionTimerDone := 0;',
    'END_IF;',
    '',
    '//Set the State Bit, clear all other bits.',
    'FOR i := 0 TO 127 DO',
    '\tlocalStatus.State[i] := 0;',
    'END_FOR;',
    'localStatus.State[StateLogicControl.StateReg] := 1;',
    '',
    'COP(localStatus, StateLogicStatus, 1);',
    '',
  ];

  const stContent = stLines
    .map((line, i) => `<Line Number="${i}">\n${cdata(line)}\n</Line>`)
    .join('\n');

  return `
<AddOnInstructionDefinitions Use="Context">
<AddOnInstructionDefinition Name="State_Engine_128Max" Class="Standard" Revision="5.0" Vendor="Steven Douglas Corp." ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false" CreatedDate="2013-06-25T13:55:13.933Z" CreatedBy="SDC" EditedDate="2025-08-25T14:49:42.628Z" EditedBy="SDC"
 SoftwareRevision="v37.00">
<Description>
${cdata('State Logic Engine For 128 States')}
</Description>
<RevisionNote>
${cdata(`-Separated UDT into Control & Status Pieces For better use with standard "Progam" methods.
-Removed Timer,OS,Bit, Counter from Control UDT (Use local program tags instead)
-4.1 optimizations
-4.2 optimizations. Ena--Timer bits no longer needed.
-5.0 added integrated state history array (variable length) 1/14/23 D.G.`)}
</RevisionNote>
<Parameters>
<Parameter Name="EnableIn" TagType="Base" DataType="BOOL" Usage="Input" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Input - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="EnableOut" TagType="Base" DataType="BOOL" Usage="Output" Radix="Decimal" Required="false" Visible="false" ExternalAccess="Read Only">
<Description>
${cdata('Enable Output - System Defined Parameter')}
</Description>
</Parameter>
<Parameter Name="StateLogicControl" TagType="Base" DataType="StateLogicControl" Usage="InOut" Required="true" Visible="true" Constant="false"/>
<Parameter Name="StateLogicStatus" TagType="Base" DataType="StateLogicStatus" Usage="InOut" Required="true" Visible="true" Constant="false"/>
<Parameter Name="StateHistoryArray" TagType="Base" DataType="SINT" Dimensions="1" Usage="InOut" Radix="Decimal" Required="true" Visible="true" Constant="false">
<Description>
${cdata('State history array')}
</Description>
</Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="StateDurationTimer" DataType="FBD_TIMER" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata(fbdTimerL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${fbdTimerDec}
</DefaultData>
</LocalTag>
<LocalTag Name="i" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="INT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="StateReg_Prev" DataType="INT" Radix="Decimal" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="INT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
<LocalTag Name="FaultTimer" DataType="FBD_TIMER" ExternalAccess="None">
<DefaultData Format="L5K">
${cdata(fbdTimerL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${fbdTimerDec}
</DefaultData>
</LocalTag>
<LocalTag Name="localStatus" DataType="StateLogicStatus" ExternalAccess="None">
<Description>
${cdata('Temp structure for copying to ensure data changes all at once.')}
</Description>
<DefaultData Format="L5K">
${cdata(localStatusL5K)}
</DefaultData>
<DefaultData Format="Decorated">
${localStatusDec}
</DefaultData>
</LocalTag>
<LocalTag Name="HistoryArraySize" DataType="SINT" Radix="Decimal" ExternalAccess="None">
<Description>
${cdata('Size of state history array')}
</Description>
<DefaultData Format="L5K">
${cdata('0')}
</DefaultData>
<DefaultData Format="Decorated">
<DataValue DataType="SINT" Radix="Decimal" Value="0"/>
</DefaultData>
</LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="ST">
<STContent>
${stContent}
</STContent>
</Routine>
</Routines>
<Dependencies>
<Dependency Type="DataType" Name="StateLogicStatus"/>
<Dependency Type="DataType" Name="StateLogicControl"/>
</Dependencies>
</AddOnInstructionDefinition>${hasServos ? generateAOIRangeCheck() : ''}
</AddOnInstructionDefinitions>`;
}

// ── Cross-SM context program blocks ──────────────────────────────────────────
//
// When rungs reference tags from other programs (e.g. \S02_Foo.q_Ready),
// Studio 5000 requires a <Program Use="Context"> declaration inside the L5X
// so it can resolve those cross-program references on import.
//
// Collects all cross-SM tag references in the SM's devices and CheckResults
// outcomes, then emits one context block per referenced program.

function generateCrossSmContextPrograms(sm, allSMs) {
  // Map: progName → Set<tagName>
  const refs = {};

  function addRef(progName, tagName) {
    if (!refs[progName]) refs[progName] = new Set();
    refs[progName].add(tagName);
  }

  for (const device of sm.devices ?? []) {
    // Parameter devices with cross-SM scope
    if (device.type === 'Parameter' && device.paramScope === 'cross-sm' && device.crossSmId) {
      const crossSm = allSMs.find(s => s.id === device.crossSmId);
      if (!crossSm) continue;
      const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
      const pfx = device.dataType === 'boolean' ? 'q_' : 'p_';
      addRef(progName, `${pfx}${device.name}`);
    }

    // CheckResults outcomes — legacy paramDeviceId format
    if (device.type === 'CheckResults') {
      for (const outcome of device.outcomes ?? []) {
        if (outcome.paramScope === 'cross-sm' && outcome.crossSmId && outcome.paramDeviceId) {
          const crossSm = allSMs.find(s => s.id === outcome.crossSmId);
          if (!crossSm) continue;
          const crossDev = (crossSm.devices ?? []).find(d => d.id === outcome.paramDeviceId);
          if (!crossDev) continue;
          const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
          const pfx = crossDev.dataType === 'boolean' ? 'q_' : 'p_';
          addRef(progName, `${pfx}${crossDev.name}`);
        }

        // New unified inputRef format: "deviceId:cross:smId"
        if (outcome.inputRef) {
          const parts = outcome.inputRef.split(':');
          if (parts.length === 3 && parts[1] === 'cross') {
            const crossSmId = parts[2];
            const crossSm = allSMs.find(s => s.id === crossSmId);
            if (!crossSm) continue;
            const crossDev = (crossSm.devices ?? []).find(d => d.id === parts[0]);
            if (!crossDev) continue;
            const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
            const pfx = crossDev.dataType === 'boolean' ? 'q_' : 'p_';
            addRef(progName, `${pfx}${crossDev.name}`);
          }
        }
      }
    }
  }

  // Also scan transition conditions stored on edges (inputRef with :cross: pattern)
  for (const edge of sm.edges ?? []) {
    const inputRef = edge.data?.inputRef ?? edge.data?.condition?.inputRef;
    if (!inputRef) continue;
    const parts = inputRef.split(':');
    if (parts.length === 3 && parts[1] === 'cross') {
      const crossSm = allSMs.find(s => s.id === parts[2]);
      if (!crossSm) continue;
      const crossDev = (crossSm.devices ?? []).find(d => d.id === parts[0]);
      if (!crossDev) continue;
      const progName = buildProgramName(crossSm.stationNumber ?? 1, crossSm.name ?? 'Unknown');
      const pfx = crossDev.dataType === 'boolean' ? 'q_' : 'p_';
      addRef(progName, `${pfx}${crossDev.name}`);
    }
  }

  if (Object.keys(refs).length === 0) return '';

  return Object.entries(refs).map(([progName, tags]) => {
    const tagRefs = Array.from(tags)
      .map(t => `\n<Tag Use="Reference" Name="${escapeXml(t)}">\n</Tag>`)
      .join('');
    return `
<Program Use="Context" Name="${escapeXml(progName)}" Class="Standard">
<Tags Use="Context">${tagRefs}
</Tags>
</Program>`;
  }).join('');
}

// ── Main export function ─────────────────────────────────────────────────────

export function exportToL5X(sm, allSMs = [], trackingFields = []) {
  if (!sm) throw new Error('No state machine provided');

  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  const orderedNodes = orderNodes(sm.nodes ?? [], sm.edges ?? []);
  const stepMap = buildStepMap(orderedNodes, sm.devices ?? []);

  const hasServos = (sm.devices ?? []).some(d => d.type === 'ServoAxis');
  const hasAnalogSensors = (sm.devices ?? []).some(d => d.type === 'AnalogSensor');
  const needsRangeCheck = hasServos || hasAnalogSensors;

  const tagsXml = generateAllTags(sm, orderedNodes, stepMap, trackingFields);
  const r00 = generateR00Main();
  const r01 = generateR01Inputs(sm);
  const r02 = generateR02StateTransitions(sm, orderedNodes, stepMap, allSMs, trackingFields);
  const r03 = generateR03StateLogic(sm, orderedNodes, stepMap, allSMs, trackingFields);

  const dataTypes = generateDataTypes(hasServos, trackingFields);
  const aoi = generateAOI(needsRangeCheck);

  // Context program blocks for cross-SM tag references
  const contextPrograms = generateCrossSmContextPrograms(sm, allSMs);

  const now = toCTimeString(new Date());
  const stationDesc = `S${String(sm.stationNumber ?? 0).padStart(2, '0')} ${sm.description ?? sm.name ?? ''}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="${SCHEMA_REV}" SoftwareRevision="${SOFTWARE_REV}" TargetName="${programName}" TargetType="Program" TargetClass="Standard" ContainsContext="true" ExportDate="${now}" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">
<Controller Use="Context" Name="${CONTROLLER_NAME}">
${dataTypes}
${aoi}
<Programs Use="Context">
${contextPrograms}<Program Use="Target" Name="${programName}" TestEdits="false" MainRoutineName="R00_Main" Disabled="false" Class="Standard" UseAsFolder="false">
<Description>
${cdata(`${stationDesc} - Auto-generated by SDC State Logic Builder`)}
</Description>
<Tags>
${tagsXml}
</Tags>
<Routines>
${r00}
${r01}
${r02}
${r03}
</Routines>
</Program>
</Programs>
</Controller>
</RSLogix5000Content>`;
}

// ── Download helpers ─────────────────────────────────────────────────────────

export function downloadL5X(sm, allSMs = [], trackingFields = []) {
  const xml = exportToL5X(sm, allSMs, trackingFields);
  const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
  a.href = url;
  a.download = `${programName}.L5X`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export multiple SMs as a single ZIP file containing one .L5X per SM.
 * Minimal ZIP implementation — no external dependencies.
 */
export function downloadAllL5XAsZip(stateMachines, trackingFields = []) {
  const files = [];
  for (const sm of stateMachines) {
    if ((sm.nodes ?? []).length === 0) continue;
    const name = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unnamed');
    const xml = exportToL5X(sm, stateMachines, trackingFields);
    files.push({ name: `${name}.L5X`, content: xml });
  }
  if (files.length === 0) return;

  const zipBlob = buildZipBlob(files);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SDC_StateMachines.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Minimal ZIP builder (no dependencies) ────────────────────────────────────

function buildZipBlob(files) {
  const enc = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const dataBytes = enc.encode(file.content);
    const crc = crc32(dataBytes);

    // Local file header (30 bytes + name + data)
    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0, true);             // flags
    lv.setUint16(8, 0, true);             // compression: stored
    lv.setUint16(10, 0, true);            // mod time
    lv.setUint16(12, 0, true);            // mod date
    lv.setUint32(14, crc, true);          // crc-32
    lv.setUint32(18, dataBytes.length, true); // compressed size
    lv.setUint32(22, dataBytes.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // file name length
    lv.setUint16(28, 0, true);            // extra field length
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);    // signature
    cv.setUint16(4, 20, true);            // version made by
    cv.setUint16(6, 20, true);            // version needed
    cv.setUint16(8, 0, true);             // flags
    cv.setUint16(10, 0, true);            // compression
    cv.setUint16(12, 0, true);            // mod time
    cv.setUint16(14, 0, true);            // mod date
    cv.setUint32(16, crc, true);          // crc-32
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);            // extra length
    cv.setUint16(32, 0, true);            // comment length
    cv.setUint16(34, 0, true);            // disk number start
    cv.setUint16(36, 0, true);            // internal attrs
    cv.setUint32(38, 0, true);            // external attrs
    cv.setUint32(42, offset, true);       // local header offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralHeaders) centralSize += c.length;

  // End of central directory record (22 bytes)
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localHeaders, ...centralHeaders, endRecord], { type: 'application/zip' });
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function exportProjectJSON(project) {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name ?? 'project'}_backup.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
