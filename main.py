import argparse
from pdf_binder import app  # noqa: F401  (uvicorn imports this module)

if __name__ == "__main__":
    import uvicorn
    p = argparse.ArgumentParser()
    # Bind to loopback by default - this is a local, single-user tool with no
    # authentication. Pass --host 0.0.0.0 only if you knowingly want LAN access.
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true",
                   help="enable auto-reload (development only)")
    args = p.parse_args()
    if args.host == "0.0.0.0":
        print("WARNING: binding to 0.0.0.0 exposes this unauthenticated app to your network.")
    print(f"PDF Binder running at http://{args.host}:{args.port}")
    uvicorn.run("pdf_binder:app", host=args.host, port=args.port, reload=args.reload)
