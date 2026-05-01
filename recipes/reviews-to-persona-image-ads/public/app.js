/**
 * Browser-side UI only. No API keys.
 *
 * Where state lives:
 * - sessionStorage  — the cleaned reviews list, the inferred personas, and the user's checkbox
 *                     selections. Tab-scoped: closing the tab clears it.
 * - localStorage    — the in-flight image-ad generation rows (one per persona × design template).
 *                     Survives refreshes so the user can come back to a job table that's still
 *                     ticking, instead of losing track of a run that's already been billed for.
 *
 * Polling pattern (one batched server call per tick — never N parallel SAL calls from the
 * browser; the server fans the IDs into a single `GET /v1/image-ads?ids=...`):
 * - POLL_FAST_MS (~4s) while any row is still processing.
 * - One POLL_SLOW_MS (~30s) consistency tail after every row is terminal, then idle.
 * - Pauses entirely when the tab is hidden (visibilitychange) and refreshes once on focus.
 *
 * If the job table looks stuck, the most common cause is a stale localStorage entry pointing
 * at IDs that no longer exist (different env / different SAL workspace). The "Clear saved
 * generation" button in the UI wipes it.
 */

const UI_LOG_PREFIX = '[reviews-to-persona-image-ads UI]';

const STORAGE_KEYS = {
  reviews: 'recipe_reviews_json',
  personas: 'recipe_personas_json',
  selected: 'recipe_selected_indices_json',
};

const GENERATION_STORAGE_VERSION = 1;
const GENERATION_STORAGE_KEY = 'recipe_generation_session_v1';

/** While any row is non-terminal, poll the server this often (one batched SAL list per tick). */
const POLL_FAST_MS = 4000;
/** After every row is terminal, one more check this long, then polling stops (cheap consistency tail). */
const POLL_SLOW_MS = 30000;

/**
 * Mirrors `PERSONA_SLOT_COUNT` from `src/config/recipe-constants.ts`, set from `GET /api/config/env-status`.
 * Fallback until `GET /api/config/env-status` returns (matches `PERSONA_SLOT_COUNT` in recipe-constants).
 */
let personaSlotCount = 5;

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const csvFile = document.querySelector('#csvFile');
const csvText = document.querySelector('#csvText');
const btnClean = document.querySelector('#btnClean');
const cleanMeta = document.querySelector('#cleanMeta');
const cleanError = document.querySelector('#cleanError');
const btnPersonas = document.querySelector('#btnPersonas');
const personasError = document.querySelector('#personasError');
const personaList = document.querySelector('#personaList');
const selectHint = document.querySelector('#selectHint');
const btnGenerate = document.querySelector('#btnGenerate');
const selectCount = document.querySelector('#selectCount');
const generateError = document.querySelector('#generateError');
const generateStatus = document.querySelector('#generateStatus');
const results = document.querySelector('#results');
const jobsTableBody = document.querySelector('#jobsTableBody');
const jobsWrap = document.querySelector('#jobsWrap');
const jobsHint = document.querySelector('#jobsHint');
const btnClearGeneration = document.querySelector('#btnClearGeneration');
const envBanner = document.querySelector('#envBanner');

/** @type {string[]} */
let reviews = [];
/** @type {any[]} */
let personas = [];
/** @type {Set<number>} */
let selectedIndices = new Set();

let pollTimerId = null;
/** Avoid overlapping POST /api/generate/status calls (focus + visibility + timer). */
let pollInFlight = false;
/** After `allTerminal`, we schedule at most one `POLL_SLOW_MS` follow-up per “run”. */
let terminalFollowUpScheduled = false;

function loadSession() {
  try {
    const r = sessionStorage.getItem(STORAGE_KEYS.reviews);
    if (r) reviews = JSON.parse(r);
    const p = sessionStorage.getItem(STORAGE_KEYS.personas);
    if (p) personas = JSON.parse(p);
    const s = sessionStorage.getItem(STORAGE_KEYS.selected);
    if (s) selectedIndices = new Set(JSON.parse(s));
  } catch {
    reviews = [];
    personas = [];
    selectedIndices = new Set();
  }
}

function persistSession() {
  sessionStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(reviews));
  sessionStorage.setItem(STORAGE_KEYS.personas, JSON.stringify(personas));
  sessionStorage.setItem(
    STORAGE_KEYS.selected,
    JSON.stringify([...selectedIndices]),
  );
}

