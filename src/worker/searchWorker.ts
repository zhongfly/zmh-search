type AssetRef = { path: string; sha256: string; bytes: number };

type Manifest = {
  version: number;
  generatedAt: string;
  stats: { count: number; uniqueTokens: number; indexBytes: number; version: number };
  assets: {
    meta: AssetRef;
    dict: AssetRef;
    tags: AssetRef;
    index: AssetRef;
  };
};

type TagsJson = {
  version: number;
  tags: Array<{ tagId: number; name: string; count: number; bit: number }>;
};

type DictBin = {
  n: number;
  keys: Uint32Array;
  offsets: Uint32Array;
  lengths: Uint32Array;
  dfs: Uint32Array;
};

type MetaBin = {
  count: number;
  sep: string;
  ids: Int32Array;
  tagLo: Uint32Array;
  tagHi: Uint32Array;
  flags: Uint8Array;
  titlesOffsets: Uint32Array;
  titlesPool: Uint8Array;
  coversOffsets: Uint32Array;
  coversPool: Uint8Array;
  authorsOffsets: Uint32Array;
  authorsPool: Uint8Array;
  aliasesOffsets: Uint32Array;
  aliasesPool: Uint8Array;
};

type FilterMode = "any" | "only0" | "only1";
type SortMode = "relevance" | "id_desc" | "id_asc";

type InitMessage = { type: "init" };
type SearchMessage = {
  type: "search";
  requestId: number;
  q: string;
  tagBits: number[];
  excludeTagBits: number[];
  hidden: FilterMode;
  hideChapter: FilterMode;
  sort: SortMode;
  page: number;
  size: number;
};

type InMessage = InitMessage | SearchMessage;

type ReadyMessage = {
  type: "ready";
  count: number;
  tags: TagsJson["tags"];
  generatedAt: string;
};

type ProgressMessage = { type: "progress"; stage: string };

type ResultItem = {
  id: number;
  title: string;
  cover: string;
  aliases: string[];
  authors: string[];
  tags: Array<{ tagId: number; name: string }>;
  hidden: boolean;
  isHideChapter: boolean;
};

type ResultsMessage = {
  type: "results";
  requestId: number;
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
  items: ResultItem[];
};

type OutMessage = ReadyMessage | ProgressMessage | ResultsMessage;

const DB_NAME = "zmh-search-cache";
const DB_VERSION = 1;
const STORE_FILES = "files";

type StoredFile = { key: string; data: ArrayBuffer };

function post(msg: OutMessage): void {
  // eslint-disable-next-line no-restricted-globals
  postMessage(msg);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readonly");
    const store = tx.objectStore(STORE_FILES);
    const req = store.get(key);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
    req.onsuccess = () => {
      const row = req.result as StoredFile | undefined;
      resolve(row?.data ?? null);
    };
  });
}

function idbPut(db: IDBDatabase, key: string, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    const store = tx.objectStore(STORE_FILES);
    const req = store.put({ key, data } satisfies StoredFile);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 写入失败"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
  });
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function loadAsset(db: IDBDatabase, asset: AssetRef): Promise<ArrayBuffer> {
  const cached = await idbGet(db, asset.sha256);
  if (cached) return cached;
  const buf = await fetchArrayBuffer(`/${asset.path}`);
  await idbPut(db, asset.sha256, buf);
  return buf;
}

const DECODER = new TextDecoder("utf-8");

function decodeUtf8(buf: ArrayBuffer): string {
  return DECODER.decode(buf);
}

const ALNUM_RE = /[\p{Letter}\p{Number}]/u;
function normText(text: string): string {
  if (!text) return "";
  const t = text.normalize("NFKC").toLowerCase();
  let out = "";
  for (const ch of t) {
    if (ALNUM_RE.test(ch)) out += ch;
  }
  return out;
}

type ParsedQuery = { include: string[]; exclude: string[] };

const WS_SPLIT_RE = /\s+/u;
function parseQuery(raw: string): ParsedQuery {
  const parts = raw.trim().split(WS_SPLIT_RE).filter(Boolean);
  const include = new Set<string>();
  const exclude = new Set<string>();
  for (const p of parts) {
    const head = p[0] ?? "";
    const isExclude = (head === "-" || head === "－") && p.length > 1;
    const body = isExclude ? p.slice(1) : p;
    const n = normText(body);
    if (n.length < 2) continue;
    if (isExclude) exclude.add(n);
    else include.add(n);
  }
  const excludeTerms = [...exclude].sort();
  const includeTerms = [...include].filter((t) => !exclude.has(t)).sort();
  return { include: includeTerms, exclude: excludeTerms };
}

