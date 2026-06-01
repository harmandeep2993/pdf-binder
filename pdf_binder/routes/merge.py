import io, os, json, shutil, tempfile, time, traceback
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pypdf import PdfReader, PdfWriter, PageObject, Transformation
import pypdfium2 as pdfium
from PIL import Image
from ..pdf_utils import assert_pdf, open_reader, read_capped
from ..cache import cache_get
from ..history import insert_merge, _OUTPUT_DIR

router = APIRouter()

_MAX_PAGES = 10_000


def _effective_dims(page) -> tuple[float, float]:
    """Return (width, height) accounting for /Rotate."""
    rot = int(page.get("/Rotate", 0)) % 360
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    return (h, w) if rot in (90, 270) else (w, h)


def _fit_to(page, target_w: float, target_h: float):
    """Scale and centre page content onto a blank page of target_w × target_h."""
    eff_w, eff_h = _effective_dims(page)
    if abs(eff_w - target_w) < 2 and abs(eff_h - target_h) < 2:
        return page
    scale = min(target_w / eff_w, target_h / eff_h)
    tx    = (target_w - eff_w * scale) / 2
    ty    = (target_h - eff_h * scale) / 2
    blank = PageObject.create_blank_page(width=target_w, height=target_h)
    blank.merge_transformed_page(page, Transformation().scale(scale).translate(tx, ty))
    return blank


def _page_num_overlay(width: float, height: float, num: int, total: int) -> bytes:
    """Build a minimal single-page PDF containing only a centred page-number label."""
    label = f"{num} / {total}"
    label_esc = label.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    fs = 8
    approx_w = len(label) * fs * 0.52
    x = max(4.0, (width - approx_w) / 2)
    content = f"BT /F1 {fs} Tf {x:.2f} 8.00 Td ({label_esc}) Tj ET"
    cb = content.encode()
    res = b"<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>"
    o1 = b"1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n"
    o2 = b"2 0 obj\n<</Type/Pages/Kids [3 0 R]/Count 1>>\nendobj\n"
    o3 = (f"3 0 obj\n<</Type/Page/Parent 2 0 R"
          f"/MediaBox [0 0 {width:.2f} {height:.2f}]"
          f"/Contents 4 0 R/Resources ").encode() + res + b">>\nendobj\n"
    o4 = b"4 0 obj\n<</Length " + str(len(cb)).encode() + b">>\nstream\n" + cb + b"\nendstream\nendobj\n"
    hdr  = b"%PDF-1.4\n"
    parts = [o1, o2, o3, o4]
    body  = b"".join(parts)
    offsets, pos = [], 0
    for p in parts:
        offsets.append(len(hdr) + pos); pos += len(p)
    xref_pos = len(hdr) + len(body)
    xref = b"xref\n0 5\n0000000000 65535 f \n"
    for off in offsets:
        xref += f"{off:010d} 00000 n \n".encode()
    trailer = f"trailer\n<</Size 5/Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF".encode()
    return hdr + body + xref + trailer



def _jpeg_page_pdf(pw: float, ph: float, jpeg_bytes: bytes, img_w: int, img_h: int) -> bytes:
    """Build a minimal single-page PDF with a JPEG image (grayscale) filling the page."""
    img_len = len(jpeg_bytes)
    content = f"q {pw:.2f} 0 0 {ph:.2f} 0 0 cm /Im0 Do Q"
    cb = content.encode()

    o1 = b"1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n"
    o2 = b"2 0 obj\n<</Type/Pages/Kids [3 0 R]/Count 1>>\nendobj\n"
    o3 = (
        f"3 0 obj\n<</Type/Page/Parent 2 0 R"
        f"/MediaBox [0 0 {pw:.2f} {ph:.2f}]"
        f"/Contents 4 0 R"
        f"/Resources <</XObject<</Im0 5 0 R>>>>>>\n>>\nendobj\n"
    ).encode()
    o4 = b"4 0 obj\n<</Length " + str(len(cb)).encode() + b">>\nstream\n" + cb + b"\nendstream\nendobj\n"
    o5 = (
        f"5 0 obj\n"
        f"<</Type/XObject/Subtype/Image"
        f"/Width {img_w}/Height {img_h}"
        f"/ColorSpace /DeviceGray"
        f"/BitsPerComponent 8"
        f"/Filter/DCTDecode"
        f"/Length {img_len}>>\n"
        f"stream\n"
    ).encode() + jpeg_bytes + b"\nendstream\nendobj\n"

    hdr   = b"%PDF-1.4\n"
    parts = [o1, o2, o3, o4, o5]
    body  = b"".join(parts)
    offsets, pos = [], 0
    for p in parts:
        offsets.append(len(hdr) + pos); pos += len(p)
    xref_pos = len(hdr) + len(body)
    xref = b"xref\n0 6\n0000000000 65535 f \n"
    for off in offsets:
        xref += f"{off:010d} 00000 n \n".encode()
    trailer = f"trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF".encode()
    return hdr + body + xref + trailer


