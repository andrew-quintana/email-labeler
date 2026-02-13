#!/usr/bin/env python3
"""
Infer importance from a trained classifier artifact.
Reads: argv[1] = path to pickle artifact (embedder_name, classifier)
       argv[2] = text to classify (summary or summary + snippet)
Prints JSON: { "important": true/false, "probability": float }
"""
import json
import sys
import os


def main():
    if len(sys.argv) < 3:
        print("Usage: infer_important.py <model.pkl> <text>", file=sys.stderr)
        sys.exit(1)

    model_path = sys.argv[1]
    text = sys.argv[2]

    try:
        import pickle
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        sys.exit(2)

    with open(model_path, "rb") as f:
        artifact = pickle.load(f)

    embedder_name = artifact.get("embedder_name", "all-MiniLM-L6-v2")
    classifier = artifact["classifier"]

    embedder = SentenceTransformer(embedder_name)
    embedding = embedder.encode([text])

    proba = classifier.predict_proba(embedding)[0]
    # proba is [P(False), P(True)] for binary classifier
    p_important = float(proba[1]) if len(proba) > 1 else float(proba[0])
    important = p_important >= 0.5

    print(json.dumps({"important": important, "probability": round(p_important, 4)}))


if __name__ == "__main__":
    main()
