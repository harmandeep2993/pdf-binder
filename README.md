# Pagefuse

Local PDF tool — merge, split, reorder, rotate, and extract pages. No cloud, no uploads.

## Features

- Merge multiple PDFs into one
- Reorder pages by dragging
- Rotate, duplicate, and delete individual pages
- Split or extract pages as PDF or images (JPEG/PNG)
- Password-protected PDF support
- Live preview of the final merged output
- Light/dark theme

## Requirements

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) (or pip)

## Setup

```bash
uv sync
.venv\Scripts\activate      # Windows
# source .venv/bin/activate # macOS/Linux
```

## Run

```bash
uvicorn pagefuse:app --reload --port 8000
```

Open `http://localhost:8000`.

### Custom host/port

```bash
python main.py --host 0.0.0.0 --port 8001
```

Binds to all interfaces so other devices on your LAN can connect.

## Limits

- Max upload: 100 MB per file
- Cache: 500 MB LRU (oldest evicted on overflow)
