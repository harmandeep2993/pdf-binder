import io, os, tempfile, traceback
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
import pypdfium2 as pdfium
from ..pdf_utils import assert_pdf, open_reader, read_capped
from ..cache import cache_get
from pypdf import PdfWriter

router = APIRouter()

@router.get("/page-zoom/{key}/{page_idx}")
def zoom_page(key: str, page_idx: int):
    content = cache_get(key)
    if content is None:
        raise HTTPException(404, "File not in cache - re-upload the file")
    try:
        doc = pdfium.PdfDocument(content)
        if page_idx < 0 or page_idx >= len(doc):
            raise HTTPException(400, "Page index out of range")
        page = doc[page_idx]
        bitmap = page.render(scale=2.0)
        buf = io.BytesIO()
        bitmap.to_pil().convert("RGB").save(buf, format="JPEG", quality=90)
        page.close(); doc.close()
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/jpeg",
                                 headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "Failed to render page")

@router.post("/decrypt")
async def decrypt_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    password: str = Form(""),
    key: str = Form(""),
):
    try:
        cached = cache_get(key)
        content = cached if cached is not None else await read_capped(file)
        if cached is None:
            assert_pdf(content, file.filename)
        reader = open_reader(content, password)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        writer.write(tmp); tmp.close()
        stem = Path(file.filename).stem
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=f"{stem}_decrypted.pdf",
                            media_type="application/pdf")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "Failed to decrypt PDF")
