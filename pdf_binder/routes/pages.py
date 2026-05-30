import io, json, asyncio, traceback
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from pypdf import PdfReader
from ..pdf_utils import assert_pdf, open_reader, stream_thumbs
from ..cache import cache_put

router = APIRouter()

@router.post("/pages")
async def get_pages(file: UploadFile = File(...), password: str = Form("")):
    try:
        content = await file.read()
        assert_pdf(content, file.filename)

        # Auth must succeed before streaming starts
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
        key    = cache_put(content)
        fname  = file.filename
        size   = len(content)
        pw     = password

        async def generate():
            # 1. Send metadata immediately so the card appears right away
            meta = {"type": "meta", "filename": fname, "total": total, "size": size, "key": key}
            yield f"data: {json.dumps(meta)}\n\n"

            # 2. Render thumbnails in a thread, stream each one as it finishes
            queue: asyncio.Queue = asyncio.Queue()
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, stream_thumbs, content, pw, total, queue, loop)

            received = 0
            while received < total:
                item = await queue.get()
                if item is None:
                    break
                i, thumb = item
                received += 1
                yield f"data: {json.dumps({'type':'thumb','index':i,'data':thumb})}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))
