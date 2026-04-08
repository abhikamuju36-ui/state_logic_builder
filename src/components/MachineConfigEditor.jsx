/**
 * MachineConfigEditor - Machine type, station layout, and SM association.
 * Features a visual representation (dial, linear, etc.) of the station layout.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useDiagramStore, _getSmArray } from '../store/useDiagramStore.js';

// ── Mini SVG icons for machine type cards ───────────────────────────────────
function MiniDialIcon({ active }) {
  const c = '#1574C4';
  const bg = active ? '#dbeafe' : '#e0f2fe';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      <circle cx="24" cy="24" r="20" fill="none" stroke={bg} strokeWidth="2" />
      <circle cx="24" cy="24" r="5" fill={bg} stroke={c} strokeWidth="1" />
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const x = 24 + 16 * Math.cos(a);
        const y = 24 + 16 * Math.sin(a);
        return <circle key={i} cx={x} cy={y} r="3" fill={c} opacity={0.8} />;
      })}
    </svg>
  );
}

function MiniLinearIcon({ active }) {
  const c = '#1574C4';
  const bg = active ? '#dbeafe' : '#e0f2fe';
  return (
    <svg viewBox="0 0 56 32" width="48" height="28">
      <line x1="4" y1="16" x2="52" y2="16" stroke={bg} strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="52,16 48,12 48,20" fill={c} opacity={0.5} />
      {Array.from({ length: 5 }).map((_, i) => {
        const x = 6 + i * 10;
        return <rect key={i} x={x} y="9" width="8" height="14" rx="2" fill={c} opacity={0.8} />;
      })}
    </svg>
  );
}

function MiniRobotCellIcon({ active }) {
  const c = '#7c3aed';
  const bg = active ? '#ede9fe' : '#f5f3ff';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      {/* Base pedestal */}
      <rect x="10" y="38" width="16" height="6" rx="2" fill={c} opacity={0.7} />
      <rect x="14" y="34" width="8" height="5" rx="1" fill={c} opacity={0.5} />
      {/* Robot body / J1 */}
      <rect x="15" y="26" width="6" height="9" rx="2" fill={c} opacity={0.8} />
      {/* Upper arm / J2 */}
      <line x1="18" y1="26" x2="18" y2="14" stroke={c} strokeWidth="3" strokeLinecap="round" />
      {/* Elbow joint */}
      <circle cx="18" cy="14" r="2.5" fill={bg} stroke={c} strokeWidth="1.5" />
      {/* Forearm / J3 */}
      <line x1="18" y1="14" x2="32" y2="10" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      {/* Wrist joint */}
      <circle cx="32" cy="10" r="2" fill={bg} stroke={c} strokeWidth="1.5" />
      {/* End effector / gripper */}
      <line x1="32" y1="10" x2="38" y2="7" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="5" x2="38" y2="9" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      {/* Peripheral stations */}
      {[[38, 22], [38, 34], [42, 42]].map(([x, y], i) => (
        <rect key={i} x={x - 3} y={y - 3} width="7" height="5" rx="1.5" fill={c} opacity={0.5} />
      ))}
    </svg>
  );
}

function MiniTestIcon({ active }) {
  const c = '#d97706';
  const bg = active ? '#fde68a' : '#fef3c7';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      {/* Camera mount arm */}
      <line x1="8" y1="40" x2="8" y2="18" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="8" y1="18" x2="22" y2="12" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      {/* Camera body */}
      <rect x="20" y="6" width="16" height="12" rx="2" fill={bg} stroke={c} strokeWidth="2" />
      {/* Camera lens */}
      <circle cx="28" cy="12" r="4" fill="none" stroke={c} strokeWidth="1.5" />
      <circle cx="28" cy="12" r="1.5" fill={c} opacity={0.6} />
      {/* LED ring */}
      <circle cx="28" cy="12" r="6" fill="none" stroke={c} strokeWidth="0.8" strokeDasharray="2 2" opacity={0.5} />
      {/* Light cone / FOV */}
      <path d="M22,18 L16,34 L40,34 L34,18" fill={c} opacity={0.1} stroke={c} strokeWidth="0.8" strokeDasharray="3 2" />
      {/* Part on conveyor */}
      <rect x="18" y="36" width="20" height="4" rx="1" fill={c} opacity={0.4} />
      <rect x="24" y="32" width="8" height="4" rx="1" fill={c} opacity={0.6} />
      {/* Mount base */}
      <rect x="4" y="40" width="8" height="4" rx="1" fill={c} opacity={0.6} />
    </svg>
  );
}

