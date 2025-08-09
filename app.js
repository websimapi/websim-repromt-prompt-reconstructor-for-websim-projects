import { generateReprompt, generatePreviewImage } from './ai.js';
import { timeAgo, formatCount, dedupeBy, el, htmlToElement } from './utils.js';
import { marked } from 'marked';

const state = {
  user: null,
  scope: 'my', // 'my' | 'following' | 'all'
  query: '',
  postedOnly: true,
  includePrompts: true,
  includeAssets: false,
  revisionLimit: 10,
  page: 1,
  pageSize: 12,
  results: [],
  total: null,
  selected: null,
  collectedContext: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const $results = $('#results');
const $resultsCount = $('#results-count');
const $prev = $('#prev-page');
const $next = $('#next-page');
const $pageIndicator = $('#page-indicator');

const $projectDetail = $('#project-detail');
const $aiGenerate = $('#ai-generate');
const $aiCopy = $('#ai-copy');
const $aiOutput = $('#ai-output');
const $aiTarget = $('#ai-target');
const $aiVerbosity = $('#ai-verbosity');
const $aiIncludeAcceptance = $('#ai-include-acceptance');
const $aiGeneratePreview = $('#ai-generate-preview');
const $previewContainer = $('#preview-container');
const $previewContent = $('#preview-content');
const $previewStatus = $('#preview-status');

async function init() {
  try {
    state.user = await window.websim.getUser?.();
  } catch (e) {
    // not logged in or unavailable; proceed with public scope only
  }

  // Scope toggle
  $$('#scope-my, #scope-following, #scope-all').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.segmented-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.scope = btn.dataset.scope;
      state.page = 1;
      search();
    });
  });

  // Filters
  $('#filter-posted').addEventListener('change', (e) => {
    state.postedOnly = e.target.checked;
    state.page = 1; search();
  });
  $('#filter-include-prompts').addEventListener('change', (e) => {
    state.includePrompts = e.target.checked;
    // doesn't affect results, only reconstruction; no auto-search needed
  });
  $('#filter-include-assets').addEventListener('change', (e) => {
    state.includeAssets = e.target.checked;
  });
  $('#filter-revision-limit').addEventListener('change', (e) => {
    state.revisionLimit = Number(e.target.value);
  });

  // Search
  const onSearch = () => {
    state.query = $('#search-input').value.trim();
    state.page = 1;
    search();
  };
  $('#search-btn').addEventListener('click', onSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch();
  });

  // Pagination
  $prev.addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      search();
    }
  });
  $next.addEventListener('click', () => {
    state.page++;
    search();
  });

  // AI actions
  $aiGenerate.addEventListener('click', async () => {
    if (!state.selected) return;
    $aiGenerate.disabled = true;
    $aiGenerate.textContent = 'Generating…';
    $aiOutput.value = '';
    $previewContainer.classList.add('hidden');
    $previewContent.innerHTML = '';

    try {
      const context = state.collectedContext || await collectProjectContext(state.selected.project.id);
      state.collectedContext = context;

      const opts = {
        target: $aiTarget.value,
        verbosity: $aiVerbosity.value,
        includeAcceptance: $aiIncludeAcceptance.checked,
      };
      const prompt = await generateReprompt(context, opts);
      $aiOutput.value = prompt;
      $aiCopy.disabled = !prompt;

      if ($aiGeneratePreview.checked && (opts.target === 'image' || opts.target === 'webapp' || opts.target === 'game' || opts.target === '3d')) {
        $previewContainer.classList.remove('hidden');
        $previewStatus.textContent = 'Generating preview…';
        try {
          const imgUrl = await generatePreviewImage(prompt);
          $previewContent.innerHTML = '';
          const img = new Image();
          img.src = imgUrl;
          img.alt = 'Preview';
          $previewContent.appendChild(img);
          $previewStatus.textContent = 'Generated';
        } catch (e) {
          $previewStatus.textContent = 'Preview failed';
          $previewContent.textContent = 'Unable to generate preview image.';
        }
      }
    } catch (e) {
      $aiOutput.value = `Error generating reprompt:\n${e.message || e}`;
    } finally {
      $aiGenerate.disabled = false;
      $aiGenerate.textContent = 'Generate Reprompt';
    }
  });

  $aiCopy.addEventListener('click', async () => {
    if (!$aiOutput.value) return;
    await navigator.clipboard.writeText($aiOutput.value);
    $aiCopy.textContent = 'Copied!';
    setTimeout(() => ($aiCopy.textContent = 'Copy'), 1200);
  });

  // Initial search
  if (!state.user && state.scope !== 'all') {
    // if not logged in, default to all public
    state.scope = 'all';
    $$('.segmented-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('scope-all').classList.add('active');
  }
  search();
}

