import io, base64
from fastapi import HTTPException
from pypdf import PdfReader
import pypdfium2 as pdfium

_MAX_UPLOAD = 100 * 1024 * 1024  # 100 MB per file

def assert_pdf(content: bytes, name: str = "file") -> None:
    if len(content) > _MAX_UPLOAD:
        raise HTTPException(413, f"{name} exceeds the 100 MB upload limit")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400, f"{name} is not a valid PDF")

def open_reader(content: bytes, password: str = "") -> PdfReader:
    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        if reader.decrypt(password).value == 0:
            raise HTTPException(401, "wrong_password")
    return reader

def render_thumbs(content: bytes, password: str, total: int) -> list[str]:
    """Render all thumbnails at once (used for batch mode)."""
    doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
    thumbs = []
    for i in range(total):
        thumbs.append(_render_page(doc, i))
    doc.close()
    return thumbs

def stream_thumbs(content: bytes, password: str, total: int, queue, loop):
    """Render thumbnails one-by-one and push to asyncio queue (for SSE streaming).
    loop must be passed from the calling async context — threads have no event loop.
    """
    doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
    for i in range(total):
        thumb = _render_page(doc, i)
        loop.call_soon_threadsafe(queue.put_nowait, (i, thumb))
    doc.close()
    loop.call_soon_threadsafe(queue.put_nowait, None)  # sentinel

def _render_page(doc: pdfium.PdfDocument, i: int) -> str:
    page   = doc[i]
    bitmap = page.render(scale=0.4)
    buf    = io.BytesIO()
    bitmap.to_pil().convert("RGB").save(buf, format="JPEG", quality=70)
    page.close()
    return base64.b64encode(buf.getvalue()).decode()
