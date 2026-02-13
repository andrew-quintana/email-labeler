#!/usr/bin/env python3
"""
Infer label-router head weights from a trained artifact.
argv[1] = path to pickle artifact (embedder_name, classifier, label_list)
argv[2] = text to classify (summary)
Prints JSON: { "head_weights": { label: float, ... }, "label_list": [...] }
"""
import json
import sys
import os


def main():
    if len(sys.argv) < 3:
        print("Usage: infer_label_router.py <model.pkl> <text>", file=sys.stderr)
        sys.exit(1)

    model_path = sys.argv[1]
    text = sys.argv[2]

    try:
        import pickle
        from sentence_transformers import SentenceTransformer
        import numpy as np
    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        sys.exit(2)

    with open(model_path, "rb") as f:
        artifact = pickle.load(f)

    embedder_name = artifact.get("embedder_name", "all-MiniLM-L6-v2")
    classifier = artifact["classifier"]
    label_list = artifact["label_list"]

    embedder = SentenceTransformer(embedder_name)
    embedding = embedder.encode([text])

    # Get probabilities for each class
    proba = classifier.predict_proba(embedding)[0]
    # Map to label_list order (classifier.classes_ may differ)
    head_weights = {}
    classes = list(classifier.classes_)
    for i, label in enumerate(label_list):
        if label in classes:
            idx = classes.index(label)
            head_weights[label] = float(proba[idx])
        else:
            head_weights[label] = 0.0

    print(json.dumps({"head_weights": head_weights, "label_list": label_list}))


if __name__ == "__main__":
    main()
