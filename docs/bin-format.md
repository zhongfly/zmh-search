# `.bin` 索引文件格式（TypeScript 版）

本项目会在构建时离线生成前端检索索引，输出到 `public/assets/`（生产构建后位于 `dist/assets/`）。

- 生成端：`scripts/build_index.py`
- 使用端：`src/worker/searchWorker.ts`（WebWorker，负责下载/解压/解析/检索）

索引由三类资源组成：

- `meta-lite*.bin`：文档（漫画）元信息分片（MetaBin）
- `ngram.dict*.bin`：n-gram 词典（DictBin）
- `ngram.index*.bin`：倒排 postings 分片（Index shard，纯字节池）

`public/assets/manifest.json` 记录每个文件的 `path/sha256/bytes`，以及分片参数（`metaShardDocs/indexShardCount` 等）。

---

## 通用约定

### 字节序

所有 header 字段均为 **Little-Endian**。TypeScript 侧用 `DataView#getUint16/getUint32(..., true)` 读取。

### 对齐

`meta-lite*.bin` 的多个段之间会做 **4 字节对齐**（pad 0），以便后续能用 `Int32Array/Uint32Array` 直接建立视图。

```ts
function align4(offset: number): number {
  return (offset + 3) & ~3;
}
```

### 字符串池（String pool）

多个字符串会被打包为：

- `offsets: uint32[(n + 1)]`：第 i 个字符串字节范围 `[offsets[i], offsets[i + 1])`
- `pool: uint8[ offsets[n] ]`：UTF-8 字节拼接池

```ts
const DECODER = new TextDecoder("utf-8");

function decodeString(pool: Uint8Array, offsets: Uint32Array, index: number): string {
  const start = offsets[index] ?? 0;
  const end = offsets[index + 1] ?? start;
  if (end <= start) return "";
  return DECODER.decode(pool.subarray(start, end));
}
```

---

## `meta-lite*.bin`（MetaBin v2）

### 文件名与分片

构建端会把 meta 按固定条目数分片（默认 `metaShardDocs=4096`），输出：

- `meta-lite.s000.<sha12>.bin`
- `meta-lite.s001.<sha12>.bin`
- ...

这些分片按顺序覆盖全量 `docId` 空间：第 k 片包含全局 `docId` `[k*metaShardDocs, (k+1)*metaShardDocs)`（最后一片可能不足）。

### Header（固定 16 字节）

| 字段 | 类型 | 说明 |
|---|---:|---|
| magic | `4 bytes` | 固定 `ZMHm` |
| version | `uint16` | 固定 `2` |
| sepCode | `uint16` | 列表分隔符（默认 `\u001F`） |
| count | `uint32` | 本分片文档数 |
| coverBaseCount | `uint32` | cover base 去重后的条目数 |

### Body 布局（按顺序紧密排列，部分段后 align4）

按顺序：

1) `ids: int32[count]`：漫画真实 `id`
2) `tagLo: uint32[count]`：标签 bitset 低 32 位
3) `tagHi: uint32[count]`：标签 bitset 高 32 位（当前实现最多 64 位）
4) `flags: uint8[count]`：状态位（之后 `align4`）
5) `titlesPool(count)`：标题字符串池（之后 `align4`）
6) `coverBasePool(coverBaseCount)`：cover base 字符串池（之后 `align4`）
7) `coverBaseIds: uint8[count]` 或 `uint16[count]`：每条文档指向 cover base 的索引（之后 `align4`）
8) `coverPathsPool(count)`：cover path 字符串池（之后 `align4`）
9) `authorsPool(count)`：作者列表字符串池（之后 `align4`）
10) `aliasesPool(count)`：别名列表字符串池（之后 `align4`）

其中 `xxxPool(n)` 都是：`offsets:uint32[n+1] + pool:uint8[offsets[n]]`。

### flags 位定义

| bit | 含义 |
|---:|---|
| 0 | `hidden` |
| 1 | `isHideChapter` |
| 2 | `needLogin`（或不可读） |
| 3 | `isLock` |

### coverBaseIds 的编码

- 若 `coverBaseCount <= 255`：用 `uint8[count]` 写入，读取时可以扩成 `Uint16Array`
- 否则：直接用 `uint16[count]`

`0` 表示空 base；否则 base 字符串在 `coverBasePool` 中的索引。

### TypeScript 解析参考实现

