/**
 * Toolbar - Top application bar.
 * Project name, SM dropdown (with reorder), recipe dropdown, export, save/load.
 *
 * Save = always triggers browser download dialog (user chooses where).
 * Ctrl+S = same behaviour.
 * Server-side persistence is handled automatically in the background.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useDiagramStore, _getSmArray } from '../store/useDiagramStore.js';
import { downloadL5X, downloadAllL5XAsZip, exportProjectJSON } from '../lib/l5xExporter.js';
import { buildProgramName } from '../lib/tagNaming.js';

// ── Reorderable list popup ─────────────────────────────────────────────────────
function ReorderPopup({ items, labelFn, onReorder, onClose, title }) {
  const dragIdx = useRef(null);
  const overIdx = useRef(null);
  const [, forceUpdate] = useState(0);

  function handleDragStart(i) { dragIdx.current = i; }
  function handleDragOver(e, i) {
    e.preventDefault();
    if (overIdx.current !== i) { overIdx.current = i; forceUpdate(n => n + 1); }
  }
  function handleDrop() {
    if (dragIdx.current !== null && overIdx.current !== null && dragIdx.current !== overIdx.current) {
      onReorder(dragIdx.current, overIdx.current);
    }
    dragIdx.current = null;
    overIdx.current = null;
    forceUpdate(n => n + 1);
  }

  return (
    <div className="reorder-popup__backdrop" onClick={onClose}>
      <div className="reorder-popup" onClick={e => e.stopPropagation()}>
        <div className="reorder-popup__header">
          <span className="reorder-popup__title">{title}</span>
          <button className="reorder-popup__close" onClick={onClose}>×</button>
        </div>
        <div className="reorder-popup__hint">Drag to reorder</div>
        <div className="reorder-popup__list">
          {items.map((item, i) => (
            <div
              key={item.id ?? i}
              className={`reorder-popup__item${overIdx.current === i ? ' reorder-popup__item--over' : ''}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={handleDrop}
              onDragEnd={() => { dragIdx.current = null; overIdx.current = null; forceUpdate(n => n + 1); }}
            >
              <span className="reorder-popup__grip">⠿</span>
              <span className="reorder-popup__label">{labelFn(item, i)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SVG icon helpers ───────────────────────────────────────────────────────────
function IconSave() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function IconOpen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function IconExport() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-3.45"/>
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-.49-3.45"/>
    </svg>
  );
}

// ── Main Toolbar ───────────────────────────────────────────────────────────────
export function Toolbar({ onGoHome }) {
  const store = useDiagramStore();
  const { project, activeSmId, serverAvailable, activeView } = store;
  const sms = _getSmArray(store);
  const sm = store.getActiveSm();
  const fileInputRef = useRef(null);
  const smDropdownRef = useRef(null);
  const recipeDropdownRef = useRef(null);

  const trackingFields = store.project?.partTracking?.fields ?? [];

  // Dropdown state
  const [smDropdownOpen, setSmDropdownOpen]       = useState(false);
  const [recipeDropdownOpen, setRecipeDropdownOpen] = useState(false);
  const [smReorderOpen, setSmReorderOpen]         = useState(false);
  const [recipeReorderOpen, setRecipeReorderOpen] = useState(false);

  // Unsaved-changes indicator
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const projectRef = useRef(project);
  useEffect(() => {
    if (projectRef.current !== project && projectRef.current !== null) {
      setHasUnsavedChanges(true);
    }
    projectRef.current = project;
  }, [project]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!smDropdownOpen && !recipeDropdownOpen) return;
    function handleClick(e) {
      if (smDropdownOpen && smDropdownRef.current && !smDropdownRef.current.contains(e.target))
        setSmDropdownOpen(false);
      if (recipeDropdownOpen && recipeDropdownRef.current && !recipeDropdownRef.current.contains(e.target))
        setRecipeDropdownOpen(false);
    }
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handleClick); };
  }, [smDropdownOpen, recipeDropdownOpen]);

  // ── Export handlers ──────────────────────────────────────────────────────────
  function handleExportL5X() {
    if (!sm) return alert('No state machine selected.');
    if ((sm.nodes ?? []).length === 0) return alert('No states defined. Add at least one state before exporting.');

    // Warn about unconfigured decision nodes
    const unconfiguredDecisions = (sm.nodes ?? []).filter(
      n => n.type === 'decisionNode' && !n.data?.signalId && !n.data?.sensorTag
    );
    if (unconfiguredDecisions.length > 0) {
      const ok = window.confirm(
        `${unconfiguredDecisions.length} decision node(s) have no condition configured.\n` +
        'These will generate unconditional transitions in the L5X.\n\nExport anyway?'
      );
      if (!ok) return;
    }

    // Warn if any devices have invalid tag stems
    const badDevices = (sm.devices ?? []).filter(d => d.name && !/^[A-Za-z][A-Za-z0-9_]*$/.test(d.name));
    if (badDevices.length > 0) {
      const names = badDevices.map(d => d.displayName).join(', ');
      const ok = window.confirm(
        `These devices have invalid PLC tag names: ${names}\n` +
        'Generated tag names may be invalid in Studio 5000.\n\nExport anyway?'
      );
      if (!ok) return;
    }

    try { downloadL5X(sm, sms, trackingFields); }
    catch (err) { alert(`Export error: ${err.message}`); console.error(err); }
  }

  function handleExportAllL5X() {
    const exportable = sms.filter(s => (s.nodes ?? []).length > 0);
    if (exportable.length === 0) return alert('No state machines with states to export.');
    try { downloadAllL5XAsZip(sms, trackingFields); }
    catch (err) { alert(`Export error: ${err.message}`); console.error(err); }
  }

  // ── Save = browser download dialog ──────────────────────────────────────────
  const handleSaveProject = useCallback(() => {
    // Trigger browser "Save As" download dialog — user picks the location
    exportProjectJSON(project);
    setHasUnsavedChanges(false);
    // Also persist to server silently so the session is always recoverable
    if (serverAvailable) {
      store.saveCurrentProject().catch(err =>
        console.warn('Background server save failed:', err)
      );
    }
  }, [project, serverAvailable, store]);

  // Ctrl+S shortcut
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveProject]);

  // Warn before tab/window close when there are unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome to show the dialog
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // ── Load handler ─────────────────────────────────────────────────────────────
  function handleLoadProject() { fileInputRef.current?.click(); }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file');
        await store.importProject(loaded);
        setHasUnsavedChanges(false);
      } catch (err) {
        alert(`Failed to load project: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const canUndo = store._past.length > 0;
  const canRedo = store._future.length > 0;
  const recipes = project.recipes ?? [];
  const variants = project.sequenceVariants ?? [];
  const activeRecipe = recipes.find(r => r.id === store.activeRecipeId);
  const isCustomSeq = activeRecipe?.customSequence || activeRecipe?.sequenceVariantId;

  return (
    <header className="toolbar">

      {/* ── Home / lightning bolt ─────────────────────────────────────────── */}
      {onGoHome && (
        <button className="toolbar__brand toolbar__brand--btn" onClick={onGoHome} title="Go to home screen">
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* ── Brand ────────────────────────────────────────────────────────── */}
      <div className="toolbar__brand">
        <span className="toolbar__logo" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <svg viewBox="27 0 113 61" width="36" height="20" xmlns="http://www.w3.org/2000/svg">
            <path d="M83.4835 60.1812C114.598 60.1812 139.822 46.7092 139.822 30.0906C139.822 13.472 114.598 0 83.4835 0C52.3689 0 27.1455 13.472 27.1455 30.0906C27.1455 46.7092 52.3689 60.1812 83.4835 60.1812Z" fill="#befa4f"/>
            <path d="M98.2318 40.056C99.5818 38.7032 100.647 37.0961 101.366 35.3287C102.085 33.5612 102.442 31.6689 102.418 29.7623C102.42 29.4749 102.44 29.1879 102.48 28.9033C102.906 22.9645 107.664 19.3373 116.269 19.3373C118.925 19.2905 121.573 19.6565 124.116 20.4222C124.234 20.4655 124.358 20.4879 124.483 20.4885C124.711 20.4971 124.934 20.4198 125.107 20.272C125.28 20.1242 125.39 19.9168 125.416 19.6914L125.808 15.907C125.802 15.7011 125.732 15.5019 125.61 15.336C125.487 15.17 125.317 15.045 125.121 14.9775C121.931 14.1319 118.639 13.7224 115.337 13.7602C102.413 13.7602 94.7509 19.6718 94.3365 28.9921C94.3281 29.1995 94.3202 29.6864 94.3077 30.006C94.2988 31.5338 93.9774 33.0438 93.3631 34.4439C92.1556 37.0574 89.8882 38.4515 87.0638 39.2035C85.1018 39.6805 83.0891 39.9198 81.0695 39.9161C79.6601 39.945 78.2495 39.9217 76.7669 39.9217V22.5684C76.761 22.3864 76.6827 22.2141 76.5493 22.0894C76.4159 21.9647 76.2383 21.8978 76.0554 21.9034H69.4401C69.2572 21.8978 69.0795 21.9647 68.9461 22.0894C68.8127 22.2141 68.7344 22.3864 68.7285 22.5684C68.7285 24.909 68.7285 27.2496 68.7285 29.5903C68.7285 34.4845 68.7287 39.3788 68.7291 44.2732C68.7408 44.6293 68.894 44.9662 69.1549 45.21C69.4159 45.4539 69.7634 45.5847 70.1211 45.5739C73.711 45.5752 77.3009 45.5842 80.8907 45.5715C84.434 45.638 87.9654 45.1427 91.3523 44.1041C93.3537 43.4806 95.2355 42.5266 96.9192 41.2822C96.9333 41.2699 96.9409 41.258 96.9555 41.246C97.409 40.8618 97.8345 40.4651 98.2318 40.056Z" fill="#1574C4"/>
            <path d="M92.3274 15.5056C88.7096 14.1184 84.8999 13.6997 81.0251 13.6836L53.574 13.6918L53.5636 13.6985C44.0479 13.7909 39.373 16.9175 39.373 22.4146C39.373 27.2423 42.6591 30.1871 50.7024 32.1137C57.2257 33.6859 59.0401 34.8592 59.0401 36.8967C59.0401 39.0224 57.1762 40.2183 51.6343 40.2183C47.6129 40.2183 44.2775 39.7752 41.3102 38.624C41.1849 38.5735 41.0524 38.5435 40.9175 38.5351C40.6875 38.5315 40.4645 38.6135 40.2921 38.7652C40.1197 38.9168 40.0104 39.127 39.9857 39.3546L39.5446 43.2741V43.3623C39.5601 43.5543 39.6307 43.7378 39.748 43.891C39.8654 44.0441 40.0245 44.1604 40.2064 44.226C43.9394 45.277 47.8042 45.7915 51.6834 45.7538C62.7673 45.7538 67.1814 42.5652 67.1814 36.5863C67.1814 31.8032 63.9447 29.0135 55.2633 26.7547C49.3779 25.2046 47.5143 24.0975 47.5143 22.1489C47.5143 20.4503 48.9675 19.357 54.0149 19.2696H78.5911V19.2563C81.3333 19.1576 84.077 19.4011 86.7584 19.981C89.4953 20.6527 91.7406 21.9166 93.0618 24.2673C93.1237 24.3774 93.1835 24.49 93.2414 24.605C93.2794 24.4871 93.3192 24.3696 93.3606 24.2523C94.1775 21.9791 95.4727 19.9058 97.1597 18.1711C95.6918 17.0472 94.0629 16.1487 92.3274 15.5056Z" fill="#1574C4"/>
            <path d="M125.661 39.7882C125.635 39.563 125.525 39.3557 125.352 39.2079C125.18 39.0601 124.957 38.9828 124.729 38.9915C124.596 38.992 124.463 39.0144 124.336 39.0577C121.797 39.8843 119.137 40.2808 116.465 40.2304C110.066 40.2304 105.642 38.3357 103.645 34.7709C103.593 34.6785 103.543 34.5849 103.495 34.4902C103.459 34.6103 103.422 34.73 103.384 34.8492C102.609 37.2409 101.293 39.4235 99.5371 41.2289C103.156 44.1665 108.551 45.8082 115.484 45.8082C118.818 45.8487 122.143 45.4392 125.367 44.5909C125.553 44.5293 125.717 44.4148 125.839 44.2614C125.961 44.108 126.036 43.9225 126.053 43.7277L125.661 39.7882Z" fill="#1574C4"/>
          </svg>
        </span>
        <span className="toolbar__title">SDC State Logic Builder</span>
      </div>

      <div className="toolbar__divider" />

      {/* ── Project picker ────────────────────────────────────────────────── */}
      <button
        className="toolbar__project-btn"
        onClick={store.openProjectManager}
        title={serverAvailable ? 'Switch / manage projects' : 'Project server not running'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7 }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="toolbar__project-name">{project.name}</span>
        {!serverAvailable && <span className="toolbar__server-warn" title="Server offline">⚠</span>}
        {hasUnsavedChanges && <span className="toolbar__unsaved-dot" title="Unsaved changes" />}
      </button>

      <div className="toolbar__divider" />

      {/* ── SM dropdown ───────────────────────────────────────────────────── */}
      <div className="toolbar__sm-selector" ref={smDropdownRef}>
        <button
          className="toolbar__sm-active"
          onClick={() => setSmDropdownOpen(o => !o)}
          title={sm ? buildProgramName(sm.stationNumber, sm.name) : 'Select state machine'}
        >
          {sm ? (
            <>
              <span className="toolbar__sm-station">S{String(sm.stationNumber).padStart(2, '0')}</span>
              <span className="toolbar__sm-name">{sm.displayName ?? sm.name}</span>
            </>
          ) : (
            <span style={{ color: '#8896a8' }}>No SM</span>
          )}
          <span className="toolbar__sm-chevron">{smDropdownOpen ? '▲' : '▼'}</span>
        </button>

        {smDropdownOpen && (
          <div className="toolbar__sm-dropdown">
            <div className="toolbar__sm-list">
              {sms.map(s => (
                <div
                  key={s.id}
                  className={`toolbar__sm-item${s.id === activeSmId ? ' toolbar__sm-item--active' : ''}`}
                  onClick={() => { store.setActiveSm(s.id); setSmDropdownOpen(false); }}
                >
                  <span className="toolbar__sm-item-station">S{String(s.stationNumber).padStart(2, '0')}</span>
                  <span className="toolbar__sm-item-name">{s.displayName ?? s.name}</span>
                  <button
                    className="toolbar__sm-item-delete"
                    title="Delete state machine"
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Delete "${s.displayName ?? s.name}"?`)) store.deleteStateMachine(s.id);
                    }}
                  >×</button>
                </div>
              ))}
              {sms.length === 0 && <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>No state machines</div>}
            </div>
            <div className="toolbar__sm-dropdown-actions">
              <button className="toolbar__sm-dropdown-btn" onClick={() => { store.openNewSmModal(); setSmDropdownOpen(false); }}>+ New SM</button>
              {sms.length > 1 && (
                <button className="toolbar__sm-dropdown-btn" onClick={() => { setSmReorderOpen(true); setSmDropdownOpen(false); }}>↕ Reorder</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Recipe dropdown ───────────────────────────────────────────────── */}
      <div className="toolbar__sm-selector" ref={recipeDropdownRef}>
        <button
          className="toolbar__sm-active"
          onClick={() => setRecipeDropdownOpen(o => !o)}
          title={activeRecipe ? activeRecipe.name : 'Select recipe'}
          style={isCustomSeq ? { borderColor: '#0072B5' } : undefined}
        >
          {activeRecipe ? (
            <span className="toolbar__sm-name">{activeRecipe.name}</span>
          ) : (
            <span style={{ color: '#8896a8' }}>{recipes.length > 0 ? 'Select Recipe' : 'No Recipes'}</span>
          )}
          <span className="toolbar__sm-chevron">{recipeDropdownOpen ? '▲' : '▼'}</span>
        </button>

        {recipeDropdownOpen && (
          <div className="toolbar__sm-dropdown">
            <div className="toolbar__sm-list">
              {recipes.map(r => {
                const isDefault = r.id === (project.defaultRecipeId ?? recipes[0]?.id);
                const vName = r.sequenceVariantId ? variants.find(v => v.id === r.sequenceVariantId)?.name : null;
                return (
                  <div
                    key={r.id}
                    className={`toolbar__sm-item${r.id === store.activeRecipeId ? ' toolbar__sm-item--active' : ''}`}
                    onClick={() => { store.setActiveRecipe(r.id); setRecipeDropdownOpen(false); }}
                  >
                    <span className="toolbar__sm-item-name">{r.name}</span>
                    {isDefault && <span className="toolbar__recipe-badge toolbar__recipe-badge--default">DEFAULT</span>}
                    {r.customSequence && <span className="toolbar__recipe-badge toolbar__recipe-badge--custom">{vName ?? 'CUSTOM'}</span>}
                  </div>
                );
              })}
              {recipes.length === 0 && <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>No recipes</div>}
            </div>
            <div className="toolbar__sm-dropdown-actions">
              <button className="toolbar__sm-dropdown-btn" onClick={() => { store.openRecipeManager(); setRecipeDropdownOpen(false); }}>Manage Recipes</button>
              {recipes.length > 1 && (
                <button className="toolbar__sm-dropdown-btn" onClick={() => { setRecipeReorderOpen(true); setRecipeDropdownOpen(false); }}>↕ Reorder</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Spacer pushes right-side actions to the right ─────────────────── */}
      <div style={{ flex: 1 }} />

      {/* ── Right actions ────────────────────────────────────────────────── */}
      <div className="toolbar__actions">

        {/* Undo / Redo */}
        <div className="toolbar__btn-group">
          <button
            className="toolbar__icon-btn"
            onClick={() => store.undo()}
            disabled={!canUndo}
            title={`Undo (Ctrl+Z)${canUndo ? ` · ${store._past.length} step${store._past.length !== 1 ? 's' : ''}` : ''}`}
          >
            <IconUndo />
          </button>
          <button
            className="toolbar__icon-btn"
            onClick={() => store.redo()}
            disabled={!canRedo}
            title={`Redo (Ctrl+Y)${canRedo ? ` · ${store._future.length} step${store._future.length !== 1 ? 's' : ''}` : ''}`}
          >
            <IconRedo />
          </button>
        </div>

        <div className="toolbar__divider" />

        {/* Export L5X */}
        <div className="toolbar__btn-group">
          <button
            className="btn btn--primary btn--sm"
            onClick={handleExportL5X}
            disabled={!sm}
            title="Export active SM to L5X (Allen Bradley)"
          >
            <IconExport />
            Export L5X
          </button>
          {sms.length > 1 && (
            <button
              className="btn btn--primary-outline btn--sm"
              onClick={handleExportAllL5X}
              title="Export all SMs as a ZIP of L5X files"
            >
              All
            </button>
          )}
        </div>

        <div className="toolbar__divider" />

        {/* Save / Open */}
        <div className="toolbar__btn-group">
          <button
            className={`btn btn--sm ${hasUnsavedChanges ? 'btn--save-unsaved' : 'btn--save'}`}
            onClick={handleSaveProject}
            title="Save project — opens download dialog so you choose where to save (Ctrl+S)"
          >
            <IconSave />
            {hasUnsavedChanges ? 'Save *' : 'Save'}
          </button>
          <button
            className="btn btn--sm btn--open"
            onClick={handleLoadProject}
            title="Open a saved project JSON file"
          >
            <IconOpen />
            Open
          </button>
        </div>

        <div className="toolbar__divider" />

        {/* Setup */}
        <button
          className={`btn btn--ghost toolbar__setup-btn${activeView === 'projectSetup' ? ' toolbar__setup-btn--active' : ''}`}
          onClick={() => store.setActiveView(activeView === 'projectSetup' ? 'canvas' : 'projectSetup')}
          title="Machine Configuration & Standards Profile"
        >
          ⚙ Setup
        </button>

      </div>

      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* ── SM reorder popup ──────────────────────────────────────────────── */}
      {smReorderOpen && (
        <ReorderPopup
          items={sms}
          labelFn={s => `S${String(s.stationNumber).padStart(2, '0')} — ${s.displayName ?? s.name}`}
          onReorder={(from, to) => store.reorderStateMachines(from, to)}
          onClose={() => setSmReorderOpen(false)}
          title="Reorder State Machines"
        />
      )}

      {/* ── Recipe reorder popup ──────────────────────────────────────────── */}
      {recipeReorderOpen && (
        <ReorderPopup
          items={project.recipes ?? []}
          labelFn={r => r.name}
          onReorder={(from, to) => store.reorderRecipes(from, to)}
          onClose={() => setRecipeReorderOpen(false)}
          title="Reorder Recipes"
        />
      )}
    </header>
  );
}
