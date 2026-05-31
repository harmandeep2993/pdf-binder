import os, traceback
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from ..history import list_merges, get_merge, delete_merge

router = APIRouter()


@router.get("/history")
def get_history():
    return list_merges()


@router.get("/history/{id}/view")
def view_merge(id: int):
    record = get_merge(id)
    if not record:
        raise HTTPException(404, "Record not found")
    path = Path(record["file_path"])
    if not path.exists():
        raise HTTPException(404, "File no longer on disk — it may have been deleted")
    return FileResponse(
        path, media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{record['filename']}\""},
    )


@router.get("/history/{id}/download")
def download_merge(id: int):
    record = get_merge(id)
    if not record:
        raise HTTPException(404, "Record not found")
    path = Path(record["file_path"])
    if not path.exists():
        raise HTTPException(404, "File no longer on disk — it may have been deleted")
    return FileResponse(path, filename=record["filename"], media_type="application/pdf")


@router.delete("/history/{id}")
def remove_history(id: int):
    file_path = delete_merge(id)
    if file_path is None:
        raise HTTPException(404, "Record not found")
    try:
        os.unlink(file_path)
    except FileNotFoundError:
        pass
    return {"ok": True}
