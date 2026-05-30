import io, traceback
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from pypdf import PdfReader
from ..pdf_utils import assert_pdf, open_reader, render_thumbs
from ..cache import cache_put

router = APIRouter()

@router.post("/pages")
async def get_pages(file: UploadFile = File(...), password: str = Form("")):
    try:
        content = await file.read()
        assert_pdf(content, file.filename)

        probe = PdfReader(io.BytesIO(content), strict=False)
        if probe.is_encrypted:
            try:
                if probe.decrypt(password).value == 0:
                    raise HTTPException(401, "wrong_password")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(401, "wrong_password")

        reader = open_reader(content, password)
        total  = len(reader.pages)
        thumbs = await run_in_threadpool(render_thumbs, content, password, total)
        key    = cache_put(content)
        return {"filename": file.filename, "total": total, "thumbs": thumbs, "size": len(content), "key": key}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))
