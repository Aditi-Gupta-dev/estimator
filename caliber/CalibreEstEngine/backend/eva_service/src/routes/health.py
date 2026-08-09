from fastapi import APIRouter
from sqlalchemy import func, select

from ..storage.db import session_scope
from ..storage.models import ChunkEmbedding, Document

router = APIRouter()


@router.get("/health")
def health():
    with session_scope() as session:
        doc_count = session.execute(select(func.count()).select_from(Document)).scalar_one()
        embedded_count = session.execute(select(func.count()).select_from(ChunkEmbedding)).scalar_one()
    return {
        "status": "ok",
        "documents": doc_count,
        "embedded_chunks": embedded_count,
    }
