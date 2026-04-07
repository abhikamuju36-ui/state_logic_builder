/**
 * NewStateMachineModal - Create a new state machine / sequence program.
 */

import { useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';
import { buildProgramName } from '../../lib/tagNaming.js';

/** Valid PLC tag name: letters/digits/underscore, must start with a letter */
function isValidPLCName(n) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(n.trim());
}

export function NewStateMachineModal() {
  const store = useDiagramStore();
  const [name, setName] = useState('');
  const [station, setStation] = useState('');
  const [desc, setDesc] = useState('');
  const [addStartState, setAddStartState] = useState(true);

  const nameError = name && !isValidPLCName(name)
    ? 'Must start with a letter and contain only letters, numbers, or underscores (no spaces).'
    : null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || nameError) return;

    const smId = store.addStateMachine({
      name: name.trim(),
      stationNumber: Number(station) || 1,
      description: desc.trim(),
    });

    if (addStartState) {
      store.addNode(smId, { label: 'Wait for Index Complete' });
    }

    setName('');
    setStation('');
    setDesc('');
    store.closeNewSmModal();
  }

  const preview = name ? buildProgramName(station || 1, name) : '—';

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) store.closeNewSmModal(); }}>
      <div className="modal" style={{ width: 460 }}>
        <div className="modal__header">
          <span>New State Machine</span>
          <button className="icon-btn" onClick={store.closeNewSmModal}>✕</button>
        </div>

        <form className="modal__body" onSubmit={handleSubmit}>
          <label className="form-label">Station Name *</label>
          <input
            className={`form-input${nameError ? ' form-input--error' : ''}`}
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. PostCutterVerify"
          />
          {nameError
            ? <div className="form-hint form-hint--error">{nameError}</div>
            : <div className="form-hint">No spaces. PascalCase recommended. Used in L5X tag names.</div>
          }

          <label className="form-label">Station Number *</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="99"
            value={station}
            onChange={e => setStation(e.target.value)}
            placeholder="e.g. 4"
          />

          <label className="form-label">Description</label>
          <input
            className="form-input"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="e.g. Post Cutter and Part Verify"
          />

          <div className="props-info-box" style={{ marginTop: 8 }}>
            <div className="props-info-box__label">Program Name (L5X)</div>
            <div className="props-info-box__value mono">{preview}</div>
          </div>

          <label className="form-checkbox-row">
            <input
              type="checkbox"
              checked={addStartState}
              onChange={e => setAddStartState(e.target.checked)}
            />
            <span>Add initial "Wait for Index Complete" state</span>
          </label>

          <div className="modal__footer">
            <button type="button" className="btn btn--secondary" onClick={store.closeNewSmModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim() || !station || !!nameError}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