def _to_grayscale(writer: PdfWriter) -> PdfWriter:
    """Convert all pages in writer to grayscale by rendering via pdfium and re-encoding as JPEG."""
    src_buf = io.BytesIO()
    writer.write(src_buf)
    src_buf.seek(0)
    src_doc = pdfium.PdfDocument(src_buf.read())

    new_writer = PdfWriter()
    for i in range(len(src_doc)):
        page = src_doc[i]
        bitmap = page.render(scale=2.0, grayscale=True)
        pil_img = bitmap.to_pil().convert("L")
        img_w, img_h = pil_img.size

        # Get original page dimensions in points
        pw = page.get_width()
        ph = page.get_height()

        jpeg_buf = io.BytesIO()
        pil_img.save(jpeg_buf, format="JPEG", quality=85)
        jpeg_bytes = jpeg_buf.getvalue()

        page_pdf = _jpeg_page_pdf(pw, ph, jpeg_bytes, img_w, img_h)
        gs_reader = PdfReader(io.BytesIO(page_pdf))
        new_writer.add_page(gs_reader.pages[0])
        page.close()

    src_doc.close()
    return new_writer


def _copy_outlines(reader: PdfReader, writer: PdfWriter, page_offset: int, parent=None) -> None:
    """Recursively copy PDF outline/bookmarks from reader into writer with adjusted page numbers."""
    outline = reader.outline
    if not outline:
        return
    _process_outline_items(outline, reader, writer, page_offset, parent)


def _process_outline_items(items, reader: PdfReader, writer: PdfWriter, page_offset: int, parent) -> None:
    i = 0
    while i < len(items):
        item = items[i]
        if isinstance(item, list):
            i += 1
            continue
        try:
            page_num = reader.get_destination_page_number(item) + page_offset
            added = writer.add_outline_item(str(item.title), page_num, parent=parent)
            # Check if next element is a list of children
            if i + 1 < len(items) and isinstance(items[i + 1], list):
                _process_outline_items(items[i + 1], reader, writer, page_offset, added)
                i += 2
                continue
        except Exception:
            pass
        i += 1


def _flatten_forms_pdf(writer: PdfWriter) -> None:
    """Remove AcroForm and Widget annotations to make form non-interactive."""
    from pypdf.generic import ArrayObject
    root = writer._root_object
    if "/AcroForm" in root:
        del root["/AcroForm"]
    for page in writer.pages:
        if "/Annots" not in page:
            continue
        try:
            annots = page["/Annots"]
            if hasattr(annots, "get_object"):
                annots = annots.get_object()
            filtered = [a for a in annots
                        if a.get_object().get("/Subtype", "") != "/Widget"]
            page["/Annots"] = ArrayObject(filtered)
        except Exception:
            pass


