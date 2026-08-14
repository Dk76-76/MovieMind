import pickle
from pathlib import Path

files = [
    "df.pkl",
    "indices.pkl",
    "tfidf_matrix.pkl",
    "tfidf.pkl"
]

for filename in files:
    path = Path(filename)

    print("\n" + "=" * 60)
    print(f"FILE: {filename}")
    print("=" * 60)

    if not path.exists():
        print("❌ FILE NOT FOUND")
        continue

    try:
        with open(path, "rb") as f:
            obj = pickle.load(f)

        print("TYPE:", type(obj))

        if hasattr(obj, "shape"):
            print("SHAPE:", obj.shape)

        if hasattr(obj, "columns"):
            print("COLUMNS:")
            print(list(obj.columns))

        if hasattr(obj, "head"):
            print("\nFIRST 5 ROWS:")
            print(obj.head().to_string())

        if hasattr(obj, "__len__"):
            try:
                print("\nLENGTH:", len(obj))
            except Exception:
                pass

        if filename == "tfidf.pkl":
            if hasattr(obj, "vocabulary_"):
                print("TF-IDF VOCABULARY SIZE:", len(obj.vocabulary_))

            if hasattr(obj, "get_feature_names_out"):
                try:
                    features = obj.get_feature_names_out()
                    print("FEATURE COUNT:", len(features))
                    print("FIRST 20 FEATURES:", features[:20])
                except Exception:
                    pass

    except Exception as e:
        print("❌ ERROR:", type(e).__name__, str(e))
        