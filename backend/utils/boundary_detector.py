"""
OpenCV detection of printed dashed rectangular borders on Vedantu worksheets.
Returns pixel-coordinate bounding boxes sorted top-to-bottom.

Strategy: aggressive morphological closing to bridge dashed gaps,
then contour detection filtered for question-box dimensions.
"""

import cv2
import numpy as np
import base64


def detect_dashed_rectangles(image_bytes: bytes) -> tuple[list[dict], int, int]:
    """
    Detect printed dashed rectangular borders.
    Returns: (boxes_list, img_w, img_h)
    Each box: {"x": int, "y": int, "w": int, "h": int, "area": int}
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        print("[BOUNDARY] Failed to decode image")
        return [], 0, 0

    img_h, img_w = img.shape[:2]
    print(f"[BOUNDARY] Image: {img_w}x{img_h}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Scale kernels to image size
    # Dashed gaps are typically 1-3% of dimension
    # Need kernels 3-5x gap size to bridge reliably
    kern_h = max(50, img_w // 12)   # ~8% of width
    kern_v = max(50, img_h // 12)   # ~8% of height

    strategies = [
        # Strategy 1: Adaptive threshold, moderate
        {"name": "adaptive-15-8", "method": "adaptive", "block": 15, "C": 8,
         "kh": kern_h, "kv": kern_v, "dilate_iter": 3},
        # Strategy 2: Adaptive, bigger block + kernels
        {"name": "adaptive-25-6", "method": "adaptive", "block": 25, "C": 6,
         "kh": kern_h * 2, "kv": kern_v * 2, "dilate_iter": 3},
        # Strategy 3: Adaptive, inverted for light dashes on white
        {"name": "adaptive-11-4", "method": "adaptive", "block": 11, "C": 4,
         "kh": kern_h, "kv": kern_v, "dilate_iter": 4},
        # Strategy 4: Otsu
        {"name": "otsu", "method": "otsu",
         "kh": kern_h, "kv": kern_v, "dilate_iter": 3},
        # Strategy 5: Canny edge
        {"name": "canny", "method": "canny", "low": 30, "high": 100,
         "kh": kern_h, "kv": kern_v, "dilate_iter": 4},
        # Strategy 6: Canny tighter
        {"name": "canny-tight", "method": "canny", "low": 50, "high": 150,
         "kh": kern_h * 2, "kv": kern_v * 2, "dilate_iter": 3},
    ]

    best = []
    for s in strategies:
        cands = _run_strategy(gray, img_h, img_w, s)
        print(f"[BOUNDARY] {s['name']}: {len(cands)} candidates")
        for c in cands:
            print(f"    x={c['x']} y={c['y']} w={c['w']} h={c['h']} "
                  f"(w%={c['w']/img_w:.2f} h%={c['h']/img_h:.2f})")
        if len(cands) > len(best):
            best = cands
        if 2 <= len(cands) <= 8:
            best = cands
            break

    # Deduplicate
    best.sort(key=lambda c: c["area"], reverse=True)
    kept = []
    for cand in best:
        dup = False
        for k in kept:
            if _iou(cand, k) > 0.45 or _containment(cand, k) > 0.7:
                dup = True
                break
        if not dup:
            kept.append(cand)

    kept.sort(key=lambda c: c["y"])

    print(f"[BOUNDARY] Final: {len(kept)} boxes")
    for i, b in enumerate(kept):
        print(f"  [{i}] x={b['x']} y={b['y']} w={b['w']} h={b['h']} "
              f"(x%={b['x']/img_w:.3f} y%={b['y']/img_h:.3f} "
              f"w%={b['w']/img_w:.3f} h%={b['h']/img_h:.3f})")

    return kept, img_w, img_h


def detect_dashed_rectangles_base64(b64_data: str) -> tuple[list[dict], int, int]:
    return detect_dashed_rectangles(base64.b64decode(b64_data))


def _run_strategy(gray, img_h, img_w, s):
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    method = s["method"]
    if method == "adaptive":
        thresh = cv2.adaptiveThreshold(
            enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, blockSize=s["block"], C=s["C"])
    elif method == "otsu":
        _, thresh = cv2.threshold(enhanced, 0, 255,
                                  cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    elif method == "canny":
        blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)
        thresh = cv2.Canny(blurred, s["low"], s["high"])
    else:
        return []

    # Morphological close — bridge dashed gaps with directional kernels
    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (s["kh"], 1))
    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, s["kv"]))

    # Close horizontally then vertically
    ch = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kh)
    cv_ = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kv)
    combined = cv2.bitwise_or(ch, cv_)

    # Also do a combined close to connect corners
    k_sq = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, k_sq)

    # Dilate to thicken lines and merge nearby segments
    dilate_iter = s.get("dilate_iter", 3)
    combined = cv2.dilate(combined, np.ones((7, 7), np.uint8), iterations=dilate_iter)

    contours, hierarchy = cv2.findContours(combined, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

    # Filter for question-box sized rectangles
    # Expected: width ~50-95% of image, height ~8-35% of image
    min_w = img_w * 0.50
    max_w = img_w * 0.97
    min_h = img_h * 0.08
    max_h = img_h * 0.35
    min_area = img_h * img_w * 0.05  # At least 5% of image area

    cands = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if w < min_w or w > max_w:
            continue
        if h < min_h or h > max_h:
            continue
        if area < min_area:
            continue

        # Check rectangularity (contour area vs bounding rect area)
        cnt_area = cv2.contourArea(cnt)
        rect_ratio = cnt_area / area if area > 0 else 0
        if rect_ratio < 0.5:
            continue

        cands.append({"x": x, "y": y, "w": w, "h": h, "area": area})

    return cands


def _iou(a, b):
    x1, y1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    if x2 <= x1 or y2 <= y1: return 0
    inter = (x2 - x1) * (y2 - y1)
    return inter / (a["area"] + b["area"] - inter)


def _containment(small, big):
    x1, y1 = max(small["x"], big["x"]), max(small["y"], big["y"])
    x2 = min(small["x"] + small["w"], big["x"] + big["w"])
    y2 = min(small["y"] + small["h"], big["y"] + big["h"])
    if x2 <= x1 or y2 <= y1: return 0
    return (x2 - x1) * (y2 - y1) / small["area"]
