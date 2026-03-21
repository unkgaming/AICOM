import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from PIL import ImageGrab
from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quick detector checker for desktop UI model")
    parser.add_argument("--model", default="best (1).pt", help="Path to .pt model")
    parser.add_argument("--labels", default="searchbar", help="Comma-separated labels to report")
    parser.add_argument("--conf", type=float, default=0.2, help="Confidence threshold")
    parser.add_argument("--tries", type=int, default=5, help="How many screenshots to test")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between tries")
    parser.add_argument("--out", default="data/logs/model-check", help="Output folder for annotated images + json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    wanted = {x.strip().lower() for x in args.labels.split(",") if x.strip()}

    model_path = Path(args.model)
    if not model_path.is_absolute():
        model_path = (Path.cwd() / model_path).resolve()

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = (Path.cwd() / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(model_path))

    summary = {
        "model": str(model_path),
        "labels": sorted(wanted),
        "conf": args.conf,
        "tries": args.tries,
        "delay": args.delay,
        "runs": []
    }

    print(f"[check_model] model={model_path}")
    print(f"[check_model] labels={sorted(wanted)} conf={args.conf} tries={args.tries}")

    found_any = False

    for i in range(1, args.tries + 1):
        ts = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        img = ImageGrab.grab()

        result = model.predict(source=img, conf=args.conf, verbose=False)[0]
        plotted = result.plot()

        image_path = out_dir / f"attempt-{i:02d}-{ts}.png"

        # plotted is a numpy array (BGR). PIL can save from array directly.
        from PIL import Image

        Image.fromarray(plotted).save(image_path)

        detections = []
        boxes = result.boxes
        if boxes is not None:
            for b in boxes:
                cls_id = int(b.cls.item())
                label = str(model.names.get(cls_id, cls_id))
                conf = float(b.conf.item())
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
                hit = (not wanted) or (label.lower() in wanted)
                detections.append(
                    {
                        "label": label,
                        "conf": conf,
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                        "matchWanted": hit
                    }
                )

        matched = [d for d in detections if d["matchWanted"]]
        if matched:
            found_any = True

        run_info = {
            "attempt": i,
            "timestamp": ts,
            "annotatedImage": str(image_path),
            "detections": detections,
            "matchedCount": len(matched)
        }
        summary["runs"].append(run_info)

        labels_seen = sorted({d["label"] for d in detections})
        print(f"[attempt {i}] matched={len(matched)} labels_seen={labels_seen} image={image_path.name}")

        if i < args.tries:
            time.sleep(max(0.0, args.delay))

    summary_path = out_dir / f"summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if found_any:
        print(f"[check_model] OK: Found requested labels at least once. Summary: {summary_path}")
    else:
        print(f"[check_model] WARNING: Requested labels not found. Summary: {summary_path}")


if __name__ == "__main__":
    main()