function uniqNgrams(text: string, n: number): string[] {
  if (text.length < n) return [];
  const set = new Set<string>();
  for (let i = 0; i <= text.length - n; i += 1) {
    set.add(text.slice(i, i + n));
  }
  return [...set];
}

function tokenKey(token: string): number | null {
  if (token.length !== 2) return null;
  const a = token.charCodeAt(0);
  const b = token.charCodeAt(1);
  // 注意：避免位运算的 32-bit 有符号截断（会导致 key 变成负数）
  return a * 65536 + b;
}

function findKey(keys: Uint32Array, key: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = keys[mid];
    if (v === key) return mid;
    if (v < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function decodePostings(
  index: Uint8Array,
  offset: number,
  length: number,
  onDoc: (docId: number) => void,
): void {
  let i = offset;
  const end = offset + length;
  let prev = -1;
  while (i < end) {
    let shift = 0;
    let value = 0;
    while (true) {
      const b = index[i];
      i += 1;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    prev += value;
    onDoc(prev);
  }
}

function align4(offset: number): number {
  return (offset + 3) & ~3;
}

function parseMetaBin(buf: ArrayBuffer): MetaBin {
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new Error("meta 文件过小");
  if (u8[0] !== 90 || u8[1] !== 77 || u8[2] !== 72 || u8[3] !== 109) {
    throw new Error("meta magic 不匹配");
  }

  const view = new DataView(buf);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`meta version 不支持：${version}`);

  const sepCode = view.getUint16(6, true);
  const count = view.getUint32(8, true);

  let off = 16;
  const ids = new Int32Array(buf, off, count);
  off += count * 4;
  const tagLo = new Uint32Array(buf, off, count);
  off += count * 4;
  const tagHi = new Uint32Array(buf, off, count);
  off += count * 4;
  const flags = new Uint8Array(buf, off, count);
  off += count;
  off = align4(off);

  function readPool(): { offsets: Uint32Array; pool: Uint8Array; next: number } {
    const offsets = new Uint32Array(buf, off, count + 1);
    off += (count + 1) * 4;
    const poolLen = offsets[count] ?? 0;
    const pool = new Uint8Array(buf, off, poolLen);
    off += poolLen;
    off = align4(off);
    return { offsets, pool, next: off };
  }

  const titles = readPool();
  off = titles.next;
  const covers = readPool();
  off = covers.next;
  const authors = readPool();
  off = authors.next;
  const aliases = readPool();

  return {
    count,
    sep: String.fromCharCode(sepCode),
    ids,
    tagLo,
    tagHi,
    flags,
    titlesOffsets: titles.offsets,
    titlesPool: titles.pool,
    coversOffsets: covers.offsets,
    coversPool: covers.pool,
    authorsOffsets: authors.offsets,
    authorsPool: authors.pool,
    aliasesOffsets: aliases.offsets,
    aliasesPool: aliases.pool,
  };
}

function parseDictBin(buf: ArrayBuffer): DictBin {
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new Error("dict 文件过小");
  if (u8[0] !== 90 || u8[1] !== 77 || u8[2] !== 72 || u8[3] !== 100) {
    throw new Error("dict magic 不匹配");
  }

  const view = new DataView(buf);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`dict version 不支持：${version}`);
  const n = view.getUint16(6, true);
  const count = view.getUint32(8, true);

  let off = 16;
  const keys = new Uint32Array(buf, off, count);
  off += count * 4;
  const offsets = new Uint32Array(buf, off, count);
  off += count * 4;
  const lengths = new Uint32Array(buf, off, count);
  off += count * 4;
  const dfs = new Uint32Array(buf, off, count);

  return { n, keys, offsets, lengths, dfs };
}

type LoadedState = {
  meta: MetaBin;
  tags: TagsJson["tags"];
  tagByBit: Array<{ tagId: number; name: string }>;
  dict: DictBin;
  index: Uint8Array;
  counts: Uint16Array;
  scores: Float32Array;
  touched: number[];
  cache: { key: string; docIds: Int32Array } | null;
};

let state: LoadedState | null = null;

function passesFilters(
  meta: LoadedState["meta"],
  docId: number,
  selectedLo: number,
  selectedHi: number,
  excludedLo: number,
  excludedHi: number,
  hidden: FilterMode,
  hideChapter: FilterMode,
): boolean {
  if (selectedLo !== 0 || selectedHi !== 0) {
    if ((meta.tagLo[docId] & selectedLo) !== selectedLo) return false;
    if ((meta.tagHi[docId] & selectedHi) !== selectedHi) return false;
  }
  if (excludedLo !== 0 && (meta.tagLo[docId] & excludedLo) !== 0) return false;
  if (excludedHi !== 0 && (meta.tagHi[docId] & excludedHi) !== 0) return false;

  const f = meta.flags[docId];
  if (hidden !== "any") {
    const isHidden = (f & 1) !== 0;
    if (hidden === "only0" && isHidden) return false;
    if (hidden === "only1" && !isHidden) return false;
  }
  if (hideChapter !== "any") {
    const isHideChapter = (f & 2) !== 0;
    if (hideChapter === "only0" && isHideChapter) return false;
    if (hideChapter === "only1" && !isHideChapter) return false;
  }

  return true;
}

function splitList(text: string, sep: string): string[] {
  if (!text) return [];
  return text.split(sep).filter(Boolean);
}

function maskFromBits(bits: number[]): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const bit of bits) {
    if (bit < 0) continue;
    if (bit < 32) lo |= 1 << bit;
    else if (bit < 64) hi |= 1 << (bit - 32);
  }
  return { lo, hi };
}

