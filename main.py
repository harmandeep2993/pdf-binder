import os, argparse
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.background import BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader, PdfWriter
from pypdf.errors import FileNotDecryptedError
import pypdfium2 as pdfium
import hashlib, tempfile, json, io, base64, traceback, zipfile
from pathlib import Path
from PIL import Image

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
FRONTEND = Path(__file__).parent / "index.html"

_file_cache: dict[str, bytes] = {}  # sha256 -> content

def _cache_put(content: bytes) -> str:
    key = hashlib.sha256(content).hexdigest()
    _file_cache[key] = content
    return key

def _cache_get(key: str) -> bytes | None:
    return _file_cache.get(key)

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    return FRONTEND.read_text(encoding="utf-8")

def _render_thumbs(content: bytes, password: str, total: int) -> list[str]:
    doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
    thumbs = []
    for i in range(total):
        page   = doc[i]
        bitmap = page.render(scale=0.4)
        pil    = bitmap.to_pil().convert("RGB")
        buf    = io.BytesIO()
        pil.save(buf, format="JPEG", quality=70)
        thumbs.append(base64.b64encode(buf.getvalue()).decode())
        page.close()
    doc.close()
    return thumbs

def assert_pdf(content: bytes, name: str = "file"):
    if not content.startswith(b"%PDF-"):
        raise HTTPException(400, f"{name} is not a valid PDF")

def open_reader(content: bytes, password: str = "") -> PdfReader:
    """Open a PdfReader, decrypting if needed. Raises HTTPException on wrong password."""
    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        result = reader.decrypt(password)
        if result.value == 0:  # 0 = wrong password
            raise HTTPException(401, "wrong_password")
    return reader

@app.post("/pages")
async def get_pages(file: UploadFile = File(...), password: str = Form("")):
    try:
        content = await file.read()
        assert_pdf(content, file.filename)

        # detect encryption before trying
        probe = PdfReader(io.BytesIO(content), strict=False)
        if probe.is_encrypted:
            try:
                result = probe.decrypt(password)
                if result.value == 0:
                    raise HTTPException(401, "wrong_password")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(401, "wrong_password")

        reader = open_reader(content, password)
        total  = len(reader.pages)
        thumbs = await run_in_threadpool(_render_thumbs, content, password, total)
        cache_key = _cache_put(content)
        return {"filename": file.filename, "total": total, "thumbs": thumbs, "size": len(content), "key": cache_key}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.post("/merge")
async def merge_pdfs(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    pages: str = Form(...),
    filename: str = Form("merged.pdf"),
    passwords: str = Form("{}"),
    keys: str = Form("{}")
):
    try:
        pages_list = json.loads(pages)
        pw_map     = json.loads(passwords)  # {"filename": "password"}
        key_map    = json.loads(keys)        # {"filename": "sha256"}
        buffers: dict[str, bytes] = {}
        for f in files:
            cached = _cache_get(key_map.get(f.filename, ""))
            if cached is not None:
                buffers[f.filename] = cached
            else:
                content = await f.read()
                assert_pdf(content, f.filename)
                buffers[f.filename] = content

        readers: dict[str, PdfReader] = {
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

        filename = Path(filename).name or "merged.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        writer.write(tmp); tmp.close()
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=filename, media_type="application/pdf")
    except HTTPException: raise
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))

@app.post("/split")
async def split_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    page_indices: str = Form(...),
    rotations: str = Form("{}"),
    as_images: str = Form("false"),
    image_format: str = Form("jpeg"),
    password: str = Form(""),
    key: str = Form("")
):
    try:
        indices   = json.loads(page_indices)
        rot_map   = json.loads(rotations)
        to_images = as_images.lower() == "true"
        cached    = _cache_get(key)
        if cached is not None:
            content = cached
        else:
            content = await file.read()
            assert_pdf(content, file.filename)
        reader    = open_reader(content, password)
        total     = len(reader.pages)
        stem      = Path(file.filename).stem

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            if to_images:
                doc = pdfium.PdfDocument(content, password=password.encode() if password else None)
                fmt = image_format.lower()
                ext = "jpg" if fmt == "jpeg" else fmt
                for idx in indices:
                    if idx < 0 or idx >= total: continue
                    rotation = rot_map.get(str(idx), 0)
                    page   = doc[idx]
                    bitmap = page.render(scale=2.0, rotation=rotation)
                    pil    = bitmap.to_pil().convert("RGB")
                    buf    = io.BytesIO()
                    pil.save(buf, format="JPEG" if fmt=="jpeg" else "PNG", quality=92 if fmt=="jpeg" else None)
                    zf.writestr(f"{stem}_page{idx+1}.{ext}", buf.getvalue())
                    page.close()
                doc.close()
            else:
                for idx in indices:
                    if idx < 0 or idx >= total: continue
                    rotation = rot_map.get(str(idx), 0)
                    writer = PdfWriter()
                    pg = reader.pages[idx]
                    if rotation:
                        pg.rotate(rotation)
                    writer.add_page(pg)
                    part_buf = io.BytesIO()
                    writer.write(part_buf)
                    zf.writestr(f"{stem}_page{idx+1}.pdf", part_buf.getvalue())

        zip_buf.seek(0)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.write(zip_buf.read()); tmp.close()
        suffix = "_images" if to_images else "_split"
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=f"{stem}{suffix}.zip", media_type="application/zip")
    except HTTPException: raise
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))

if __name__ == "__main__":
    import uvicorn
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()
    print(f"Pagefuse running at http://{args.host}:{args.port}")
    uvicorn.run("main:app", host=args.host, port=args.port, reload=True)
