import "./styles.css";

type FilterMode = "any" | "only0" | "only1";
type SortMode = "relevance" | "id_desc" | "id_asc";

type TagInfo = { tagId: number; name: string; count: number; bit: number };

type WorkerReadyMsg = { type: "ready"; count: number; tags: TagInfo[]; generatedAt: string };
type WorkerProgressMsg = { type: "progress"; stage: string };
type WorkerResultsMsg = {
  type: "results";
  requestId: number;
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
  items: Array<{
    id: number;
    title: string;
    cover: string;
    aliases: string[];
    authors: string[];
    tags: Array<{ tagId: number; name: string }>;
    hidden: boolean;
    isHideChapter: boolean;
  }>;
};

type WorkerOutMsg = WorkerReadyMsg | WorkerProgressMsg | WorkerResultsMsg;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("找不到 #app");

app.innerHTML = `
  <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">再漫画搜索</h1>
        <p class="mt-2 text-xs text-slate-600 dark:text-slate-300">
          本网站与再漫画无关，从互联网上收集信息，仅用于学习研究
        </p>
      </div>
      <div class="text-xs text-slate-500 dark:text-slate-400" aria-live="polite" data-role="status">
        正在初始化…
      </div>
    </header>

    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label class="flex-1">
            <span class="sr-only">搜索</span>
            <div class="relative">
              <input
                class="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm outline-none ring-brand-200 transition-shadow placeholder:text-slate-400 focus:ring-4 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:disabled:bg-slate-800"
                placeholder="输入关键词（至少 2 个字符），支持 -关键词 排除（例：贵族 -反派）"
                autocomplete="off"
                inputmode="search"
                data-role="q"
                disabled
              />
              <button
                class="hidden absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                type="button"
                aria-label="清空搜索"
                data-role="clearQ"
                disabled
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </label>

          <button
            class="h-10 rounded-xl bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
            data-role="searchBtn"
            disabled
          >
            搜索
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <label class="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
            <span class="text-xs text-slate-600 dark:text-slate-300">隐藏漫画</span>
            <select
              class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-brand-200 transition-shadow focus:ring-4 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
              data-role="hidden"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">不显示隐藏漫画</option>
              <option value="only1">仅显示隐藏漫画</option>
            </select>
          </label>

          <label class="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
            <span class="text-xs text-slate-600 dark:text-slate-300">章节被隐藏</span>
            <select
              class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-brand-200 transition-shadow focus:ring-4 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
              data-role="hideChapter"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">不显示章节被隐藏</option>
              <option value="only1">仅显示章节被隐藏</option>
            </select>
          </label>
        </div>

      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="text-xs text-slate-600 dark:text-slate-300">标签筛选（可多选）</div>
            <button
              class="group hidden inline-flex items-center gap-1 text-xs text-brand-800 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-200"
              data-role="toggleTags"
              type="button"
              disabled
              data-expanded="false"
            >
              <span data-role="toggleTagsText">展开</span>
              <svg
                viewBox="0 0 20 20"
                class="h-4 w-4 transition-transform group-data-[expanded=true]:rotate-180"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5.25 7.5a.75.75 0 0 1 1.06 0L10 11.19l3.69-3.69a.75.75 0 1 1 1.06 1.06l-4.22 4.22a.75.75 0 0 1-1.06 0L5.25 8.56a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
          <button
            class="text-xs text-brand-800 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-200"
            data-role="clearTags"
            disabled
          >
            清空标签
          </button>
        </div>
        <div class="flex flex-wrap gap-2" data-role="tagList"></div>
      </div>
      </div>
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-medium text-slate-900 dark:text-slate-100">结果</h2>
          <div class="text-xs text-slate-500 dark:text-slate-400" data-role="resultMeta"></div>
        </div>
        <label class="flex items-center gap-2">
          <span class="text-xs text-slate-600 dark:text-slate-300">排序</span>
          <select
            class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-brand-200 transition-shadow focus:ring-4 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
            data-role="sort"
            disabled
          >
            <option value="relevance">相关性</option>
            <option value="id_desc">上架时间从新到旧</option>
            <option value="id_asc">上架时间从旧到新</option>
          </select>
        </label>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-role="results"></div>
      <div class="mt-4 flex justify-center">
        <button
          class="hidden h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          data-role="loadMore"
        >
          加载更多
        </button>
      </div>
      <div class="h-1" data-role="sentinel"></div>
    </section>

    <div
      class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 opacity-0 transition-opacity"
      data-role="toast"
    >
      <div class="rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg" data-role="toastText"></div>
    </div>

    <div
      class="fixed inset-0 z-[60] flex cursor-wait items-center justify-center bg-white/75 px-4 text-slate-900 backdrop-blur-sm transition-opacity duration-200 dark:bg-slate-950/70 dark:text-slate-100"
      data-role="loadingOverlay"
      aria-hidden="false"
    >
      <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 h-10 w-10 shrink-0 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin motion-reduce:animate-none dark:border-brand-900/40 dark:border-t-brand-400"></div>
          <div class="min-w-0">
            <div class="text-sm font-semibold">正在加载索引…</div>
            <div
              class="mt-1 text-xs text-slate-600 dark:text-slate-300"
              data-role="loadingStage"
              aria-live="polite"
            >
              正在初始化…
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
`;

