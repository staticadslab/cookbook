/**
 * Browser UI only. Polling: one batched server call per tick.
 */

const UI_LOG_PREFIX = '[customer-reviews-to-benefit-image-ads UI]';

const STORAGE_KEYS = {
  rows: 'bf_recipe_rows_json',
  extractions: 'bf_recipe_extractions_json',
  benefits: 'bf_recipe_benefits_json',
  selBenefits: 'bf_sel_benefits_json',
  selTemplates: 'bf_sel_templates_json',
};

const GENERATION_STORAGE_VERSION = 1;
const GENERATION_STORAGE_KEY = 'bf_recipe_generation_v1';

const SOURCE_PREVIEW_COUNT = 5;
const POLL_FAST_MS = 4000;
const POLL_SLOW_MS = 30000;

let maxTemplatesPerRun = 3;
/** @type {string[]} */
let templatePool = [];

const csvFile = document.querySelector('#csvFile');
const csvText = document.querySelector('#csvText');
const btnClean = document.querySelector('#btnClean');
const cleanMeta = document.querySelector('#cleanMeta');
const cleanError = document.querySelector('#cleanError');
const btnAnalyze = document.querySelector('#btnAnalyze');
const analyzeError = document.querySelector('#analyzeError');
const analyzeStatus = document.querySelector('#analyzeStatus');
const sectionChart = document.querySelector('#sectionChart');
const chartHero = document.querySelector('#chartHero');
const sectionSelect = document.querySelector('#sectionSelect');
const benefitList = document.querySelector('#benefitList');
const templateList = document.querySelector('#templateList');
const selectHint = document.querySelector('#selectHint');
const btnGenerate = document.querySelector('#btnGenerate');
const selectSummary = document.querySelector('#selectSummary');
const generateError = document.querySelector('#generateError');
const generateStatus = document.querySelector('#generateStatus');
const results = document.querySelector('#results');
const jobsTableBody = document.querySelector('#jobsTableBody');
const jobsWrap = document.querySelector('#jobsWrap');
const jobsHint = document.querySelector('#jobsHint');
const btnClearGeneration = document.querySelector('#btnClearGeneration');
const envBanner = document.querySelector('#envBanner');
const workspaceSummaryBody = document.querySelector('#workspaceSummaryBody');

/** @type {Array<{ review_index: number, review_text: string, rating: number, customer_name: string, date: string }>} */
let rows = [];
/** @type {any[]} */
let extractions = [];
/** @type {any[]} */
let benefits = [];
/** @type {Set<number>} */
let selectedBenefitIndices = new Set();
/** @type {Set<string>} */
let selectedTemplateIds = new Set();

let pollTimerId = null;
let pollInFlight = false;
let terminalFollowUpScheduled = false;

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function loadSession() {
  try {
    const r = sessionStorage.getItem(STORAGE_KEYS.rows);
    if (r) rows = JSON.parse(r);
    const e = sessionStorage.getItem(STORAGE_KEYS.extractions);
    if (e) extractions = JSON.parse(e);
    const b = sessionStorage.getItem(STORAGE_KEYS.benefits);
    if (b) benefits = JSON.parse(b);
    const sb = sessionStorage.getItem(STORAGE_KEYS.selBenefits);
    if (sb) selectedBenefitIndices = new Set(JSON.parse(sb));
    const st = sessionStorage.getItem(STORAGE_KEYS.selTemplates);
    if (st) selectedTemplateIds = new Set(JSON.parse(st));
  } catch {
    rows = [];
    extractions = [];
    benefits = [];
    selectedBenefitIndices = new Set();
    selectedTemplateIds = new Set();
  }
}

function persistSession() {
  sessionStorage.setItem(STORAGE_KEYS.rows, JSON.stringify(rows));
  sessionStorage.setItem(STORAGE_KEYS.extractions, JSON.stringify(extractions));
  sessionStorage.setItem(STORAGE_KEYS.benefits, JSON.stringify(benefits));
  sessionStorage.setItem(
    STORAGE_KEYS.selBenefits,
    JSON.stringify([...selectedBenefitIndices].sort((a, c) => a - c)),
  );
  sessionStorage.setItem(STORAGE_KEYS.selTemplates, JSON.stringify([...selectedTemplateIds]));
}

