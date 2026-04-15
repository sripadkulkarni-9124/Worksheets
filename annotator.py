"""Lightweight Pillow-based annotation renderer for answer sheets.

Generates annotated images for session persistence/export.
The primary view in the app uses CSS overlays, but this serves as
a fallback and for image export.
"""

from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
from prompts import ANNOTATION_TYPES


def _get_font(size: int) -> ImageFont.FreeTypeFont:
    """Try to load a readable font, fall back to default."""
    for name in [
        "arial.ttf", "Arial.ttf", "DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    """Convert hex color string to (r, g, b) tuple."""
    return (
        int(color[1:3], 16),
        int(color[3:5], 16),
        int(color[5:7], 16),
    )


def _draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    xy: list,
    radius: int,
    fill=None,
    outline=None,
    width: int = 1,
) -> None:
    """Draw a rounded rectangle, using Pillow 10+ native or manual fallback."""
    try:
        draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    except AttributeError:
        # Fallback for older Pillow versions
        draw.rectangle(xy, fill=fill, outline=outline, width=width)


def annotate_image(image_bytes: bytes, questions: list, target_page: int) -> bytes:
    """Draw annotation overlays on the student answer sheet.

    Args:
        image_bytes: Original answer sheet image bytes.
        questions: List of evaluated question dicts from Gemini.
        target_page: The 1-indexed page number to annotate.

    Returns:
        Annotated image as PNG bytes.
    """
    img = Image.open(BytesIO(image_bytes)).convert("RGBA")
    w, h = img.size

    # Create transparent overlay for semi-transparent boxes
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_overlay = ImageDraw.Draw(overlay)
    # Opaque layer for text/icons
    draw_main = ImageDraw.Draw(img)

    font_icon = _get_font(max(20, w // 40))
    font_label = _get_font(max(14, w // 55))
    font_small = _get_font(max(11, w // 70))
    font_marks = _get_font(max(12, w // 60))

    for q in questions:
        # Filter by page if available (default to 1 for older sessions)
        q_page = q.get("page_number")
        if q_page is not None and int(q_page) != target_page:
            continue

        bb = q.get("bounding_box")
        atype = q.get("annotation_type", "wrong")
        qnum = q.get("question_number", "?")

        if not bb or len(bb) < 4:
            continue

        # Convert percentage-based bbox to pixel coords
        x1 = int(bb[0] / 100 * w)
        y1 = int(bb[1] / 100 * h)
        bw = int(bb[2] / 100 * w)
        bh = int(bb[3] / 100 * h)
        x2 = x1 + bw
        y2 = y1 + bh

        # Clamp to image bounds
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            continue

        info = ANNOTATION_TYPES.get(atype, ANNOTATION_TYPES["wrong"])
        color = info["color"]
        icon = info["icon"]
        r, g, b = _hex_to_rgb(color)

        # Marks info
        marks_obtained = q.get("marks_obtained")
        marks_total = q.get("marks_total")
        marks_str = ""
        if marks_obtained is not None and marks_total is not None:
            marks_str = f"{marks_obtained}/{marks_total}"

        # Semi-transparent fill with rounded corners
        corner_r = min(8, (x2 - x1) // 10, (y2 - y1) // 10)
        _draw_rounded_rect(
            draw_overlay, [x1, y1, x2, y2],
            radius=corner_r,
            fill=(r, g, b, 25),
        )

        # Colored left border (teacher sidebar mark) — 4px wide
        border_w = max(4, w // 300)
        draw_overlay.rectangle(
            [x1, y1 + corner_r, x1 + border_w, y2 - corner_r],
            fill=(r, g, b, 220),
        )

        # Thin outline with rounded corners
        _draw_rounded_rect(
            draw_overlay, [x1, y1, x2, y2],
            radius=corner_r,
            outline=(r, g, b, 120),
            width=2,
        )

        # Margin tick/cross mark (left side)
        margin_x = max(4, x1 - max(36, w // 25))
        margin_y = y1 + 2
        margin_icon = icon
        draw_main.text(
            (margin_x, margin_y),
            margin_icon,
            fill=(r, g, b),
            font=font_icon,
        )

        # Question label with marks (left sidebar)
        label = f"Q{qnum}"
        if marks_str:
            label += f" {marks_str}"
        label_w = len(label) * (font_label.size // 2 + 2) + 12
        label_h = font_label.size + 8
        lx = max(0, x1 - label_w - 4)
        ly = margin_y + font_icon.size + 4

        # Label background with rounded corners
        _draw_rounded_rect(
            draw_overlay,
            [lx, ly, lx + label_w, ly + label_h],
            radius=4,
            fill=(r, g, b, 200),
        )
        draw_main.text((lx + 6, ly + 3), label, fill="white", font=font_label)

        # Error description + hint with semi-transparent background
        if not q.get("is_correct", True):
            desc_parts = []
            if q.get("error_description"):
                desc_parts.append(q["error_description"][:80])
            if q.get("hint"):
                desc_parts.append(f"Hint: {q['hint'][:60]}")

            if desc_parts:
                desc_text = " | ".join(desc_parts)
                # Estimate text dimensions
                text_w = len(desc_text) * (font_small.size // 2 + 1) + 12
                text_h = font_small.size + 8
                tx = x1 + 4
                ty = y2 + 4

                # Semi-transparent background behind hint text
                _draw_rounded_rect(
                    draw_overlay,
                    [tx, ty, tx + text_w, ty + text_h],
                    radius=4,
                    fill=(r, g, b, 50),
                )
                _draw_rounded_rect(
                    draw_overlay,
                    [tx, ty, tx + text_w, ty + text_h],
                    radius=4,
                    outline=(r, g, b, 100),
                    width=1,
                )
                draw_main.text(
                    (tx + 6, ty + 3),
                    desc_text,
                    fill=(r, g, b),
                    font=font_small,
                )

    # Composite overlay onto image
    img = Image.alpha_composite(img, overlay)
    img = img.convert("RGB")

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
