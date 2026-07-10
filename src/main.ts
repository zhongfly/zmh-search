import "./styles.css";

import type { FilterMode, SortMode, TagInfo, WorkerOutMsg, WorkerResultsMsg } from "./shared/workerProtocol";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("找不到 #app");

app.innerHTML = `
  <main class="zmh-page">
    <header class="mb-4 flex flex-col gap-2.5 border-b border-heritage/15 pb-4 dark:border-paper/10 sm:mb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:pb-5">
      <div>
        <h1 class="text-xl font-bold text-ink dark:text-paper sm:text-2xl">再漫画搜索</h1>
        <p class="mt-1 max-w-2xl text-[11px] leading-4 text-heritage-muted dark:text-paper/60 sm:mt-2 sm:text-xs sm:leading-5">
          本网站与再漫画官方无关，仅用于学习研究，漫画信息仅供参考，可能与实际不符
        </p>
      </div>
      <div class="flex items-center justify-between gap-2 sm:justify-end">
        <div class="rounded-full border border-heritage/20 bg-paper-panel/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-heritage-muted shadow-sm dark:border-paper/10 dark:bg-heritage/25 dark:text-paper/60 sm:text-xs sm:leading-5" aria-live="polite" data-role="status">
          正在初始化…
        </div>
        <div class="zmh-view-toggle shrink-0" role="group" aria-label="主题" data-role="themeToggle">
          <button class="zmh-view-button whitespace-nowrap" type="button" data-theme="auto">自动</button>
          <button class="zmh-view-button whitespace-nowrap" type="button" data-theme="light">浅色</button>
          <button class="zmh-view-button whitespace-nowrap" type="button" data-theme="dark">深色</button>
        </div>
      </div>
    </header>

    <section class="zmh-panel p-4 sm:p-5" data-role="filtersPanel">
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label class="flex-1">
            <span class="sr-only">搜索</span>
            <div class="relative">
              <input
                class="zmh-search-input"
                placeholder="输入关键词（至少 2 个字符），支持 -关键词 排除（例：贵族 -反派）"
                autocomplete="off"
                inputmode="search"
                data-role="q"
                disabled
              />
              <button
                class="zmh-icon-button absolute right-2 top-1/2 hidden -translate-y-1/2"
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
        </div>

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-heritage-muted dark:text-paper/60">隐藏漫画</span>
            <select
              class="zmh-control"
              data-role="hidden"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">否</option>
              <option value="only1">是</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-heritage-muted dark:text-paper/60">章节被隐藏</span>
            <select
              class="zmh-control"
              data-role="hideChapter"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">否</option>
              <option value="only1">是</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-heritage-muted dark:text-paper/60">需要登录</span>
            <select
              class="zmh-control"
              data-role="needLogin"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">否</option>
              <option value="only1">是</option>
            </select>
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-heritage-muted dark:text-paper/60">是否下架</span>
            <select
              class="zmh-control"
              data-role="lock"
              disabled
            >
              <option value="any">所有</option>
              <option value="only0">未下架</option>
              <option value="only1">已下架</option>
            </select>
          </label>
        </div>

      <div>
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="text-xs font-medium text-heritage-muted dark:text-paper/60">标签筛选（点击切换包含 / 排除 / 不限）</div>
          </div>
          <button
            class="zmh-subtle-button"
            data-role="clearTags"
            disabled
          >
            清空标签
          </button>
        </div>
        <div class="flex items-start gap-2">
          <div id="tagList" class="zmh-tag-list" data-role="tagList"></div>
          <button
            class="zmh-more-button hidden"
            data-role="toggleTags"
            type="button"
            disabled
            aria-expanded="false"
            aria-controls="tagList"
          >
            <span data-role="toggleTagsText">更多</span>
          </button>
        </div>
      </div>
      </div>
    </section>

    <section class="mt-6">
      <div class="flex flex-col gap-3 border-b border-heritage/15 pb-3 dark:border-paper/10 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-bold text-ink dark:text-paper">结果</h2>
          <div class="text-xs font-medium text-heritage-muted dark:text-paper/50" data-role="resultMeta"></div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="zmh-view-toggle" role="group" aria-label="结果视图">
            <button
              class="zmh-view-button"
              data-role="viewList"
              type="button"
              aria-pressed="false"
              disabled
            >
              列表
            </button>
            <button
              class="zmh-view-button"
              data-role="viewGrid"
              type="button"
              aria-pressed="false"
              disabled
            >
              网格
            </button>
          </div>
          <label class="flex items-center gap-2">
            <span class="text-xs font-medium text-heritage-muted dark:text-paper/60">排序</span>
            <select
              class="zmh-control"
              data-role="sort"
              disabled
            >
              <option value="relevance">相关性</option>
              <option value="id_desc">上架时间从新到旧</option>
              <option value="id_asc">上架时间从旧到新</option>
            </select>
          </label>
        </div>
      </div>
      <div class="mt-3" data-role="results"></div>
      <div class="mt-4 flex justify-center">
        <button
          class="zmh-control hidden px-4"
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
      <div class="rounded-xl bg-heritage px-3 py-2 text-xs font-medium text-paper shadow-lg dark:bg-gold dark:text-ink" data-role="toastText"></div>
    </div>

    <button
      class="zmh-back-top-button"
      data-role="backTop"
      type="button"
      aria-label="回到顶部"
      aria-hidden="true"
      tabindex="-1"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
        <path d="M12 6 4.5 16.5h15L12 6Z" />
      </svg>
    </button>

    <div
      class="fixed inset-0 z-[60] flex cursor-wait items-center justify-center bg-paper/80 px-4 text-ink backdrop-blur-sm transition-opacity duration-200 dark:bg-ink/80 dark:text-paper"
      data-role="loadingOverlay"
      aria-hidden="false"
    >
      <div class="zmh-panel w-full max-w-sm p-4">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 h-10 w-10 shrink-0 rounded-full border-4 border-heritage/15 border-t-heritage animate-spin motion-reduce:animate-none dark:border-paper/10 dark:border-t-gold"></div>
          <div class="min-w-0">
            <div class="text-sm font-semibold">正在加载索引…</div>
            <div
              class="mt-1 text-xs text-heritage-muted dark:text-paper/60"
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
const needLoginSelect = qs<HTMLSelectElement>('[data-role="needLogin"]');
const lockSelect = qs<HTMLSelectElement>('[data-role="lock"]');
const tagList = qs<HTMLDivElement>('[data-role="tagList"]');
const toggleTagsBtn = qs<HTMLButtonElement>('[data-role="toggleTags"]');
const toggleTagsTextEl = toggleTagsBtn.querySelector<HTMLSpanElement>('[data-role="toggleTagsText"]');
if (!toggleTagsTextEl) throw new Error("找不到 data-role=toggleTagsText");
const toggleTagsText = toggleTagsTextEl;
const clearTagsBtn = qs<HTMLButtonElement>('[data-role="clearTags"]');
const filtersPanelEl = qs<HTMLElement>('[data-role="filtersPanel"]');
const statusEl = qs<HTMLDivElement>('[data-role="status"]');
const resultsEl = qs<HTMLDivElement>('[data-role="results"]');
const resultMetaEl = qs<HTMLDivElement>('[data-role="resultMeta"]');
const viewListBtn = qs<HTMLButtonElement>('[data-role="viewList"]');
const viewGridBtn = qs<HTMLButtonElement>('[data-role="viewGrid"]');
const loadMoreBtn = qs<HTMLButtonElement>('[data-role="loadMore"]');
const sentinelEl = qs<HTMLDivElement>('[data-role="sentinel"]');
const toastEl = qs<HTMLDivElement>('[data-role="toast"]');
const toastTextEl = qs<HTMLDivElement>('[data-role="toastText"]');
const backTopBtn = qs<HTMLButtonElement>('[data-role="backTop"]');
const loadingOverlayEl = qs<HTMLDivElement>('[data-role="loadingOverlay"]');
const loadingStageEl = qs<HTMLDivElement>('[data-role="loadingStage"]');
const themeToggleBtn = qs<HTMLDivElement>('[data-role="themeToggle"]');

const STORAGE_KEY_THEME = "zmh-search:theme:v1";
type ThemeMode = "auto" | "light" | "dark";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

function loadThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_THEME);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return "auto";
}

let themeMode: ThemeMode = loadThemeMode();

function applyTheme(): void {
  const dark = themeMode === "dark" || (themeMode === "auto" && darkMedia.matches);
  const update = () => document.documentElement.classList.toggle("dark", dark);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // ponytail: 原生 View Transitions 做主题交叉淡入，不支持的浏览器直接切换
  if (!reduceMotion && dark !== document.documentElement.classList.contains("dark") && document.startViewTransition) {
    document.startViewTransition(update);
  } else {
    update();
  }
  for (const btn of themeToggleBtn.querySelectorAll<HTMLButtonElement>("button[data-theme]")) {
    const active = btn.dataset.theme === themeMode;
    btn.classList.toggle("zmh-view-button-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

themeToggleBtn.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-theme]");
  if (!btn) return;
  themeMode = btn.dataset.theme as ThemeMode;
  try {
    if (themeMode === "auto") localStorage.removeItem(STORAGE_KEY_THEME);
    else localStorage.setItem(STORAGE_KEY_THEME, themeMode);
  } catch {
    // ignore
  }
  applyTheme();
});
darkMedia.addEventListener("change", () => {
  if (themeMode === "auto") applyTheme();
});
applyTheme();

const STORAGE_KEY_SELECTED_TAG_IDS = "zmh-search:selectedTagIds:v2";
const STORAGE_KEY_EXCLUDED_TAG_IDS = "zmh-search:excludedTagIds:v2";
const STORAGE_KEY_UI_SETTINGS = "zmh-search:uiSettings:v1";
const STORAGE_KEY_RESULT_VIEW_MODE = "zmh-search:resultViewMode:v1";

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

type ResultViewMode = "list" | "grid";

type PerfMs = number | null;
let initStartMs = 0;
let initMs: PerfMs = null;
let activeSearchRequestId: number | null = null;
let activeSearchStartMs: number | null = null;
let lastSearchMs: PerfMs = null;

const autoLoadSupported = "IntersectionObserver" in window;
let resultViewMode: ResultViewMode = loadResultViewMode();
let tagFocusFrame: number | null = null;
let backTopFrame: number | null = null;

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function loadStoredInts(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => Number.isInteger(x)).map((x) => Number(x)).filter((x) => x >= 0);
  } catch {
    return [];
  }
}

function saveStoredInts(key: string, values: Iterable<number>): void {
  try {
    const items = [...values].sort((a, b) => a - b);
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function getDefaultResultViewMode(): ResultViewMode {
  const smallScreen = window.matchMedia?.("(max-width: 639px)").matches === true;
  return smallScreen ? "list" : "grid";
}

function loadResultViewMode(): ResultViewMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RESULT_VIEW_MODE);
    if (raw === "list" || raw === "grid") return raw;
  } catch {
    // ignore
  }
  return getDefaultResultViewMode();
}

function saveResultViewMode(mode: ResultViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_RESULT_VIEW_MODE, mode);
  } catch {
    // ignore
  }
}

function loadSelectedTagIds(): number[] {
  return loadStoredInts(STORAGE_KEY_SELECTED_TAG_IDS);
}

function loadExcludedTagIds(): number[] {
  return loadStoredInts(STORAGE_KEY_EXCLUDED_TAG_IDS);
}

function tagIdsFromBits(bits: Iterable<number>): number[] {
  const tagIdByBit = new Map(tags.map((t) => [t.bit, t.tagId] as const));
  const out: number[] = [];
  for (const bit of bits) {
    const tagId = tagIdByBit.get(bit);
    if (tagId !== undefined) out.push(tagId);
  }
  return out;
}

function restoreStoredTagBits(target: Set<number>, tagIds: number[], blocked?: Set<number>): void {
  const bitByTagId = new Map(tags.map((t) => [t.tagId, t.bit] as const));
  for (const tagId of tagIds) {
    const bit = bitByTagId.get(tagId);
    if (bit === undefined) continue;
    if (blocked?.has(bit)) continue;
    target.add(bit);
  }
}

function saveSelectedTagIds(): void {
  saveStoredInts(STORAGE_KEY_SELECTED_TAG_IDS, tagIdsFromBits(selectedTagBits.values()));
}

function saveExcludedTagIds(): void {
  saveStoredInts(STORAGE_KEY_EXCLUDED_TAG_IDS, tagIdsFromBits(excludedTagBits.values()));
}

function loadUiSettings(): Partial<{
  sort: SortMode;
  hidden: FilterMode;
  hideChapter: FilterMode;
  needLogin: FilterMode;
  lock: FilterMode;
}> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UI_SETTINGS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<{
      sort: SortMode;
      hidden: FilterMode;
      hideChapter: FilterMode;
      needLogin: FilterMode;
      lock: FilterMode;
    }> = {};

    const sort = parsed?.sort;
    if (sort === "relevance" || sort === "id_desc" || sort === "id_asc") out.sort = sort;

    const hidden = parsed?.hidden;
    if (hidden === "any" || hidden === "only0" || hidden === "only1") out.hidden = hidden;

    const hideChapter = parsed?.hideChapter;
    if (hideChapter === "any" || hideChapter === "only0" || hideChapter === "only1")
      out.hideChapter = hideChapter;

    const needLogin = parsed?.needLogin;
    if (needLogin === "any" || needLogin === "only0" || needLogin === "only1")
      out.needLogin = needLogin;

    const lock = parsed?.lock;
    if (lock === "any" || lock === "only0" || lock === "only1") out.lock = lock;

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
      needLogin: needLoginSelect.value as FilterMode,
      lock: lockSelect.value as FilterMode,
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
if (restoredSettings.needLogin) needLoginSelect.value = restoredSettings.needLogin;
if (restoredSettings.lock) lockSelect.value = restoredSettings.lock;

function parseIdList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0);
}

const initialUrlParams = new URLSearchParams(location.search);
const urlTagIds = parseIdList(initialUrlParams.get("tags"));
const urlExcludedTagIds = parseIdList(initialUrlParams.get("xtags"));
const urlHasTagState = initialUrlParams.has("tags") || initialUrlParams.has("xtags");
{
  const q = initialUrlParams.get("q");
  if (q) qInput.value = q;
  const sort = initialUrlParams.get("sort");
  if (sort === "relevance" || sort === "id_desc" || sort === "id_asc") sortSelect.value = sort;
  for (const [key, select] of [
    ["hidden", hiddenSelect],
    ["hideChapter", hideChapterSelect],
    ["needLogin", needLoginSelect],
    ["lock", lockSelect],
  ] as const) {
    const v = initialUrlParams.get(key);
    if (v === "any" || v === "only0" || v === "only1") select.value = v;
  }
}

function syncUrl(): void {
  const params = new URLSearchParams();
  const q = qInput.value.trim();
  if (q) params.set("q", q);
  if (sortSelect.value !== "relevance") params.set("sort", sortSelect.value);
  for (const [key, select] of [
    ["hidden", hiddenSelect],
    ["hideChapter", hideChapterSelect],
    ["needLogin", needLoginSelect],
    ["lock", lockSelect],
  ] as const) {
    if (select.value !== "any") params.set(key, select.value);
  }
  const tagIds = tagIdsFromBits(selectedTagBits.values()).sort((a, b) => a - b);
  const xtagIds = tagIdsFromBits(excludedTagBits.values()).sort((a, b) => a - b);
  if (tagIds.length > 0) params.set("tags", tagIds.join(","));
  if (xtagIds.length > 0) params.set("xtags", xtagIds.join(","));
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

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

function updateBackTopVisibility(): void {
  const shouldShow = filtersPanelEl.getBoundingClientRect().bottom < 0;
  if (!shouldShow && document.activeElement === backTopBtn) backTopBtn.blur();
  backTopBtn.classList.toggle("zmh-back-top-button-visible", shouldShow);
  backTopBtn.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  backTopBtn.tabIndex = shouldShow ? 0 : -1;
}

function scheduleBackTopVisibilityUpdate(): void {
  if (backTopFrame !== null) window.cancelAnimationFrame(backTopFrame);
  backTopFrame = window.requestAnimationFrame(() => {
    backTopFrame = null;
    updateBackTopVisibility();
  });
}

function applyResultViewMode(mode: ResultViewMode, persist: boolean): void {
  resultViewMode = mode;
  if (persist) saveResultViewMode(mode);

  resultsEl.classList.toggle("zmh-results-list", mode === "list");
  resultsEl.classList.toggle("zmh-results-grid", mode === "grid");

  viewListBtn.setAttribute("aria-pressed", mode === "list" ? "true" : "false");
  viewGridBtn.setAttribute("aria-pressed", mode === "grid" ? "true" : "false");
  viewListBtn.classList.toggle("zmh-view-button-active", mode === "list");
  viewGridBtn.classList.toggle("zmh-view-button-active", mode === "grid");
}

applyResultViewMode(resultViewMode, false);
setLoadingOverlay(true);

function setEnabled(enabled: boolean): void {
  for (const el of [
    qInput,
    sortSelect,
    hiddenSelect,
    hideChapterSelect,
    needLoginSelect,
    lockSelect,
    viewListBtn,
    viewGridBtn,
  ]) {
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
    updateToggleTagsBtn();
  }
}

function updateToggleTagsBtn(): void {
  const canToggle = tags.length > 0;
  toggleTagsBtn.disabled = !canToggle;
  if (canToggle) toggleTagsBtn.classList.remove("hidden");
  else toggleTagsBtn.classList.add("hidden");
  toggleTagsBtn.setAttribute("aria-expanded", tagsExpanded ? "true" : "false");
  toggleTagsText.textContent = tagsExpanded ? "收起" : "更多";
  if (tagsExpanded) tagList.classList.remove("zmh-tag-list-collapsed");
  else tagList.classList.add("zmh-tag-list-collapsed");
  syncCollapsedTagFocus();
}

function orderedTagsForDisplay(): TagInfo[] {
  return [...tags].sort((a, b) => {
    const aPriority = selectedTagBits.has(a.bit) ? 0 : excludedTagBits.has(a.bit) ? 1 : 2;
    const bPriority = selectedTagBits.has(b.bit) ? 0 : excludedTagBits.has(b.bit) ? 1 : 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return 0;
  });
}

function syncCollapsedTagFocus(): void {
  const buttons = tagList.querySelectorAll<HTMLButtonElement>("button[data-tag-bit]");
  if (tagsExpanded) {
    for (const btn of buttons) {
      btn.removeAttribute("tabindex");
      btn.removeAttribute("aria-hidden");
    }
    return;
  }

  const listRect = tagList.getBoundingClientRect();
  for (const btn of buttons) {
    const rect = btn.getBoundingClientRect();
    const visible = rect.top >= listRect.top - 1 && rect.bottom <= listRect.bottom + 1;
    if (visible) {
      btn.removeAttribute("tabindex");
      btn.removeAttribute("aria-hidden");
    } else {
      btn.tabIndex = -1;
      btn.setAttribute("aria-hidden", "true");
    }
  }
}

function scheduleCollapsedTagFocusSync(): void {
  if (tagFocusFrame !== null) window.cancelAnimationFrame(tagFocusFrame);
  tagFocusFrame = window.requestAnimationFrame(() => {
    tagFocusFrame = null;
    syncCollapsedTagFocus();
  });
}

function renderTags(): void {
  tagList.innerHTML = orderedTagsForDisplay()
    .map((t) => {
      const included = selectedTagBits.has(t.bit);
      const excluded = excludedTagBits.has(t.bit);
      const stateClass = included ? "zmh-chip-selected" : excluded ? "zmh-chip-excluded" : "";
      const marker = included ? "+" : excluded ? "-" : "";
      const nameClass = excluded ? "line-through decoration-2 decoration-rose-500 dark:decoration-rose-300" : "";
      return `
        <button
          class="zmh-chip ${stateClass}"
          data-tag-bit="${t.bit}"
          type="button"
        >
          ${marker ? `<span class="font-semibold">${marker}</span>` : ""}
          <span class="${nameClass}">${escapeHtml(t.name)}</span>
          <span class="text-heritage-muted/60 dark:text-paper/40">${t.count}</span>
        </button>
      `;
    })
    .join("");
  clearTagsBtn.disabled = selectedTagBits.size === 0 && excludedTagBits.size === 0;
  updateToggleTagsBtn();
  scheduleCollapsedTagFocusSync();
}

function updateClearQBtn(): void {
  const canShow = !qInput.disabled && qInput.value.trim().length > 0;
  clearQBtn.disabled = !canShow;
  if (canShow) clearQBtn.classList.remove("hidden");
  else clearQBtn.classList.add("hidden");
}

function renderResultCard(it: WorkerResultsMsg["items"][number]): string {
  const aliasText = it.aliases.length > 0 ? it.aliases.join(" / ") : "";
  const aliasTextEscaped = escapeHtml(aliasText);
  const statusChips = [
    it.hidden ? `<span class="zmh-status-chip">隐藏漫画</span>` : "",
    it.isHideChapter ? `<span class="zmh-status-chip">章节被隐藏</span>` : "",
    it.needLogin ? `<span class="zmh-status-chip">需要登录</span>` : "",
    it.isLock ? `<span class="zmh-status-chip">已下架</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const authorChips = it.authors
    .map(
      (a) => `
        <button
          class="zmh-link-chip"
          data-author="${encodeURIComponent(a)}"
          type="button"
        >${escapeHtml(a)}</button>
      `,
    )
    .join("");
  const tagChips = it.tags
    .map(
      (t) => `
        <button
          class="zmh-tag-link-chip"
          data-tag-id="${t.tagId}"
          type="button"
        >${escapeHtml(t.name)}</button>
      `,
    )
    .join("");

  const href = `https://m.zaimanhua.com/pages/comic/detail?id=${it.id}`;
  const titleEscaped = escapeHtml(it.title);
  const coverEscaped = escapeHtml(it.cover);

  return `
    <article
      class="zmh-result-card group"
      data-comic-id="${it.id}"
    >
      <div class="zmh-result-card-body">
        <div class="zmh-cover-shell zmh-result-cover">
          <a
            href="${href}"
            target="_blank"
            rel="noreferrer noopener"
            class="block"
            aria-label="打开漫画详情（新标签页）"
          >
            <div class="zmh-cover-aspect">
              <img
                src="${coverEscaped}"
                alt="${titleEscaped}"
                class="zmh-cover-img h-full w-full object-cover"
                loading="lazy"
                referrerpolicy="no-referrer"
              />
            </div>
          </a>
          <button
            class="zmh-cover-id-button absolute right-1.5 top-1.5 z-10 rounded-lg bg-ink/80 px-2 py-1 text-[11px] font-semibold text-paper backdrop-blur transition-colors hover:bg-heritage active:translate-y-0 focus:outline-none focus:ring-4 focus:ring-gold/25 dark:bg-ink/80 dark:hover:bg-gold dark:hover:text-ink"
            data-copy-id="${it.id}"
            type="button"
          >${it.id}</button>
        </div>

        <div class="zmh-result-content">
          <div class="zmh-result-title-row">
            <button
              class="zmh-inline-id-button"
              data-copy-id="${it.id}"
              type="button"
            >${it.id}</button>
            <h3 class="zmh-result-title text-sm font-bold leading-5 text-ink dark:text-paper">
              <a
                href="${href}"
                target="_blank"
                rel="noreferrer noopener"
                class="zmh-line-clamp-2 rounded underline-offset-4 transition-colors hover:text-heritage hover:underline focus:outline-none focus:ring-4 focus:ring-gold/25 dark:hover:text-gold-light dark:focus:ring-gold/20"
              >${titleEscaped}</a>
            </h3>
          </div>

          ${statusChips ? `<div class="mt-2 flex flex-wrap gap-1.5">${statusChips}</div>` : ""}

          ${
            aliasText
              ? `<div class="mt-2 text-xs leading-5 text-heritage-muted dark:text-paper/60">
                  <span class="font-medium text-heritage-muted/60 dark:text-paper/40">别名：</span>
                  <span>${aliasTextEscaped}</span>
                </div>`
              : ""
          }

          ${
            it.authors.length > 0
              ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="font-medium text-heritage-muted/60 dark:text-paper/40">作者：</span>
                  ${authorChips}
                </div>`
              : ""
          }

          ${
            it.tags.length > 0
              ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="shrink-0 font-medium text-heritage-muted/60 dark:text-paper/40">标签：</span>
                  ${tagChips}
                </div>
              `
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

const COVER_FALLBACK_HTML = `<div class="flex h-full w-full items-center justify-center text-xs text-heritage-muted/60 dark:text-paper/40" aria-hidden="true">无封面</div>`;

function markCoverFailed(img: HTMLImageElement): void {
  const shell = img.closest(".zmh-cover-aspect");
  if (shell) shell.innerHTML = COVER_FALLBACK_HTML;
}

resultsEl.addEventListener(
  "load",
  (e) => {
    const img = e.target as HTMLElement;
    if (img instanceof HTMLImageElement && img.classList.contains("zmh-cover-img")) {
      img.classList.add("zmh-cover-loaded");
    }
  },
  true,
);
resultsEl.addEventListener(
  "error",
  (e) => {
    const img = e.target as HTMLElement;
    if (img instanceof HTMLImageElement && img.classList.contains("zmh-cover-img")) {
      markCoverFailed(img);
    }
  },
  true,
);

function hydrateCovers(): void {
  for (const img of resultsEl.querySelectorAll<HTMLImageElement>("img.zmh-cover-img:not(.zmh-cover-loaded)")) {
    if (!img.complete) continue;
    if (img.naturalWidth > 0) img.classList.add("zmh-cover-loaded");
    else markCoverFailed(img);
  }
}

function updateResultControls(): void {
  resultMetaEl.textContent = `已显示 ${currentItems.length.toLocaleString()} 条（共 ${currentTotalMatches.toLocaleString()} 条）`;
  if (currentHasMore && !autoLoadSupported) loadMoreBtn.classList.remove("hidden");
  else loadMoreBtn.classList.add("hidden");
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "加载更多";
}

function appendResults(items: WorkerResultsMsg["items"]): void {
  if (items.length > 0) resultsEl.insertAdjacentHTML("beforeend", items.map(renderResultCard).join(""));
  hydrateCovers();
  updateResultControls();
}

function renderResults(): void {
  if (currentItems.length === 0) {
    const idle = shouldSkipSearch(getParams());
    const title = idle ? "开始搜索" : "没有匹配的漫画";
    const hint = idle
      ? "输入关键词（至少 2 个字符），或选择标签和筛选条件。"
      : "换个关键词试试，或调整标签和筛选条件。";
    resultsEl.innerHTML = `
      <div class="zmh-empty-state col-span-full p-6 text-sm">
        <div class="font-semibold text-ink dark:text-paper">${title}</div>
        <div class="mt-1 text-xs text-heritage-muted dark:text-paper/50">${hint}</div>
      </div>
    `;
    resultMetaEl.textContent = "";
    loadMoreBtn.classList.add("hidden");
    return;
  }

  resultsEl.innerHTML = currentItems.map(renderResultCard).join("");
  hydrateCovers();
  updateResultControls();
}

function renderLoading(text: string): void {
  resultsEl.innerHTML = `
    ${Array.from({ length: 8 })
      .map(
        () => `
          <div class="zmh-result-card">
            <div class="zmh-result-card-body">
              <div class="zmh-result-cover">
                <div class="zmh-cover-aspect motion-safe:animate-pulse rounded-lg bg-heritage/10 dark:bg-paper/10"></div>
              </div>
              <div class="zmh-result-content">
                <div class="h-4 w-5/6 motion-safe:animate-pulse rounded bg-heritage/10 dark:bg-paper/10"></div>
                <div class="mt-2 h-3 w-3/5 motion-safe:animate-pulse rounded bg-gold/10 dark:bg-gold/10"></div>
                <div class="mt-3 h-3 w-4/5 motion-safe:animate-pulse rounded bg-heritage/10 dark:bg-paper/10"></div>
              </div>
            </div>
          </div>
        `,
      )
      .join("")}
    <div class="zmh-results-message text-xs font-medium text-heritage-muted dark:text-paper/50">${escapeHtml(text)}</div>
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
    needLogin: needLoginSelect.value as FilterMode,
    lock: lockSelect.value as FilterMode,
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
    params.hideChapter !== "any" ||
    params.needLogin !== "any" ||
    params.lock !== "any";
  return !hasQuery && !hasFilters;
}

