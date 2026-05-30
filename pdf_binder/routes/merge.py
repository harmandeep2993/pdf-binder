import os, json, tempfile, traceback
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pypdf import PdfWriter
from ..pdf_utils import assert_pdf, open_reader
from ..cache import cache_get

router = APIRouter()

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
        pages_list   = json.loads(pages)
        pw_map       = json.loads(passwords)
        key_map      = json.loads(keys)
        do_compress  = compress.lower() == "true"

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
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))
