import hashlib
import json
import sqlite3
import sys
import struct
import unicodedata
from argparse import ArgumentParser
from array import array
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlsplit


DEFAULT_DB_PATH = Path("data/zaimanhua.sqlite3")
DEFAULT_OUT_DIR = Path("public/assets")

NGRAM_N = 2
LIST_SEP = "\u001F"  # Unit Separator


def _sha256_hex(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _write_hashed(out_dir: Path, stem: str, ext: str, data: bytes) -> Tuple[str, str, int]:
    digest = _sha256_hex(data)
    short = digest[:12]
    filename = f"{stem}.{short}{ext}"
    path = out_dir / filename
    path.write_bytes(data)
    return filename, digest, len(data)


def _clean_generated(out_dir: Path, keep: List[str]) -> None:
    keep_set = set(keep)
    prefixes = ("meta-lite.", "ngram.dict.", "ngram.index.", "authors.dict.", "tags.")

    for p in out_dir.iterdir():
        if not p.is_file():
            continue
        if p.name in keep_set:
            continue
        if any(p.name.startswith(pre) for pre in prefixes):
            p.unlink()


def _json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def _norm_text(text: str) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in t if ch.isalnum())


def _ngrams(text: str, n: int = NGRAM_N) -> Iterable[str]:
    if len(text) < n:
        return ()
    return (text[i : i + n] for i in range(0, len(text) - n + 1))


def _token_key(token: str) -> Optional[int]:
    b = token.encode("utf-16le")
    if len(b) != 4:
        return None
    u0 = int.from_bytes(b[0:2], "little", signed=False)
    u1 = int.from_bytes(b[2:4], "little", signed=False)
    return ((u0 & 0xFFFF) << 16) | (u1 & 0xFFFF)


def _build_string_pool(strings: List[str]) -> Tuple[array, bytes]:
    offsets = array("I", [0])
    pool = bytearray()
    for s in strings:
        b = (s or "").encode("utf-8")
        pool.extend(b)
        offsets.append(len(pool))
    return offsets, bytes(pool)


def _build_u16_list_pool(rows: List[List[int]]) -> Tuple[array, bytes]:
    offsets = array("I", [0])
    pool = bytearray()
    for row in rows:
        if any((not isinstance(v, int)) or v < 0 or v > 0xFFFF for v in row):
            raise RuntimeError("authorId 超出 uint16 范围")
        arr = array("H", row)
        if arr.itemsize != 2:
            raise RuntimeError("array('H') itemsize != 2")
        pool.extend(arr.tobytes())
        offsets.append(len(pool))
    return offsets, bytes(pool)


def _pad4(out: bytearray) -> None:
    while (len(out) % 4) != 0:
        out.append(0)


def _split_cover_url(raw: str) -> Tuple[str, str]:
    s = (raw or "").strip()
    if not s:
        return ("", "")

    if s.startswith("//"):
        s = "https:" + s

    if s.startswith("http://") or s.startswith("https://"):
        try:
            u = urlsplit(s)
        except ValueError:
            return ("", s)
        if not u.netloc:
            return ("", s)
        base = f"{u.scheme}://{u.netloc}"
        path = u.path or ""
        if u.query:
            path = f"{path}?{u.query}"
        return (base, path)

    if s.startswith("/"):
        # 站内绝对路径：直接当作可用路径（base 为空）
        return ("", s)

    if "://" in s:
        # 未知 scheme（如 data:），直接保留
        return ("", s)

    # 兼容旧数据：host/path（无 scheme），默认按 https:// 处理
    host, sep, rest = s.partition("/")
    if not sep:
        return ("https://" + host, "")
    return ("https://" + host, "/" + rest)


