type AssetRef = { path: string; sha256: string; bytes: number };

type Manifest = {
  version: number;
  generatedAt: string;
  stats: {
    version: number;
    count: number;
    uniqueTokens: number;
    indexBytes: number;
    indexShardCount?: number;
    indexShardMode?: string;
    metaShardDocs?: number;
    metaShardCount?: number;
  };
  assets: {
    meta?: AssetRef;
    metaShards?: AssetRef[];
    dict: AssetRef;
    tags: AssetRef;
    index?: AssetRef;
    indexShards?: AssetRef[];
  };
};

type TagsJson = {
  version: number;
  tags: Array<{ tagId: number; name: string; count: number; bit: number }>;
};

type DictBinV1 = {
  version: 1;
  n: number;
  keys: Uint32Array;
  offsets: Uint32Array;
  lengths: Uint32Array;
  dfs: Uint32Array;
};

type DictBinV2 = {
  version: 2;
  n: number;
  keys: Uint32Array;
  shardIds: Uint32Array;
  offsets: Uint32Array;
  lengths: Uint32Array;
  dfs: Uint32Array;
};

type DictBin = DictBinV1 | DictBinV2;

type IndexPlan = { kind: "single"; asset: AssetRef } | { kind: "sharded"; assets: AssetRef[] };

type MetaBin = {
  count: number;
  sep: string;
  ids: Int32Array;
  tagLo: Uint32Array;
  tagHi: Uint32Array;
  flags: Uint8Array;
  titlesOffsets: Uint32Array;
  titlesPool: Uint8Array;
  coverBaseOffsets: Uint32Array;
  coverBasePool: Uint8Array;
  coverBaseIds: Uint16Array;
  coverPathsOffsets: Uint32Array;
  coverPathsPool: Uint8Array;
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
  needLogin: FilterMode;
  lock: FilterMode;
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
  needLogin: boolean;
  isLock: boolean;
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

function idbPrune(db: IDBDatabase, keepKeys: Set<string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, "readwrite");
    const store = tx.objectStore(STORE_FILES);
    let removed = 0;

    const req = store.openCursor();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 清理失败"));
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null;
      if (!cursor) return;

      const key = String(cursor.key);
      if (keepKeys.has(key)) {
        cursor.continue();
        return;
      }

      const delReq = cursor.delete();
      delReq.onerror = () => reject(delReq.error ?? new Error("IndexedDB 清理失败"));
      delReq.onsuccess = () => {
        removed += 1;
        cursor.continue();
      };
    };

    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 清理失败"));
  });
}

async function fetchArrayBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