/** Persist only stable row keys (not SAL snapshots). */
function stableGenerationRows(rows) {
  return rows.map((r) => ({
    imageAdId: r.imageAdId,
    jobId: r.jobId,
    personaShortLabel: r.personaShortLabel,
    designTemplateId: r.designTemplateId,
  }));
}

function loadGenerationRows() {
  try {
    const raw = localStorage.getItem(GENERATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== GENERATION_STORAGE_VERSION || !Array.isArray(parsed.rows)) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

function saveGenerationRows(rows) {
  localStorage.setItem(
    GENERATION_STORAGE_KEY,
    JSON.stringify({
      version: GENERATION_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      rows: stableGenerationRows(rows),
    }),
  );
}

function clearPollTimer() {
  if (pollTimerId !== null) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }
}

/**
 * Adaptive interval: fast while work is in flight; one slow tail when everything is terminal, then idle.
 */
function scheduleNextPoll(allTerminal) {
  clearPollTimer();
  if (document.visibilityState !== 'visible') return;
  if (allTerminal) {
    if (!terminalFollowUpScheduled) {
      terminalFollowUpScheduled = true;
      pollTimerId = setTimeout(() => {
        pollTimerId = null;
        void runStatusPoll();
      }, POLL_SLOW_MS);
    }
    return;
  }
  terminalFollowUpScheduled = false;
  pollTimerId = setTimeout(() => {
    pollTimerId = null;
    void runStatusPoll();
  }, POLL_FAST_MS);
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatRelativePast(iso) {
  if (!iso) return '—';
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Math.abs(diffSec) < 45) return 'just now';
  const divisions = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2592000],
    ['year', 31536000],
  ];
  let unit = /** @type {Intl.RelativeTimeFormatUnit} */ ('second');
  let delta = diffSec;
  for (const [u, secs] of divisions) {
    if (Math.abs(diffSec) >= secs) {
      unit = /** @type {Intl.RelativeTimeFormatUnit} */ (u);
      delta = Math.trunc(diffSec / secs);
      break;
    }
  }
  return rtf.format(delta, unit);
}

function truncateId(id, max = 26) {
  if (!id) return '—';
  return id.length <= max ? id : `${id.slice(0, max)}…`;
}

function showGenerationChrome(visible) {
  if (btnClearGeneration) btnClearGeneration.hidden = !visible;
  if (jobsHint) jobsHint.hidden = !visible;
  if (jobsWrap) jobsWrap.hidden = !visible;
}

/**
 * @param {Array<{ imageAdId: string, jobId?: string, personaShortLabel: string, designTemplateId: string, imageAd?: any }>} statusRows
 */
function renderJobsTable(statusRows) {
  if (!jobsTableBody) return;
  jobsTableBody.innerHTML = '';

  for (const row of statusRows) {
    const ad = row.imageAd;
    const tr = document.createElement('tr');

    const jobIdDisplay = row.jobId || row.imageAdId;
    const subtitle = `Image ad · ${escapeHtml(row.personaShortLabel)}`;

    let statusClass = 'pending';
    let statusLabel = 'Waiting';
    let statusMeta = 'Syncing from server…';

    if (ad) {
      const created = ad.created_at ? new Date(ad.created_at).getTime() : null;
      if (ad.status === 'processing') {
        statusClass = 'processing';
        statusLabel = 'Processing';
        const elapsed = created != null ? Date.now() - created : 0;
        statusMeta = `${formatDuration(elapsed)} elapsed`;
      } else if (ad.status === 'completed') {
        statusClass = 'completed';
        statusLabel = 'Completed';
        const dur =
          ad.duration_ms ??
          (ad.completed_at && ad.created_at
            ? new Date(ad.completed_at).getTime() - new Date(ad.created_at).getTime()
            : null);
        statusMeta = `Done in ${formatDuration(dur)}`;
      } else if (ad.status === 'failed') {
        statusClass = 'failed';
        statusLabel = 'Failed';
        statusMeta = ad.error?.message ? escapeHtml(ad.error.message) : 'Generation failed';
      }
    }

    const createdMain = ad?.created_at ? formatRelativePast(ad.created_at) : '—';
    const createdAbs =
      ad?.created_at ? escapeHtml(new Date(ad.created_at).toLocaleString()) : '';

    tr.innerHTML = `
      <td>
        <div class="job-id">${escapeHtml(truncateId(jobIdDisplay))}</div>
        <div class="job-sub">${subtitle}</div>
      </td>
      <td>
        <div class="status-line">
          <span class="status-dot status-dot--${statusClass}" aria-hidden="true"></span>
          <span>${statusLabel}</span>
        </div>
        <div class="status-meta">${statusMeta}</div>
      </td>
      <td>
        <div class="created-main">${createdMain}</div>
        ${createdAbs ? `<div class="created-abs">${createdAbs}</div>` : ''}
      </td>
    `;
    jobsTableBody.appendChild(tr);
  }
}

