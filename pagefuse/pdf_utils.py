import io, base64
from fastapi import HTTPException
from pypdf import PdfReader
import pypdfium2 as pdfium

def assert_pdf(content: bytes, name: str = "file") -> None:
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400, f"{name} is not a valid PDF")

def open_reader(content: bytes, password: str = "") -> PdfReader:
    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        if reader.decrypt(password).value == 0:
            raise HTTPException(401, "wrong_password")
    return reader

def render_thumbs(content: bytes, password: str, total: int) -> list[str]:
    doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
    thumbs = []
    for i in range(total):
        page   = doc[i]
        bitmap = page.render(scale=0.4)
        buf    = io.BytesIO()
        bitmap.to_pil().convert("RGB").save(buf, format="JPEG", quality=70)
        thumbs.append(base64.b64encode(buf.getvalue()).decode())
        page.close()
    doc.close()
    return thumbs
