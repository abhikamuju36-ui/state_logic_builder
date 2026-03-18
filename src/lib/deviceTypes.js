/**
 * SDC Device Type Definitions
 * Based on SDC_StateLogic_Template_rev5.1.xlsm and PLC Software Standardization Guide Rev1
 *
 * Each device type defines:
 *  - label: display name in UI
 *  - icon: emoji icon for UI
 *  - color: accent color for node display
 *  - operations: available actions an ME can assign to a state
 *  - sensorArrangements: '1-sensor' | '2-sensor' (for pneumatic actuators)
 *  - tagPatterns: how tags are named (use {name} as placeholder)
 *  - defaultTimerPreMs: default delay timer preset in milliseconds
 */

export const DEVICE_TYPES = {
  PneumaticLinearActuator: {
    label: 'Cylinder / Linear Actuator',
    icon: '⬆',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 4,
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend', verb: 'Extend', icon: '⬆' },
      { value: 'Retract', label: 'Retract', verb: 'Retract', icon: '⬇' },
    ],
    homePositions: [
      { value: 'Retract', label: 'Retracted' },
      { value: 'Extend', label: 'Extended' },
    ],
    defaultHomePosition: 'Retract',
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    tagPatterns: {
      inputExt:       'i_{name}Ext',
      inputRet:       'i_{name}Ret',
      outputExtend:   'q_Ext{name}',
      outputRetract:  'q_Ret{name}',
      timerExt:       '{name}ExtDelay',
      timerRet:       '{name}RetDelay',
      debounceExt:    '{name}ExtDebounce',
      debounceRet:    '{name}RetDebounce',
    },
    defaultTimerPreMs: 500,
    // Transition condition auto-generated after each operation:
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ext',
        timerTag: '{name}ExtDelay',
        labelTemplate: "'{deviceName}' Extended & Timer",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ret',
        timerTag: '{name}RetDelay',
        labelTemplate: "'{deviceName}' Retracted & Timer",
      },
    },
  },

  PneumaticRotaryActuator: {
    label: 'Rotary Actuator',
    icon: '↺',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 5,
    category: 'Pneumatic',
    operations: [
      { value: 'Extend', label: 'Extend (CW)', verb: 'Extend', icon: '↺' },
      { value: 'Retract', label: 'Retract (CCW)', verb: 'Retract', icon: '↻' },
    ],
    homePositions: [
      { value: 'Retract', label: 'Retracted (CCW)' },
      { value: 'Extend', label: 'Extended (CW)' },
    ],
    defaultHomePosition: 'Retract',
    sensorArrangements: ['1-sensor (Ret only)', '2-sensor (Ext + Ret)'],
    defaultSensorArrangement: '2-sensor (Ext + Ret)',
    tagPatterns: {
      inputExt:       'i_{name}Ext',
      inputRet:       'i_{name}Ret',
      outputExtend:   'q_Ext{name}',
      outputRetract:  'q_Ret{name}',
      timerExt:       '{name}ExtDelay',
      timerRet:       '{name}RetDelay',
      debounceExt:    '{name}ExtDebounce',
      debounceRet:    '{name}RetDebounce',
    },
    defaultTimerPreMs: 500,
    transitionConditions: {
      Extend: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ext',
        timerTag: '{name}ExtDelay',
        labelTemplate: "'{deviceName}' Extended",
      },
      Retract: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Ret',
        timerTag: '{name}RetDelay',
        labelTemplate: "'{deviceName}' Retracted",
      },
    },
  },

  PneumaticGripper: {
    label: 'Gripper',
    icon: '✋',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 6,
    category: 'Pneumatic',
    operations: [
      { value: 'Engage', label: 'Engage (Close)', verb: 'Engage', icon: '✊' },
      { value: 'Disengage', label: 'Disengage (Open)', verb: 'Disengage', icon: '✋' },
    ],
    homePositions: [
      { value: 'Disengage', label: 'Disengaged (Open)' },
      { value: 'Engage', label: 'Engaged (Closed)' },
    ],
    defaultHomePosition: 'Disengage',
    sensorArrangements: ['1-sensor (Engaged only)', '2-sensor (Eng + Dis)'],
    defaultSensorArrangement: '1-sensor (Engaged only)',
    tagPatterns: {
      inputEngage:      'i_{name}Engage',
      inputDisengage:   'i_{name}Disengage',
      outputEngage:     'q_Engage{name}',
      outputDisengage:  'q_Disengage{name}',
      timerEngage:      '{name}EngageDelay',
      timerDisengage:   '{name}DisengageDelay',
      debounceEngage:   '{name}EngageDebounce',
      debounceDisengage:'{name}DisengageDebounce',
    },
    defaultTimerPreMs: 300,
    transitionConditions: {
      Engage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Engage',
        timerTag: '{name}EngageDelay',
        labelTemplate: "'{deviceName}' Engaged",
      },
      Disengage: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}Disengage',
        timerTag: '{name}DisengageDelay',
        labelTemplate: "'{deviceName}' Disengaged",
      },
    },
  },

  PneumaticVacGenerator: {
    label: 'Vacuum Generator',
    icon: '💨',
    color: '#1574c4',
    colorBg: '#e8f0fa',
    sides: 8,
    category: 'Pneumatic',
    operations: [
      { value: 'VacOn', label: 'Vacuum On', verb: 'VacOn', icon: '💨' },
      { value: 'VacOff', label: 'Vacuum Off', verb: 'VacOff', icon: '⭕' },
      { value: 'VacOnEject', label: 'Vacuum On + Eject', verb: 'VacOnEject', icon: '💨' },
    ],
    homePositions: [
      { value: 'VacOff', label: 'Vacuum Off' },
      { value: 'VacOn', label: 'Vacuum On' },
    ],
    defaultHomePosition: 'VacOff',
    tagPatterns: {
      inputVacOn:       'i_{name}VacOn',
      inputVacOnEject:  'i_{name}VacOnEject',
      outputVacOn:      'q_VacOn{name}',
      outputVacOff:     'q_VacOff{name}',
      outputVacOnEject: 'q_VacOnEject{name}',
      timerVacOn:       '{name}VacOnDelay',
      timerVacOnEject:  '{name}VacOnEjectDelay',
    },
    defaultTimerPreMs: 300,
    transitionConditions: {
      VacOn: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}VacOn',
        timerTag: '{name}VacOnDelay',
        labelTemplate: "'{deviceName}' Vac On Verified",
      },
      VacOff: {
        type: 'timer',
        timerTag: '{name}VacOnDelay',
        labelTemplate: "'{deviceName}' Vac Off Timer",
      },
      VacOnEject: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}VacOnEject',
        timerTag: '{name}VacOnEjectDelay',
        labelTemplate: "'{deviceName}' VacEject Verified",
      },
    },
  },

  ServoAxis: {
    label: 'Servo Axis',
    icon: '⚡',
    color: '#061d39',
    colorBg: '#e6eaf0',
    sides: 10,
    category: 'Servo',
    operations: [
      { value: 'ServoMove', label: 'Move to Position', verb: 'MoveTo', icon: '⚡' },
      { value: 'ServoIncr', label: 'Incremental Move', verb: 'Increment', icon: '↔' },
      { value: 'ServoIndex', label: 'Index', verb: 'Index', icon: '🔄' },
    ],
    tagPatterns: {
      axisTag:          'a{axisNum}_{name}',
      positionParam:    'p_{name}{positionName}',
      mamControl:       'MAM_{name}',
      oneShotTag:       '{name}_Step{step}_OS',
    },
    defaultTimerPreMs: 0,
    // Positions are user-defined per device instance
    transitionConditions: {
      ServoMove: {
        type: 'servoAtTarget',
        labelTemplate: "@ '{positionName}'",
      },
    },
  },

  Timer: {
    label: 'Timer / Dwell',
    icon: '⏱',
    color: '#d9d9d9',
    colorBg: '#f5f5f5',
    sides: 12,
    category: 'Logic',
    operations: [
      { value: 'Wait', label: 'Wait (Dwell)', verb: 'Wait', icon: '⏱' },
    ],
    tagPatterns: {
      timerTag: '{name}',
    },
    defaultTimerPreMs: 1000,
    transitionConditions: {
      Wait: {
        type: 'timer',
        timerTag: '{name}',
        labelTemplate: "Timer {delayMs}ms",
      },
    },
  },

  DigitalSensor: {
    label: 'Digital Sensor / PEC',
    icon: '👁',
    color: '#aacee8',
    colorBg: '#eef5fb',
    sides: 14,
    category: 'Sensor',
    operations: [
      { value: 'Verify', label: 'Verify (Check Sensor)', verb: 'Verify', icon: '✓' },
      { value: 'WaitOn', label: 'Wait For ON', verb: 'WaitOn', icon: '👁' },
      { value: 'WaitOff', label: 'Wait For OFF', verb: 'WaitOff', icon: '👁' },
    ],
    tagPatterns: {
      inputTag: 'i_{name}',
      debounce: '{name}Debounce',
    },
    defaultTimerPreMs: 10,
    transitionConditions: {
      WaitOn: {
        type: 'sensorOn',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' ON",
      },
      WaitOff: {
        type: 'sensorOff',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' OFF",
      },
      Verify: {
        type: 'sensorOn',
        sensorTag: 'i_{name}',
        labelTemplate: "'{deviceName}' Verified ON",
      },
    },
  },

  VisionSystem: {
    label: 'Vision System',
    icon: '📷',
    color: '#fa9150',
    colorBg: '#fff0e6',
    sides: 4,
    category: 'Sensor',
    operations: [
      { value: 'Trigger', label: 'Trigger Inspection', verb: 'Trigger', icon: '📷' },
    ],
    tagPatterns: {
      triggerOutput:    'q_Trigger{name}',
      trigReady:        'i_{name}TrigRdy',
      resultReady:      'i_{name}ResultReady',
      inspPass:         'i_{name}InspPass',
      waitTimer:        '{name}WaitTimer',
      trigDwell:        '{name}TrigDwell',
      jobOutcome:       'q_Pass_{jobName}',   // per-job pass/fail params
    },
    defaultTimerPreMs: 50,
    transitionConditions: {
      Trigger: {
        type: 'sensorTimer',
        sensorTag: 'i_{name}ResultReady',
        timerTag: '{name}TrigDwell',
        labelTemplate: "'{deviceName}' Result Ready",
      },
    },
  },

  Parameter: {
    label: 'Parameter',
    icon: '⚙',
    color: '#ffde51',
    colorBg: '#fffde6',
    sides: 0,
    category: 'Logic',
    operations: [
      { value: 'SetOn',    label: 'Set ON',    verb: 'SetOn',    icon: '●' },
      { value: 'SetOff',   label: 'Set OFF',   verb: 'SetOff',   icon: '○' },
      { value: 'WaitOn',   label: 'Wait ON',   verb: 'WaitOn',   icon: '⏳' },
      { value: 'WaitOff',  label: 'Wait OFF',  verb: 'WaitOff',  icon: '⏳' },
      { value: 'SetValue', label: 'Set Value', verb: 'SetValue', icon: '=' },
    ],
    tagPatterns: {
      paramTag: 'p_{name}',
    },
    defaultTimerPreMs: 0,
    // Parameters latch (OTL/OTU). WaitOn/WaitOff produce verify transition conditions.
    transitionConditions: {
      WaitOn: {
        type: 'paramOn',
        paramTag: 'p_{name}',
        labelTemplate: "'{deviceName}' = ON",
      },
      WaitOff: {
        type: 'paramOff',
        paramTag: 'p_{name}',
        labelTemplate: "'{deviceName}' = OFF",
      },
      // SetOn / SetOff / SetValue do not produce a verify transition condition.
    },
  },
};