/**
 * @param {Array<{ personaShortLabel: string, designTemplateId: string, imageAd?: any }>} statusRows
 */
function renderResultsFromStatusRows(statusRows) {
  if (!results) return;
  results.innerHTML = '';
  for (const row of statusRows) {
    const ad = row.imageAd;
    const wrap = document.createElement('div');
    if (ad?.image_url && ad.status === 'completed') {
      wrap.innerHTML = `
        <a href="${escapeHtml(ad.image_url)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(ad.image_url)}" alt="" loading="lazy" />
        </a>
        <div class="ad-caption">
          ${escapeHtml(row.personaShortLabel)} · ${escapeHtml(row.designTemplateId.slice(0, 12))}…
          <br />
          <a href="${escapeHtml(ad.image_url)}" target="_blank" rel="noreferrer">Download PNG</a>
        </div>
      `;
    } else if (ad?.status === 'failed') {
      wrap.innerHTML = `<div class="ad-caption error">${escapeHtml(row.personaShortLabel)} — failed ${ad.error ? escapeHtml(ad.error.message) : ''}</div>`;
    } else if (ad?.status === 'processing') {
      wrap.innerHTML = `<div class="ad-caption muted">${escapeHtml(row.personaShortLabel)} — still processing…</div>`;
    } else {
      continue;
    }
    results.appendChild(wrap);
  }
}

async function runStatusPoll() {
  if (pollInFlight) return;
  const rows = loadGenerationRows();
  if (!rows?.length) {
    showGenerationChrome(false);
    return;
  }

  showGenerationChrome(true);
  pollInFlight = true;
  try {
    const data = await postJson('/api/generate/status', { rows });
    const list = data.rows ?? [];
    const allTerminal = Boolean(data.allTerminal);

    renderJobsTable(list);
    renderResultsFromStatusRows(list);

    const processing = list.filter((r) => r.imageAd?.status === 'processing').length;
    if (!allTerminal) {
      generateStatus.textContent = `Updating… ${processing} still processing (server batched poll ~every ${POLL_FAST_MS / 1000}s while this tab is visible).`;
    } else {
      generateStatus.textContent = `All ${list.length} ad(s) finished (completed or failed). Optional consistency check in ~${POLL_SLOW_MS / 1000}s.`;
    }

    scheduleNextPoll(allTerminal);
    if (allTerminal && pollTimerId === null) {
      generateStatus.textContent = `All ${list.length} ad(s) finished (completed or failed). Polling idle — switch back to this tab or click Generate again to refresh.`;
    }

    console.log(UI_LOG_PREFIX, 'status poll', {
      allTerminal,
      completed: list.filter((r) => r.imageAd?.status === 'completed').length,
      failed: list.filter((r) => r.imageAd?.status === 'failed').length,
    });
  } catch (e) {
    showError(generateError, e instanceof Error ? e.message : String(e));
    if (document.visibilityState === 'visible') {
      scheduleNextPoll(false);
    }
  } finally {
    pollInFlight = false;
  }
}

function restoreGenerationUi() {
  const rows = loadGenerationRows();
  if (!rows?.length) {
    showGenerationChrome(false);
    return;
  }
  showGenerationChrome(true);
  const placeholderRows = rows.map((r) => ({ ...r, imageAd: null }));
  renderJobsTable(placeholderRows);
  void runStatusPoll();
}

function showError(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

async function postJson(path, body) {
  console.log(UI_LOG_PREFIX, 'POST', path);
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn(UI_LOG_PREFIX, 'POST failed', path, res.status, data.error || res.statusText);
    throw new Error(data.error || res.statusText || 'Request failed');
  }
  console.log(UI_LOG_PREFIX, 'POST ok', path);
  return data;
}

function syncUiAfterClean() {
  cleanMeta.textContent = reviews.length
    ? `${reviews.length} review(s) ready for Gemini`
    : '';
  btnPersonas.disabled = reviews.length === 0;
}