function tagsFromMask(tagByBit: LoadedState["tagByBit"], lo: number, hi: number) {
  const out: Array<{ tagId: number; name: string }> = [];
  for (let bit = 0; bit < tagByBit.length; bit += 1) {
    const on = bit < 32 ? ((lo >>> bit) & 1) === 1 : ((hi >>> (bit - 32)) & 1) === 1;
    if (!on) continue;
    out.push(tagByBit[bit]);
  }
  return out;
}

function decodeString(pool: Uint8Array, offsets: Uint32Array, index: number): string {
  const start = offsets[index];
  const end = offsets[index + 1];
  if (end <= start) return "";
  return DECODER.decode(pool.subarray(start, end));
}

function buildItem(s: LoadedState, docId: number): ResultItem {
  const m = s.meta;
  const f = m.flags[docId];
  const hidden = (f & 1) !== 0;
  const isHideChapter = (f & 2) !== 0;

  const title = decodeString(m.titlesPool, m.titlesOffsets, docId);
  const coverPart = decodeString(m.coversPool, m.coversOffsets, docId);
  const cover =
    coverPart.length === 0
      ? ""
      : coverPart.startsWith("http://") || coverPart.startsWith("https://")
        ? coverPart
        : `https://${coverPart}`;

  const aliasesText = decodeString(m.aliasesPool, m.aliasesOffsets, docId);
  const authorsText = decodeString(m.authorsPool, m.authorsOffsets, docId);

  return {
    id: m.ids[docId],
    title,
    cover,
    aliases: splitList(aliasesText, m.sep),
    authors: splitList(authorsText, m.sep),
    tags: tagsFromMask(s.tagByBit, m.tagLo[docId], m.tagHi[docId]),
    hidden,
    isHideChapter,
  };
}

function resetTouched(s: LoadedState): void {
  for (const docId of s.touched) {
    s.counts[docId] = 0;
    s.scores[docId] = 0;
  }
  s.touched.length = 0;
}

function buildExcludeMask(s: LoadedState, excludeTerms: string[]): Uint8Array {
  const mask = new Uint8Array(s.meta.count);
  const termTouched: number[] = [];

  for (const term of excludeTerms) {
    const termTokens = uniqNgrams(term, s.dict.n);
    if (termTokens.length === 0) continue;

    const tokenIdxs: number[] = [];
    for (const token of termTokens) {
      const key = tokenKey(token);
      if (key === null) continue;
      const idx = findKey(s.dict.keys, key);
      if (idx < 0) continue;
      tokenIdxs.push(idx);
    }
    if (tokenIdxs.length === 0) continue;

    tokenIdxs.sort((a, b) => s.dict.dfs[a] - s.dict.dfs[b]);
    const minHit = Math.max(1, Math.ceil(termTokens.length * 0.6));
    const minHitClamped = Math.min(minHit, tokenIdxs.length);

    for (const idx of tokenIdxs) {
      const o = s.dict.offsets[idx];
      const l = s.dict.lengths[idx];
      decodePostings(s.index, o, l, (docId) => {
        if (mask[docId] === 1) return;
        const prev = s.counts[docId];
        if (prev === 0) termTouched.push(docId);
        s.counts[docId] = prev + 1;
      });
    }

    for (const docId of termTouched) {
      if (s.counts[docId] >= minHitClamped) mask[docId] = 1;
      s.counts[docId] = 0;
    }
    termTouched.length = 0;
  }

  return mask;
}

