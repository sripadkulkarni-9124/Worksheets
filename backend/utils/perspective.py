"""
Perspective correction for photographed worksheets.
Detects the paper boundary and dewarps it to a flat rectangle.
"""

import cv2
import numpy as np
import base64
import io


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left: smallest x+y
    rect[2] = pts[np.argmax(s)]   # bottom-right: largest x+y
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # top-right: smallest x-y
    rect[3] = pts[np.argmax(d)]   # bottom-left: largest x-y
    return rect


def _find_paper_contour(gray: np.ndarray):
    """Find the largest 4-sided contour (the paper) in a grayscale image."""
    # Try multiple approaches for robustness

    # Approach 1: Adaptive threshold + contours
    for block_size in [11, 21, 31]:
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        # Try Canny edge detection with different thresholds
        for low, high in [(30, 100), (50, 150), (75, 200)]:
            edged = cv2.Canny(blurred, low, high)
            # Dilate to close gaps in edges
            kernel = np.ones((3, 3), np.uint8)
            edged = cv2.dilate(edged, kernel, iterations=2)

            contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

            for c in contours:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)
                if len(approx) == 4:
                    area = cv2.contourArea(approx)
                    img_area = gray.shape[0] * gray.shape[1]
                    # Paper should be at least 20% of the image
                    if area > img_area * 0.2:
                        return approx

    return None


def _compute_skew_angle(pts: np.ndarray) -> float:
    """Compute the skew angle from ordered corner points."""
    tl, tr, br, bl = pts
    # Top edge angle
    dx_top = tr[0] - tl[0]
    dy_top = tr[1] - tl[1]
    angle_top = np.degrees(np.arctan2(dy_top, dx_top))
    # Bottom edge angle
    dx_bot = br[0] - bl[0]
    dy_bot = br[1] - bl[1]
    angle_bot = np.degrees(np.arctan2(dy_bot, dx_bot))
    return (angle_top + angle_bot) / 2


def perspective_correct_bytes(image_bytes: bytes, quality: int = 92) -> tuple[bytes, bool]:
    """
    Dewarp a photographed worksheet so the paper appears flat and rectangular.

    Args:
        image_bytes: Raw JPEG/PNG bytes
        quality: JPEG output quality (0-100)

    Returns:
        (corrected_bytes, was_corrected) — if correction fails, returns original unchanged.
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes, False

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = img.shape[:2]

        # Find paper boundary
        contour = _find_paper_contour(gray)
        if contour is None:
            print("[PERSPECTIVE] No paper boundary found — skipping correction")
            return image_bytes, False

        # Order the 4 corners
        pts = contour.reshape(4, 2).astype(np.float32)
        pts = order_points(pts)

        # Check if correction is actually needed (skew > 1 degree)
        skew = abs(_compute_skew_angle(pts))
        if skew < 1.0:
            print(f"[PERSPECTIVE] Skew is only {skew:.1f}° — skipping correction")
            return image_bytes, False

        print(f"[PERSPECTIVE] Detected skew: {skew:.1f}° — applying correction")

        # Compute output dimensions from the corner points
        (tl, tr, br, bl) = pts
        width_top = np.linalg.norm(tr - tl)
        width_bot = np.linalg.norm(br - bl)
        out_w = int(max(width_top, width_bot))

        height_left = np.linalg.norm(tl - bl)
        height_right = np.linalg.norm(tr - br)
        out_h = int(max(height_left, height_right))

        # Maintain reasonable dimensions (don't blow up tiny crops)
        out_w = max(out_w, 800)
        out_h = max(out_h, 600)

        # Destination rectangle
        dst = np.array([
            [0, 0],
            [out_w - 1, 0],
            [out_w - 1, out_h - 1],
            [0, out_h - 1],
        ], dtype=np.float32)

        # Perspective transform
        M = cv2.getPerspectiveTransform(pts, dst)
        warped = cv2.warpPerspective(img, M, (out_w, out_h))

        # Encode back to JPEG
        _, buffer = cv2.imencode('.jpg', warped, [cv2.IMWRITE_JPEG_QUALITY, quality])
        corrected = buffer.tobytes()

        print(f"[PERSPECTIVE] Corrected: {w}x{h} → {out_w}x{out_h}")
        return corrected, True

    except Exception as e:
        print(f"[PERSPECTIVE] Error: {e}")
        return image_bytes, False


def perspective_correct_base64(b64_data: str, mime_type: str = "image/jpeg") -> tuple[str, str, bool]:
    """
    Convenience wrapper: takes base64 string, returns corrected base64 string.

    Returns:
        (corrected_b64, corrected_mime, was_corrected)
    """
    try:
        raw_bytes = base64.b64decode(b64_data)
        corrected_bytes, was_corrected = perspective_correct_bytes(raw_bytes)
        if was_corrected:
            corrected_b64 = base64.b64encode(corrected_bytes).decode('ascii')
            return corrected_b64, "image/jpeg", True
        else:
            return b64_data, mime_type, False
    except Exception as e:
        print(f"[PERSPECTIVE] Base64 error: {e}")
        return b64_data, mime_type, False