function renderPersonas() {
  personaList.innerHTML = '';
  if (personas.length === 0) {
    updateSelectionUi();
    return;
  }

  personas.forEach((persona, index) => {
    const card = document.createElement('div');
    card.className = 'persona-card';
    const id = `persona-${index}`;
    const checked = selectedIndices.has(index);
    card.innerHTML = `
      <label style="display:flex; gap:0.5rem; align-items:flex-start; font-weight:400;">
        <input type="checkbox" id="${id}" data-index="${index}" ${checked ? 'checked' : ''} />
        <span>
          <h3>${escapeHtml(persona.shortLabel)}</h3>
          <div class="muted">Confidence: ${persona.confidence}</div>
          <p>${escapeHtml(persona.narrative.slice(0, 280))}${persona.narrative.length > 280 ? '…' : ''}</p>
        </span>
      </label>
    `;
    personaList.appendChild(card);
  });

  personaList.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const idx = Number(box.dataset.index);
      if (box.checked) {
        if (selectedIndices.size >= personaSlotCount && !selectedIndices.has(idx)) {
          box.checked = false;
          return;
        }
        selectedIndices.add(idx);
      } else {
        selectedIndices.delete(idx);
      }
      persistSession();
      updateSelectionUi();
    });
  });

  updateSelectionUi();
}

function updateSelectionUi() {
  selectCount.textContent = `${selectedIndices.size} / ${personaSlotCount} selected`;
  if (personas.length === 0) {
    selectHint.textContent = 'Infer personas first.';
    btnGenerate.disabled = true;
    return;
  }
  selectHint.textContent = `Check exactly ${personaSlotCount} personas. Each becomes one Static Ads Lab audience.`;
  btnGenerate.disabled = selectedIndices.size !== personaSlotCount;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

csvFile?.addEventListener('change', async () => {
  const file = csvFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  csvText.value = text;
});

btnClean.addEventListener('click', async () => {
  showError(cleanError, '');
  showError(personasError, '');
  try {
    const data = await postJson('/api/reviews/clean', { csvText: csvText.value });
    reviews = data.reviews ?? [];
    personas = [];
    selectedIndices = new Set();
    persistSession();
    syncUiAfterClean();
    renderPersonas();
    cleanMeta.textContent = `${reviews.length} review(s); skipped by rating: ${data.skippedByRating ?? 0}`;
    console.log(UI_LOG_PREFIX, 'clean reviews', {
      count: reviews.length,
      skippedByRating: data.skippedByRating ?? 0,
    });
  } catch (e) {
    showError(cleanError, e instanceof Error ? e.message : String(e));
  }
});

btnPersonas.addEventListener('click', async () => {
  showError(personasError, '');
  btnPersonas.disabled = true;
  try {
    const data = await postJson('/api/personas', { reviews });
    personas = data.personas ?? [];
    selectedIndices = new Set();
    persistSession();
    renderPersonas();
    console.log(UI_LOG_PREFIX, 'personas received', { count: personas.length });
  } catch (e) {
    showError(personasError, e instanceof Error ? e.message : String(e));
  } finally {
    btnPersonas.disabled = reviews.length === 0;
  }
});

btnGenerate.addEventListener('click', async () => {
  showError(generateError, '');
  generateStatus.textContent = 'Creating audiences and enqueueing image ads…';
  btnGenerate.disabled = true;
  results.innerHTML = '';
  clearPollTimer();
  terminalFollowUpScheduled = false;

  const chosen = [...selectedIndices]
    .sort((a, b) => a - b)
    .map((i) => personas[i]);

  try {
    console.log(UI_LOG_PREFIX, 'generate/start', {
      personaLabels: chosen.map((p) => p.shortLabel),
    });
    const data = await postJson('/api/generate/start', { personas: chosen });
    const rows = data.rows ?? [];
    saveGenerationRows(rows);
    showGenerationChrome(rows.length > 0);
    const placeholderRows = rows.map((r) => ({ ...r, imageAd: null }));
    renderJobsTable(placeholderRows);
    void runStatusPoll();
  } catch (e) {
    showError(generateError, e instanceof Error ? e.message : String(e));
    generateStatus.textContent = '';
  } finally {
    btnGenerate.disabled = selectedIndices.size !== personaSlotCount;
  }
});

btnClearGeneration?.addEventListener('click', () => {
  localStorage.removeItem(GENERATION_STORAGE_KEY);
  clearPollTimer();
  terminalFollowUpScheduled = false;
  if (jobsTableBody) jobsTableBody.innerHTML = '';
  showGenerationChrome(false);
  if (results) results.innerHTML = '';
  generateStatus.textContent = '';
  console.log(UI_LOG_PREFIX, 'cleared generation session');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void runStatusPoll();
  } else {
    clearPollTimer();
  }
});