const worker = new Worker(new URL("./worker/searchWorker.ts", import.meta.url), { type: "module" });

function setStatusReady(): void {
  const perf: string[] = [];
  if (initMs !== null) perf.push(`init ${Math.round(initMs)}ms`);
  if (lastSearchMs !== null) perf.push(`search ${Math.round(lastSearchMs)}ms`);
  const perfText = perf.length > 0 ? `，${perf.join("，")}` : "";

  if (!generatedAt) {
    statusEl.textContent = `数据（共 ${totalCount.toLocaleString()} 条${perfText}）`;
    return;
  }
  try {
    const dt = new Date(generatedAt);
    if (!Number.isNaN(dt.getTime())) {
      statusEl.textContent = `数据：${dt.toLocaleString()}（共 ${totalCount.toLocaleString()} 条${perfText}）`;
      return;
    }
  } catch {
    // ignore
  }
  statusEl.textContent = `数据：${generatedAt}（共 ${totalCount.toLocaleString()} 条${perfText}）`;
}

worker.onmessage = (ev: MessageEvent<WorkerOutMsg>) => {
  const msg = ev.data;
  if (msg.type === "progress") {
    statusEl.textContent = msg.stage;
    if (isInitializing) setLoadingOverlay(true, msg.stage);
    return;
  }
  if (msg.type === "ready") {
    initMs = initStartMs > 0 ? performance.now() - initStartMs : null;
    tags = msg.tags;
    totalCount = msg.count;
    generatedAt = msg.generatedAt;
    isInitializing = false;
    setLoadingOverlay(false);

    selectedTagBits.clear();
    excludedTagBits.clear();
    if (urlHasTagState) {
      restoreStoredTagBits(selectedTagBits, urlTagIds);
      restoreStoredTagBits(excludedTagBits, urlExcludedTagIds, selectedTagBits);
      saveSelectedTagIds();
      saveExcludedTagIds();
    } else {
      restoreStoredTagBits(selectedTagBits, loadSelectedTagIds());
      restoreStoredTagBits(excludedTagBits, loadExcludedTagIds(), selectedTagBits);
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
    if (activeSearchRequestId === msg.requestId && activeSearchStartMs !== null) {
      lastSearchMs = performance.now() - activeSearchStartMs;
    }
    loadingMore = false;
    currentHasMore = msg.hasMore;
    currentTotalMatches = msg.total;
    if (msg.page === 1) {
      currentItems = msg.items;
      renderResults();
    } else {
      currentItems = [...currentItems, ...msg.items];
      appendResults(msg.items);
    }
    setStatusReady();
    requestAnimationFrame(() => checkAutoLoad());
  }
};

initStartMs = performance.now();
worker.postMessage({ type: "init" });

let debounceTimer: number | null = null;
let composing = false;
function debouncedSearch(): void {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => doSearch(1), 220);
}