function qs<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`找不到元素：${sel}`);
  return el;
}

const qInput = qs<HTMLInputElement>('[data-role="q"]');
const clearQBtn = qs<HTMLButtonElement>('[data-role="clearQ"]');
const sortSelect = qs<HTMLSelectElement>('[data-role="sort"]');
const hiddenSelect = qs<HTMLSelectElement>('[data-role="hidden"]');
const hideChapterSelect = qs<HTMLSelectElement>('[data-role="hideChapter"]');
const searchBtn = qs<HTMLButtonElement>('[data-role="searchBtn"]');
const tagList = qs<HTMLDivElement>('[data-role="tagList"]');
const toggleTagsBtn = qs<HTMLButtonElement>('[data-role="toggleTags"]');
const toggleTagsTextEl = toggleTagsBtn.querySelector<HTMLSpanElement>('[data-role="toggleTagsText"]');
if (!toggleTagsTextEl) throw new Error("找不到 data-role=toggleTagsText");
const toggleTagsText = toggleTagsTextEl;
const clearTagsBtn = qs<HTMLButtonElement>('[data-role="clearTags"]');
const statusEl = qs<HTMLDivElement>('[data-role="status"]');
const resultsEl = qs<HTMLDivElement>('[data-role="results"]');
const resultMetaEl = qs<HTMLDivElement>('[data-role="resultMeta"]');
const loadMoreBtn = qs<HTMLButtonElement>('[data-role="loadMore"]');
const sentinelEl = qs<HTMLDivElement>('[data-role="sentinel"]');
const toastEl = qs<HTMLDivElement>('[data-role="toast"]');
const toastTextEl = qs<HTMLDivElement>('[data-role="toastText"]');
const loadingOverlayEl = qs<HTMLDivElement>('[data-role="loadingOverlay"]');
const loadingStageEl = qs<HTMLDivElement>('[data-role="loadingStage"]');

const STORAGE_KEY_SELECTED_TAG_BITS = "zmh-search:selectedTagBits:v1";
const STORAGE_KEY_EXCLUDED_TAG_BITS = "zmh-search:excludedTagBits:v1";
const STORAGE_KEY_UI_SETTINGS = "zmh-search:uiSettings:v1";

let tags: TagInfo[] = [];
const selectedTagBits = new Set<number>();
const excludedTagBits = new Set<number>();
let tagsExpanded = false;

let totalCount = 0;
let generatedAt = "";
let currentRequestId = 0;
let currentPage = 1;
let currentHasMore = false;
let currentItems: WorkerResultsMsg["items"] = [];
let currentTotalMatches = 0;
let loadingMore = false;
let isInitializing = true;

const autoLoadSupported = "IntersectionObserver" in window;

function loadBits(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => Number.isInteger(x))
      .map((x) => Number(x))
      .filter((x) => x >= 0 && x < 64);
  } catch {
    return [];
  }
}

function saveBits(key: string, values: Iterable<number>): void {
  try {
    const bits = [...values].sort((a, b) => a - b);
    localStorage.setItem(key, JSON.stringify(bits));
  } catch {
    // ignore
  }
}

function loadSelectedTagBits(): number[] {
  return loadBits(STORAGE_KEY_SELECTED_TAG_BITS);
}

function loadExcludedTagBits(): number[] {
  return loadBits(STORAGE_KEY_EXCLUDED_TAG_BITS);
}

function saveSelectedTagBits(): void {
  saveBits(STORAGE_KEY_SELECTED_TAG_BITS, selectedTagBits.values());
}

