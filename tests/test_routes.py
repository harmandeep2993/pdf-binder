"""
Backend route tests.

Run: pytest tests/ -v
Requires: pip install pytest pytest-asyncio httpx
"""
import pytest
from httpx import AsyncClient, ASGITransport
from pdf_binder import app

# Minimal valid 1-page PDF (no content streams - just structure)
_VALID_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
    b"xref\n0 4\n"
    b"0000000000 65535 f\n"
    b"0000000009 00000 n\n"
    b"0000000058 00000 n\n"
    b"0000000115 00000 n\n"
    b"trailer<</Size 4/Root 1 0 R>>\n"
    b"startxref\n190\n%%EOF"
)

@pytest.fixture
def transport():
    return ASGITransport(app=app)


# /pages

@pytest.mark.asyncio
async def test_pages_rejects_non_pdf(transport):
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/pages",
                         data={"password": ""},
                         files={"file": ("t.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 400
    assert "valid PDF" in r.json()["detail"]


@pytest.mark.asyncio
async def test_pages_rejects_oversized(transport):
    big = b"%PDF-" + b"x" * (101 * 1024 * 1024)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/pages",
                         data={"password": ""},
                         files={"file": ("big.pdf", big, "application/pdf")})
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_pages_streams_sse(transport):
    """Valid PDF should return text/event-stream with a meta event."""
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        async with c.stream("POST", "/pages",
                            data={"password": ""},
                            files={"file": ("t.pdf", _VALID_PDF, "application/pdf")}) as r:
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            # Read first chunk - should contain meta event
            got_meta = False
            async for line in r.aiter_lines():
                if line.startswith("data:"):
                    import json
                    ev = json.loads(line[5:])
                    if ev.get("type") == "meta":
                        got_meta = True
                        assert ev["total"] >= 1
                        assert "key" in ev
                        break
            assert got_meta


# /merge

@pytest.mark.asyncio
async def test_merge_rejects_non_pdf(transport):
    import json
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/merge",
                         data={
                             "pages": json.dumps([{"file": "bad.pdf", "page": 0, "rotation": 0}]),
                             "filename": "out.pdf",
                             "passwords": "{}",
                             "keys": "{}",
                             "compress": "false",
                         },
                         files=[("files", ("bad.pdf", b"not a pdf", "application/pdf"))])
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_merge_filename_sanitized(transport):
    """Path traversal in filename should be stripped."""
    import json
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/merge",
                         data={
                             "pages": json.dumps([{"file": "t.pdf", "page": 0, "rotation": 0}]),
                             "filename": "../../evil.pdf",
                             "passwords": "{}",
                             "keys": "{}",
                             "compress": "false",
                         },
                         files=[("files", ("t.pdf", _VALID_PDF, "application/pdf"))])
    # Either succeeds with sanitized name or fails - must NOT 500
    assert r.status_code in (200, 400, 422)
    if r.status_code == 200:
        cd = r.headers.get("content-disposition", "")
        assert "evil.pdf" not in cd or ".." not in cd


# /split

@pytest.mark.asyncio
async def test_split_rejects_non_pdf(transport):
    import json
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/split",
                         data={
                             "page_indices": json.dumps([0]),
                             "rotations": "{}",
                             "as_images": "false",
                             "image_format": "jpeg",
                             "password": "",
                             "key": "",
                         },
                         files=[("file", ("bad.pdf", b"not a pdf", "application/pdf"))])
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_split_valid_pdf_returns_zip(transport):
    import json
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post("/split",
                         data={
                             "page_indices": json.dumps([0]),
                             "rotations": "{}",
                             "as_images": "false",
                             "image_format": "jpeg",
                             "password": "",
                             "key": "",
                         },
                         files=[("file", ("t.pdf", _VALID_PDF, "application/pdf"))])
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
