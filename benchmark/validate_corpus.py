#!/usr/bin/env python3
"""
Corpus integrity check: every annotation's must_contain strings must exist
in the fetched paper text. Guards against (a) broken fetches, (b) annotator
memory errors. Exits non-zero on any failure.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
ANN = os.path.join(HERE, "annotations")


def norm(s: str) -> str:
    return " ".join(s.split())


def main() -> int:
    failures = 0
    refs_total = 0
    for fname in sorted(os.listdir(ANN)):
        if not fname.endswith(".json"):
            continue
        ann = json.load(open(os.path.join(ANN, fname), encoding="utf-8"))
        pid = ann["paper_id"]
        text_path = os.path.join(CORPUS, f"{pid}.txt")
        if not os.path.exists(text_path):
            print(f"  FAIL {pid}: corpus text missing")
            failures += 1
            continue
        text = norm(open(text_path, encoding="utf-8").read())
        refs = ann["references"]
        refs_total += len(refs)
        bad = 0
        for r in refs:
            if not any(norm(mc) in text for mc in r["must_contain"]):
                print(f"  FAIL {pid} {r['field_path']}: none of {r['must_contain']} found in text")
                bad += 1
        if bad:
            failures += bad
        else:
            print(f"  ok   {pid}: {len(refs)} references verified against text")
    print(f"\nCorpus integrity: {refs_total - failures}/{refs_total} references verified "
          f"({len(os.listdir(ANN))} annotation files)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