def _pack_meta_bin(
    ids: List[int],
    titles: List[str],
    covers: List[str],
    author_id_lists: List[List[int]],
    alias_texts: List[str],
    tag_lo: List[int],
    tag_hi: List[int],
    flags: List[int],
    sep: str,
) -> bytes:
    count = len(ids)
    if not (
        len(titles) == count
        and len(covers) == count
        and len(author_id_lists) == count
        and len(alias_texts) == count
        and len(tag_lo) == count
        and len(tag_hi) == count
        and len(flags) == count
    ):
        raise RuntimeError("meta 字段长度不一致")

    cover_bases = [""]
    cover_base_idx = {"": 0}
    cover_paths: List[str] = []
    cover_base_ids: List[int] = []

    for raw in covers:
        base, path = _split_cover_url(raw)
        if base not in cover_base_idx:
            cover_base_idx[base] = len(cover_bases)
            cover_bases.append(base)
        cover_base_ids.append(cover_base_idx[base])
        cover_paths.append(path)

    base_count = len(cover_bases)
    idx_bytes = 1 if base_count <= 0xFF else 2

    out = bytearray()
    # meta v4：header 的最后一个 uint32 复用为 coverBaseCount
    out.extend(struct.pack("<4sHHII", b"ZMHm", 4, ord(sep), count, base_count))

    # ids 使用 delta + varint（prev 初值 0）
    prev_id = 0
    for comic_id in ids:
        delta = comic_id - prev_id
        if delta <= 0:
            raise RuntimeError("meta ids 必须严格递增")
        out.extend(_encode_varint(delta))
        prev_id = comic_id
    _pad4(out)

    lo_arr = array("I", tag_lo)
    hi_arr = array("H", tag_hi)
    if lo_arr.itemsize != 4:
        raise RuntimeError("array('I') itemsize != 4")
    if hi_arr.itemsize != 2:
        raise RuntimeError("array('H') itemsize != 2")
    out.extend(lo_arr.tobytes())
    out.extend(hi_arr.tobytes())

    out.extend(bytes(flags))
    _pad4(out)

    # titles pool（count + 1 offsets）
    offsets, pool = _build_string_pool(titles)
    if offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")
    out.extend(offsets.tobytes())
    out.extend(pool)
    _pad4(out)

    # cover base pool（base_count + 1 offsets）
    base_offsets, base_pool = _build_string_pool(cover_bases)
    if base_offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")
    out.extend(base_offsets.tobytes())
    out.extend(base_pool)
    _pad4(out)

    # cover base index（per doc）
    if idx_bytes == 1:
        if any(i < 0 or i > 0xFF for i in cover_base_ids):
            raise RuntimeError("cover base index 超出 uint8 范围")
        out.extend(bytes(cover_base_ids))
    else:
        idx_arr = array("H", cover_base_ids)
        if idx_arr.itemsize != 2:
            raise RuntimeError("array('H') itemsize != 2")
        out.extend(idx_arr.tobytes())
    _pad4(out)

    # cover path pool（count + 1 offsets）
    cover_offsets, cover_pool = _build_string_pool(cover_paths)
    if cover_offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")
    out.extend(cover_offsets.tobytes())
    out.extend(cover_pool)
    _pad4(out)

    # authors（per-doc uint16 authorId 列表池）
    author_offsets, author_pool = _build_u16_list_pool(author_id_lists)
    if author_offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")
    out.extend(author_offsets.tobytes())
    out.extend(author_pool)
    _pad4(out)

    # aliases（UTF-8 字符串池）
    alias_offsets, alias_pool = _build_string_pool(alias_texts)
    if alias_offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")
    out.extend(alias_offsets.tobytes())
    out.extend(alias_pool)
    _pad4(out)

    return bytes(out)


def _pack_authors_dict_bin(author_name_by_id: Dict[int, str]) -> bytes:
    author_ids = sorted(author_name_by_id.keys())
    if any((not isinstance(i, int)) or i < 0 or i > 0xFFFF for i in author_ids):
        raise RuntimeError("authorId 超出 uint16 范围")

    names = [author_name_by_id.get(i, "") for i in author_ids]
    offsets, pool = _build_string_pool(names)
    if offsets.itemsize != 4:
        raise RuntimeError("offsets itemsize != 4")

    out = bytearray()
    out.extend(struct.pack("<4sHHII", b"ZMHa", 1, 0, len(author_ids), 0))
    if author_ids:
        ids_arr = array("H", author_ids)
        if ids_arr.itemsize != 2:
            raise RuntimeError("array('H') itemsize != 2")
        out.extend(ids_arr.tobytes())
    _pad4(out)
    out.extend(offsets.tobytes())
    out.extend(pool)
    return bytes(out)