function stableGenerationRows(jobRows) {
  return jobRows.map((r) => ({
    imageAdId: r.imageAdId,
    jobId: r.jobId,
    benefitLabel: r.benefitLabel,
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

function saveGenerationRows(jobRows) {
  localStorage.setItem(
    GENERATION_STORAGE_KEY,
    JSON.stringify({
      version: GENERATION_STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      rows: stableGenerationRows(jobRows),
    }),
  );
}

function clearPollTimer() {
  if (pollTimerId !== null) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }
}

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

function renderJobsTable(statusRows) {
  if (!jobsTableBody) return;
  jobsTableBody.innerHTML = '';

  for (const row of statusRows) {
    const ad = row.imageAd;
    const tr = document.createElement('tr');
    const jobIdDisplay = row.jobId || row.imageAdId;
    const subtitle = `Image ad · ${escapeHtml(row.benefitLabel ?? '')}`;

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

function renderResultsFromStatusRows(statusRows) {
  if (!results) return;
  results.innerHTML = '';
  for (const row of statusRows) {
    const ad = row.imageAd;
    const wrap = document.createElement('div');
    const cap = escapeHtml(row.benefitLabel ?? '');
    if (ad?.image_url && ad.status === 'completed') {
      wrap.innerHTML = `
        <a href="${escapeHtml(ad.image_url)}" target="_blank" rel="noreferrer">
          <img src="${escapeHtml(ad.image_url)}" alt="" loading="lazy" />
        </a>
        <div class="ad-caption">
          ${cap} · ${escapeHtml(truncateId(row.designTemplateId, 18))}
          <br />
          <a href="${escapeHtml(ad.image_url)}" target="_blank" rel="noreferrer">Download PNG</a>
        </div>
      `;
    } else if (ad?.status === 'failed') {
      wrap.innerHTML = `<div class="ad-caption error">${cap} — failed ${ad.error ? escapeHtml(ad.error.message) : ''}</div>`;
    } else if (ad?.status === 'processing') {
      wrap.innerHTML = `<div class="ad-caption muted">${cap} — still processing…</div>`;
    } else {
      continue;
    }
    results.appendChild(wrap);
  }
}

async function runStatusPoll() {
  if (pollInFlight) return;
  const jobRows = loadGenerationRows();
  if (!jobRows?.length) {
    showGenerationChrome(false);
    return;
  }

  showGenerationChrome(true);
  pollInFlight = true;
  try {
    const data = await postJson('/api/generate/status', { rows: jobRows });
    const list = data.rows ?? [];
    const allTerminal = Boolean(data.allTerminal);

    renderJobsTable(list);
    renderResultsFromStatusRows(list);

    const processing = list.filter((r) => r.imageAd?.status === 'processing').length;
    if (!allTerminal) {
      generateStatus.textContent = `Updating… ${processing} still processing (~${POLL_FAST_MS / 1000}s tick while tab visible).`;
    } else {
      generateStatus.textContent = `All ${list.length} ad(s) finished.`;
    }

    scheduleNextPoll(allTerminal);
    if (allTerminal && pollTimerId === null) {
      generateStatus.textContent = `All ${list.length} ad(s) finished. Polling idle.`;
    }
    console.log(UI_LOG_PREFIX, 'status poll', { allTerminal, n: list.length });
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
  const jobRows = loadGenerationRows();
  if (!jobRows?.length) {
    showGenerationChrome(false);
    return;
  }
  showGenerationChrome(true);
  const placeholderRows = jobRows.map((r) => ({ ...r, imageAd: null }));
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

/** Plain-language step feedback for Analyze — keep out of error banner. */
function setStepStatus(el, text, live) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('status-live', Boolean(live) && Boolean(text));
}

function refreshStepHintsFromSession() {
  if (!analyzeStatus) return;
  if (benefits.length > 0) {
    analyzeStatus.textContent = `Last run: ${extractions.length} extraction(s), ${benefits.length} benefit theme(s). Run again to refresh from the current rows.`;
    analyzeStatus.classList.remove('status-live');
  } else if (extractions.length > 0) {
    analyzeStatus.textContent = `${extractions.length} extraction(s) saved — click Analyze reviews to build benefit themes (or clean CSV to start over).`;
    analyzeStatus.classList.remove('status-live');
  }
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
    console.warn(UI_LOG_PREFIX, 'POST failed', path, data.error);
    throw new Error(data.error || res.statusText || 'Request failed');
  }
  return data;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function reviewSnippet(text, max = 260) {
  const t = String(text ?? '').trim();
  if (!t) return '—';
  if (t.length <= max) return escapeHtml(t);
  return `${escapeHtml(t.slice(0, max))}…`;
}

/** @returns {Map<number, { review_text: string }>} */
function rowByReviewIndex() {
  const m = new Map();
  for (const r of rows) {
    m.set(r.review_index, r);
  }
  return m;
}

function buildBenefitSourcesInnerHtml(b) {
  const byIdx = rowByReviewIndex();
  const idxs = [...(b.source_review_indices ?? [])].sort((a, c) => a - c);
  const withText = idxs
    .map((i) => ({ index: i, text: byIdx.get(i)?.review_text?.trim() ?? '' }))
    .filter((x) => x.text.length > 0);
  const total = withText.length;
  if (total === 0) {
    return '<p class="muted benefit-card__sources-empty">No review text matched these indices in the current rows.</p>';
  }
  const lis = withText
    .map((item, j) => {
      const extra = j >= SOURCE_PREVIEW_COUNT ? ' benefit-card__source-li--extra' : '';
      const hidden = j >= SOURCE_PREVIEW_COUNT ? ' hidden' : '';
      return `<li class="benefit-card__source-li${extra}"${hidden}><span class="benefit-card__source-idx">Review #${item.index}</span><blockquote>${reviewSnippet(item.text)}</blockquote></li>`;
    })
    .join('');
  const toggle =
    total > SOURCE_PREVIEW_COUNT
      ? `<button type="button" class="secondary benefit-card__source-toggle" aria-expanded="false" data-total="${total}">Show all ${total}</button>`
      : '';
  return `<ol class="benefit-card__source-list">${lis}</ol>${toggle}`;
}

function syncAfterClean() {
  cleanMeta.textContent = rows.length ? `${rows.length} review row(s) ready` : '';
  if (btnAnalyze) btnAnalyze.disabled = rows.length === 0;
}

function renderChart() {
  if (!chartHero || !sectionChart) return;
  if (benefits.length === 0) {
    sectionChart.hidden = true;
    return;
  }
  sectionChart.hidden = false;
  const counts = benefits.map((b) => b.source_review_indices?.length ?? 0);
  const max = Math.max(1, ...counts);
  chartHero.innerHTML = '<h3>Benefit mentions by review count</h3>';
  const wrap = document.createElement('div');
  wrap.className = 'bar-chart';
  const sorted = [...benefits]
    .map((b, i) => ({ b, i, c: b.source_review_indices?.length ?? 0 }))
    .sort((a, d) => d.c - a.c);
  for (const { b, c } of sorted) {
    const pct = Math.round((c / max) * 100);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-row__label" title="${escapeHtml(b.label)}">${escapeHtml(b.label)}</span>
      <span class="bar-row__count">${c}</span>
      <div class="bar-row__track"><div class="bar-row__fill" style="width:${pct}%"></div></div>
    `;
    wrap.appendChild(row);
  }
  chartHero.appendChild(wrap);
}

function renderBenefitAndTemplatePicks() {
  if (!benefitList || !templateList || !sectionSelect) return;
  if (benefits.length === 0) {
    sectionSelect.hidden = true;
    return;
  }
  sectionSelect.hidden = false;
  benefitList.innerHTML = '';
  benefits.forEach((b, index) => {
    const n = b.source_review_indices?.length ?? 0;
    const card = document.createElement('div');
    card.className = 'benefit-card';
    const id = `benefit-${index}`;
    const checked = selectedBenefitIndices.has(index);
    const sourcesInner = buildBenefitSourcesInnerHtml(b);
    card.innerHTML = `
      <label class="benefit-card__pick">
        <input type="checkbox" id="${id}" data-index="${index}" ${checked ? 'checked' : ''} />
        <span><strong>${escapeHtml(b.label)}</strong> — ${n} review(s)</span>
      </label>
      <details class="benefit-card__sources">
        <summary>Sources <span class="muted">(${n})</span></summary>
        <div class="benefit-card__sources-body">${sourcesInner}</div>
      </details>
    `;
    benefitList.appendChild(card);
  });

  benefitList.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const idx = Number(box.dataset.index);
      if (box.checked) selectedBenefitIndices.add(idx);
      else selectedBenefitIndices.delete(idx);
      persistSession();
      updateSelectSummary();
    });
  });

  void renderTemplatePickGrid();
}

async function renderTemplatePickGrid() {
  if (!templateList) return;

  if (templatePool.length === 0) {
    templateList.innerHTML =
      '<p class="muted">Add design template ids in <code>recipe-constants.ts</code>.</p>';
    templateList.className = 'template-grid';
    updateSelectSummary();
    return;
  }

  templateList.className = 'template-grid template-grid--visual';
  templateList.innerHTML = '<p class="muted template-grid__loading">Loading previews…</p>';

  /** @type {Map<string, Record<string, unknown>>} */
  let byId = new Map();
  let salKeyMissing = false;
  try {
    const res = await fetch('/api/design-templates/pool');
    const data = await res.json().catch(() => ({}));
    salKeyMissing = data.salKeyMissing === true;
    const list = Array.isArray(data.templates) ? data.templates : [];
    byId = new Map(list.map((t) => [t.id, t]));
  } catch {
    byId = new Map();
  }

  templateList.innerHTML = '';

  if (salKeyMissing) {
    const note = document.createElement('p');
    note.className = 'muted template-grid__note';
    note.innerHTML =
      'Set your Static Ads Lab key to load template previews from the API. You can still select by id.';
    templateList.appendChild(note);
  }

  for (const tid of templatePool) {
    const meta = byId.get(tid);
    const refUrl = String(meta?.reference_image_url || '').trim();
    const previewUrl = String(meta?.preview_url || '').trim();
    /** Prefer the original reference upload when the API has it; else the rendered layout preview. */
    const primaryUrl = refUrl || previewUrl;
    const hasAltThumb = Boolean(refUrl && previewUrl && refUrl !== previewUrl);
    const checked = selectedTemplateIds.has(tid);

    const label = document.createElement('label');
    label.className = 'template-card';
    if (checked) label.classList.add('template-card--checked');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'template-card__check';
    if (checked) input.checked = true;

    const media = document.createElement('div');
    media.className = 'template-card__media';

    /** @type {HTMLImageElement | null} */
    let thumbImg = null;
    if (primaryUrl) {
      const img = document.createElement('img');
      thumbImg = img;
      img.src = primaryUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        thumbImg = null;
        const ph = document.createElement('div');
        ph.className = 'template-card__placeholder';
        ph.textContent = 'Preview unavailable';
        media.appendChild(ph);
      });
      media.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'template-card__placeholder';
      ph.textContent = meta?.fetchError ? 'Could not load' : 'No preview';
      media.appendChild(ph);
    }

    const foot = document.createElement('div');
    foot.className = 'template-card__foot';
    const idSpan = document.createElement('span');
    idSpan.className = 'template-card__id';
    idSpan.textContent = truncateId(tid, 40);
    foot.appendChild(idSpan);
    const badgeParts = [meta?.ad_format, meta?.aspect_ratio].filter(Boolean);
    if (badgeParts.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'template-card__badge';
      badge.textContent = badgeParts.join(' · ');
      foot.appendChild(badge);
    }

    if (hasAltThumb && thumbImg) {
      let showingReference = Boolean(refUrl);
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'secondary template-card__thumb-toggle';
      toggleBtn.textContent = showingReference ? 'Layout preview' : 'Original';
      toggleBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showingReference = !showingReference;
        thumbImg.src = showingReference ? refUrl : previewUrl;
        toggleBtn.textContent = showingReference ? 'Layout preview' : 'Original';
      });
      foot.appendChild(toggleBtn);
    }

    input.addEventListener('change', () => {
      if (input.checked) {
        if (selectedTemplateIds.size >= maxTemplatesPerRun && !selectedTemplateIds.has(tid)) {
          input.checked = false;
          return;
        }
        selectedTemplateIds.add(tid);
      } else {
        selectedTemplateIds.delete(tid);
      }
      label.classList.toggle('template-card--checked', input.checked);
      persistSession();
      updateSelectSummary();
    });

    label.appendChild(input);
    label.appendChild(media);
    label.appendChild(foot);
    templateList.appendChild(label);
  }

  updateSelectSummary();
}

function updateSelectSummary() {
  const bt = selectedBenefitIndices.size;
  const tt = selectedTemplateIds.size;
  selectSummary.textContent = `${bt} benefit(s), ${tt} template(s) · ${bt * tt} ad(s)`;
  const ok = bt >= 1 && tt >= 1;
  btnGenerate.disabled = !ok;
  selectHint.textContent = ok
    ? 'Ready to generate.'
    : `Pick at least one benefit and one template (up to ${maxTemplatesPerRun} templates).`;
}

/**
 * Renders brand, product, variant (emphasized), and audience from GET /api/config/env-status.
 * @param {Record<string, unknown> | null | undefined} statusPayload Full JSON from env-status (includes recipeContext + flags).
 */
function renderRecipeContext(statusPayload) {
  if (!workspaceSummaryBody) return;

  const ctx = statusPayload?.recipeContext;
  const namesFromSal = statusPayload?.recipeContextNamesFromSal === true;
  const labelWarnings = Array.isArray(statusPayload?.recipeContextLabelWarnings)
    ? statusPayload.recipeContextLabelWarnings
    : [];

  if (!ctx || typeof ctx !== 'object') {
    workspaceSummaryBody.innerHTML =
      '<p class="muted">Open this page through the recipe server to see your workspace summary.</p>';
    return;
  }

  const brandLabel = String(ctx.brandLabel ?? '').trim();
  const productLabel = String(ctx.productLabel ?? '').trim();
  const variantLabel = String(ctx.productVariantLabel ?? '').trim();
  const audienceLabel = String(ctx.audienceLabel ?? '').trim();

  const brandId = String(ctx.brandId ?? '').trim();
  const productId = String(ctx.productId ?? '').trim();
  const variantId = String(ctx.productVariantId ?? '').trim();
  const audienceId = String(ctx.audienceId ?? '').trim();

  const ph = (hint) =>
    `<span class="workspace-summary__placeholder">${escapeHtml(hint)}</span>`;

  const hintNoKey = 'Names load when the server has your Static Ads Lab key and valid recipe ids.';
  const hintFailed = 'Could not load this name from Static Ads Lab.';

  const brandLine = brandLabel
    ? escapeHtml(brandLabel)
    : namesFromSal
      ? ph(hintFailed)
      : ph(hintNoKey);
  const audienceLine = audienceLabel
    ? escapeHtml(audienceLabel)
    : namesFromSal
      ? ph(hintFailed)
      : ph(hintNoKey);

  const productLine = productLabel
    ? escapeHtml(productLabel)
    : namesFromSal
      ? ph(hintFailed)
      : ph(hintNoKey);
  const variantLine = variantId
    ? variantLabel
      ? escapeHtml(variantLabel)
      : namesFromSal
        ? ph(hintFailed)
        : ph(hintNoKey)
    : ph('No variant id in recipe constants');

  const variantIdBlock = variantId
    ? `<p class="workspace-summary__id">${escapeHtml(variantId)}</p>`
    : `<p class="workspace-summary__id workspace-summary__placeholder">No variant id set</p>`;

  const warningsBlock =
    labelWarnings.length > 0
      ? `<ul class="workspace-summary__warnings muted">${labelWarnings
          .map((w) => `<li>${escapeHtml(String(w))}</li>`)
          .join('')}</ul>`
      : '';

  workspaceSummaryBody.innerHTML = `
    <div class="workspace-summary__meta">
      <div class="workspace-summary__meta-item">
        <span class="workspace-summary__meta-label">Brand</span>
        <span class="workspace-summary__meta-value">${brandLine}</span>
        <span class="workspace-summary__id">${escapeHtml(brandId || '—')}</span>
      </div>
      <div class="workspace-summary__meta-item">
        <span class="workspace-summary__meta-label">Audience</span>
        <span class="workspace-summary__meta-value">${audienceLine}</span>
        <span class="workspace-summary__id">${escapeHtml(audienceId || '—')}</span>
      </div>
    </div>
    <div class="workspace-summary__hero">
      <div class="workspace-summary__tile workspace-summary__tile--product">
        <p class="workspace-summary__tile-eyebrow">Product</p>
        <p class="workspace-summary__tile-title">${productLine}</p>
        <p class="workspace-summary__id">${escapeHtml(productId || '—')}</p>
      </div>
      <div class="workspace-summary__tile workspace-summary__tile--variant">
        <p class="workspace-summary__tile-eyebrow">Product variant</p>
        <p class="workspace-summary__tile-title">${variantLine}</p>
        ${variantIdBlock}
      </div>
    </div>
    ${warningsBlock}
  `;
}

async function showEnvBannerIfNeeded() {
  if (!envBanner) return;
  envBanner.className = 'env-banner env-banner--pending';
  envBanner.textContent = 'Checking server environment and recipe config…';

  try {
    const res = await fetch('/api/config/env-status');
    if (!res.ok) {
      envBanner.className = 'env-banner env-banner--error';
      envBanner.innerHTML = `<strong class="env-banner__title">Could not read env status</strong><p>HTTP ${res.status}. Is <code>npm start</code> running?</p>`;
      renderRecipeContext(null);
      return;
    }

    const data = await res.json();
    renderRecipeContext(data);
    const missing = data.missing ?? [];
    const recipeIssues = data.recipeConstantsIssues ?? [];
    if (typeof data.maxTemplatesPerRun === 'number') {
      maxTemplatesPerRun = data.maxTemplatesPerRun;
    }
    if (Array.isArray(data.designTemplateIds)) {
      templatePool = data.designTemplateIds.filter(Boolean);
    }

    const envOk = missing.length === 0;
    const constantsOk = recipeIssues.length === 0;

    if (envOk && constantsOk) {
      envBanner.className = 'env-banner env-banner--ok';
      envBanner.innerHTML =
        '<strong class="env-banner__title">Ready for this POC</strong><p class="muted">Keys and ids in <code>recipe-constants.ts</code> look filled in. Generation still needs a funded Static Ads Lab wallet.</p>';
      return;
    }

    envBanner.className = 'env-banner';
    const parts = [];
    if (!envOk) {
      const list = missing.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('');
      parts.push(
        '<strong class="env-banner__title">Missing environment variables</strong>',
        `<ul>${list}</ul>`,
        '<ul class="muted env-banner__tips">',
        '<li><strong>Clean reviews</strong> needs no keys.</li>',
        '<li><strong>Analyze reviews</strong> needs <code>API_KEY_GOOGLE_GEMINI</code>.</li>',
        '<li><strong>Generate</strong> needs both keys and recipe constants.</li>',
        '</ul>',
      );
    }
    if (!constantsOk) {
      const cList = recipeIssues.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
      parts.push('<strong class="env-banner__title">Recipe constants</strong>', `<ul>${cList}</ul>`);
    }
    envBanner.innerHTML = parts.join('');
  } catch {
    envBanner.className = 'env-banner env-banner--error';
    envBanner.innerHTML =
      '<strong class="env-banner__title">Could not verify environment</strong><p>Open this app via the local server (not a <code>file://</code> URL).</p>';
    renderRecipeContext(null);
  }
}

csvFile?.addEventListener('change', async () => {
  const file = csvFile.files?.[0];
  if (!file) return;
  csvText.value = await file.text();
});

btnClean.addEventListener('click', async () => {
  showError(cleanError, '');
  showError(analyzeError, '');
  try {
    const data = await postJson('/api/reviews/clean', { csvText: csvText.value });
    rows = data.rows ?? [];
    extractions = [];
    benefits = [];
    selectedBenefitIndices = new Set();
    selectedTemplateIds = new Set();
    persistSession();
    syncAfterClean();
    sectionChart.hidden = true;
    sectionSelect.hidden = true;
    chartHero.innerHTML = '';
    cleanMeta.textContent = `${rows.length} row(s); skipped by rating: ${data.skippedByRating ?? 0}`;
    setStepStatus(analyzeStatus, '', false);
  } catch (e) {
    showError(cleanError, e instanceof Error ? e.message : String(e));
  }
});

btnAnalyze?.addEventListener('click', async () => {
  showError(analyzeError, '');
  if (!btnAnalyze) return;
  btnAnalyze.disabled = true;
  setStepStatus(
    analyzeStatus,
    'Working… Extraction runs in batches (often 15–60s for ~40 reviews), then one clustering step (often 10–40s). Chunk progress is in the terminal — this line updates when the server finishes.',
    true,
  );
  try {
    const data = await postJson('/api/benefits/analyze', { rows });
    extractions = data.extractions ?? [];
    benefits = data.benefits ?? [];
    selectedBenefitIndices = new Set();
    selectedTemplateIds = new Set();
    persistSession();
    renderChart();
    renderBenefitAndTemplatePicks();
    setStepStatus(
      analyzeStatus,
      `Done — ${extractions.length} extraction(s), ${benefits.length} benefit theme(s). Chart and picks below.`,
      false,
    );
  } catch (e) {
    showError(analyzeError, e instanceof Error ? e.message : String(e));
    setStepStatus(analyzeStatus, '', false);
  } finally {
    if (btnAnalyze) btnAnalyze.disabled = rows.length === 0;
  }
});

btnGenerate.addEventListener('click', async () => {
  showError(generateError, '');
  generateStatus.textContent = 'Enqueueing image ads…';
  btnGenerate.disabled = true;
  results.innerHTML = '';
  clearPollTimer();
  terminalFollowUpScheduled = false;

  const chosenBenefits = [...selectedBenefitIndices]
    .sort((a, c) => a - c)
    .map((i) => benefits[i]);
  const templateIds = [...selectedTemplateIds];

  try {
    const data = await postJson('/api/generate/start', {
      rows,
      extractions,
      selectedBenefits: chosenBenefits,
      templateIds,
    });
    const jobRows = data.rows ?? [];
    saveGenerationRows(jobRows);
    showGenerationChrome(jobRows.length > 0);
    renderJobsTable(jobRows.map((r) => ({ ...r, imageAd: null })));
    void runStatusPoll();
  } catch (e) {
    showError(generateError, e instanceof Error ? e.message : String(e));
    generateStatus.textContent = '';
  } finally {
    updateSelectSummary();
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
});

benefitList?.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest('.benefit-card__source-toggle');
  if (!btn || !benefitList.contains(btn)) return;
  ev.preventDefault();
  const card = btn.closest('.benefit-card');
  if (!card) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  const next = !expanded;
  btn.setAttribute('aria-expanded', String(next));
  card.querySelectorAll('.benefit-card__source-li--extra').forEach((li) => {
    li.hidden = !next;
  });
  const total = Number(btn.getAttribute('data-total') || '0');
  btn.textContent = next ? 'Show less' : `Show all ${total}`;
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

(async () => {
  loadSession();
  await showEnvBannerIfNeeded();
  syncAfterClean();
  if (benefits.length > 0) {
    renderChart();
    renderBenefitAndTemplatePicks();
  } else if (extractions.length > 0) {
    if (btnAnalyze) btnAnalyze.disabled = rows.length === 0;
  }
  refreshStepHintsFromSession();
  restoreGenerationUi();
})();
