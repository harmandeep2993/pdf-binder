from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader, PdfWriter
from pypdf.errors import FileNotDecryptedError
import pypdfium2 as pdfium
import tempfile, json, io, base64, traceback, zipfile
from pathlib import Path
from PIL import Image

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
FRONTEND = Path(__file__).parent / "index.html"

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    return FRONTEND.read_text(encoding="utf-8")

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

        # for pypdfium2 we need to pass password separately
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

        return {"filename": file.filename, "total": total, "thumbs": thumbs, "size": len(content)}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.post("/merge")
async def merge_pdfs(
    files: list[UploadFile] = File(...),
    pages: str = Form(...),
    filename: str = Form("merged.pdf"),
    passwords: str = Form("{}")
):
    try:
        pages_list = json.loads(pages)
        pw_map     = json.loads(passwords)  # {"filename": "password"}
        buffers: dict[str, bytes] = {}
        for f in files:
            buffers[f.filename] = await f.read()

        writer = PdfWriter()
        for entry in pages_list:
            fname    = entry["file"]
            pidx     = entry["page"]
            rotation = entry.get("rotation", 0)
            if fname not in buffers:
                raise HTTPException(400, f"File not found: {fname}")
            pw     = pw_map.get(fname, "")
            reader = open_reader(buffers[fname], pw)
            page   = reader.pages[pidx]
            if rotation:
                page.rotate(rotation)
            writer.add_page(page)

        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        writer.write(tmp); tmp.close()
        return FileResponse(tmp.name, filename=filename, media_type="application/pdf")
    except HTTPException: raise
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))

@app.post("/split")
async def split_pdf(
    file: UploadFile = File(...),
    page_indices: str = Form(...),
    rotations: str = Form("{}"),
    as_images: str = Form("false"),
    image_format: str = Form("jpeg"),
    password: str = Form("")
):
    try:
        indices   = json.loads(page_indices)
        rot_map   = json.loads(rotations)
        to_images = as_images.lower() == "true"
        content   = await file.read()
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
        return FileResponse(tmp.name, filename=f"{stem}{suffix}.zip", media_type="application/zip")
    except HTTPException: raise
    except Exception as e:
        traceback.print_exc(); raise HTTPException(500, str(e))
    