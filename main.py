from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os

from routers import ops
from database import database
from authorization import auth
from websocket import router as websocket_router

app = FastAPI(
    title="Chat Application Backend",
    description="FastAPI backend with WebSocket chat functionality",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(ops.router)
app.include_router(database.router)
app.include_router(auth.router)
app.include_router(websocket_router.router)

@app.get("/")
async def root():
    """Serve the main index page"""
    return FileResponse('static/index.html')

@app.get("/favicon.ico")
async def favicon():
    """Serve favicon"""
    favicon_path = "static/favicon.ico"
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    else:
        # Return a simple response if favicon doesn't exist
        return {"message": "Favicon not found"}

@app.get("/api/info")
async def api_info():
    """API information endpoint"""
    return {
        "message": "Chat application with WebSocket support",
        "version": "1.0.0",
        "endpoints": {
            "websocket": "/ws/{user_id}?token={jwt_token}",
            "auth": "/auth/login",
            "ops": "/ops/",
            "frontend": "/static/",
            "status": "running"
        },
        "features": [
            "Real-time WebSocket chat",
            "JWT authentication",
            "User management",
            "Admin panel",
            "Message history",
            "Responsive web interface"
        ]
    }
