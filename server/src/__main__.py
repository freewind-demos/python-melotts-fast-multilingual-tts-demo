import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "src.app:app",
        host=os.environ.get("MELO_HOST", "127.0.0.1"),
        port=int(os.environ.get("MELO_PORT", "37861")),
        reload=os.environ.get("MELO_RELOAD") == "1",
    )
