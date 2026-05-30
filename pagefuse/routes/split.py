import os, io, json, tempfile, zipfile, traceback
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pypdf import PdfWriter
import pypdfium2 as pdfium
from ..pdf_utils import assert_pdf, open_reader
from ..cache import cache_get

router = APIRouter()

@router.post("/split")
async def split_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    page_indices: str = Form(...),
    rotations: str = Form("{}"),
    as_images: str = Form("false"),
    image_format: str = Form("jpeg"),
    password: str = Form(""),
    key: str = Form(""),
):
    try:
        indices   = json.loads(page_indices)
        rot_map   = json.loads(rotations)
        to_images = as_images.lower() == "true"
        cached    = cache_get(key)
        content   = cached if cached is not None else await file.read()
        if cached is None:
            assert_pdf(content, file.filename)

        reader = open_reader(content, password)
        total  = len(reader.pages)
        stem   = Path(file.filename).stem

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            if to_images:
                doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
                fmt = image_format.lower()
                ext = "jpg" if fmt == "jpeg" else fmt
                for idx in indices:
                    if idx < 0 or idx >= total: continue
                    page   = doc[idx]
                    bitmap = page.render(scale=2.0, rotation=rot_map.get(str(idx), 0))
                    buf    = io.BytesIO()
                    bitmap.to_pil().convert("RGB").save(
                        buf, format="JPEG" if fmt == "jpeg" else "PNG",
                        quality=92 if fmt == "jpeg" else None
                    )
                    zf.writestr(f"{stem}_page{idx+1}.{ext}", buf.getvalue())
                    page.close()
                doc.close()
            else:
                for idx in indices:
                    if idx < 0 or idx >= total: continue
                    w  = PdfWriter()
                    pg = reader.pages[idx]
                    if rot_map.get(str(idx), 0):
                        pg.rotate(rot_map[str(idx)])
                    w.add_page(pg)
                    buf = io.BytesIO()
                    w.write(buf)
                    zf.writestr(f"{stem}_page{idx+1}.pdf", buf.getvalue())

        zip_buf.seek(0)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.write(zip_buf.read()); tmp.close()
        suffix = "_images" if to_images else "_split"
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=f"{stem}{suffix}.zip", media_type="application/zip")
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))
