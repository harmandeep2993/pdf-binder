from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from .routes import router

ROOT      = Path(__file__).parent.parent
FRONTEND  = ROOT / "index.html"
STATIC    = ROOT / "static"

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
app.include_router(router)

@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    return FRONTEND.read_text(encoding="utf-8")