function MiniCustomIcon({ active }) {
  const c = '#64748b';
  return (
    <svg viewBox="0 0 48 48" width="40" height="40">
      {/* Gear */}
      <circle cx="24" cy="24" r="8" fill="none" stroke={c} strokeWidth="2" />
      <circle cx="24" cy="24" r="3" fill={c} opacity={0.4} />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const x1 = 24 + 10 * Math.cos(a);
        const y1 = 24 + 10 * Math.sin(a);
        const x2 = 24 + 14 * Math.cos(a);
        const y2 = 24 + 14 * Math.sin(a);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="3" strokeLinecap="round" />;
      })}
    </svg>
  );
}

const MACHINE_TYPE_ICONS = {
  indexing: MiniDialIcon,
  linear: MiniLinearIcon,
  robotCell: MiniRobotCellIcon,
  testInspect: MiniTestIcon,
  custom: MiniCustomIcon,
};

const MACHINE_TYPES = [
  { id: 'indexing', label: 'Indexing Dial', description: 'Rotary indexing table with stations around the perimeter' },
  { id: 'linear', label: 'Linear Indexing', description: 'Parts move linearly from station to station' },
  { id: 'robotCell', label: 'Robot Cell', description: 'Robot-centric processing cell with peripheral stations' },
  { id: 'testInspect', label: 'Test & Inspection', description: 'Testing and inspection machine with verify stations' },
  { id: 'custom', label: 'Custom', description: 'Custom machine layout' },
];

const STATION_TYPES = [
  { id: 'load', label: 'Load', color: '#1574C4' },
  { id: 'verify', label: 'Verify', color: '#E8A317' },
  { id: 'empty', label: 'Empty', color: '#94a3b8' },
];

