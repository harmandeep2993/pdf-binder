# PDF Binder

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
uvicorn pdf_binder:app --reload --port 8000
```

Open `http://localhost:8000`.

### Custom host/port

```bash
python main.py --port 8001            # loopback only (default, recommended)
python main.py --host 0.0.0.0         # expose to LAN — see the warning below
python main.py --reload               # auto-reload (development only)
```

The server binds to `127.0.0.1` by default. This app has **no built-in user
accounts** — anyone who can reach the port can use every endpoint, including
reading and deleting your merge history. Only pass `--host 0.0.0.0` if you
intend to share it on a trusted network.

### Optional shared-token auth

If you do expose the app beyond loopback, set a token to gate every request:

```bash
PDF_BINDER_TOKEN=your-secret python main.py --host 0.0.0.0
```

Clients must then send the token via the `X-Auth-Token` header or a `?token=`
query parameter; requests without it get `401`.

## Data & privacy

Merged outputs are written to `output/` and indexed in `history.db` so you can
re-download them later. Only the **50 most recent** merges are kept — older
files and records are pruned automatically. Delete `output/` and `history.db`
to wipe everything. Nothing is uploaded to any external service.

## Limits

- Max upload: 100 MB per file (enforced while streaming, not just via headers)
- Max pages rendered/previewed per document: 5,000
- Cache: 500 MB LRU (oldest evicted on overflow)
- Output encryption (when you set an output password): AES-256
- Stored merge history: 50 most recent (older ones pruned)
