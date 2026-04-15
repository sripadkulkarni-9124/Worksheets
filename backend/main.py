from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db
from routes import evaluate, annotate, chat, reattempt, sessions, preprocess


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="VED Worksheet Evaluator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(evaluate.router, prefix="/api")
app.include_router(annotate.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(reattempt.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(preprocess.router, prefix="/api")


@app.get("/")
def root():
    return {"status": "VED API running"}