function saveExcludedTagBits(): void {
  saveBits(STORAGE_KEY_EXCLUDED_TAG_BITS, excludedTagBits.values());
}

function loadUiSettings(): Partial<{
  sort: SortMode;
  hidden: FilterMode;
  hideChapter: FilterMode;
}> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UI_SETTINGS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<{ sort: SortMode; hidden: FilterMode; hideChapter: FilterMode }> = {};

    const sort = parsed?.sort;
    if (sort === "relevance" || sort === "id_desc" || sort === "id_asc") out.sort = sort;

    const hidden = parsed?.hidden;
    if (hidden === "any" || hidden === "only0" || hidden === "only1") out.hidden = hidden;

    const hideChapter = parsed?.hideChapter;
    if (hideChapter === "any" || hideChapter === "only0" || hideChapter === "only1")
      out.hideChapter = hideChapter;

    return out;
  } catch {
    return {};
  }
}

function saveUiSettings(): void {
  try {
    const payload = {
      sort: sortSelect.value as SortMode,
      hidden: hiddenSelect.value as FilterMode,
      hideChapter: hideChapterSelect.value as FilterMode,
    };
    localStorage.setItem(STORAGE_KEY_UI_SETTINGS, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const restoredSettings = loadUiSettings();
if (restoredSettings.sort) sortSelect.value = restoredSettings.sort;
if (restoredSettings.hidden) hiddenSelect.value = restoredSettings.hidden;
if (restoredSettings.hideChapter) hideChapterSelect.value = restoredSettings.hideChapter;

function maybeAutoLoadMore(): void {
  if (!autoLoadSupported) return;
  if (!currentHasMore) return;
  if (loadingMore) return;
  doSearch(currentPage + 1);
}

function checkAutoLoad(): void {
  if (!autoLoadSupported) return;
  if (!currentHasMore) return;
  if (loadingMore) return;
  const rect = sentinelEl.getBoundingClientRect();
  if (rect.top <= window.innerHeight + 600) maybeAutoLoadMore();
}

if (autoLoadSupported) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeAutoLoadMore();
    },
    { root: null, rootMargin: "600px 0px", threshold: 0 },
  );
  observer.observe(sentinelEl);
}

function toast(text: string): void {
  toastTextEl.textContent = text;
  toastEl.classList.remove("opacity-0");
  toastEl.classList.add("opacity-100");
  window.setTimeout(() => {
    toastEl.classList.remove("opacity-100");
    toastEl.classList.add("opacity-0");
  }, 900);
}

function setLoadingOverlay(visible: boolean, stage?: string): void {
  if (stage) loadingStageEl.textContent = stage;
  if (visible) {
    loadingOverlayEl.classList.remove("opacity-0", "pointer-events-none");
    loadingOverlayEl.setAttribute("aria-hidden", "false");
  } else {
    loadingOverlayEl.classList.add("opacity-0", "pointer-events-none");
    loadingOverlayEl.setAttribute("aria-hidden", "true");
  }
}

setLoadingOverlay(true);

function setEnabled(enabled: boolean): void {
  for (const el of [qInput, sortSelect, hiddenSelect, hideChapterSelect, searchBtn]) {
    el.disabled = !enabled;
  }
  toggleTagsBtn.disabled = !enabled;
  clearTagsBtn.disabled = !enabled || (selectedTagBits.size === 0 && excludedTagBits.size === 0);
  if (!enabled) {
    clearQBtn.disabled = true;
    clearQBtn.classList.add("hidden");
    toggleTagsBtn.classList.add("hidden");
  } else {
    updateClearQBtn();
  }
}

function updateToggleTagsBtn(): void {
  const canToggle = tags.length > 0;
  toggleTagsBtn.disabled = !canToggle;
  if (canToggle) toggleTagsBtn.classList.remove("hidden");
  else toggleTagsBtn.classList.add("hidden");
  toggleTagsBtn.dataset.expanded = tagsExpanded ? "true" : "false";
  toggleTagsText.textContent = tagsExpanded ? "收起" : "展开";
}

