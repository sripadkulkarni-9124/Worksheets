"""
Pre-process route: perspective-correct the worksheet image before evaluation.
Returns corrected base64 + dataUrl so frontend can use the dewarped image everywhere.
"""

from fastapi import APIRouter
from pydantic import BaseModel
import base64

router = APIRouter()


class PreprocessRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/jpeg"


@router.post("/preprocess")
async def preprocess(req: PreprocessRequest):
    from utils.perspective import perspective_correct_base64

    corrected_b64, corrected_mime, was_corrected = perspective_correct_base64(
        req.imageBase64, req.mimeType
    )

    # Build data URL for frontend display
    data_url = f"data:{corrected_mime};base64,{corrected_b64}"

    return {
        "imageBase64": corrected_b64,
        "mimeType": corrected_mime,
        "dataUrl": data_url,
        "corrected": was_corrected,
    }
