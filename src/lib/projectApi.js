/**
 * Project API — localStorage-based storage.
 *
 * Drop-in replacement for the server-based API.
 * Works in any static hosting environment (Cloudflare Pages, GitHub Pages, etc.)
 * Projects are saved in the browser's localStorage under the key prefix "sdc-proj-".
 *
 * Same interface as the original server API:
 *   listProjects()                   → [{ filename, name, lastModified, smCount }]
 *   loadProject(filename)            → project object
 *   saveProject(filename, data)      → { ok: true }
 *   deleteProjectFile(filename)      → { ok: true }
 *   isServerAvailable()              → true (always — no server needed)
 *   toFilename(name)                 → 'My_Project.json'
 */

const PROJ_PREFIX = 'sdc-proj-';
const INDEX_KEY   = 'sdc-proj-index';

/** Convert a project name to a safe filename key. */
export function toFilename(name) {
  const safe = (name || 'project')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return (safe || 'project') + '.json';
}

/** Read the filename→metadata index from localStorage. */
function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Write the index back to localStorage. */
function writeIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** List all saved projects. Returns [{ filename, name, lastModified, smCount }]. */
export async function listProjects() {
  const index = readIndex();
  return Object.entries(index).map(([filename, meta]) => ({
    filename,
    name: meta.name || filename.replace(/\.json$/, ''),
    lastModified: meta.lastModified || 0,
    smCount: meta.smCount || 0,
  }));
}

/** Load a project by filename. Returns the parsed project object. */
export async function loadProject(filename) {
  const raw = localStorage.getItem(PROJ_PREFIX + filename);
  if (!raw) throw new Error(`Project not found: ${filename}`);
  return JSON.parse(raw);
}

/** Save (create or overwrite) a project. */
export async function saveProject(filename, projectData) {
  localStorage.setItem(PROJ_PREFIX + filename, JSON.stringify(projectData));

  // Update the index with fresh metadata
  const index = readIndex();
  index[filename] = {
    name: projectData.name || filename.replace(/\.json$/, ''),
    lastModified: Date.now(),
    smCount: (projectData.stateMachines ?? []).length,
  };
  writeIndex(index);

  return { ok: true };
}

/** Delete a project file. */
export async function deleteProjectFile(filename) {
  localStorage.removeItem(PROJ_PREFIX + filename);

  const index = readIndex();
  delete index[filename];
  writeIndex(index);

  return { ok: true };
}

/**
 * Always returns true — no server needed for localStorage storage.
 * This prevents the "Project server not running" warning from ever showing.
 */
export async function isServerAvailable() {
  return true;
}
