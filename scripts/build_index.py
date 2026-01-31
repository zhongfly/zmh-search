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
    prefixes = ("meta-lite.", "ngram.dict.", "ngram.index.", "tags.")

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


def _pad4(out: bytearray) -> None:
    while (len(out) % 4) != 0:
        out.append(0)


def _pack_meta_bin(
    ids: List[int],
    titles: List[str],
    covers: List[str],
    author_texts: List[str],
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
        and len(author_texts) == count
        and len(alias_texts) == count
        and len(tag_lo) == count
        and len(tag_hi) == count
        and len(flags) == count
    ):
        raise RuntimeError("meta 字段长度不一致")

    out = bytearray()
    out.extend(struct.pack("<4sHHII", b"ZMHm", 1, ord(sep), count, 0))

    ids_arr = array("i", ids)
    if ids_arr.itemsize != 4:
        raise RuntimeError("array('i') itemsize != 4")
    out.extend(ids_arr.tobytes())

    lo_arr = array("I", tag_lo)
    hi_arr = array("I", tag_hi)
    if lo_arr.itemsize != 4 or hi_arr.itemsize != 4:
        raise RuntimeError("array('I') itemsize != 4")
    out.extend(lo_arr.tobytes())
    out.extend(hi_arr.tobytes())

    out.extend(bytes(flags))
    _pad4(out)

    for strings in (titles, covers, author_texts, alias_texts):
        offsets, pool = _build_string_pool(strings)
        if offsets.itemsize != 4:
            raise RuntimeError("offsets itemsize != 4")
        out.extend(offsets.tobytes())
        out.extend(pool)
        _pad4(out)

    return bytes(out)


def _pack_dict_bin(n: int, entries: List[Tuple[int, int, int, int]]) -> bytes:
    out = bytearray()
    out.extend(struct.pack("<4sHHII", b"ZMHd", 1, n, len(entries), 0))
    out.extend(array("I", [k for (k, _, _, _) in entries]).tobytes())
    out.extend(array("I", [o for (_, o, _, _) in entries]).tobytes())
    out.extend(array("I", [l for (_, _, l, _) in entries]).tobytes())
    out.extend(array("I", [df for (_, _, _, df) in entries]).tobytes())
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
    if len(tag_ids) > 64:
        raise RuntimeError(f"tag 种类过多（{len(tag_ids)}），当前实现仅支持 <= 64")

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


