import argparse
from pagefuse import app  # noqa: F401  (uvicorn imports this module)

if __name__ == "__main__":
    import uvicorn
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()
    print(f"Pagefuse running at http://{args.host}:{args.port}")
    uvicorn.run("pagefuse:app", host=args.host, port=args.port, reload=True)