window.addEventListener('focus', () => {
  void runStatusPoll();
});

/**
 * Env + recipe-constants strip at the top (#envBanner, above the h1).
 * Yellow: missing env vars and/or empty SAL ids in recipe-constants.ts.
 * Green: env + constants look ready for this POC.
 * Red: cannot reach server.
 */
async function showEnvBannerIfNeeded() {
  if (!envBanner) return;
  envBanner.className = 'env-banner env-banner--pending';
  envBanner.textContent = 'Checking server environment and recipe config…';

  try {
    const res = await fetch('/api/config/env-status');
    if (!res.ok) {
      envBanner.className = 'env-banner env-banner--error';
      envBanner.innerHTML = `<strong class="env-banner__title">Could not read env status</strong><p>Server returned ${res.status}. Is <code>npm start</code> running in the recipe folder?</p>`;
      console.warn(UI_LOG_PREFIX, 'env-status HTTP error', res.status);
      return;
    }

    const data = await res.json();
    const missing = data.missing ?? [];
    const recipeIssues = data.recipeConstantsIssues ?? [];
    if (typeof data.personaSlotCount === 'number' && data.personaSlotCount >= 1) {
      personaSlotCount = data.personaSlotCount;
    }

    const envOk = missing.length === 0;
    const constantsOk = recipeIssues.length === 0;
    const allOk = envOk && constantsOk;

    if (allOk) {
      envBanner.className = 'env-banner env-banner--ok';
      envBanner.innerHTML =
        '<strong class="env-banner__title">Ready for this POC</strong><p class="muted">API keys are set and <code>src/config/recipe-constants.ts</code> has no missing SAL ids detected. If a step still fails, check terminal logs and your Static Ads Lab workspace.</p>';
      console.log(UI_LOG_PREFIX, 'env-status ok', { envOk, constantsOk });
      return;
    }

    console.warn(UI_LOG_PREFIX, 'env-status warnings', { missing, recipeIssues });
    envBanner.className = 'env-banner';
    const parts = [];

    if (!envOk) {
      const list = missing.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('');
      parts.push(
        '<strong class="env-banner__title">Missing environment variables</strong>',
        '<p>Unset or empty (use <code>.env</code> or <code>.env.local</code>):</p>',
        `<ul>${list}</ul>`,
        '<p class="muted">This banner only lists names, not values.</p>',
        '<ul class="muted env-banner__tips">',
        '<li><strong>Clean reviews</strong> works without API keys.</li>',
        '<li><strong>Infer personas</strong> needs <code>API_KEY_GOOGLE_GEMINI</code>.</li>',
        '<li><strong>Generate image ads</strong> needs both API keys and valid recipe constants below.</li>',
        '</ul>',
      );
    }

    if (!constantsOk) {
      const cList = recipeIssues.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
      parts.push(
        '<strong class="env-banner__title">Recipe constants</strong>',
        '<p>Fill in required ids in <code>src/config/recipe-constants.ts</code> (needed for <strong>Generate image ads</strong>):</p>',
        `<ul>${cList}</ul>`,
        '<p class="muted">Checks look for <code>REPLACE_ME</code> or empty values — ids are not validated against the Static Ads Lab API.</p>',
      );
    }

    if (envOk && !constantsOk) {
      parts.unshift(
        '<p class="muted" style="margin-top:0"><strong>API keys look set.</strong> Finish the constant ids before generating ads.</p>',
      );
    }

    envBanner.innerHTML = parts.join('');
  } catch (e) {
    envBanner.className = 'env-banner env-banner--error';
    envBanner.innerHTML =
      '<strong class="env-banner__title">Could not verify environment</strong><p>Open this app at <code>http://localhost:9000</code> (or the port in <code>PORT</code>; run <code>npm start</code> in <code>recipes/reviews-to-persona-image-ads</code>). If you opened the HTML file from disk (<code>file://</code>), API checks will not work.</p>';
    console.warn(UI_LOG_PREFIX, 'env-status fetch failed', e);
  }
}

(async () => {
  loadSession();
  syncUiAfterClean();
  await showEnvBannerIfNeeded();
  renderPersonas();
  restoreGenerationUi();
})();