function search(s: LoadedState, msg: SearchMessage): ResultsMessage {
  const meta = s.meta;
  const { include: includeTerms, exclude: excludeTerms } = parseQuery(msg.q);
  const qNorm = includeTerms.length === 1 ? includeTerms[0] : "";
  const queryTokens = qNorm ? uniqNgrams(qNorm, s.dict.n) : [];
  const qKey = `${includeTerms.join(" ")}|-${excludeTerms.join(" ")}`;

  const { lo: selectedLo, hi: selectedHi } = maskFromBits(msg.tagBits);
  const { lo: excludedLo, hi: excludedHi } = maskFromBits(msg.excludeTagBits);
  const hasQuery = includeTerms.length > 0 || excludeTerms.length > 0;

  const size = Math.max(1, Math.min(100, msg.size | 0));
  const page = Math.max(1, msg.page | 0);
  const offset = (page - 1) * size;

  const items: ResultItem[] = [];

  const cacheKey = `${msg.sort}|${msg.hidden}|${msg.hideChapter}|${selectedLo},${selectedHi}|${excludedLo},${excludedHi}|${qKey}`;
  const cached = s.cache;
  if (cached?.key === cacheKey) {
    const total = cached.docIds.length;
    const hasMore = offset + size < total;
    const slice = cached.docIds.slice(offset, offset + size);
    for (const docId of slice) items.push(buildItem(s, docId));
    return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
  }

  const excludeMask = excludeTerms.length > 0 ? buildExcludeMask(s, excludeTerms) : null;

  if (!hasQuery) {
    if (
      selectedLo === 0 &&
      selectedHi === 0 &&
      excludedLo === 0 &&
      excludedHi === 0 &&
      msg.hidden === "any" &&
      msg.hideChapter === "any"
    ) {
      s.cache = { key: cacheKey, docIds: new Int32Array(0) };
      return {
        type: "results",
        requestId: msg.requestId,
        page,
        size,
        total: 0,
        hasMore: false,
        items: [],
      };
    }

    const docIds: number[] = [];
    if (msg.sort === "id_asc") {
      for (let docId = 0; docId < meta.count; docId += 1) {
        if (
          !passesFilters(
            meta,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
          )
        ) {
          continue;
        }
        docIds.push(docId);
      }
    } else {
      for (let docId = meta.count - 1; docId >= 0; docId -= 1) {
        if (
          !passesFilters(
            meta,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
          )
        ) {
          continue;
        }
        docIds.push(docId);
      }
    }

    const all = Int32Array.from(docIds);
    s.cache = { key: cacheKey, docIds: all };
    const total = all.length;
    const hasMore = offset + size < total;
    const slice = all.slice(offset, offset + size);
    for (const docId of slice) items.push(buildItem(s, docId));
    return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
  }

  if (includeTerms.length === 0) {
    const sort = msg.sort === "id_asc" ? "id_asc" : "id_desc";
    const docIds: number[] = [];
    if (sort === "id_asc") {
      for (let docId = 0; docId < meta.count; docId += 1) {
        if (
          !passesFilters(
            meta,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
          )
        ) {
          continue;
        }
        if (excludeMask && excludeMask[docId] === 1) continue;
        docIds.push(docId);
      }
    } else {
      for (let docId = meta.count - 1; docId >= 0; docId -= 1) {
        if (
          !passesFilters(
            meta,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
          )
        ) {
          continue;
        }
        if (excludeMask && excludeMask[docId] === 1) continue;
        docIds.push(docId);
      }
    }

    const all = Int32Array.from(docIds);
    s.cache = { key: cacheKey, docIds: all };
    const total = all.length;
    const hasMore = offset + size < total;
    const slice = all.slice(offset, offset + size);
    for (const docId of slice) items.push(buildItem(s, docId));
    return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
  }

  if (includeTerms.length > 1) {
    const sort = msg.sort;
    const isRelevanceSort = sort === "relevance";

    const candidates: number[] = [];
    const termTouched: number[] = [];

    for (const term of includeTerms) {
      const termTokens = uniqNgrams(term, s.dict.n);
      if (termTokens.length === 0) continue;

      const tokenIdxs: number[] = [];
      for (const token of termTokens) {
        const key = tokenKey(token);
        if (key === null) continue;
        const idx = findKey(s.dict.keys, key);
        if (idx < 0) continue;
        tokenIdxs.push(idx);
      }
      if (tokenIdxs.length === 0) continue;

      tokenIdxs.sort((a, b) => s.dict.dfs[a] - s.dict.dfs[b]);
      const minHit = Math.max(1, Math.ceil(termTokens.length * 0.6));
      const minHitClamped = Math.min(minHit, tokenIdxs.length);

      for (const idx of tokenIdxs) {
        const o = s.dict.offsets[idx];
        const l = s.dict.lengths[idx];
        decodePostings(s.index, o, l, (docId) => {
          if (excludeMask && excludeMask[docId] === 1) return;
          if (
            !passesFilters(
              meta,
              docId,
              selectedLo,
              selectedHi,
              excludedLo,
              excludedHi,
              msg.hidden,
              msg.hideChapter,
            )
          ) {
            return;
          }
          const prev = s.counts[docId];
          if (prev === 0) termTouched.push(docId);
          s.counts[docId] = prev + 1;
        });
      }

      for (const docId of termTouched) {
        const hit = s.counts[docId];
        if (hit >= minHitClamped) {
          const prevScore = s.scores[docId];
          if (prevScore === 0) candidates.push(docId);
          s.scores[docId] = isRelevanceSort ? prevScore + hit / termTokens.length : 1;
        }
        s.counts[docId] = 0;
      }
      termTouched.length = 0;
    }

    if (candidates.length === 0) {
      s.cache = { key: cacheKey, docIds: new Int32Array(0) };
      return {
        type: "results",
        requestId: msg.requestId,
        page,
        size,
        total: 0,
        hasMore: false,
        items: [],
      };
    }

    if (isRelevanceSort) {
      for (const docId of candidates) {
        const titleText = decodeString(meta.titlesPool, meta.titlesOffsets, docId);
        const aliasesText = decodeString(meta.aliasesPool, meta.aliasesOffsets, docId);
        const authorsText = decodeString(meta.authorsPool, meta.authorsOffsets, docId);

        const titleNorm = normText(titleText);
        const aliasesNorm = normText(aliasesText);
        const authorsNorm = normText(authorsText);

        let score = s.scores[docId];
        for (const term of includeTerms) {
          if (titleNorm.includes(term)) score += 1.4;
          if (aliasesNorm.includes(term)) score += 0.6;
          if (authorsNorm.includes(term)) score += 0.4;
        }
        s.scores[docId] = score;
      }

      candidates.sort((a, b) => {
        const sa = s.scores[a];
        const sb = s.scores[b];
        if (sb !== sa) return sb - sa;
        return meta.ids[b] - meta.ids[a];
      });
    } else {
      // meta 按 id 排序写入，因此 docId 顺序即上架时间顺序
      candidates.sort((a, b) => (sort === "id_asc" ? a - b : b - a));
    }

    const all = Int32Array.from(candidates);
    for (const docId of candidates) s.scores[docId] = 0;

    s.cache = { key: cacheKey, docIds: all };
    const total = all.length;
    const hasMore = offset + size < total;
    const slice = all.slice(offset, offset + size);
    for (const docId of slice) items.push(buildItem(s, docId));
    return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
  }

  const tokenIdxs: number[] = [];
  for (const token of queryTokens) {
    const key = tokenKey(token);
    if (key === null) continue;
    const idx = findKey(s.dict.keys, key);
    if (idx < 0) continue;
    tokenIdxs.push(idx);
  }

  if (tokenIdxs.length === 0) {
    s.cache = { key: cacheKey, docIds: new Int32Array(0) };
    return {
      type: "results",
      requestId: msg.requestId,
      page,
      size,
      total: 0,
      hasMore: false,
      items: [],
    };
  }

  tokenIdxs.sort((a, b) => s.dict.dfs[a] - s.dict.dfs[b]);

  const minHit = Math.max(1, Math.ceil(queryTokens.length * 0.6));
  const minHitClamped = Math.min(minHit, tokenIdxs.length);

  for (const idx of tokenIdxs) {
    const o = s.dict.offsets[idx];
    const l = s.dict.lengths[idx];
    decodePostings(s.index, o, l, (docId) => {
      if (excludeMask && excludeMask[docId] === 1) return;
      if (
        !passesFilters(
          meta,
          docId,
          selectedLo,
          selectedHi,
          excludedLo,
          excludedHi,
          msg.hidden,
          msg.hideChapter,
        )
      ) {
        return;
      }
      const prev = s.counts[docId];
      if (prev === 0) s.touched.push(docId);
      s.counts[docId] = prev + 1;
    });
  }

  const sort = msg.sort;
  if (sort === "id_desc" || sort === "id_asc") {
    const docIds: number[] = [];
    if (sort === "id_asc") {
      for (let docId = 0; docId < meta.count; docId += 1) {
        if (s.counts[docId] < minHitClamped) continue;
        docIds.push(docId);
      }
    } else {
      for (let docId = meta.count - 1; docId >= 0; docId -= 1) {
        if (s.counts[docId] < minHitClamped) continue;
        docIds.push(docId);
      }
    }

    const all = Int32Array.from(docIds);
    resetTouched(s);
    s.cache = { key: cacheKey, docIds: all };
    const total = all.length;
    const hasMore = offset + size < total;
    const slice = all.slice(offset, offset + size);
    for (const docId of slice) items.push(buildItem(s, docId));
    return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
  }

  const candidates: number[] = [];
  for (const docId of s.touched) {
    const hit = s.counts[docId];
    if (hit < minHitClamped) continue;

    let score = hit / queryTokens.length;

    const title = decodeString(meta.titlesPool, meta.titlesOffsets, docId);
    if (normText(title).includes(qNorm)) score += 1.4;

    const aliasesText = decodeString(meta.aliasesPool, meta.aliasesOffsets, docId);
    if (normText(aliasesText).includes(qNorm)) score += 0.6;

    const authorsText = decodeString(meta.authorsPool, meta.authorsOffsets, docId);
    if (normText(authorsText).includes(qNorm)) score += 0.4;

    s.scores[docId] = score;
    candidates.push(docId);
  }

  candidates.sort((a, b) => {
    const sa = s.scores[a];
    const sb = s.scores[b];
    if (sb !== sa) return sb - sa;
    return meta.ids[b] - meta.ids[a];
  });

  const all = Int32Array.from(candidates);
  resetTouched(s);
  s.cache = { key: cacheKey, docIds: all };
  const total = all.length;
  const hasMore = offset + size < total;
  const slice = all.slice(offset, offset + size);
  for (const docId of slice) items.push(buildItem(s, docId));
  return { type: "results", requestId: msg.requestId, page, size, total, hasMore, items };
}

