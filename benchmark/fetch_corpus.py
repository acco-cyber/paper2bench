#!/usr/bin/env python3
"""
Paper2Bench benchmark corpus fetcher.

Downloads arXiv papers as HTML (arxiv.org/html first, then ar5iv fallback),
strips markup to plain text, and stores one .txt per paper.

Every benchmark annotation is later verified against THIS text, so the
corpus is the single source of truth for what the papers actually say.

Usage:
  python3 benchmark/fetch_corpus.py            # fetch all missing
  python3 benchmark/fetch_corpus.py --force    # refetch everything
"""
import html
import json
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")

# First batch of the Paper2Bench Reproducibility Benchmark corpus.
# Landmark CV/NLP training papers chosen for taxonomy relevance
# (optimizer / schedule / batch / architecture / decoding fields).
PAPERS = [
    {"id": "1706.03762", "title": "Attention Is All You Need", "venue": "NeurIPS 2017"},
    {"id": "1512.03385", "title": "Deep Residual Learning for Image Recognition", "venue": "CVPR 2016"},
    {"id": "1810.04805", "title": "BERT: Pre-training of Deep Bidirectional Transformers", "venue": "NAACL 2019"},
    {"id": "1412.6980", "title": "Adam: A Method for Stochastic Optimization", "venue": "ICLR 2015"},
    {"id": "2010.11929", "title": "An Image is Worth 16x16 Words (ViT)", "venue": "ICLR 2021"},
    {"id": "1608.06993", "title": "Densely Connected Convolutional Networks", "venue": "CVPR 2017"},
    {"id": "1605.07146", "title": "Wide Residual Networks", "venue": "BMVC 2017"},
    {"id": "1409.1556", "title": "Very Deep Convolutional Networks (VGG)", "venue": "ICLR 2015"},
    {"id": "1910.01108", "title": "RoBERTa: A Robustly Optimized BERT Pretraining Approach", "venue": "arXiv 2019"},
    {"id": "1905.11946", "title": "EfficientNet: Rethinking Model Scaling", "venue": "ICML 2019"},
    {"id": "1801.04381", "title": "MobileNetV2: Inverted Residuals and Linear Bottlenecks", "venue": "CVPR 2018"},
    {"id": "1511.06434", "title": "Unsupervised Representation Learning with DCGANs", "venue": "ICLR 2016"},
    {"id": "1611.05431", "title": "Aggregated Residual Transformations (ResNeXt)", "venue": "CVPR 2017"},
]

SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "nav", "footer", "head", "form", "iframe"}
BLOCK_TAGS = {"p", "div", "section", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "figcaption", "br", "table", "figure"}


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip_depth += 1
        elif tag in BLOCK_TAGS and self._skip_depth == 0:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag in BLOCK_TAGS and self._skip_depth == 0:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self.parts.append(data)


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Paper2Bench-benchmark/1.0 (corpus fetch)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def html_to_text(raw: bytes) -> str:
    parser = TextExtractor()
    parser.feed(raw.decode("utf-8", errors="replace"))
    text = "".join(parser.parts)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return html.unescape(text).strip() + "\n"


def sanity_check(text: str, paper_id: str) -> bool:
    """Reject pages that clearly failed to contain the paper body."""
    if len(text) < 20_000:
        return False
    # The arXiv page chrome alone is ~3-6k chars; real papers are 30k+.
    words = len(text.split())
    return words > 3_000


def fetch_one(paper: dict, force: bool) -> dict:
    pid = paper["id"]
    safe = pid.replace("/", "_")
    out_path = os.path.join(CORPUS, f"{safe}.txt")
    meta_path = os.path.join(CORPUS, f"{safe}.json")

    if os.path.exists(out_path) and not force:
        return {"id": pid, "status": "cached", "chars": os.path.getsize(out_path)}

    errors = []
    for base in (f"https://arxiv.org/html/{pid}v3", f"https://arxiv.org/html/{pid}v2",
                 f"https://arxiv.org/html/{pid}", f"https://ar5iv.labs.arxiv.org/html/{pid}"):
        try:
            text = html_to_text(fetch(base))
            if sanity_check(text, pid):
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(text)
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump({"id": pid, "title": paper["title"], "venue": paper["venue"],
                               "source": base, "chars": len(text)}, f, indent=2)
                return {"id": pid, "status": "fetched", "source": base, "chars": len(text)}
            errors.append(f"{base}: too short ({len(text)} chars)")
        except Exception as e:  # noqa: BLE001 - report every source failure
            errors.append(f"{base}: {type(e).__name__}: {e}")
    return {"id": pid, "status": "FAILED", "errors": errors}


def main() -> int:
    force = "--force" in sys.argv
    os.makedirs(CORPUS, exist_ok=True)
    results = [fetch_one(p, force) for p in PAPERS]
    ok = [r for r in results if r["status"] in ("fetched", "cached")]
    failed = [r for r in results if r["status"] == "FAILED"]
    for r in results:
        if r["status"] == "FAILED":
            print(f"  FAIL {r['id']}: " + "; ".join(r.get("errors", []))[:200])
        else:
            print(f"  ok   {r['id']}: {r['status']} ({r['chars']:,} chars)")
    print(f"\nCorpus: {len(ok)}/{len(PAPERS)} papers available")
    return 1 if len(ok) < len(PAPERS) - 2 else 0  # tolerate at most 2 failures


if __name__ == "__main__":
    sys.exit(main())
