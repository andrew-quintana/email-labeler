#!/usr/bin/env python3
"""
Train importance classifier: embed (sentence-transformers) + logistic regression.
Reads JSON from file: argv[1] = path to [{"text": "...", "important": true/false}, ...]
Writes model to argv[2] (default: ./important_model.pkl).
"""
import json
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: train_important.py <data.json> [output.pkl]", file=sys.stderr)
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
    labels = [bool(row.get("important")) for row in data]

    if len(set(labels)) < 2:
        print(json.dumps({
            "samples": len(data),
            "skipped": True,
            "reason": f"Need both True and False labels to train, got only {labels[0]}",
        }))
        sys.exit(0)

    model_name = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    embedder = SentenceTransformer(model_name)
    X = embedder.encode(texts)

    clf = LogisticRegression(max_iter=500)
    clf.fit(X, labels)

    out_path = sys.argv[2] if len(sys.argv) > 2 else "./important_model.pkl"
    with open(out_path, "wb") as f:
        pickle.dump({"embedder_name": model_name, "classifier": clf}, f)

    print(json.dumps({"samples": len(data), "path": out_path}))


if __name__ == "__main__":
    main()