async function init(): Promise<void> {
  post({ type: "progress", stage: "加载索引清单…" });
  const manifest = await fetchJson<Manifest>("/assets/manifest.json");
  const generatedAt = manifest.generatedAt;

  post({ type: "progress", stage: "打开本地缓存…" });
  const db = await openDb();

  post({ type: "progress", stage: "加载 tags…" });
  const tagsBuf = await loadAsset(db, manifest.assets.tags);
  const tagsJson = JSON.parse(decodeUtf8(tagsBuf)) as TagsJson;
  const tags = tagsJson.tags;

  const tagByBit: Array<{ tagId: number; name: string }> = [];
  for (const t of tags) tagByBit[t.bit] = { tagId: t.tagId, name: t.name };

  post({ type: "progress", stage: "加载 meta…" });
  const metaBuf = await loadAsset(db, manifest.assets.meta);
  const meta = parseMetaBin(metaBuf);

  post({ type: "progress", stage: "加载 dict…" });
  const dictBuf = await loadAsset(db, manifest.assets.dict);
  const dict = parseDictBin(dictBuf);

  post({ type: "progress", stage: "加载 index…" });
  const indexBuf = await loadAsset(db, manifest.assets.index);
  const index = new Uint8Array(indexBuf);

  state = {
    meta,
    tags,
    tagByBit,
    dict,
    index,
    counts: new Uint16Array(meta.count),
    scores: new Float32Array(meta.count),
    touched: [],
    cache: null,
  };

  post({ type: "ready", count: meta.count, tags, generatedAt });
}

// eslint-disable-next-line no-restricted-globals
self.onmessage = (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void init().catch((err) => {
      const raw = String(err);
      if (raw.includes("404")) {
        post({
          type: "progress",
          stage: "找不到索引文件（/assets/manifest.json）。请先运行：npm run build:index",
        });
        return;
      }
      post({ type: "progress", stage: `加载失败：${raw}` });
    });
    return;
  }
  if (msg.type === "search") {
    if (!state) return;
    post(search(state, msg));
  }
};