```ts
export type MetaBin = {
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

function parseMetaBinV2(buf: ArrayBuffer): MetaBin {
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new Error("meta 文件过小");
  // "ZMHm"
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

  const readPool = (n: number) => {
    const offsets = new Uint32Array(buf, off, n + 1);
    off += (n + 1) * 4;
    const poolLen = offsets[n] ?? 0;
    const pool = new Uint8Array(buf, off, poolLen);
    off += poolLen;
    off = align4(off);
    return { offsets, pool };
  };

  const titles = readPool(count);
  const coverBases = readPool(coverBaseCount);

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
  const authors = readPool(count);
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
```

---

## `ngram.dict*.bin`（DictBin v1 / v2）

### Header（固定 16 字节）

| 字段 | 类型 | 说明 |
|---|---:|---|
| magic | `4 bytes` | 固定 `ZMHd` |
| version | `uint16` | `1` 或 `2` |
| n | `uint16` | n-gram 长度（当前为 2） |
| count | `uint32` | 词条数 |
| reserved | `uint32` | 保留（当前为 0） |

### Body（全为 `uint32[count]`）

- v1：`keys, offsets, lengths, dfs`
- v2：`keys, shardIds, offsets, lengths, dfs`

字段含义：

- `key`：tokenKey（2 个 UTF-16 code unit 拼成 uint32）
- `shardId`（仅 v2）：该 token 的 postings 存放在哪个 index 分片
- `offset/length`：postings 在 index 分片字节池中的起始与长度
- `df`：document frequency（postings 中 docId 数量）

### TypeScript 解析参考实现

```ts
export type DictBinV1 = {
  version: 1;
  n: number;
  keys: Uint32Array;
  offsets: Uint32Array;
  lengths: Uint32Array;
  dfs: Uint32Array;
};

export type DictBinV2 = {
  version: 2;
  n: number;
  keys: Uint32Array;
  shardIds: Uint32Array;
  offsets: Uint32Array;
  lengths: Uint32Array;
  dfs: Uint32Array;
};

export type DictBin = DictBinV1 | DictBinV2;

function parseDictBin(buf: ArrayBuffer): DictBin {
  const u8 = new Uint8Array(buf);
  if (u8.length < 16) throw new Error("dict 文件过小");
  // "ZMHd"
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
```

---

## `ngram.index*.bin`（Index postings 分片）

index 分片文件本身**没有 header**，就是 postings 字节的拼接池；每条 postings 的范围由 dict 的 `offset/length` 指定。

postings 编码规则：

1) docId 列表必须严格递增
2) 先做 delta：`prev=-1`，`delta = docId - prev`
3) delta 用 **unsigned LEB128 varint** 编码（7-bit payload + 0x80 continuation）

TypeScript 解码参考实现（与 worker 一致）：

```ts
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
      const b = index[i] ?? 0;
      i += 1;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    prev += value;
    onDoc(prev);
  }
}
```

---

## tokenKey（2-gram 的 key 计算）

查询端会把归一化后的 2-gram token（长度为 2 的字符串）编码成 uint32：

```ts
function tokenKey(token: string): number | null {
  if (token.length !== 2) return null;
  const a = token.charCodeAt(0);
  const b = token.charCodeAt(1);
  // 避免 32-bit 位运算导致负数截断
  return a * 65536 + b;
}
```

构建端的 `_token_key()` 逻辑等价（使用 UTF-16LE 两个 code unit 组合）。

---

## 分片定位（docId → meta shard / index shard）

### meta shard

全局 docId（从 0 开始）映射到 meta 分片：

- 若 `metaShardDocs` 是 2 的幂：`shardId = docId >>> shift`，`localId = docId & (metaShardDocs - 1)`
- 否则：`shardId = Math.floor(docId / metaShardDocs)`，`localId = docId - shardId * metaShardDocs`

### index shard

- dict v1：只有一个 index 分片（shardId 恒为 0）
- dict v2：`shardId = dict.shardIds[tokenIdx]`，用它选择对应的 `ngram.index.hNNN*.bin`

---

## 压缩与缓存（部署/运行时注意点）

- 生产构建会把 `dist/assets/*.bin` 写成 **gzip 压缩后的内容**；需要静态托管层为这些 `.bin` 配置 `Content-Encoding: gzip`（项目已提供 `public/_headers`）。
- Worker 侧支持“文件内容是 gzip”的情况：检测 gzip header 后，若环境支持 `DecompressionStream` 则会自行解压，否则会抛错提示你需要正确配置 `Content-Encoding`。
- `manifest.json` 的 `sha256` 用于 IndexedDB 缓存 key 与淘汰旧缓存；但不会对下载内容做额外校验。

