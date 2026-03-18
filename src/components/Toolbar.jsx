/**
 * Toolbar - Top application bar.
 * Project name, SM tabs, export, save/load.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { downloadL5X, downloadAllL5XAsZip } from '../lib/l5xExporter.js';
import { buildProgramName } from '../lib/tagNaming.js';

/** Lightning bolt SVG — matches home page logo */
function BoltIcon({ size = 18, color = '#f59e0b' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z"
        fill={color}
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Save the project as a .json file, using the native File System Access API
 * (shows a real "Save As" dialog). Falls back to a regular download on
 * browsers that don't support showSaveFilePicker (e.g. Firefox).
 */
async function saveProjectToFile(project) {
  const json = JSON.stringify(project, null, 2);
  const suggestedName = `${(project.name || 'project').replace(/[^a-zA-Z0-9_\- ]/g, '_')}.json`;

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'State Logic Project',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } catch (err) {
      // User cancelled — not an error
      if (err.name !== 'AbortError') throw err;
    }
  } else {
    // Fallback: trigger browser download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export function Toolbar({ onGoHome }) {
  const store = useDiagramStore();
  const { project, activeSmId } = store;
  const sms = project.stateMachines ?? [];
  const sm = store.getActiveSm();
  const fileInputRef = useRef(null);

  const trackingFields = store.project?.partTracking?.fields ?? [];

  function handleExportL5X() {
    if (!sm) return alert('No state machine selected.');
    if (sm.nodes.length === 0) return alert('No states defined. Add at least one state before exporting.');
    try {
      downloadL5X(sm, sms, trackingFields);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }

  function handleExportAllL5X() {
    const exportable = sms.filter(s => (s.nodes ?? []).length > 0);
    if (exportable.length === 0) return alert('No state machines with states to export.');
    try {
      downloadAllL5XAsZip(sms, trackingFields);
    } catch (err) {
      alert(`Export error: ${err.message}`);
      console.error(err);
    }
  }

  // Track unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const projectRef = useRef(project);

  useEffect(() => {
    if (projectRef.current !== project && projectRef.current !== null) {
      setHasUnsavedChanges(true);
    }
    projectRef.current = project;
  }, [project]);

  /** Save — always shows the native "Save As" file picker dialog */
  const handleSaveProject = useCallback(async () => {
    try {
      await saveProjectToFile(project);
      setHasUnsavedChanges(false);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }, [project]);

  // Ctrl+S to save
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

  function handleLoadProject() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file');
        store.importProject(loaded);
      } catch (err) {
        alert(`Failed to load project: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const programName = sm ? buildProgramName(sm.stationNumber, sm.name) : null;

  return (
    <header className="toolbar">
      {/* Logo / Brand — click to go home */}
      <button
        className="toolbar__brand toolbar__brand--btn"
        onClick={onGoHome}
        title="Go to home screen"
      >
        <BoltIcon size={20} color="#f59e0b" />
        <span className="toolbar__title">SDC State Logic Builder</span>
      </button>

      {/* Project selector */}
      <button
        className="btn btn--ghost toolbar__project-btn"
        onClick={store.openProjectManager}
        title="Switch project"
      >
        📁 {project.name}
      </button>
      <div className="toolbar__divider" />

      {/* SM tabs */}
      <div className="toolbar__tabs">
        {sms.map(s => (
          <button
            key={s.id}
            className={`sm-tab${s.id === activeSmId ? ' sm-tab--active' : ''}`}
            onClick={() => store.setActiveSm(s.id)}
            title={buildProgramName(s.stationNumber, s.name)}
          >
            <span className="sm-tab__station">S{String(s.stationNumber).padStart(2, '0')}</span>
            <span className="sm-tab__name">{s.displayName ?? s.name}</span>
            <button
              className="sm-tab__close"
              title="Delete state machine"
              onClick={e => {
                e.stopPropagation();
                if (confirm(`Delete state machine "${s.displayName ?? s.name}"?`)) {
                  store.deleteStateMachine(s.id);
                }
              }}
            >×</button>
          </button>
        ))}
        <button
          className="sm-tab sm-tab--add"
          onClick={store.openNewSmModal}
          title="New state machine"
        >
          + New
        </button>
      </div>

      {/* Recipe selector */}
      {(() => {
        const recipes = project.recipes ?? [];
        const activeRecipe = recipes.find(r => r.id === store.activeRecipeId);
        const isCustomSeq = activeRecipe?.customSequence;
        return (
          <div className="toolbar__recipe">
            {recipes.length > 0 ? (
              <select
                className="toolbar__recipe-select"
                value={store.activeRecipeId ?? ''}
                onChange={e => store.setActiveRecipe(e.target.value || null)}
                title="Active recipe"
                style={isCustomSeq ? { borderColor: '#0072B5', color: '#0072B5' } : undefined}
              >
                {recipes.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.customSequence ? ' [custom seq]' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="toolbar__recipe-empty" style={{ color: '#8896a8', fontSize: 12 }}>No Recipes</span>
            )}
            {isCustomSeq && (
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                background: '#0072B5', color: '#fff', marginLeft: 4, whiteSpace: 'nowrap',
              }}>
                CUSTOM SEQ
              </span>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={store.openRecipeManager}
              title="Manage recipes"
              style={{ fontSize: 12, padding: '3px 8px' }}
            >
              Recipes
            </button>
          </div>
        );
      })()}
      <div className="toolbar__divider" />

      {/* Right actions */}
      <div className="toolbar__actions">
        {/* Undo / Redo */}
        <button
          className="btn btn--ghost"
          onClick={() => store.undo()}
          disabled={store._past.length === 0}
          title={store._past.length > 0
            ? `Undo (Ctrl+Z) — ${store._past.length} step${store._past.length !== 1 ? 's' : ''} available`
            : 'Nothing to undo'}
          style={{ fontSize: 15, padding: '4px 8px', minWidth: 0 }}
        >↩{store._past.length > 0 && <sup style={{ fontSize: 9, marginLeft: 1 }}>{store._past.length}</sup>}</button>

        <button
          className="btn btn--ghost"
          onClick={() => store.redo()}
          disabled={store._future.length === 0}
          title={store._future.length > 0
            ? `Redo (Ctrl+Y) — ${store._future.length} step${store._future.length !== 1 ? 's' : ''} available`
            : 'Nothing to redo'}
          style={{ fontSize: 15, padding: '4px 8px', minWidth: 0 }}
        >↪{store._future.length > 0 && <sup style={{ fontSize: 9, marginLeft: 1 }}>{store._future.length}</sup>}</button>

        <div className="toolbar__divider" />

        {programName && (
          <span className="toolbar__program-name mono">{programName}</span>
        )}

        {/* Export buttons */}
        <button
          className="btn btn--primary"
          onClick={handleExportL5X}
          disabled={!sm}
          title="Export current state machine to L5X"
        >
          ↓ Export L5X
        </button>

        {sms.length > 1 && (
          <button
            className="btn btn--secondary"
            onClick={handleExportAllL5X}
            title="Export all state machines as separate L5X files"
          >
            ↓ Export All
          </button>
        )}

        <div className="toolbar__divider" />

        {/* Save — always shows native Save As dialog */}
        <button
          className={`btn ${hasUnsavedChanges ? 'btn--warning' : 'btn--ghost'}`}
          onClick={handleSaveProject}
          title="Save project — choose file location (Ctrl+S)"
          style={hasUnsavedChanges ? { animation: 'none', fontWeight: 'bold' } : {}}
        >
          {hasUnsavedChanges ? '💾 Save *' : '💾 Save'}
        </button>

        {/* Open from local file */}
        <button
          className="btn btn--ghost"
          onClick={handleLoadProject}
          title="Open project from a local JSON file"
        >
          📂 Open
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </header>
  );
}