@router.post("/merge")
async def merge_pdfs(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    pages: str = Form(...),
    filename: str = Form("merged.pdf"),
    passwords: str = Form("{}"),
    keys: str = Form("{}"),
    compress: str = Form("false"),
    page_numbers: str = Form("false"),
    normalize: str = Form("false"),
    metadata: str = Form("{}"),
    grayscale: str = Form("false"),
    bookmarks: str = Form("true"),
    output_password: str = Form(""),
    flatten_forms: str = Form("false"),
):
    try:
        pages_list  = json.loads(pages)
        pw_map      = json.loads(passwords)
        key_map     = json.loads(keys)
        meta_dict   = json.loads(metadata) if metadata else {}
        if not isinstance(pages_list, list):
            raise HTTPException(400, "pages must be a JSON array")
        if not isinstance(pw_map, dict):
            raise HTTPException(400, "passwords must be a JSON object")
        if not isinstance(key_map, dict):
            raise HTTPException(400, "keys must be a JSON object")
        if len(pages_list) > _MAX_PAGES:
            raise HTTPException(400, f"Too many pages requested (max {_MAX_PAGES})")
        do_compress     = compress.lower() == "true"
        do_page_numbers = page_numbers.lower() == "true"
        do_normalize    = normalize.lower() == "true"
        do_grayscale    = grayscale.lower() == "true"
        do_bookmarks    = bookmarks.lower() == "true"
        do_flatten  = flatten_forms.lower() == "true"
        do_encrypt  = bool(output_password.strip())

        buffers: dict[str, bytes] = {}
        for f in files:
            cached = cache_get(key_map.get(f.filename, ""))
            if cached is not None:
                buffers[f.filename] = cached
            else:
                content = await read_capped(f)
                assert_pdf(content, f.filename)
                buffers[f.filename] = content

        readers = {
            fname: open_reader(buf, pw_map.get(fname, ""))
            for fname, buf in buffers.items()
        }
        writer = PdfWriter()
        file_page_offsets: dict[str, int] = {}

        for entry in pages_list:
            # Handle blank page entries first
            if entry.get("type") == "blank":
                blank = PageObject.create_blank_page(
                    width=float(entry.get("width", 595)),
                    height=float(entry.get("height", 842)),
                )
                writer.add_page(blank)
                continue

            fname    = entry["file"]
            pidx     = entry["page"]
            rotation = entry.get("rotation", 0)
            if fname not in readers:
                raise HTTPException(400, f"File not found: {fname}")
            if not isinstance(pidx, int) or pidx < 0 or pidx >= len(readers[fname].pages):
                raise HTTPException(400, f"Page index {pidx} out of range for {fname}")

            # Track first page offset per file for bookmarks
            if fname not in file_page_offsets:
                file_page_offsets[fname] = len(writer.pages)

            added = writer.add_page(readers[fname].pages[pidx])
            if rotation:
                added.rotate(rotation)
            crop = entry.get("crop")
            if crop:
                try:
                    mb = added.mediabox
                    from pypdf.generic import RectangleObject
                    added.cropbox = RectangleObject((
                        float(mb.left)   + float(crop.get("l", 0)),
                        float(mb.bottom) + float(crop.get("b", 0)),
                        float(mb.right)  - float(crop.get("r", 0)),
                        float(mb.top)    - float(crop.get("t", 0)),
                    ))
                except Exception:
                    pass

        if do_normalize and len(writer.pages) > 1:
            target_w, target_h = _effective_dims(writer.pages[0])
            if target_w > target_h:          # force portrait
                target_w, target_h = target_h, target_w
            normalized = PdfWriter()
            for page in writer.pages:
                normalized.add_page(_fit_to(page, target_w, target_h))
            writer = normalized

        if do_grayscale:
            writer = _to_grayscale(writer)

        if do_compress:
            for page in writer.pages:
                page.compress_content_streams()
            writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)

        if do_page_numbers:
            total_pages = len(writer.pages)
            for i, page in enumerate(writer.pages):
                w_pt = float(page.mediabox.width)
                h_pt = float(page.mediabox.height)
                overlay_bytes  = _page_num_overlay(w_pt, h_pt, i + 1, total_pages)
                overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
                page.merge_page(overlay_reader.pages[0])


        if do_bookmarks:
            for fname, offset in file_page_offsets.items():
                if fname in readers:
                    try:
                        writer.add_outline_item(Path(fname).stem, offset)
                        _copy_outlines(readers[fname], writer, offset)
                    except Exception:
                        pass

        if do_flatten:
            _flatten_forms_pdf(writer)

        if isinstance(meta_dict, dict):
            pdf_meta = {k: v for k, v in {
                "/Title":   meta_dict.get("title", ""),
                "/Author":  meta_dict.get("author", ""),
                "/Subject": meta_dict.get("subject", ""),
            }.items() if v}
            if pdf_meta:
                writer.add_metadata(pdf_meta)

        if do_encrypt:
            writer.encrypt(user_password=output_password.strip(), algorithm="AES-256")

        filename = Path(filename).name or "merged.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        writer.write(tmp); tmp.close()

        # Persist to output dir and record in history
        safe_stem = Path(filename).stem[:80]
        out_path  = _OUTPUT_DIR / f"{int(time.time())}_{safe_stem}.pdf"
        shutil.copy2(tmp.name, out_path)
        insert_merge(
            filename, str(out_path),
            list(buffers.keys()),
            len(writer.pages),
            out_path.stat().st_size,
        )

        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, filename=filename, media_type="application/pdf")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(500, "An error occurred while processing the PDF")