def _pack_dict_bin_v3(n: int, entries: List[Tuple[int, int, int, int, int]]) -> bytes:
    out = bytearray()
    out.extend(struct.pack("<4sHHII", b"ZMHd", 3, n, len(entries), 0))
    out.extend(array("I", [k for (k, _, _, _, _) in entries]).tobytes())

    shard_ids = [s for (_, s, _, _, _) in entries]
    if any(s < 0 or s > 0xFF for s in shard_ids):
        raise RuntimeError("dict shardId 超出 uint8 范围")
    out.extend(bytes(shard_ids))
    _pad4(out)

    out.extend(array("I", [o for (_, _, o, _, _) in entries]).tobytes())

    lengths = [l for (_, _, _, l, _) in entries]
    if any(l < 0 or l > 0xFFFF for l in lengths):
        raise RuntimeError("dict length 超出 uint16 范围")
    out.extend(array("H", lengths).tobytes())

    dfs = [df for (_, _, _, _, df) in entries]
    if any(df < 0 or df > 0xFFFF for df in dfs):
        raise RuntimeError("dict df 超出 uint16 范围")
    out.extend(array("H", dfs).tobytes())
    return bytes(out)


def _encode_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint 仅支持非负整数")
    out = bytearray()
    v = value
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def _encode_postings(doc_ids: List[int]) -> bytes:
    out = bytearray()
    prev = -1
    for doc_id in doc_ids:
        delta = doc_id - prev
        if delta <= 0:
            raise ValueError("postings 必须严格递增")
        out.extend(_encode_varint(delta))
        prev = doc_id
    return bytes(out)


@dataclass(frozen=True)
class TagInfo:
    tag_id: int
    name: str
    count: int
    bit: int


def _iter_comic_json(conn: sqlite3.Connection):
    cur = conn.cursor()
    for (j,) in cur.execute("SELECT json FROM comics ORDER BY id"):
        yield json.loads(j)


def _collect_tags(conn: sqlite3.Connection) -> List[TagInfo]:
    tag_name_by_id: Dict[int, str] = {}
    tag_count_by_id: Dict[int, int] = {}

    for obj in _iter_comic_json(conn):
        for tag in obj.get("types") or []:
            tag_id = tag.get("tag_id")
            tag_name = tag.get("tag_name")
            if not isinstance(tag_id, int):
                continue
            if isinstance(tag_name, str) and tag_name:
                tag_name_by_id.setdefault(tag_id, tag_name)
            tag_count_by_id[tag_id] = tag_count_by_id.get(tag_id, 0) + 1

    tag_ids = sorted(tag_count_by_id.keys())
    if len(tag_ids) > 50:
        raise RuntimeError(f"tag 种类过多（{len(tag_ids)}），当前实现仅支持 <= 50")

    infos: List[TagInfo] = []
    for bit, tag_id in enumerate(tag_ids):
        infos.append(
            TagInfo(
                tag_id=tag_id,
                name=tag_name_by_id.get(tag_id, str(tag_id)),
                count=tag_count_by_id.get(tag_id, 0),
                bit=bit,
            )
        )

    return infos


def _index_shard_id(token_key: int, shard_count: int) -> int:
    if shard_count <= 1:
        return 0
    # 对 uint32 做乘法哈希（Knuth），保证稳定且分布相对均匀
    h = (int(token_key) * 2654435761) & 0xFFFFFFFF
    return int(h % shard_count)


