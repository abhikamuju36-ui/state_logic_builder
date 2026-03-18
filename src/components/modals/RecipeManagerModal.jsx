/**
 * RecipeManagerModal — Manage recipes and their parameter overrides.
 * Grid layout: parameters as rows, recipes as columns.
 * The default recipe shows base device values. Non-default recipes override from the default.
 */

import { useState, useMemo } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore.js';

export function RecipeManagerModal() {
  const store = useDiagramStore();
  const { project } = store;
  const recipes = project.recipes ?? [];
  const overrides = project.recipeOverrides ?? {};
  const sms = project.stateMachines ?? [];

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [expandedSpeeds, setExpandedSpeeds] = useState({});  // { "smId|device": true }

  // Find the default recipe
  const defaultRecipe = recipes.find(r => r.isDefault) ?? recipes[0];
  const defaultRecipeId = defaultRecipe?.id;

  // ── Collect all parameters across all SMs ──────────────────────────────

  const parameters = useMemo(() => {
    const params = [];

    for (const sm of sms) {
      for (const dev of (sm.devices ?? [])) {
        if (dev._autoVerify || dev._autoVision) continue;

        // Servo positions only
        if (dev.type === 'ServoAxis') {
          for (const pos of (dev.positions ?? [])) {
            params.push({
              category: 'positions',
              key: `${dev.id}:${pos.name}`,
              label: pos.name,
              device: dev.displayName || dev.name,
              sm: sm.displayName || sm.name,
              smId: sm.id,
              devId: dev.id,
              posName: pos.name,
              type: 'number',
              unit: 'mm',
              baseValue: pos.defaultValue ?? 0,
              isSpeed: false,
            });
          }
          // Speed profiles — tagged so we can show/hide them
          for (const sp of (dev.speedProfiles ?? [])) {
            for (const field of ['speed', 'accel', 'decel']) {
              params.push({
                category: 'speeds',
                key: `${dev.id}:${sp.name}:${field}`,
                label: `${sp.name} ${field}`,
                device: dev.displayName || dev.name,
                sm: sm.displayName || sm.name,
                smId: sm.id,
                devId: dev.id,
                speedProfileName: sp.name,
                speedField: field,
                type: 'number',
                unit: field === 'speed' ? 'mm/s' : 'mm/s\u00B2',
                baseValue: sp[field] ?? 0,
                isSpeed: true,
              });
            }
          }
        }
      }
    }

    return params;
  }, [sms]);

  // ── Group parameters by SM > Device ────────────────────────────────────

  const groupedParams = useMemo(() => {
    const groups = {};
    for (const p of parameters) {
      const gKey = `${p.smId}|${p.device}`;
      if (!groups[gKey]) groups[gKey] = { sm: p.sm, device: p.device, smId: p.smId, params: [] };
      groups[gKey].params.push(p);
    }
    return Object.values(groups);
  }, [parameters]);

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Get the effective value for a recipe + param: override if set, else base device value */
  function getEffectiveValue(recipeId, param) {
    const ov = overrides[recipeId]?.[param.category]?.[param.key];
    if (ov !== undefined) return ov;
    // Fall back to device base value
    return param.baseValue;
  }

  /** Get the value the default recipe has for this param */
  function getDefaultValue(param) {
    if (!defaultRecipeId) return param.baseValue;
    return getEffectiveValue(defaultRecipeId, param);
  }

  // ── Handlers ───────────────────────────────────────────────────────────

  function handleAddRecipe() {
    const name = newName.trim();
    if (!name) return;
    store.addRecipe({ name });
    setNewName('');
  }

  function handleDeleteRecipe(id) {
    const r = recipes.find(rc => rc.id === id);
    if (recipes.length <= 1) {
      alert('You need at least one recipe.');
      return;
    }
    if (!confirm(`Delete recipe "${r?.name}"?`)) return;
    store.deleteRecipe(id);
  }

  function handleDuplicate(id) {
    const r = recipes.find(rc => rc.id === id);
    store.duplicateRecipe(id, `${r?.name} (copy)`);
  }

  function startEditName(recipe) {
    setEditingId(recipe.id);
    setEditName(recipe.name);
  }

  function commitEditName(id) {
    if (editName.trim()) store.updateRecipe(id, { name: editName.trim() });
    setEditingId(null);
  }

  function handleValueChange(recipeId, param, rawValue) {
    const val = rawValue === '' ? undefined : Number(rawValue);
    if (val === undefined) {
      store.clearRecipeOverride(recipeId, param.category, param.key);
    } else {
      store.setRecipeOverride(recipeId, param.category, param.key, val);
    }
  }

  // ── Build table rows ─────────────────────────────────────────────────

  function toggleSpeeds(groupKey) {
    setExpandedSpeeds(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }

  function renderParamRows() {
    const rows = [];

    for (let gi = 0; gi < groupedParams.length; gi++) {
      const group = groupedParams[gi];
      const groupKey = `${group.smId}|${group.device}`;
      const hasSpeedParams = group.params.some(p => p.isSpeed);
      const speedsExpanded = expandedSpeeds[groupKey] ?? false;

      rows.push(
        <tr key={`gh-${gi}`} className="recipe-grid__group-header">
          <td colSpan={1 + recipes.length}>
            <span className="recipe-grid__group-sm">{group.sm}</span>
            <span className="recipe-grid__group-device">{group.device}</span>
            {hasSpeedParams && (
              <button
                className="recipe-grid__speed-toggle"
                onClick={() => toggleSpeeds(groupKey)}
                title={speedsExpanded ? 'Hide speed profiles' : 'Show speed profiles'}
              >
                {speedsExpanded ? '▾ Hide Speeds' : '▸ Speeds'}
              </button>
            )}
          </td>
        </tr>
      );
      for (const param of group.params) {
        // Hide speed params unless expanded
        if (param.isSpeed && !speedsExpanded) continue;
        const defVal = getDefaultValue(param);

        rows.push(
          <tr key={param.key}>
            <td className="recipe-grid__param-cell">
              <span className="recipe-grid__param-label">{param.label}</span>
              <span className="recipe-grid__param-unit">{param.unit}</span>
            </td>
            {recipes.map(r => {
              const ov = overrides[r.id]?.[param.category]?.[param.key];
              const effectiveVal = ov !== undefined ? ov : param.baseValue;
              const isDefault = r.id === defaultRecipeId;
              // Non-default recipes: highlight if value differs from default recipe
              const differsFromDefault = !isDefault && effectiveVal !== defVal;

              return (
                <td
                  key={r.id}
                  className={
                    'recipe-grid__value-cell' +
                    (differsFromDefault ? ' recipe-grid__value-cell--override' : '') +
                    (isDefault ? ' recipe-grid__value-cell--default' : '')
                  }
                >
                  <input
                    type="number"
                    className="recipe-grid__input"
                    value={ov !== undefined ? ov : ''}
                    placeholder={String(isDefault ? param.baseValue : defVal)}
                    onChange={e => handleValueChange(r.id, param, e.target.value)}
                  />
                </td>
              );
            })}
          </tr>
        );
      }
    }

    return rows;
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={store.closeRecipeManager}>
      <div className="modal" style={{ width: 'min(95vw, 1100px)', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal__header">
          <span>Recipe Manager</span>
          <button className="modal__close" onClick={store.closeRecipeManager}>&#x2715;</button>
        </div>

        {/* Body */}
        <div className="modal__body" style={{ padding: 0 }}>

          {/* Legend */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '6px 16px',
            background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, color: '#64748b',
          }}>
            <span style={{ fontWeight: 600, color: '#374151' }}>Legend:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: '#fef9c3', border: '1.5px solid #fde047' }} />
              Value differs from default recipe
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: '#eff6ff', border: '1.5px solid #93c5fd' }} />
              Default recipe column
            </span>
            <span style={{ color: '#9ca3af', marginLeft: 'auto' }}>
              Leave a cell blank to inherit the default recipe value
            </span>
          </div>

          {/* Add recipe bar */}
          <div className="recipe-add-bar">
            <input
              className="form-input"
              placeholder="New recipe name..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddRecipe()}
              style={{ flex: 1 }}
            />
            <button className="btn btn--primary btn--sm" onClick={handleAddRecipe} disabled={!newName.trim()}>
              + Add Recipe
            </button>
          </div>

          {recipes.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#8896a8' }}>
              No recipes yet. Add one above to get started.
            </div>
          ) : (
            <div className="recipe-grid-wrap">
              <table className="recipe-grid">
                <thead>
                  <tr>
                    <th className="recipe-grid__param-header">Parameter</th>
                    {recipes.map(r => (
                      <th key={r.id} className={`recipe-grid__recipe-header${r.isDefault ? ' recipe-grid__recipe-header--default' : ''}`}>
                        <div className="recipe-header">
                          {editingId === r.id ? (
                            <input
                              className="recipe-header__name-input"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onBlur={() => commitEditName(r.id)}
                              onKeyDown={e => e.key === 'Enter' && commitEditName(r.id)}
                              autoFocus
                            />
                          ) : (
                            <span
                              className="recipe-header__name"
                              onDoubleClick={() => startEditName(r)}
                              title="Double-click to rename"
                            >
                              {r.name}
                              {r.isDefault && <span className="recipe-header__default-badge">DEFAULT</span>}
                            </span>
                          )}
                          <div className="recipe-header__actions">
                            <label className="recipe-header__check" title="Custom sequence — this recipe has its own state machine layout">
                              <input
                                type="checkbox"
                                checked={r.customSequence ?? false}
                                onChange={() => {
                                  if (r.customSequence) {
                                    if (!confirm(`Revert "${r.name}" to the default sequence? Custom sequence changes will be lost.`)) return;
                                  }
                                  store.toggleCustomSequence(r.id);
                                }}
                              />
                              <span style={{ fontSize: 11 }}>Custom Seq</span>
                            </label>
                            <button
                              className="recipe-header__btn"
                              title="Set as default"
                              onClick={() => store.setDefaultRecipe(r.id)}
                              style={{ color: r.isDefault ? '#f59e0b' : undefined }}
                            >&#9733;</button>
                            <button
                              className="recipe-header__btn"
                              title="Duplicate recipe"
                              onClick={() => handleDuplicate(r.id)}
                            >&#10697;</button>
                            {!r.isDefault && (
                              <button
                                className="recipe-header__btn recipe-header__btn--danger"
                                title="Delete recipe"
                                onClick={() => handleDeleteRecipe(r.id)}
                              >&#x2715;</button>
                            )}
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {renderParamRows()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