async function search() {
  renderResults([], true);
  const offset = (state.page - 1) * state.pageSize;
  try {
    let body;
    if (state.scope === 'my' && state.user) {
      // GET /users/{user}/projects
      const params = new URLSearchParams();
      params.set('first', state.pageSize.toString());
      params.set('after', ''); // cursor pagination not trivial; use limit/offset approach by slicing client-side
      if (state.postedOnly) params.set('posted', 'true');
      if (state.query) params.set('query', state.query);
      const res = await fetch(`/api/v1/users/${encodeURIComponent(state.user.username)}/projects?sort_by=updated_at&${params.toString()}`);
      body = await res.json();
      // Convert cursor list to offset list client-side
      let items = body.projects?.data || [];
      if (state.query) {
        // items already filtered by server, still sort by updated
      }
      const slice = items.slice(offset, offset + state.pageSize);
      state.results = slice;
      state.total = items.length; // approximate
      updatePager(items.length);
    } else if (state.scope === 'following' && state.user) {
      // GET /users/{user}/following/projects
      const params = new URLSearchParams();
      params.set('limit', state.pageSize.toString());
      params.set('offset', offset.toString());
      if (state.postedOnly) params.set('posted', 'true');
      if (state.query) params.set('query', state.query);
      const res = await fetch(`/api/v1/users/${encodeURIComponent(state.user.username)}/following/projects?sort_by=updated_at&${params.toString()}`);
      body = await res.json();
      state.results = body.projects?.data || [];
      state.total = (body.projects?.meta?.count ?? null);
      updatePager(state.results.length, body.projects?.meta);
    } else {
      // GET /projects (public)
      const params = new URLSearchParams();
      params.set('limit', state.pageSize.toString());
      params.set('offset', offset.toString());
      params.set('sort_by', 'updated_at');
      if (state.postedOnly) params.set('posted', 'true');
      if (state.query) params.set('query', state.query);
      const res = await fetch(`/api/v1/projects?${params.toString()}`);
      body = await res.json();
      state.results = body.projects?.data || [];
      state.total = (body.projects?.meta?.count ?? null);
      updatePager(state.results.length, body.projects?.meta);
    }

    renderResults(state.results);
  } catch (e) {
    renderResults([], false, e.message || String(e));
  }
}

function updatePager(length, meta) {
  const page = state.page;
  const size = state.pageSize;
  $pageIndicator.textContent = `Page ${page}`;
  if (meta?.has_next_page !== undefined) {
    $prev.disabled = page <= 1;
    $next.disabled = !meta.has_next_page;
  } else {
    $prev.disabled = page <= 1;
    $next.disabled = length < size; // naive
  }
}

function renderResults(items, loading = false, error = null) {
  $results.innerHTML = '';
  $resultsCount.textContent = loading ? 'Loading…' : `${items.length} result${items.length === 1 ? '' : 's'}`;
  if (error) {
    $resultsCount.textContent = 'Error';
    $results.innerHTML = `<div class="muted" style="padding:10px;">${error}</div>`;
    return;
  }
  if (!loading && items.length === 0) {
    $results.innerHTML = `<div class="muted" style="padding:10px;">No results.</div>`;
    return;
  }

  for (const { project, site } of items) {
    const tpl = document.getElementById('result-card-tpl').content.cloneNode(true);
    const card = tpl.querySelector('.result-card');
    const img = tpl.querySelector('img');
    const title = tpl.querySelector('.title');
    const byline = tpl.querySelector('.byline');
    const stats = tpl.querySelector('.stats');

    const thumbUrl = site?.id ? `https://images.websim.com/v1/site/${site.id}/600` : (project?.thumbnail?.url || '');
    img.src = thumbUrl || 'https://images.websim.com/v1/site/FYP/600';
    img.alt = project?.title || 'Project';

    title.textContent = project?.title || '(Untitled)';
    const creator = project?.created_by;
    byline.innerHTML = creator?.username
      ? `<a href="https://websim.com/@${creator.username}" target="_blank" rel="noopener" class="small">@${creator.username}</a>`
      : '';

    const s = project?.stats || { views: 0, likes: 0, comments: 0 };
    stats.textContent = `👍 ${formatCount(s.likes)}  •  👁️ ${formatCount(s.views)}  •  💬 ${formatCount(s.comments)}`;

    card.addEventListener('click', async () => {
      state.selected = { project, site };
      state.collectedContext = null;
      await showProjectDetail(project, site);
    });

    $results.appendChild(tpl);
  }
}