export const DEVICE_CATEGORIES = {
  Pneumatic: ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'],
  Servo: ['ServoAxis'],
  Logic: ['Timer', 'Parameter'],
  Sensor: ['DigitalSensor', 'VisionSystem'],
};

/**
 * Get all available operations for a device type
 */
export function getOperationsForType(typeKey) {
  return DEVICE_TYPES[typeKey]?.operations ?? [];
}

/**
 * Get the default transition condition suggestion for a given device operation
 */
export function getTransitionSuggestion(typeKey, operation) {
  return DEVICE_TYPES[typeKey]?.transitionConditions?.[operation] ?? null;
}

/**
 * Derive a normalised sensor-config key from the device's sensorArrangement string.
 * Returns: 'both' | 'extendOnly' | 'retractOnly' | 'engageOnly' | 'none'
 */
export function getSensorConfigKey(device) {
  const arr = (device.sensorArrangement ?? '').toLowerCase();

  switch (device.type) {
    case 'PneumaticLinearActuator':
    case 'PneumaticRotaryActuator':
      if (arr.includes('2-sensor')) return 'both';
      if (arr.includes('ret only') || arr.includes('1-sensor')) return 'retractOnly';
      if (arr.includes('ext only')) return 'extendOnly';
      return 'none';

    case 'PneumaticGripper':
      if (arr.includes('2-sensor')) return 'both';
      if (arr.includes('1-sensor') || arr.includes('engaged only')) return 'engageOnly';
      return 'none';

    default:
      return 'none';
  }
}
