"""Three-way merge of database snapshots — pure functions, no database access.

Inputs are three snapshots as {record_key: {column: value}} (a missing key = record absent).
The rule, applied first per record and then per field when both sides touched a record:

    ours == theirs  -> take it          (same change on both sides, or untouched)
    ours == base    -> take theirs      (only they changed it)
    theirs == base  -> take ours        (only we changed it)
    otherwise       -> conflict         (changed differently on both sides)

Deleted-on-one-side / modified-on-the-other is a record-level conflict (field = None).

`resolutions` maps "key" or "key|field" to "ours" | "theirs"; the most specific entry wins.
"""
MISSING = object()


def _pick(b, o, t):
    """Returns (value, conflicted)."""
    if o == t:
        return o, False
    if o == b:
        return t, False
    if t == b:
        return o, False
    return None, True


def _public(v):
    return None if v is MISSING else v


def _resolution(resolutions: dict, key: str, field: str | None):
    if field is not None and f"{key}|{field}" in resolutions:
        return resolutions[f"{key}|{field}"]
    return resolutions.get(key)


def merge_snapshots(base: dict, ours: dict, theirs: dict, resolutions: dict | None = None):
    """Returns (merged {key: record}, conflicts [...], resolved_count)."""
    resolutions = resolutions or {}
    merged, conflicts, resolved = {}, [], 0
    for key in sorted(set(base) | set(ours) | set(theirs)):
        b, o, t = base.get(key, MISSING), ours.get(key, MISSING), theirs.get(key, MISSING)
        value, conflicted = _pick(b, o, t)
        if not conflicted:
            if value is not MISSING:
                merged[key] = value
            continue

        if o is MISSING or t is MISSING:
            # deleted on one side, modified on the other: decide the whole record
            choice = _resolution(resolutions, key, None)
            if choice in ("ours", "theirs"):
                resolved += 1
                value = o if choice == "ours" else t
                if value is not MISSING:
                    merged[key] = value
            else:
                conflicts.append({"key": key, "field": None, "base": _public(b),
                                  "ours": _public(o), "theirs": _public(t)})
            continue

        # both sides kept the record but changed it differently: merge field by field
        bf = {} if b is MISSING else b
        record, record_conflicted = {}, False
        for field in sorted(set(bf) | set(o) | set(t)):
            fb, fo, ft = bf.get(field, MISSING), o.get(field, MISSING), t.get(field, MISSING)
            fv, fc = _pick(fb, fo, ft)
            if fc:
                choice = _resolution(resolutions, key, field)
                if choice in ("ours", "theirs"):
                    resolved += 1
                    fv = fo if choice == "ours" else ft
                else:
                    record_conflicted = True
                    conflicts.append({"key": key, "field": field, "base": _public(fb),
                                      "ours": _public(fo), "theirs": _public(ft)})
                    continue
            if fv is not MISSING:
                record[field] = fv
        if not record_conflicted:
            merged[key] = record
    return merged, conflicts, resolved