async function showProjectDetail(project, site) {
  $aiGenerate.disabled = true;
  $aiCopy.disabled = true;
  $aiOutput.value = '';
  $previewContainer.classList.add('hidden');
  $previewContent.innerHTML = '';

  $projectDetail.classList.remove('empty-state');
  $projectDetail.innerHTML = `
    <div class="project-summary">
      <div class="thumb"><img src="${site?.id ? `https://images.websim.com/v1/site/${site.id}/600` : (project?.thumbnail?.url || '')}" alt="cover"/></div>
      <div class="summary-right">
        <h2>${project?.title || '(Untitled)'}</h2>
        <div class="muted small">
          ${project?.description ? marked.parseInline(project.description) : ''}
        </div>
        <div class="small" style="margin-top:6px;">
          <a class="muted" href="https://websim.com/p/${project.id}" target="_blank" rel="noopener">Open project ↗</a>
        </div>
      </div>
    </div>
    <div class="small muted">Collecting revisions and prompts…</div>
    <div class="revs" id="revs"></div>
  `;

  const context = await collectProjectContext(project.id);
  state.collectedContext = context;

  const $revs = $('#revs');
  $revs.innerHTML = '';

  for (const rev of context.revisions) {
    const rowTpl = document.getElementById('rev-row-tpl').content.cloneNode(true);
    const row = rowTpl.querySelector('.rev-row');
    row.querySelector('.rev-badge').textContent = `${rev.version}`;
    row.querySelector('.rev-head').textContent = `Revision v${rev.version} • ${timeAgo(rev.created_at)}`;
    row.querySelector('.rev-sub').textContent = [
      rev.site_title ? `“${rev.site_title}”` : null,
      rev.site_model ? `model: ${rev.site_model}` : null,
      (rev.asset_count ? `${rev.asset_count} assets` : null),
    ].filter(Boolean).join('  •  ') || '—';

    const btn = row.querySelector('.toggle');
    let promptShown = false;

    const promptBox = el('div', { className: 'rev-prompt', style: 'display:none;' });
    promptBox.textContent = rev.prompt_text || '(No prompt text)';
    row.appendChild(promptBox);

    btn.addEventListener('click', () => {
      promptShown = !promptShown;
      promptBox.style.display = promptShown ? 'block' : 'none';
      btn.textContent = promptShown ? 'Hide prompt' : 'Show prompt';
    });

    $revs.appendChild(row);
  }

  $aiGenerate.disabled = false;
}

async function collectProjectContext(projectId) {
  // 1) Get revisions
  const revListRes = await fetch(`/api/v1/projects/${projectId}/revisions`);
  const revListBody = await revListRes.json();
  const entries = revListBody.revisions?.data || [];

  // Order by created_at asc to preserve ancestry
  const revs = entries.map((e) => e.project_revision).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // limit
  const capped = revs.slice(-state.revisionLimit);

  // 2) For each revision, fetch detail (includes site)
  const detailed = [];
  for (const r of capped) {
    const revRes = await fetch(`/api/v1/projects/${projectId}/revisions/${r.version}`);
    const revBody = await revRes.json();
    const pr = revBody.project_revision;
    const site = revBody.site;

    let assets = [];
    if (state.includeAssets) {
      try {
        const assetsRes = await fetch(`/api/v1/projects/${projectId}/revisions/${pr.version}/assets`);
        const assetsBody = await assetsRes.json();
        assets = assetsBody.assets || [];
      } catch (e) {
        // ignore asset errors
      }
    }

    detailed.push({
      version: pr.version,
      created_at: pr.created_at,
      site_title: site?.title ?? null,
      site_model: site?.model ?? null,
      prompt_type: site?.prompt?.type ?? null,
      prompt_text: site?.prompt?.text ?? null,
      attachments: site?.lore?.attachments || [],
      asset_count: assets.length,
      asset_hints: (assets || []).slice(0, 40).map((a) => ({
        content_type: a.content_type,
        filename: a.path?.split('/').pop(),
        duration: a?.meta?.duration,
        width: a?.meta?.width,
        height: a?.meta?.height,
        transparent: a?.meta?.transparent,
      })),
    });
  }

  // 3) Compose context
  const projectRes = await fetch(`/api/v1/projects/${projectId}`);
  const projectBody = await projectRes.json();
  const project = projectBody.project;

  return {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      stats: project.stats,
      created_by: project.created_by,
      slug: project.slug,
    },
    revisions: detailed,
  };
}

window.addEventListener('DOMContentLoaded', init);