def _build(
    conn: sqlite3.Connection,
    index_shard_count: int,
    meta_shard_docs: int,
) -> Tuple[List[bytes], List[bytes], bytes, bytes, dict, dict]:
    tags = _collect_tags(conn)
    tag_bit_by_id = {t.tag_id: t.bit for t in tags}

    ids: List[int] = []
    titles: List[str] = []
    covers: List[str] = []
    author_id_lists: List[List[int]] = []
    alias_texts: List[str] = []
    tag_lo: List[int] = []
    tag_hi: List[int] = []
    flags: List[int] = []
    author_name_by_id: Dict[int, str] = {}

    postings: Dict[str, List[int]] = {}

    doc_id = 0
    for obj in _iter_comic_json(conn):
        comic_id = obj.get("id")
        if not isinstance(comic_id, int):
            continue
        current_doc_id = doc_id
        doc_id += 1

        title = obj.get("title") or ""
        cover_raw = obj.get("cover") or ""
        cover = (
            cover_raw[8:]
            if isinstance(cover_raw, str) and cover_raw.startswith("https://")
            else cover_raw
        )

        authors: List[str] = []
        author_ids: List[int] = []
        for a in (obj.get("authors") or []):
            aid = a.get("tag_id")
            name = a.get("tag_name")
            if not isinstance(aid, int):
                continue
            if aid < 0 or aid > 0xFFFF:
                raise RuntimeError(f"authorId 超出 uint16 范围：{aid}")
            if not isinstance(name, str) or not name:
                continue
            author_ids.append(aid)
            authors.append(name)
            author_name_by_id.setdefault(aid, name)
        aliases = [a for a in (obj.get("aliases") or []) if isinstance(a, str) and a]
        tag_items = obj.get("types") or []

        mask_lo = 0
        mask_hi = 0
        mask_ex = 0
        for t in tag_items:
            tag_id = t.get("tag_id")
            if not isinstance(tag_id, int):
                continue
            bit = tag_bit_by_id.get(tag_id)
            if bit is None:
                continue
            if bit < 32:
                mask_lo |= 1 << bit
            elif bit < 48:
                mask_hi |= 1 << (bit - 32)
            elif bit < 50:
                mask_ex |= 1 << (bit - 48)
            else:
                raise RuntimeError(f"tag bit 超出可编码范围：{bit}")

        raw_hidden = obj.get("hidden")
        try:
            hidden_value = int(raw_hidden)
        except (TypeError, ValueError):
            hidden_value = 0
        hidden = 1 if hidden_value != 0 else 0
        hide_chapter = 1 if obj.get("isHideChapter") == 1 else 0
        raw_can_read = obj.get("canRead")
        can_read: Optional[bool]
        if isinstance(raw_can_read, bool):
            can_read = raw_can_read
        elif isinstance(raw_can_read, str):
            t = raw_can_read.strip().lower()
            if t in ("1", "true", "yes", "y"):
                can_read = True
            elif t in ("0", "false", "no", "n"):
                can_read = False
            else:
                can_read = None
        else:
            try:
                can_read = int(raw_can_read) != 0
            except (TypeError, ValueError):
                can_read = None

        if can_read is None:
            raw_need_login = obj.get("is_need_login")
            try:
                need_login_value = int(raw_need_login)
            except (TypeError, ValueError):
                need_login_value = 0
            need_login = 1 if need_login_value != 0 else 0
        else:
            need_login = 1 if not can_read else 0
        raw_is_lock = obj.get("is_lock")
        try:
            is_lock_value = int(raw_is_lock)
        except (TypeError, ValueError):
            is_lock_value = 0
        is_lock = 1 if is_lock_value != 0 else 0
        f = (
            (hidden & 1)
            | ((hide_chapter & 1) << 1)
            | ((need_login & 1) << 2)
            | ((is_lock & 1) << 3)
            | ((mask_ex & 0b11) << 4)
        )

        ids.append(comic_id)
        titles.append(title)
        covers.append(cover)
        author_id_lists.append(author_ids)
        alias_texts.append(LIST_SEP.join(aliases))
        tag_lo.append(mask_lo)
        tag_hi.append(mask_hi)
        flags.append(f)

        grams = set()
        if isinstance(title, str) and title:
            grams.update(_ngrams(_norm_text(title)))
        for alias in aliases:
            grams.update(_ngrams(_norm_text(alias)))
        for author in authors:
            grams.update(_ngrams(_norm_text(author)))

        for gram in grams:
            postings.setdefault(gram, []).append(current_doc_id)

    tags_json = {
        "version": 1,
        "tags": [
            {
                "tagId": t.tag_id,
                "name": t.name,
                "count": t.count,
                "bit": t.bit,
            }
            for t in sorted(tags, key=lambda x: (-x.count, x.name, x.tag_id))
        ],
    }

    dict_items: List[Tuple[int, List[int]]] = []
    skipped = 0
    for token, doc_ids in postings.items():
        key = _token_key(token)
        if key is None:
            skipped += 1
            continue
        dict_items.append((key, doc_ids))

    dict_items.sort(key=lambda x: x[0])
    for i in range(1, len(dict_items)):
        if dict_items[i][0] == dict_items[i - 1][0]:
            raise RuntimeError("dict tokenKey 冲突（非唯一）")

    shard_count = int(index_shard_count or 0)
    if shard_count <= 0:
        shard_count = 1

    shard_out = [bytearray() for _ in range(shard_count)]
    entries_v3: List[Tuple[int, int, int, int, int]] = []
    index_total = 0
    for key, doc_ids in dict_items:
        data = _encode_postings(doc_ids)
        shard_id = _index_shard_id(key, shard_count)
        local_off = len(shard_out[shard_id])
        shard_out[shard_id].extend(data)
        index_total += len(data)
        entries_v3.append((key, shard_id, local_off, len(data), len(doc_ids)))

    dict_bin = _pack_dict_bin_v3(NGRAM_N, entries_v3)
    authors_dict_bin = _pack_authors_dict_bin(author_name_by_id)
    index_parts = [bytes(b) for b in shard_out]

    meta_docs = int(meta_shard_docs or 0)
    if meta_docs <= 0:
        meta_docs = len(ids) or 1

    meta_parts: List[bytes] = []
    for start in range(0, len(ids), meta_docs):
        end = min(len(ids), start + meta_docs)
        meta_parts.append(
            _pack_meta_bin(
                ids=ids[start:end],
                titles=titles[start:end],
                covers=covers[start:end],
                author_id_lists=author_id_lists[start:end],
                alias_texts=alias_texts[start:end],
                tag_lo=tag_lo[start:end],
                tag_hi=tag_hi[start:end],
                flags=flags[start:end],
                sep=LIST_SEP,
            )
        )

    stats = {
        "version": 5,
        "count": len(ids),
        "authorDictCount": len(author_name_by_id),
        "uniqueTokens": len(entries_v3),
        "indexBytes": index_total,
        "indexShardCount": shard_count,
        "indexShardMode": "tokenKeyHash",
        "metaShardDocs": meta_docs,
        "metaShardCount": len(meta_parts),
    }

    if skipped > 0:
        print(f"提示：有 {skipped} 个 token 无法编码为 utf-16 2-unit key，已跳过", file=sys.stderr)

    return meta_parts, index_parts, dict_bin, authors_dict_bin, tags_json, stats