// ── Visual Dial Layout ──────────────────────────────────────────────────────
function DialVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see dial layout</div>;

  // Scale radius so stations never overlap — need circumference > count * (2 * stationR + gap)
  const stationR = 28;
  const minGap = 14;
  const minCircumference = count * (stationR * 2 + minGap);
  const r = Math.max(120, minCircumference / (2 * Math.PI));
  const size = (r + stationR + 20) * 2;
  const cx = size / 2, cy = size / 2;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="machine-visual__svg machine-visual__svg--dial">
      {/* Dial ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="6 4" />
      <circle cx={cx} cy={cy} r={28} fill="#f1f5f9" stroke="#94a3b8" strokeWidth="1.5" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="600">INDEX</text>

      {/* Direction arrow */}
      <path d={`M ${cx + r + 12} ${cy - 20} A ${r + 12} ${r + 12} 0 0 1 ${cx + r + 12} ${cy + 20}`}
        fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
          <polygon points="0 0, 6 2.5, 0 5" fill="#94a3b8" />
        </marker>
      </defs>

      {stations.map((st, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
        const isSelected = st.id === selectedId;
        const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

        return (
          <g key={st.id} className="station-click" onClick={() => onSelectStation(st.id)} style={{ cursor: 'pointer' }}>
            <circle
              cx={x} cy={y} r={stationR}
              fill={isSelected ? stType.color : '#fff'}
              stroke={stType.color}
              strokeWidth={isSelected ? 3 : 2}
            />
            <text x={x} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="700"
              fill={isSelected ? '#fff' : stType.color}>
              S{String(st.number).padStart(2, '0')}
            </text>
            <text x={x} y={y + 8} textAnchor="middle" fontSize="7"
              fill={isSelected ? '#fff' : '#64748b'}>
              {(st.name ?? '').substring(0, 10)}
            </text>
            {linkedSms.length > 0 && (
              <circle cx={x + stationR - 4} cy={y - stationR + 4} r={7} fill="#befa4f" stroke="#1574C4" strokeWidth="1" />
            )}
            {linkedSms.length > 0 && (
              <text x={x + stationR - 4} y={y - stationR + 7} textAnchor="middle" fontSize="8" fontWeight="700" fill="#1574C4">
                {linkedSms.length}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Visual Linear Layout ────────────────────────────────────────────────────
function LinearVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see linear layout</div>;

  return (
    <div className="linear-visual">
      <div className="linear-visual__track">
        <div className="linear-visual__line" />
        <div className="linear-visual__arrow" />
      </div>
      <div className="linear-visual__stations" style={{ '--station-count': count }}>
        {stations.map((st) => {
          const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
          const isSelected = st.id === selectedId;
          const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

          return (
            <div
              key={st.id}
              className={`linear-visual__station${isSelected ? ' linear-visual__station--selected' : ''}`}
              style={{
                borderColor: stType.color,
                background: isSelected ? stType.color : '#fff',
                color: isSelected ? '#fff' : stType.color,
              }}
              onClick={() => onSelectStation(st.id)}
            >
              <span className="linear-visual__station-id">
                S{String(st.number).padStart(2, '0')}
              </span>
              <span className="linear-visual__station-name" style={{ color: isSelected ? '#fff' : '#64748b' }}>
                {(st.name ?? '').substring(0, 14)}
              </span>
              {linkedSms.length > 0 && (
                <span className="linear-visual__sm-badge">{linkedSms.length}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Robot Cell Layout ───────────────────────────────────────────────────────
function RobotCellVisual({ stations, selectedId, onSelectStation, sms }) {
  const count = stations.length;
  if (count === 0) return <div className="machine-visual__empty">Add stations to see cell layout</div>;

  const cx = 200, cy = 200, r = 140;

  return (
    <svg viewBox="0 0 400 400" className="machine-visual__svg">
      {/* Cell boundary */}
      <rect x={30} y={30} width={340} height={340} rx={16} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="8 4" />
      {/* Robot in center */}
      <circle cx={cx} cy={cy} r={36} fill="#f5f3ff" stroke="#7c3aed" strokeWidth="2" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="10" fill="#7c3aed" fontWeight="600">ROBOT</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#a78bfa">CELL</text>

      {stations.map((st, i) => {
        const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
        const isSelected = st.id === selectedId;
        const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);

        return (
          <g key={st.id} className="station-click" onClick={() => onSelectStation(st.id)} style={{ cursor: 'pointer' }}>
            <rect x={x - 36} y={y - 24} width={72} height={48} rx={6}
              fill={isSelected ? stType.color : '#fff'}
              stroke={stType.color} strokeWidth={isSelected ? 3 : 1.5} />
            <text x={x} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700"
              fill={isSelected ? '#fff' : stType.color}>
              S{String(st.number).padStart(2, '0')}
            </text>
            <text x={x} y={y + 8} textAnchor="middle" fontSize="7"
              fill={isSelected ? '#fff' : '#64748b'}>
              {(st.name ?? '').substring(0, 10)}
            </text>
            {linkedSms.length > 0 && (
              <>
                <circle cx={x + 30} cy={y - 18} r={7} fill="#befa4f" stroke="#1574C4" strokeWidth="1" />
                <text x={x + 30} y={y - 15} textAnchor="middle" fontSize="8" fontWeight="700" fill="#1574C4">
                  {linkedSms.length}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Station Detail Panel ────────────────────────────────────────────────────
function StationDetail({ station, sms, onUpdate, onLinkSm, onUnlinkSm }) {
  if (!station) return (
    <div className="station-detail__empty">
      Select a station on the visual to edit its properties
    </div>
  );

  const linkedSms = (station.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);
  const availableSms = sms.filter(s => !(station.smIds ?? []).includes(s.id));
  const stType = STATION_TYPES.find(t => t.id === station.type) ?? STATION_TYPES[0];

  return (
    <div className="station-detail">
      <div className="station-detail__header" style={{ borderLeftColor: stType.color }}>
        <span className="station-detail__number">S{String(station.number).padStart(2, '0')}</span>
        <input
          className="station-detail__name-input"
          value={station.name}
          onChange={e => onUpdate(station.id, { name: e.target.value })}
          placeholder="Station name"
        />
      </div>

      <div className="station-detail__field">
        <label>Station Type</label>
        <div className="station-detail__type-grid">
          {STATION_TYPES.map(t => (
            <button
              key={t.id}
              className={`station-detail__type-btn${station.type === t.id ? ' station-detail__type-btn--active' : ''}`}
              style={{ '--type-color': t.color }}
              onClick={() => onUpdate(station.id, { type: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Linked State Machines */}
      <div className="station-detail__field">
        <label>Linked State Machines</label>
        {linkedSms.length > 0 ? (
          <div className="station-detail__sm-list">
            {linkedSms.map(sm => (
              <div key={sm.id} className="station-detail__sm-item">
                <span className="station-detail__sm-badge">S{String(sm.stationNumber).padStart(2, '0')}</span>
                <span>{sm.displayName ?? sm.name}</span>
                <button
                  className="station-detail__sm-remove"
                  onClick={() => onUnlinkSm(station.id, sm.id)}
                  title="Unlink"
                >×</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="station-detail__hint">No state machines linked to this station</p>
        )}
        {availableSms.length > 0 && (
          <select
            className="station-detail__sm-add"
            value=""
            onChange={e => { if (e.target.value) onLinkSm(station.id, e.target.value); }}
          >
            <option value="">+ Link State Machine...</option>
            {availableSms.map(sm => (
              <option key={sm.id} value={sm.id}>
                S{String(sm.stationNumber).padStart(2, '0')} — {sm.displayName ?? sm.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Verify station options */}
      {station.type === 'verify' && (
        <div className="station-detail__field">
          <label>
            <input
              type="checkbox"
              checked={station.bypass ?? false}
              onChange={e => onUpdate(station.id, { bypass: e.target.checked })}
            />
            Bypass capable
          </label>
          <label style={{ marginTop: 4, display: 'block' }}>
            <input
              type="checkbox"
              checked={station.lockout ?? false}
              onChange={e => onUpdate(station.id, { lockout: e.target.checked })}
            />
            Lockout capable
          </label>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────
export function MachineConfigEditor() {
  const mc = useDiagramStore(s => s.project.machineConfig ?? {});
  const store = useDiagramStore();
  const sms = _getSmArray(store);
  const updateMachineConfig = useDiagramStore(s => s.updateMachineConfig);
  const setMachineStationCount = useDiagramStore(s => s.setStationCount);
  const updateStation = useDiagramStore(s => s.updateStation);
  const linkSmToStation = useDiagramStore(s => s.linkSmToStation);
  const unlinkSmFromStation = useDiagramStore(s => s.unlinkSmFromStation);

  const [selectedStationId, setSelectedStationId] = useState(null);
  const selectedStation = (mc.stations ?? []).find(s => s.id === selectedStationId) ?? null;

  const machineType = mc.machineType ?? 'indexing';
  const stations = mc.stations ?? [];

  const VisualComponent = useMemo(() => {
    switch (machineType) {
      case 'indexing': return DialVisual;
      case 'linear': return LinearVisual;
      case 'robotCell': return RobotCellVisual;
      case 'testInspect': return LinearVisual;
      default: return LinearVisual;
    }
  }, [machineType]);

  // Click anywhere outside a station or its detail panel → deselect
  const handleBackgroundClick = useCallback((e) => {
    // Don't deselect if clicking inside station detail or a station element
    if (e.target.closest('.machine-config__station-detail')) return;
    if (e.target.closest('.machine-config__station-table tbody tr')) return;
    if (e.target.closest('.linear-visual__station')) return;
    if (e.target.closest('.station-click')) return;
    setSelectedStationId(null);
  }, []);

  return (
    <div className="machine-config" onClick={handleBackgroundClick}>
      <div className="machine-config__header">
        <h2 className="machine-config__title">Machine Configuration</h2>
        <p className="machine-config__subtitle">
          Define your machine layout, name stations, and link them to state machines.
        </p>
      </div>

      {/* Top form row */}
      <div className="machine-config__form-row">
        <div className="machine-config__field">
          <label>Machine Name</label>
          <input
            type="text"
            value={mc.machineName ?? ''}
            onChange={e => updateMachineConfig({ machineName: e.target.value })}
            placeholder="e.g. Stamper PNP Assembly"
          />
        </div>
        <div className="machine-config__field">
          <label>Customer</label>
          <input
            type="text"
            value={mc.customerName ?? ''}
            onChange={e => updateMachineConfig({ customerName: e.target.value })}
            placeholder="e.g. Acme Corp"
          />
        </div>
        <div className="machine-config__field">
          <label>Project Number</label>
          <input
            type="text"
            value={mc.projectNumber ?? ''}
            onChange={e => updateMachineConfig({ projectNumber: e.target.value })}
            placeholder="e.g. 1103"
          />
        </div>
        <div className="machine-config__field">
          <label>Target Cycle Time (s)</label>
          <input
            type="number"
            value={mc.targetCycleTime ?? 0}
            onChange={e => updateMachineConfig({ targetCycleTime: Number(e.target.value) })}
            min="0"
            step="0.1"
          />
        </div>
      </div>

      {/* Machine type selector */}
      <div className="machine-config__type-selector">
        <label>Machine Type</label>
        <div className="machine-config__type-grid">
          {MACHINE_TYPES.map(mt => {
            const IconComp = MACHINE_TYPE_ICONS[mt.id];
            const isActive = machineType === mt.id;
            return (
              <button
                key={mt.id}
                className={`machine-config__type-card${isActive ? ' machine-config__type-card--active' : ''}`}
                onClick={() => updateMachineConfig({ machineType: mt.id })}
              >
                <span className="machine-config__type-icon">{IconComp && <IconComp active={isActive} />}</span>
                <span className="machine-config__type-label">{mt.label}</span>
                <span className="machine-config__type-desc">{mt.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Station count + nest count */}
      <div className="machine-config__form-row">
        <div className="machine-config__field">
          <label>Number of Stations</label>
          <div className="machine-config__count-control">
            <button onClick={() => setMachineStationCount(Math.max(0, stations.length - 1))}>−</button>
            <span className="machine-config__count-value">{stations.length}</span>
            <button onClick={() => setMachineStationCount(stations.length + 1)}>+</button>
          </div>
        </div>
        {machineType === 'indexing' && (
          <div className="machine-config__field">
            <label>Number of Nests</label>
            <input
              type="number"
              value={mc.nestCount ?? 0}
              onChange={e => updateMachineConfig({ nestCount: Number(e.target.value) })}
              min="0"
            />
          </div>
        )}
      </div>

      {/* Visual — full width */}
      <div className="machine-config__visual-wrapper machine-config__visual-wrapper--full">
        <VisualComponent
          stations={stations}
          selectedId={selectedStationId}
          onSelectStation={setSelectedStationId}
          sms={sms}
        />
      </div>

      {/* Station list table + selected detail side by side */}
      {stations.length > 0 && (
        <div className="machine-config__bottom-layout">
          <div className="machine-config__station-table-wrapper">
            <table className="machine-config__station-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>#</th>
                  <th>Name</th>
                  <th style={{ width: 64 }}>Type</th>
                  <th style={{ width: 36 }} title="Linked State Machines">SMs</th>
                </tr>
              </thead>
              <tbody>
                {stations.map(st => {
                  const stType = STATION_TYPES.find(t => t.id === st.type) ?? STATION_TYPES[0];
                  const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);
                  const isSelected = st.id === selectedStationId;
                  return (
                    <tr
                      key={st.id}
                      className={isSelected ? 'machine-config__station-row--active' : ''}
                      onClick={() => setSelectedStationId(st.id)}
                    >
                      <td className="machine-config__station-num">
                        S{String(st.number).padStart(2, '0')}
                      </td>
                      <td className="machine-config__station-name">{st.name}</td>
                      <td>
                        <span className="machine-config__station-type-pill" style={{ background: stType.color }}>
                          {stType.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {linkedSms.length > 0
                          ? <span className="machine-config__station-sm-count">{linkedSms.length}</span>
                          : <span className="machine-config__station-none">—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="machine-config__detail-wrapper">
            <StationDetail
              station={selectedStation}
              sms={sms}
              onUpdate={updateStation}
              onLinkSm={linkSmToStation}
              onUnlinkSm={unlinkSmFromStation}
            />
          </div>
        </div>
      )}
    </div>
  );
}