function renderTags(): void {
  const selected = tags.filter((t) => selectedTagBits.has(t.bit) || excludedTagBits.has(t.bit));
  const list = tagsExpanded ? tags : selected;

  tagList.innerHTML = list
    .map((t) => {
      const included = selectedTagBits.has(t.bit);
      const excluded = excludedTagBits.has(t.bit);
      const nameClass = excluded ? "line-through decoration-2 decoration-rose-600 dark:decoration-rose-200" : "";
      return `
        <button
          class="${
            included
              ? "border-brand-700 bg-brand-50 text-brand-900 dark:border-brand-300 dark:bg-brand-900/30 dark:text-brand-100"
              : excluded
                 ? "border-rose-500 bg-rose-50 text-rose-900 dark:border-rose-300 dark:bg-rose-900/25 dark:text-rose-100"
               : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          } inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-4 focus:ring-brand-200"
          data-tag-bit="${t.bit}"
          type="button"
        >
          <span class="${nameClass}">${t.name}</span>
          <span class="${
            included
              ? "text-brand-700 dark:text-brand-200"
              : excluded
                ? "text-rose-700 dark:text-rose-200"
                : "text-slate-500 dark:text-slate-400"
          }">${t.count}</span>
        </button>
      `;
    })
    .join("");
  clearTagsBtn.disabled = selectedTagBits.size === 0 && excludedTagBits.size === 0;
  updateToggleTagsBtn();
}

function updateClearQBtn(): void {
  const canShow = !qInput.disabled && qInput.value.trim().length > 0;
  clearQBtn.disabled = !canShow;
  if (canShow) clearQBtn.classList.remove("hidden");
  else clearQBtn.classList.add("hidden");
}