def _parse_args(argv: List[str]):
    parser = ArgumentParser(description="从 zaimanhua.sqlite3 离线生成前端检索索引（写入 public/assets/）。")
    parser.add_argument(
        "db",
        nargs="?",
        default=str(DEFAULT_DB_PATH),
        help=f"SQLite 数据库文件路径（默认：{DEFAULT_DB_PATH.as_posix()}）",
    )
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help=f"索引输出目录（默认：{DEFAULT_OUT_DIR.as_posix()}）",
    )
    parser.add_argument(
        "--generated-at",
        default="",
        help="写入到 manifest.json 的 generatedAt 覆盖值（建议 ISO-8601，例如 2026-01-31T00:00:00Z）。默认使用当前 UTC 时间。",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="生成完成后清理 out_dir 中旧的索引产物（仅删除 meta-lite.* / ngram.* / authors.dict.* / tags.*）。",
    )
    parser.add_argument(
        "--meta-shard-docs",
        type=int,
        default=4096,
        help="将 meta-lite 按固定条目数分片（用于高频小增量更新）。设为 0 表示不分片。默认：4096。",
    )
    parser.add_argument(
        "--index-shard-count",
        type=int,
        default=8,
        help="将 ngram.index 按 tokenKey 哈希固定分片的数量。设为 0 表示单分片。默认：8。",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = _parse_args(sys.argv[1:])
    db_path = Path(args.db)
    out_dir = Path(args.out_dir)
    generated_at = (args.generated_at or "").strip() or datetime.now(timezone.utc).isoformat()
    index_shard_count = int(getattr(args, "index_shard_count", 0) or 0)
    meta_shard_docs = int(getattr(args, "meta_shard_docs", 0) or 0)

    if not db_path.exists():
        print(f"找不到数据库文件：{db_path.as_posix()}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path.as_posix())
    try:
        meta_parts, index_parts, dict_bin, authors_dict_bin, tags_json, stats = _build(
            conn,
            index_shard_count=index_shard_count,
            meta_shard_docs=meta_shard_docs,
        )
    finally:
        conn.close()

    dict_bytes = dict_bin
    authors_dict_bytes = authors_dict_bin
    tags_bytes = _json_bytes(tags_json)

    meta_assets = []
    for i, data in enumerate(meta_parts):
        name, sha, size = _write_hashed(out_dir, f"meta-lite.s{i:03d}", ".bin", data)
        meta_assets.append({"path": f"assets/{name}", "sha256": sha, "bytes": size})

    dict_name, dict_sha, dict_size = _write_hashed(out_dir, "ngram.dict", ".bin", dict_bytes)
    authors_name, authors_sha, authors_size = _write_hashed(
        out_dir, "authors.dict", ".bin", authors_dict_bytes
    )
    tags_name, tags_sha, tags_size = _write_hashed(out_dir, "tags", ".json", tags_bytes)

    index_assets = []
    for i, data in enumerate(index_parts):
        name, sha, size = _write_hashed(out_dir, f"ngram.index.h{i:03d}", ".bin", data)
        index_assets.append({"path": f"assets/{name}", "sha256": sha, "bytes": size})

    manifest = {
        "version": 3,
        "generatedAt": generated_at,
        "stats": stats,
        "assets": {
            "metaShards": meta_assets,
            "dict": {"path": f"assets/{dict_name}", "sha256": dict_sha, "bytes": dict_size},
            "authors": {"path": f"assets/{authors_name}", "sha256": authors_sha, "bytes": authors_size},
            "tags": {"path": f"assets/{tags_name}", "sha256": tags_sha, "bytes": tags_size},
            "indexShards": index_assets,
        },
    }

    (out_dir / "manifest.json").write_bytes(_json_bytes(manifest))

    if args.clean:
        keep_meta_names = [a["path"].split("/")[-1] for a in meta_assets]
        keep_index_names = [a["path"].split("/")[-1] for a in index_assets]
        _clean_generated(
            out_dir,
            keep=[
                ".gitkeep",
                "manifest.json",
                dict_name,
                authors_name,
                tags_name,
                *keep_meta_names,
                *keep_index_names,
            ],
        )

    print("已生成索引：")
    print(f"- {out_dir.as_posix()}/manifest.json")
    for a in meta_assets:
        print(f"- {out_dir.as_posix()}/{a['path'].split('/')[-1]}")
    print(f"- {out_dir.as_posix()}/{dict_name}")
    print(f"- {out_dir.as_posix()}/{authors_name}")
    print(f"- {out_dir.as_posix()}/{tags_name}")
    for a in index_assets:
        print(f"- {out_dir.as_posix()}/{a['path'].split('/')[-1]}")
    print(f"- 条目数：{stats['count']}，token：{stats['uniqueTokens']}，index：{stats['indexBytes']} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
