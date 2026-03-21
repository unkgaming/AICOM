import argparse
import base64
import io
import json
from PIL import ImageDraw, ImageGrab
from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--labels", default="")
    parser.add_argument("--conf", type=float, default=0.25)
    args = parser.parse_args()

    wanted = {x.strip().lower() for x in args.labels.split(",") if x.strip()}

    try:
        model = YOLO(args.model)
        img = ImageGrab.grab()
        result = model.predict(source=img, conf=args.conf, verbose=False)[0]

        detections = []
        all_detections = []
        draw = ImageDraw.Draw(img)
        boxes = result.boxes
        if boxes is not None:
            for b in boxes:
                cls_id = int(b.cls.item())
                label = str(model.names.get(cls_id, cls_id))
                conf = float(b.conf.item())
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0

                det = {
                    "label": label,
                    "conf": conf,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "cx": cx,
                    "cy": cy,
                }
                all_detections.append(det)

                draw_this = (not wanted) or (label.lower() in wanted)
                if draw_this:
                    draw.rectangle((x1, y1, x2, y2), outline=(255, 80, 80), width=3)
                    draw.text((x1 + 4, max(0.0, y1 - 16)), f"{label} {conf:.2f}", fill=(255, 80, 80))

                if wanted and label.lower() not in wanted:
                    continue

                detections.append(
                    det
                )

        detections.sort(key=lambda d: d["conf"], reverse=True)
        all_detections.sort(key=lambda d: d["conf"], reverse=True)

        out_img = img.copy()
        out_img.thumbnail((1280, 720))

        buf = io.BytesIO()
        out_img.save(buf, format="JPEG", quality=70, optimize=True)
        annotated_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        annotated_data_url = f"data:image/jpeg;base64,{annotated_b64}"

        seen_labels = sorted({d["label"] for d in all_detections})
        print(
            json.dumps(
                {
                    "ok": True,
                    "detections": detections,
                    "allDetections": all_detections,
                    "seenLabels": seen_labels,
                    "annotatedDataUrl": annotated_data_url,
                }
            )
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
