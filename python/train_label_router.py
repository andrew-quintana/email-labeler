#!/usr/bin/env python3
"""
Train label router head: embed (sentence-transformers) + multi-class logistic regression.
Reads JSON from file: argv[1] = path to [{"text": "...", "target_label": "..."}, ...]
Writes model to argv[2] (default: ./label_router_model.pkl).
Prints JSON: { "samples": int, "labels": int, "path": str }
"""
import json
import sys
import os


def main():
    if len(sys.argv) < 2:
        print("Usage: train_label_router.py <data.json> [output.pkl]", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = json.load(f)
    if not data:
        print("No samples", file=sys.stderr)
        sys.exit(1)

    try:
        from sentence_transformers import SentenceTransformer
        from sklearn.linear_model import LogisticRegression
        import pickle
    except ImportError as e:
        print(f"Import error: {e}. Install sentence-transformers scikit-learn", file=sys.stderr)
        sys.exit(2)

    texts = [row.get("text") or "" for row in data]
    targets = [row.get("target_label") or "other" for row in data]

    # Stable sorted label list
    label_list = sorted(set(targets))

    if len(label_list) < 2:
        print(json.dumps({
            "samples": len(data),
            "labels": len(label_list),
            "skipped": True,
            "reason": f"Need at least 2 distinct labels to train, got {len(label_list)}",
        }))
        sys.exit(0)

    model_name = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    embedder = SentenceTransformer(model_name)
    X = embedder.encode(texts)

    clf = LogisticRegression(max_iter=500, solver="lbfgs")
    clf.fit(X, targets)

    out_path = sys.argv[2] if len(sys.argv) > 2 else "./label_router_model.pkl"
    with open(out_path, "wb") as f:
        pickle.dump({
            "embedder_name": model_name,
            "classifier": clf,
            "label_list": label_list,
        }, f)

    print(json.dumps({"samples": len(data), "labels": len(label_list), "path": out_path}))


if __name__ == "__main__":
    main()