def _build(conn: sqlite3.Connection) -> Tuple[bytes, bytes, bytes, dict, dict]:
    tags = _collect_tags(conn)
    tag_bit_by_id = {t.tag_id: t.bit for t in tags}

    ids: List[int] = []
    titles: List[str] = []
    covers: List[str] = []
    author_texts: List[str] = []
    alias_texts: List[str] = []
    tag_lo: List[int] = []
    tag_hi: List[int] = []
    flags: List[int] = []

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

        authors = [
            a.get("tag_name")
            for a in (obj.get("authors") or [])
            if isinstance(a.get("tag_name"), str) and a.get("tag_name")
        ]
        aliases = [a for a in (obj.get("aliases") or []) if isinstance(a, str) and a]
        tag_items = obj.get("types") or []

        mask_lo = 0
        mask_hi = 0
        for t in tag_items:
            tag_id = t.get("tag_id")
            if not isinstance(tag_id, int):
                continue
            bit = tag_bit_by_id.get(tag_id)
            if bit is None:
                continue
            if bit < 32:
                mask_lo |= 1 << bit
            else:
                mask_hi |= 1 << (bit - 32)

        raw_hidden = obj.get("hidden")
        try:
            hidden_value = int(raw_hidden)
        except (TypeError, ValueError):
            hidden_value = 0
        hidden = 1 if hidden_value != 0 else 0
        hide_chapter = 1 if obj.get("isHideChapter") == 1 else 0
        raw_need_login = obj.get("is_need_login")
        try:
            need_login_value = int(raw_need_login)
        except (TypeError, ValueError):
            need_login_value = 0
        need_login = 1 if need_login_value != 0 else 0
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
        )

        ids.append(comic_id)
        titles.append(title)
        covers.append(cover)
        author_texts.append(LIST_SEP.join(authors))
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

    entries: List[Tuple[int, int, int, int]] = []
    index_out = bytearray()
    offset = 0
    for key, doc_ids in dict_items:
        data = _encode_postings(doc_ids)
        entries.append((key, offset, len(data), len(doc_ids)))
        index_out.extend(data)
        offset += len(data)

    dict_bin = _pack_dict_bin(NGRAM_N, entries)
    meta_bin = _pack_meta_bin(
        ids=ids,
        titles=titles,
        covers=covers,
        author_texts=author_texts,
        alias_texts=alias_texts,
        tag_lo=tag_lo,
        tag_hi=tag_hi,
        flags=flags,
        sep=LIST_SEP,
    )

    stats = {
        "version": 1,
        "count": len(ids),
        "uniqueTokens": len(entries),
        "indexBytes": len(index_out),
    }

    if skipped > 0:
        print(f"提示：有 {skipped} 个 token 无法编码为 utf-16 2-unit key，已跳过", file=sys.stderr)

    return meta_bin, bytes(index_out), dict_bin, tags_json, stats


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
        help="生成完成后清理 out_dir 中旧的索引产物（仅删除 meta-lite.* / ngram.* / tags.*）。",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = _parse_args(sys.argv[1:])
    db_path = Path(args.db)
    out_dir = Path(args.out_dir)
    generated_at = (args.generated_at or "").strip() or datetime.now(timezone.utc).isoformat()

    if not db_path.exists():
        print(f"找不到数据库文件：{db_path.as_posix()}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path.as_posix())
    try:
        meta_bin, index_bin, dict_bin, tags_json, stats = _build(conn)
    finally:
        conn.close()

    meta_bytes = meta_bin
    dict_bytes = dict_bin
    tags_bytes = _json_bytes(tags_json)

    meta_name, meta_sha, meta_size = _write_hashed(out_dir, "meta-lite", ".bin", meta_bytes)
    dict_name, dict_sha, dict_size = _write_hashed(out_dir, "ngram.dict", ".bin", dict_bytes)
    tags_name, tags_sha, tags_size = _write_hashed(out_dir, "tags", ".json", tags_bytes)
    index_name, index_sha, index_size = _write_hashed(out_dir, "ngram.index", ".bin", index_bin)

    manifest = {
        "version": 1,
        "generatedAt": generated_at,
        "stats": stats,
        "assets": {
            "meta": {"path": f"assets/{meta_name}", "sha256": meta_sha, "bytes": meta_size},
            "dict": {"path": f"assets/{dict_name}", "sha256": dict_sha, "bytes": dict_size},
            "tags": {"path": f"assets/{tags_name}", "sha256": tags_sha, "bytes": tags_size},
            "index": {"path": f"assets/{index_name}", "sha256": index_sha, "bytes": index_size},
        },
    }

    (out_dir / "manifest.json").write_bytes(_json_bytes(manifest))

    if args.clean:
        _clean_generated(
            out_dir,
            keep=[
                ".gitkeep",
                "manifest.json",
                meta_name,
                dict_name,
                tags_name,
                index_name,
            ],
        )

    print("已生成索引：")
    print(f"- {out_dir.as_posix()}/manifest.json")
    print(f"- {out_dir.as_posix()}/{meta_name}")
    print(f"- {out_dir.as_posix()}/{dict_name}")
    print(f"- {out_dir.as_posix()}/{tags_name}")
    print(f"- {out_dir.as_posix()}/{index_name}")
    print(f"- 条目数：{stats['count']}，token：{stats['uniqueTokens']}，index：{stats['indexBytes']} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
