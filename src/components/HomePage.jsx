/**
 * HomePage — Landing / start page.
 * Shown when the user clicks the logo or first opens the app.
 */

import { useState, useEffect, useRef } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { listProjects } from '../lib/projectApi.js';

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Lightning bolt SVG logo */
function BoltIcon({ size = 48, color = '#f59e0b' }) {
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

export function HomePage({ onEnterEditor }) {
  const store = useDiagramStore();
  const { serverAvailable, project } = store;
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(null); // filename being switched to
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const hasCurrentProject = project?.stateMachines?.length > 0;
  const currentFilename = store.currentFilename;

  useEffect(() => {
    if (serverAvailable) {
      listProjects()
        .then(list => {
          list.sort((a, b) => b.lastModified - a.lastModified);
          setProjects(list);
        })
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    } else {
      setLoadingProjects(false);
    }
  }, [serverAvailable]);

  async function handleCreateProject(e) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await store.createNewProject(newName.trim());
      onEnterEditor();
    } catch (err) {
      alert('Failed to create project: ' + err.message);
      setCreating(false);
    }
  }

  async function handleOpenProject(filename) {
    if (switching) return;
    setSwitching(filename);
    try {
      await store.switchProject(filename);
      onEnterEditor();
    } catch (err) {
      alert('Failed to open project: ' + err.message);
      setSwitching(null);
    }
  }

  function handleOpenFile() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file — missing stateMachines');
        store.importProject(loaded);
        onEnterEditor();
      } catch (err) {
        alert('Failed to load project: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.endsWith('.json')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!loaded.stateMachines) throw new Error('Invalid project file');
        store.importProject(loaded);
        onEnterEditor();
      } catch (err) {
        alert('Failed to load project: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="home-page">
      {/* Background grid decoration */}
      <div className="home-page__grid-bg" />

      {/* Main content */}
      <div className="home-page__content">

        {/* Hero branding */}
        <div className="home-hero">
          <div className="home-hero__logo">
            <BoltIcon size={56} color="#f59e0b" />
          </div>
          <div className="home-hero__text">
            <h1 className="home-hero__title">SDC State Logic Builder</h1>
            <p className="home-hero__subtitle">
              Design, visualize, and export PLC state machine logic
            </p>
          </div>
        </div>

        {/* Two-column layout: left = actions, right = recent projects */}
        <div className="home-columns">

          {/* ── Left: Quick actions ── */}
          <div className="home-panel">
            <h2 className="home-panel__title">Get Started</h2>

            {/* New project */}
            <form className="home-new-form" onSubmit={handleCreateProject}>
              <input
                className="home-new-form__input"
                placeholder="New project name..."
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="home-action-btn home-action-btn--primary"
                disabled={!newName.trim() || creating}
              >
                {creating ? '⏳ Creating...' : '+ New Project'}
              </button>
            </form>


            {/* Open from file / drag-drop */}
            <div
              className={`home-dropzone${dragOver ? ' home-dropzone--active' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={handleOpenFile}
            >
              <span className="home-dropzone__icon">📂</span>
              <span className="home-dropzone__label">
                {dragOver ? 'Drop to open' : 'Open project file'}
              </span>
              <span className="home-dropzone__hint">Click or drag a .json file here</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {/* Continue editing button */}
            {hasCurrentProject && (
              <button
                className="home-action-btn home-action-btn--continue"
                onClick={onEnterEditor}
              >
                ↗ Continue Editing — {project.name}
              </button>
            )}
          </div>

          {/* ── Right: Recent projects ── */}
          <div className="home-panel">
            <h2 className="home-panel__title">Recent Projects</h2>

            {!serverAvailable && (
              <p className="home-panel__empty">Create a new project or open a .json file to get started.</p>
            )}

            {serverAvailable && loadingProjects && (
              <p className="home-panel__empty">Loading projects...</p>
            )}

            {serverAvailable && !loadingProjects && projects.length === 0 && (
              <p className="home-panel__empty">No projects yet. Create one to get started.</p>
            )}

            <div className="home-project-list">
              {projects.map(p => {
                const isActive = p.filename === currentFilename;
                const isLoading = switching === p.filename;
                return (
                  <button
                    key={p.filename}
                    className={`home-project-card${isActive ? ' home-project-card--active' : ''}`}
                    onClick={() => handleOpenProject(p.filename)}
                    disabled={!!switching}
                  >
                    <div className="home-project-card__icon">
                      {isLoading ? '⏳' : '📋'}
                    </div>
                    <div className="home-project-card__info">
                      <span className="home-project-card__name">
                        {p.name}
                        {isActive && <span className="home-project-card__badge">OPEN</span>}
                      </span>
                      <span className="home-project-card__meta">
                        {p.smCount} state machine{p.smCount !== 1 ? 's' : ''}
                        &nbsp;·&nbsp;
                        {formatDate(p.lastModified)}
                      </span>
                    </div>
                    <span className="home-project-card__arrow">›</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="home-footer">
          <span>SDC State Logic Builder · ME → L5X export tool</span>
          <span>state-logic-builder.pages.dev</span>
        </div>
      </div>
    </div>
  );
}