function doSearch(page: number): void {
  const params = getParams();
  if (page === 1) {
    // 避免切换筛选/关键词后仍用旧的 hasMore 触发自动加载，导致跳过第 1 页并混入旧结果
    loadingMore = false;
    currentHasMore = false;
    currentItems = [];
    syncUrl();
  }
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
  activeSearchRequestId = currentRequestId;
  activeSearchStartMs = performance.now();
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
viewListBtn.addEventListener("click", () => applyResultViewMode("list", true));
viewGridBtn.addEventListener("click", () => applyResultViewMode("grid", true));
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
needLoginSelect.addEventListener("change", () => {
  saveUiSettings();
  doSearch(1);
});
lockSelect.addEventListener("change", () => {
  saveUiSettings();
  doSearch(1);
});

toggleTagsBtn.addEventListener("click", () => {
  if (toggleTagsBtn.disabled) return;
  tagsExpanded = !tagsExpanded;
  updateToggleTagsBtn();
});

clearTagsBtn.addEventListener("click", () => {
  if (selectedTagBits.size === 0 && excludedTagBits.size === 0) return;
  selectedTagBits.clear();
  excludedTagBits.clear();
  saveSelectedTagIds();
  saveExcludedTagIds();
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
  saveSelectedTagIds();
  saveExcludedTagIds();
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
    saveSelectedTagIds();
    saveExcludedTagIds();
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
    saveSelectedTagIds();
    saveExcludedTagIds();
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

backTopBtn.addEventListener("click", () => {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
});

window.addEventListener("scroll", scheduleBackTopVisibilityUpdate, { passive: true });
window.addEventListener("resize", () => {
  scheduleBackTopVisibilityUpdate();
  scheduleCollapsedTagFocusSync();
});
scheduleBackTopVisibilityUpdate();