async function fetchJsonNoStore<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`请求失败：${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function isGzipBytes(u8: Uint8Array): boolean {
  // gzip header: 1f 8b 08
  return u8.length >= 3 && u8[0] === 0x1f && u8[1] === 0x8b && u8[2] === 0x08;
}

async function maybeGunzipArrayBuffer(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf);
  if (!isGzipBytes(u8)) return buf;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("索引文件为 gzip 格式，但当前环境不支持自动解压。请使用 Cloudflare Pages 或为 /assets/*.bin 配置 Content-Encoding: gzip。");
  }
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

async function loadAsset(db: IDBDatabase, asset: AssetRef, signal?: AbortSignal): Promise<ArrayBuffer> {
  const cached = await idbGet(db, asset.sha256);
  if (cached) return cached;
  const buf = await fetchArrayBuffer(`/${asset.path}`, signal);
  const decoded = await maybeGunzipArrayBuffer(buf);
  void idbPut(db, asset.sha256, decoded).catch(() => {
    // 写入失败不影响主流程
  });
  return decoded;
}

async function loadAssetsBatched(
  db: IDBDatabase,
  assets: AssetRef[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ArrayBuffer[]> {
  if (assets.length === 0) return [];
  const out = new Array<ArrayBuffer>(assets.length);
  const workerCount = Math.max(1, Math.min(concurrency | 0, assets.length));
  let next = 0;
  let done = 0;

  const run = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= assets.length) return;
      out[i] = await loadAsset(db, assets[i]);
      done += 1;
      onProgress?.(done, assets.length);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, run));
  return out;
}

const DECODER = new TextDecoder("utf-8");

function decodeUtf8(buf: ArrayBuffer): string {
  return DECODER.decode(buf);
}

const NON_ALNUM_RE = /[^\p{Letter}\p{Number}]+/gu;
function normText(text: string): string {
  if (!text) return "";
  return text.normalize("NFKC").toLowerCase().replace(NON_ALNUM_RE, "");
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
  if (version !== 2) throw new Error(`meta version 不支持：${version}`);

  const sepCode = view.getUint16(6, true);
  const count = view.getUint32(8, true);
  const coverBaseCount = view.getUint32(12, true);

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

  function readPool(n: number): { offsets: Uint32Array; pool: Uint8Array; next: number } {
    const offsets = new Uint32Array(buf, off, n + 1);
    off += (n + 1) * 4;
    const poolLen = offsets[n] ?? 0;
    const pool = new Uint8Array(buf, off, poolLen);
    off += poolLen;
    off = align4(off);
    return { offsets, pool, next: off };
  }

  const titles = readPool(count);
  off = titles.next;
  const coverBases = readPool(coverBaseCount);
  off = coverBases.next;

  const idxBytes = coverBaseCount <= 0xff ? 1 : 2;
  let coverBaseIds: Uint16Array;
  if (idxBytes === 1) {
    const ids8 = new Uint8Array(buf, off, count);
    off += count;
    off = align4(off);
    const ids16 = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) ids16[i] = ids8[i] ?? 0;
    coverBaseIds = ids16;
  } else {
    coverBaseIds = new Uint16Array(buf, off, count);
    off += count * 2;
    off = align4(off);
  }

  const coverPaths = readPool(count);
  off = coverPaths.next;

  const authors = readPool(count);
  off = authors.next;
  const aliases = readPool(count);

  return {
    count,
    sep: String.fromCharCode(sepCode),
    ids,
    tagLo,
    tagHi,
    flags,
    titlesOffsets: titles.offsets,
    titlesPool: titles.pool,
    coverBaseOffsets: coverBases.offsets,
    coverBasePool: coverBases.pool,
    coverBaseIds,
    coverPathsOffsets: coverPaths.offsets,
    coverPathsPool: coverPaths.pool,
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
  const n = view.getUint16(6, true);
  const count = view.getUint32(8, true);

  let off = 16;
  const keys = new Uint32Array(buf, off, count);
  off += count * 4;
  if (version === 1) {
    const offsets = new Uint32Array(buf, off, count);
    off += count * 4;
    const lengths = new Uint32Array(buf, off, count);
    off += count * 4;
    const dfs = new Uint32Array(buf, off, count);
    return { version: 1, n, keys, offsets, lengths, dfs };
  }
  if (version === 2) {
    const shardIds = new Uint32Array(buf, off, count);
    off += count * 4;
    const offsets = new Uint32Array(buf, off, count);
    off += count * 4;
    const lengths = new Uint32Array(buf, off, count);
    off += count * 4;
    const dfs = new Uint32Array(buf, off, count);
    return { version: 2, n, keys, shardIds, offsets, lengths, dfs };
  }
  throw new Error(`dict version 不支持：${version}`);
}

type LoadedState = {
  db: IDBDatabase;
  totalCount: number;
  metaSep: string;
  metaShardDocs: number;
  metaShardShift: number | null;
  metaShardMask: number;
  metaShards: MetaBin[];
  metaIds: Int32Array;
  metaTagLo: Uint32Array;
  metaTagHi: Uint32Array;
  metaFlags: Uint8Array;
  tags: TagsJson["tags"];
  tagByBit: Array<{ tagId: number; name: string }>;
  dict: DictBin;
  indexPlan: IndexPlan;
  indexCache: Map<number, Uint8Array>;
  indexInflight: Map<number, Promise<Uint8Array>>;
  counts: Uint16Array;
  scores: Float32Array;
  touched: number[];
  cache: { key: string; docIds: Int32Array } | null;
};

let state: LoadedState | null = null;

function indexShardCount(plan: IndexPlan): number {
  return plan.kind === "single" ? 1 : plan.assets.length;
}

function getIndexAsset(plan: IndexPlan, shardId: number): AssetRef {
  if (plan.kind === "single") {
    if (shardId !== 0) throw new Error(`索引分片不存在：${shardId}`);
    return plan.asset;
  }
  const asset = plan.assets[shardId];
  if (!asset) throw new Error(`索引分片不存在：${shardId}`);
  return asset;
}

function dictShardId(dict: DictBin, tokenIdx: number): number {
  return dict.version === 2 ? dict.shardIds[tokenIdx] ?? 0 : 0;
}

function decodeTokenIdxPostings(
  s: LoadedState,
  tokenIdx: number,
  onDoc: (docId: number) => void,
): void {
  const shardId = dictShardId(s.dict, tokenIdx);
  const index = s.indexCache.get(shardId);
  if (!index) throw new Error("索引尚未加载");
  const o = s.dict.offsets[tokenIdx] ?? 0;
  const l = s.dict.lengths[tokenIdx] ?? 0;
  decodePostings(index, o, l, onDoc);
}

async function loadIndexShard(
  s: LoadedState,
  shardId: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const cached = s.indexCache.get(shardId);
  if (cached) return cached;

  const inflight = s.indexInflight.get(shardId);
  if (inflight) return await inflight;

  const p = (async () => {
    const asset = getIndexAsset(s.indexPlan, shardId);
    const buf = await loadAsset(s.db, asset, signal);
    const u8 = new Uint8Array(buf);
    s.indexCache.set(shardId, u8);
    return u8;
  })();

  s.indexInflight.set(shardId, p);
  try {
    return await p;
  } finally {
    s.indexInflight.delete(shardId);
  }
}

async function ensureIndexForTokenIdxs(
  s: LoadedState,
  tokenIdxs: number[],
  signal?: AbortSignal,
): Promise<void> {
  if (tokenIdxs.length === 0) return;
  if (s.dict.version === 1 && s.indexPlan.kind === "sharded") {
    throw new Error("dict v1 与 index 分片不兼容，请重新生成索引。");
  }
  const shardIds = new Set<number>();
  for (const idx of tokenIdxs) shardIds.add(dictShardId(s.dict, idx));
  await Promise.all([...shardIds].map((id) => loadIndexShard(s, id, signal)));
}

async function preloadIndex(s: LoadedState): Promise<void> {
  if (s.dict.version === 1 && s.indexPlan.kind === "sharded") return;
  const total = indexShardCount(s.indexPlan);
  if (total <= 0) return;

  const concurrency = Math.min(2, total);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const shardId = next;
      next += 1;
      await loadIndexShard(s, shardId);
    }
  });
  await Promise.all(workers);
}

function shouldPreloadIndex(): boolean {
  try {
    const conn = (navigator as any).connection as
      | { saveData?: boolean; effectiveType?: string }
      | undefined;
    if (conn?.saveData) return false;
    const t = String(conn?.effectiveType ?? "");
    if (t === "slow-2g" || t === "2g") return false;
  } catch {
    // ignore
  }
  return true;
}

function passesFilters(
  s: LoadedState,
  docId: number,
  selectedLo: number,
  selectedHi: number,
  excludedLo: number,
  excludedHi: number,
  hidden: FilterMode,
  hideChapter: FilterMode,
  needLogin: FilterMode,
  lock: FilterMode,
): boolean {
  if (selectedLo !== 0 || selectedHi !== 0) {
    if (((s.metaTagLo[docId] ?? 0) & selectedLo) !== selectedLo) return false;
    if (((s.metaTagHi[docId] ?? 0) & selectedHi) !== selectedHi) return false;
  }
  if (excludedLo !== 0 && ((s.metaTagLo[docId] ?? 0) & excludedLo) !== 0) return false;
  if (excludedHi !== 0 && ((s.metaTagHi[docId] ?? 0) & excludedHi) !== 0) return false;

  const f = s.metaFlags[docId] ?? 0;
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
  if (needLogin !== "any") {
    const isNeedLogin = (f & 4) !== 0;
    if (needLogin === "only0" && isNeedLogin) return false;
    if (needLogin === "only1" && !isNeedLogin) return false;
  }
  if (lock !== "any") {
    const isLocked = (f & 8) !== 0;
    if (lock === "only0" && isLocked) return false;
    if (lock === "only1" && !isLocked) return false;
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

function shardShiftForDocs(shardDocs: number): number | null {
  const n = shardDocs | 0;
  if (n <= 0) return null;
  if ((n & (n - 1)) !== 0) return null;
  return 31 - Math.clz32(n);
}

function metaShardId(s: LoadedState, docId: number): number {
  const shift = s.metaShardShift;
  if (shift !== null) return docId >>> shift;
  return Math.floor(docId / s.metaShardDocs);
}

function metaLocalDocId(s: LoadedState, docId: number, shardId: number): number {
  const shift = s.metaShardShift;
  if (shift !== null) return docId & s.metaShardMask;
  return docId - shardId * s.metaShardDocs;
}

function buildItem(s: LoadedState, docId: number): ResultItem {
  const f = s.metaFlags[docId] ?? 0;
  const hidden = (f & 1) !== 0;
  const isHideChapter = (f & 2) !== 0;
  const needLogin = (f & 4) !== 0;
  const isLock = (f & 8) !== 0;

  const shardId = metaShardId(s, docId);
  const shard = s.metaShards[shardId];
  if (!shard) throw new Error(`meta 分片不存在：${shardId}`);
  const localDocId = metaLocalDocId(s, docId, shardId);

  const title = decodeString(shard.titlesPool, shard.titlesOffsets, localDocId);
  const coverPath = decodeString(shard.coverPathsPool, shard.coverPathsOffsets, localDocId);
  const coverBaseId = shard.coverBaseIds[localDocId] ?? 0;
  const coverBase =
    coverBaseId === 0 ? "" : decodeString(shard.coverBasePool, shard.coverBaseOffsets, coverBaseId);
  const cover = coverBase.length > 0 ? `${coverBase}${coverPath}` : coverPath;

  const aliasesText = decodeString(shard.aliasesPool, shard.aliasesOffsets, localDocId);
  const authorsText = decodeString(shard.authorsPool, shard.authorsOffsets, localDocId);

  return {
    id: s.metaIds[docId] ?? 0,
    title,
    cover,
    aliases: splitList(aliasesText, s.metaSep),
    authors: splitList(authorsText, s.metaSep),
    tags: tagsFromMask(s.tagByBit, s.metaTagLo[docId] ?? 0, s.metaTagHi[docId] ?? 0),
    hidden,
    isHideChapter,
    needLogin,
    isLock,
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
  const mask = new Uint8Array(s.totalCount);
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
      decodeTokenIdxPostings(s, idx, (docId) => {
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

function collectTokenIdxs(dict: DictBin, terms: string[]): number[] {
  const idxs = new Set<number>();
  for (const term of terms) {
    const tokens = uniqNgrams(term, dict.n);
    for (const token of tokens) {
      const key = tokenKey(token);
      if (key === null) continue;
      const idx = findKey(dict.keys, key);
      if (idx < 0) continue;
      idxs.add(idx);
    }
  }
  return [...idxs];
}

async function searchAsync(
  s: LoadedState,
  msg: SearchMessage,
  signal?: AbortSignal,
): Promise<ResultsMessage> {
  const parsed = parseQuery(msg.q);
  const { include: includeTerms, exclude: excludeTerms } = parsed;
  if (includeTerms.length === 0 && excludeTerms.length === 0) return searchSync(s, msg, parsed);

  const tokenIdxs = collectTokenIdxs(s.dict, [...includeTerms, ...excludeTerms]);
  if (tokenIdxs.length > 0) {
    const shardIds = new Set<number>();
    for (const idx of tokenIdxs) shardIds.add(dictShardId(s.dict, idx));
    let needLoad = 0;
    for (const shardId of shardIds) if (!s.indexCache.has(shardId)) needLoad += 1;
    if (needLoad > 0) post({ type: "progress", stage: "加载索引缓存…" });
  }

  await ensureIndexForTokenIdxs(s, tokenIdxs, signal);
  return searchSync(s, msg, parsed);
}

function searchSync(s: LoadedState, msg: SearchMessage, parsed?: ParsedQuery): ResultsMessage {
  const totalCount = s.totalCount;
  const { include: includeTerms, exclude: excludeTerms } = parsed ?? parseQuery(msg.q);
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

  const cacheKey = `${msg.sort}|${msg.hidden}|${msg.hideChapter}|${msg.needLogin}|${msg.lock}|${selectedLo},${selectedHi}|${excludedLo},${excludedHi}|${qKey}`;
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
      msg.hideChapter === "any" &&
      msg.needLogin === "any" &&
      msg.lock === "any"
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
      for (let docId = 0; docId < totalCount; docId += 1) {
        if (
          !passesFilters(
            s,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
            msg.needLogin,
            msg.lock,
          )
        ) {
          continue;
        }
        docIds.push(docId);
      }
    } else {
      for (let docId = totalCount - 1; docId >= 0; docId -= 1) {
        if (
          !passesFilters(
            s,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
            msg.needLogin,
            msg.lock,
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
      for (let docId = 0; docId < totalCount; docId += 1) {
        if (
          !passesFilters(
            s,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
            msg.needLogin,
            msg.lock,
          )
        ) {
          continue;
        }
        if (excludeMask && excludeMask[docId] === 1) continue;
        docIds.push(docId);
      }
    } else {
      for (let docId = totalCount - 1; docId >= 0; docId -= 1) {
        if (
          !passesFilters(
            s,
            docId,
            selectedLo,
            selectedHi,
            excludedLo,
            excludedHi,
            msg.hidden,
            msg.hideChapter,
            msg.needLogin,
            msg.lock,
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
        decodeTokenIdxPostings(s, idx, (docId) => {
          if (excludeMask && excludeMask[docId] === 1) return;
          if (
            !passesFilters(
              s,
              docId,
              selectedLo,
              selectedHi,
              excludedLo,
              excludedHi,
              msg.hidden,
              msg.hideChapter,
              msg.needLogin,
              msg.lock,
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
        const shardId = metaShardId(s, docId);
        const shard = s.metaShards[shardId];
        if (!shard) continue;
        const localDocId = metaLocalDocId(s, docId, shardId);

        const titleText = decodeString(shard.titlesPool, shard.titlesOffsets, localDocId);
        const aliasesText = decodeString(shard.aliasesPool, shard.aliasesOffsets, localDocId);
        const authorsText = decodeString(shard.authorsPool, shard.authorsOffsets, localDocId);

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
        return (s.metaIds[b] ?? 0) - (s.metaIds[a] ?? 0);
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
    decodeTokenIdxPostings(s, idx, (docId) => {
      if (excludeMask && excludeMask[docId] === 1) return;
      if (
        !passesFilters(
          s,
          docId,
          selectedLo,
          selectedHi,
          excludedLo,
          excludedHi,
          msg.hidden,
          msg.hideChapter,
          msg.needLogin,
          msg.lock,
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
      for (let docId = 0; docId < totalCount; docId += 1) {
        if (s.counts[docId] < minHitClamped) continue;
        docIds.push(docId);
      }
    } else {
      for (let docId = totalCount - 1; docId >= 0; docId -= 1) {
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

    const shardId = metaShardId(s, docId);
    const shard = s.metaShards[shardId];
    if (!shard) continue;
    const localDocId = metaLocalDocId(s, docId, shardId);

    const title = decodeString(shard.titlesPool, shard.titlesOffsets, localDocId);
    if (normText(title).includes(qNorm)) score += 1.4;

    const aliasesText = decodeString(shard.aliasesPool, shard.aliasesOffsets, localDocId);
    if (normText(aliasesText).includes(qNorm)) score += 0.6;

    const authorsText = decodeString(shard.authorsPool, shard.authorsOffsets, localDocId);
    if (normText(authorsText).includes(qNorm)) score += 0.4;

    s.scores[docId] = score;
    candidates.push(docId);
  }

  candidates.sort((a, b) => {
    const sa = s.scores[a];
    const sb = s.scores[b];
    if (sb !== sa) return sb - sa;
    return (s.metaIds[b] ?? 0) - (s.metaIds[a] ?? 0);
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
  const manifest = await fetchJsonNoStore<Manifest>("/assets/manifest.json");
  const generatedAt = manifest.generatedAt;

  const totalCount = Math.max(0, manifest.stats.count | 0);

  const metaAssets: AssetRef[] = (() => {
    const shards = manifest.assets.metaShards;
    if (Array.isArray(shards) && shards.length > 0) return shards;
    const single = manifest.assets.meta;
    if (single) return [single];
    throw new Error("manifest 缺少 meta/metaShards");
  })();

  const metaShardDocs = (() => {
    const n = manifest.stats.metaShardDocs;
    if (typeof n === "number" && n > 0) return n | 0;
    return totalCount;
  })();
  const expectedMetaShardCount = metaShardDocs > 0 ? Math.ceil(totalCount / metaShardDocs) : 0;
  if (expectedMetaShardCount > 0 && metaAssets.length !== expectedMetaShardCount) {
    throw new Error(`manifest meta 分片数量不匹配：${metaAssets.length} != ${expectedMetaShardCount}`);
  }

  const indexPlan: IndexPlan = (() => {
    const shards = manifest.assets.indexShards;
    if (Array.isArray(shards) && shards.length > 0) return { kind: "sharded", assets: shards };
    const single = manifest.assets.index;
    if (single) return { kind: "single", asset: single };
    throw new Error("manifest 缺少 index/indexShards");
  })();
  const keepKeys = new Set<string>([manifest.assets.tags.sha256, manifest.assets.dict.sha256]);
  for (const a of metaAssets) keepKeys.add(a.sha256);
  if (indexPlan.kind === "single") keepKeys.add(indexPlan.asset.sha256);
  else for (const asset of indexPlan.assets) keepKeys.add(asset.sha256);

  post({ type: "progress", stage: "打开本地缓存…" });
  const db = await openDb();

  post({ type: "progress", stage: "加载索引文件（tags/dict/meta）…" });
  const metaBufsPromise = loadAssetsBatched(db, metaAssets, 6, (done, total) => {
    post({ type: "progress", stage: `加载 meta 分片…（${done}/${total}）` });
  });
  const [tagsBuf, dictBuf, metaBufs] = await Promise.all([
    loadAsset(db, manifest.assets.tags),
    loadAsset(db, manifest.assets.dict),
    metaBufsPromise,
  ]);

  const tagsJson = JSON.parse(decodeUtf8(tagsBuf)) as TagsJson;
  const tags = tagsJson.tags;

  const tagByBit: Array<{ tagId: number; name: string }> = [];
  for (const t of tags) tagByBit[t.bit] = { tagId: t.tagId, name: t.name };

  const dict = parseDictBin(dictBuf);

  const metaIds = new Int32Array(totalCount);
  const metaTagLo = new Uint32Array(totalCount);
  const metaTagHi = new Uint32Array(totalCount);
  const metaFlags = new Uint8Array(totalCount);

  const metaShards: MetaBin[] = [];
  let off = 0;
  let metaSep = "";
  for (const buf of metaBufs) {
    const shard = parseMetaBin(buf);
    if (!metaSep) metaSep = shard.sep;
    if (metaSep !== shard.sep) throw new Error("meta 分片 sep 不一致");
    if (off + shard.count > totalCount) throw new Error("meta 分片条目数溢出");

    metaIds.set(shard.ids, off);
    metaTagLo.set(shard.tagLo, off);
    metaTagHi.set(shard.tagHi, off);
    metaFlags.set(shard.flags, off);

    metaShards.push(shard);
    off += shard.count;
  }
  if (off !== totalCount) throw new Error(`meta 分片条目数不匹配：${off} != ${totalCount}`);

  const shift = shardShiftForDocs(metaShardDocs);
  const mask = shift === null ? 0 : (metaShardDocs - 1) | 0;

  state = {
    db,
    totalCount,
    metaSep: metaSep || "\u001F",
    metaShardDocs,
    metaShardShift: shift,
    metaShardMask: mask,
    metaShards,
    metaIds,
    metaTagLo,
    metaTagHi,
    metaFlags,
    tags,
    tagByBit,
    dict,
    indexPlan,
    indexCache: new Map<number, Uint8Array>(),
    indexInflight: new Map<number, Promise<Uint8Array>>(),
    counts: new Uint16Array(totalCount),
    scores: new Float32Array(totalCount),
    touched: [],
    cache: null,
  };

  post({ type: "ready", count: totalCount, tags, generatedAt });

  // 新索引已可用后再后台清理旧缓存，并预热索引文件（不阻塞首屏可用性）。
  setTimeout(() => {
    void idbPrune(db, keepKeys).catch(() => {
      // 清理失败不影响主流程
    });
    const s = state;
    if (!s) return;
    if (!shouldPreloadIndex()) return;
    setTimeout(() => {
      void preloadIndex(s).catch(() => {});
    }, 800);
  }, 0);
}

let searching = false;
let pendingSearch: SearchMessage | null = null;
let activeSearchAbort: AbortController | null = null;

function requestSearch(msg: SearchMessage): void {
  pendingSearch = msg;
  activeSearchAbort?.abort();
  if (!searching) void runSearchLoop();
}

async function runSearchLoop(): Promise<void> {
  if (searching) return;
  searching = true;
  try {
    while (pendingSearch) {
      const msg = pendingSearch;
      pendingSearch = null;
      if (!state) return;

      const ac = new AbortController();
      activeSearchAbort = ac;

      try {
        const result = await searchAsync(state, msg, ac.signal);
        // 若等待期间出现新请求，跳过旧结果（主线程也会按 requestId 丢弃）。
        if (pendingSearch) continue;
        post(result);
      } catch (err) {
        if (ac.signal.aborted) continue;
        post({ type: "progress", stage: `搜索失败：${String(err)}` });
      }
    }
  } finally {
    searching = false;
  }
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
    requestSearch(msg);
  }
};
