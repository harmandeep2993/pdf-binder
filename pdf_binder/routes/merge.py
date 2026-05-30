import os, json, tempfile, traceback
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pypdf import PdfWriter
from ..pdf_utils import assert_pdf, open_reader
from ..cache import cache_get

router = APIRouter()

_MAX_PAGES = 10_000

@router.post("/merge")
async def merge_pdfs(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    pages: str = Form(...),
    filename: str = Form("merged.pdf"),
    passwords: str = Form("{}"),
    keys: str = Form("{}"),
    compress: str = Form("false"),
):
    try:
        pages_list = json.loads(pages)
        pw_map     = json.loads(passwords)
        key_map    = json.loads(keys)
        if not isinstance(pages_list, list):
            raise HTTPException(400, "pages must be a JSON array")
        if not isinstance(pw_map, dict):
            raise HTTPException(400, "passwords must be a JSON object")
        if not isinstance(key_map, dict):
            raise HTTPException(400, "keys must be a JSON object")
        if len(pages_list) > _MAX_PAGES:
            raise HTTPException(400, f"Too many pages requested (max {_MAX_PAGES})")
        do_compress = compress.lower() == "true"

        buffers: dict[str, bytes] = {}
        for f in files:
            cached = cache_get(key_map.get(f.filename, ""))
            if cached is not None:
                buffers[f.filename] = cached
            else:
                content = await f.read()
                assert_pdf(content, f.filename)
                buffers[f.filename] = content

        readers = {
            fname: open_reader(buf, pw_map.get(fname, ""))
            for fname, buf in buffers.items()
        }
        writer = PdfWriter()
        for entry in pages_list:
            fname    = entry["file"]
            pidx     = entry["page"]
            rotation = entry.get("rotation", 0)
            if fname not in readers:
                raise HTTPException(400, f"File not found: {fname}")
            if not isinstance(pidx, int) or pidx < 0 or pidx >= len(readers[fname].pages):
                raise HTTPException(400, f"Page index {pidx} out of range for {fname}")
            added = writer.add_page(readers[fname].pages[pidx])
            if rotation:
                added.rotate(rotation)

        if do_compress:
            for page in writer.pages:
                page.compress_content_streams()
            writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)

        filename = Path(filename).name or "merged.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        writer.write(tmp); tmp.close()
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=filename, media_type="application/pdf")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "An error occurred while processing the PDF")
