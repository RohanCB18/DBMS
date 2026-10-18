from app.merge import merge_snapshots

BASE = {"c:1": {"phone": "111", "city": "Pune"}, "c:2": {"phone": "222", "city": "Goa"}}


def test_untouched_and_identical_changes():
    ours = {**BASE, "c:1": {"phone": "999", "city": "Pune"}}
    merged, conflicts, _ = merge_snapshots(BASE, ours, dict(ours))
    assert merged == ours and conflicts == []


def test_one_sided_changes_are_taken():
    ours = {**BASE, "c:1": {"phone": "999", "city": "Pune"}}
    theirs = {**BASE, "c:2": {"phone": "222", "city": "Delhi"}}
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert conflicts == []
    assert merged["c:1"]["phone"] == "999" and merged["c:2"]["city"] == "Delhi"


def test_field_level_merge_of_same_record():
    ours = {**BASE, "c:1": {"phone": "999", "city": "Pune"}}
    theirs = {**BASE, "c:1": {"phone": "111", "city": "Mumbai"}}
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert conflicts == []
    assert merged["c:1"] == {"phone": "999", "city": "Mumbai"}


def test_same_field_changed_differently_conflicts():
    ours = {**BASE, "c:1": {"phone": "999", "city": "Pune"}}
    theirs = {**BASE, "c:1": {"phone": "888", "city": "Pune"}}
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert conflicts == [{"key": "c:1", "field": "phone", "base": "111", "ours": "999", "theirs": "888"}]
    assert "c:1" not in merged


def test_field_resolution_wins_over_record_resolution():
    ours = {**BASE, "c:1": {"phone": "999", "city": "X"}}
    theirs = {**BASE, "c:1": {"phone": "888", "city": "Y"}}
    res = {"c:1": "ours", "c:1|phone": "theirs"}
    merged, conflicts, resolved = merge_snapshots(BASE, ours, theirs, res)
    assert conflicts == [] and resolved == 2
    assert merged["c:1"] == {"phone": "888", "city": "X"}


def test_additions_and_deletions():
    ours = {k: v for k, v in BASE.items() if k != "c:2"}             # we deleted c:2
    theirs = {**BASE, "c:3": {"phone": "333", "city": "Agra"}}       # they added c:3
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert conflicts == [] and set(merged) == {"c:1", "c:3"}


def test_delete_vs_modify_is_a_record_conflict():
    ours = {k: v for k, v in BASE.items() if k != "c:2"}
    theirs = {**BASE, "c:2": {"phone": "000", "city": "Goa"}}
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert len(conflicts) == 1 and conflicts[0]["field"] is None and conflicts[0]["ours"] is None
    merged, conflicts, _ = merge_snapshots(BASE, ours, theirs, {"c:2": "theirs"})
    assert conflicts == [] and merged["c:2"]["phone"] == "000"
    merged, _, _ = merge_snapshots(BASE, ours, theirs, {"c:2": "ours"})
    assert "c:2" not in merged


def test_both_added_same_key_differently():
    ours = {**BASE, "c:9": {"phone": "1", "city": "A"}}
    theirs = {**BASE, "c:9": {"phone": "1", "city": "B"}}
    _, conflicts, _ = merge_snapshots(BASE, ours, theirs)
    assert conflicts == [{"key": "c:9", "field": "city", "base": None, "ours": "A", "theirs": "B"}]


def test_field_added_on_one_side_and_removed_on_other():
    base = {"c:1": {"a": 1, "b": 2}}
    ours = {"c:1": {"a": 1, "b": 2, "new": 5}}
    theirs = {"c:1": {"a": 1}}
    merged, conflicts, _ = merge_snapshots(base, ours, theirs)
    assert conflicts == [] and merged["c:1"] == {"a": 1, "new": 5}