function renderResults(): void {
  if (currentItems.length === 0) {
    resultsEl.innerHTML = `
      <div class="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        暂无结果。请输入关键词（至少 2 个字符）或选择标签后搜索。
      </div>
    `;
    resultMetaEl.textContent = "";
    loadMoreBtn.classList.add("hidden");
    return;
  }

  resultsEl.innerHTML = currentItems
    .map((it) => {
      const aliasText = it.aliases.length > 0 ? it.aliases.join(" / ") : "";
      const statusChips = [
        it.hidden
          ? `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">隐藏漫画</span>`
          : "",
        it.isHideChapter
          ? `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">章节被隐藏</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      const authorChips = it.authors
        .map(
          (a) => `
          <button
            class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-brand-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            data-author="${encodeURIComponent(a)}"
            type="button"
          >${a}</button>
        `,
        )
        .join("");
      const tagChips = it.tags
        .map(
          (t) => `
          <button
            class="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-900 hover:bg-brand-100 focus:outline-none focus:ring-4 focus:ring-brand-200 dark:bg-brand-900/30 dark:text-brand-100 dark:hover:bg-brand-900/50"
            data-tag-id="${t.tagId}"
            type="button"
          >${t.name}</button>
        `,
        )
        .join("");

      const href = `https://m.zaimanhua.com/pages/comic/detail?id=${it.id}`;

      return `
        <article
          class="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
          data-comic-id="${it.id}"
        >
          <div class="p-3">
            <div class="relative overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
              <a
                href="${href}"
                target="_blank"
                rel="noreferrer noopener"
                class="block"
                aria-label="打开漫画详情（新标签页）"
              >
                <div class="aspect-[3/4] w-full">
                  <img
                    src="${it.cover}"
                    alt="${it.title}"
                    class="h-full w-full object-cover"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                </div>
              </a>
              <button
                class="absolute right-1 top-1 z-10 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-brand-200"
                data-copy-id="${it.id}"
                type="button"
              >${it.id}</button>
            </div>

            <h3 class="mt-2 text-sm font-semibold leading-6 text-slate-900 dark:text-slate-100">
              <a
                href="${href}"
                target="_blank"
                rel="noreferrer noopener"
                class="underline-offset-2 hover:underline focus:outline-none focus:ring-4 focus:ring-brand-200"
              >${it.title}</a>
            </h3>

            ${statusChips ? `<div class="mt-2 flex flex-wrap gap-1.5">${statusChips}</div>` : ""}

              ${
                aliasText
                  ? `<div class="mt-1 text-xs text-slate-600 dark:text-slate-300">别名：${aliasText}</div>`
                  : ""
              }

              ${
                it.authors.length > 0
                  ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span class="text-slate-600 dark:text-slate-300">作者：</span>
                      ${authorChips}
                    </div>`
                  : ""
              }

              ${
                it.tags.length > 0
                  ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span class="text-slate-600 dark:text-slate-300">标签：</span>
                      ${tagChips}
                    </div>`
                  : ""
              }
          </div>
        </article>
      `;
    })
    .join("");

  resultMetaEl.textContent = `已显示 ${currentItems.length} 条（共 ${currentTotalMatches} 条）`;
  if (currentHasMore && !autoLoadSupported) loadMoreBtn.classList.remove("hidden");
  else loadMoreBtn.classList.add("hidden");
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "加载更多";
}

function renderLoading(text: string): void {
  resultsEl.innerHTML = `
    <div class="col-span-full rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div class="h-4 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
      <div class="mt-3 space-y-2">
        <div class="h-4 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
        <div class="h-4 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
        <div class="h-4 w-4/6 animate-pulse rounded bg-slate-200 dark:bg-slate-700"></div>
      </div>
      <div class="mt-3 text-xs text-slate-600 dark:text-slate-300">${text}</div>
    </div>
  `;
}

function toTagBits(): number[] {
  return [...selectedTagBits.values()].sort((a, b) => a - b);
}

function toExcludeTagBits(): number[] {
  return [...excludedTagBits.values()].sort((a, b) => a - b);
}

function getParams() {
  return {
    q: qInput.value.trim(),
    sort: sortSelect.value as SortMode,
    hidden: hiddenSelect.value as FilterMode,
    hideChapter: hideChapterSelect.value as FilterMode,
    tagBits: toTagBits(),
    excludeTagBits: toExcludeTagBits(),
  };
}

function shouldSkipSearch(params: ReturnType<typeof getParams>): boolean {
  const parts = params.q.trim().split(/\s+/u).filter(Boolean);
  const hasQuery = parts.some((p) => p.length >= 2);
  const hasFilters =
    params.tagBits.length > 0 ||
    params.excludeTagBits.length > 0 ||
    params.hidden !== "any" ||
    params.hideChapter !== "any";
  return !hasQuery && !hasFilters;
}

const worker = new Worker(new URL("./worker/searchWorker.ts", import.meta.url), { type: "module" });

function setStatusReady(): void {
  if (!generatedAt) {
    statusEl.textContent = `数据（共 ${totalCount} 条）`;
    return;
  }
  try {
    const dt = new Date(generatedAt);
    if (!Number.isNaN(dt.getTime())) {
      statusEl.textContent = `数据：${dt.toLocaleString()}（共 ${totalCount} 条）`;
      return;
    }
  } catch {
    // ignore
  }
  statusEl.textContent = `数据：${generatedAt}（共 ${totalCount} 条）`;
}

worker.onmessage = (ev: MessageEvent<WorkerOutMsg>) => {
  const msg = ev.data;
  if (msg.type === "progress") {
    statusEl.textContent = msg.stage;
    if (isInitializing) setLoadingOverlay(true, msg.stage);
    return;
  }
  if (msg.type === "ready") {
    tags = msg.tags;
    totalCount = msg.count;
    generatedAt = msg.generatedAt;
    isInitializing = false;
    setLoadingOverlay(false);

    selectedTagBits.clear();
    excludedTagBits.clear();
    const availableBits = new Set(tags.map((t) => t.bit));
    for (const bit of loadSelectedTagBits()) {
      if (availableBits.has(bit)) selectedTagBits.add(bit);
    }
    for (const bit of loadExcludedTagBits()) {
      if (!availableBits.has(bit)) continue;
      if (selectedTagBits.has(bit)) continue;
      excludedTagBits.add(bit);
    }

    setEnabled(true);
    renderTags();
    setStatusReady();
    if (!shouldSkipSearch(getParams())) doSearch(1);
    else renderResults();
    return;
  }
  if (msg.type === "results") {
    if (msg.requestId !== currentRequestId) return;
    loadingMore = false;
    currentHasMore = msg.hasMore;
    currentTotalMatches = msg.total;
    if (msg.page === 1) currentItems = msg.items;
    else currentItems = [...currentItems, ...msg.items];
    renderResults();
    setStatusReady();
    requestAnimationFrame(() => checkAutoLoad());
  }
};

worker.postMessage({ type: "init" });

let debounceTimer: number | null = null;
let composing = false;
function debouncedSearch(): void {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => doSearch(1), 220);
}

function doSearch(page: number): void {
  const params = getParams();
  if (page === 1) loadingMore = false;
  if (page === 1 && shouldSkipSearch(params)) {
    currentItems = [];
    currentTotalMatches = 0;
    currentHasMore = false;
    renderResults();
    setStatusReady();
    updateClearQBtn();
    return;
  }
  currentRequestId += 1;
  currentPage = page;
  statusEl.textContent = "搜索中…";
  const isLoadMore = page > 1;
  if (isLoadMore) {
    if (autoLoadSupported) loadingMore = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "加载中…";
  } else {
    currentTotalMatches = 0;
    resultMetaEl.textContent = "";
    loadMoreBtn.classList.add("hidden");
    loadMoreBtn.disabled = true;
    renderLoading("正在搜索…");
  }
  worker.postMessage({
    type: "search",
    requestId: currentRequestId,
    page,
    size: 20,
    ...params,
  });
}

qInput.addEventListener("input", (e) => {
  updateClearQBtn();
  if ((e as InputEvent).isComposing || composing) return;
  debouncedSearch();
});
qInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && !composing) doSearch(1);
});
qInput.addEventListener("compositionstart", () => {
  composing = true;
});
qInput.addEventListener("compositionend", () => {
  composing = false;
  updateClearQBtn();
  debouncedSearch();
});
clearQBtn.addEventListener("click", () => {
  qInput.value = "";
  updateClearQBtn();
  qInput.focus();
  doSearch(1);
});
searchBtn.addEventListener("click", () => doSearch(1));
sortSelect.addEventListener("change", () => {
  saveUiSettings();
  doSearch(1);
});
hiddenSelect.addEventListener("change", () => {
  saveUiSettings();
  doSearch(1);
});
hideChapterSelect.addEventListener("change", () => {
  saveUiSettings();
  doSearch(1);
});

toggleTagsBtn.addEventListener("click", () => {
  if (toggleTagsBtn.disabled) return;
  tagsExpanded = !tagsExpanded;
  renderTags();
});

clearTagsBtn.addEventListener("click", () => {
  if (selectedTagBits.size === 0 && excludedTagBits.size === 0) return;
  selectedTagBits.clear();
  excludedTagBits.clear();
  saveSelectedTagBits();
  saveExcludedTagBits();
  renderTags();
  doSearch(1);
});

tagList.addEventListener("click", (e) => {
  const t = e.target as HTMLElement | null;
  const btn = t?.closest<HTMLButtonElement>("button[data-tag-bit]");
  if (!btn) return;
  const bit = Number(btn.dataset.tagBit);
  if (!Number.isFinite(bit)) return;
  if (selectedTagBits.has(bit)) {
    selectedTagBits.delete(bit);
    excludedTagBits.add(bit);
  } else if (excludedTagBits.has(bit)) {
    excludedTagBits.delete(bit);
  } else {
    selectedTagBits.add(bit);
    excludedTagBits.delete(bit);
  }
  saveSelectedTagBits();
  saveExcludedTagBits();
  renderTags();
  doSearch(1);
});

resultsEl.addEventListener("click", async (e) => {
  const el = e.target as HTMLElement | null;
  if (!el) return;

  const copyBtn = el.closest<HTMLButtonElement>("button[data-copy-id]");
  if (copyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const id = copyBtn.dataset.copyId ?? "";
    try {
      await navigator.clipboard.writeText(id);
      toast(`已复制 ID：${id}`);
    } catch {
      toast("复制失败（浏览器限制）");
    }
    return;
  }

  const authorBtn = el.closest<HTMLButtonElement>("button[data-author]");
  if (authorBtn) {
    e.preventDefault();
    e.stopPropagation();
    const author = decodeURIComponent(authorBtn.dataset.author ?? "");
    qInput.value = author;
    selectedTagBits.clear();
    excludedTagBits.clear();
    saveSelectedTagBits();
    saveExcludedTagBits();
    renderTags();
    updateClearQBtn();
    doSearch(1);
    return;
  }

  const tagBtn = el.closest<HTMLButtonElement>("button[data-tag-id]");
  if (tagBtn) {
    e.preventDefault();
    e.stopPropagation();
    const tagId = Number(tagBtn.dataset.tagId);
    const tag = tags.find((x) => x.tagId === tagId);
    if (!tag) return;
    qInput.value = "";
    selectedTagBits.clear();
    excludedTagBits.clear();
    selectedTagBits.add(tag.bit);
    saveSelectedTagBits();
    saveExcludedTagBits();
    renderTags();
    updateClearQBtn();
    doSearch(1);
    return;
  }
});

loadMoreBtn.addEventListener("click", () => {
  if (!currentHasMore) return;
  doSearch(currentPage + 1);
});
