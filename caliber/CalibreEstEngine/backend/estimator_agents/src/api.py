"""FastAPI service exposing the Oracle Fusion estimation risk models.

    GET  /health  — service + model status
    POST /score   — score a single project's inputs (see ScoreRequest below)

Run with:  uvicorn api:app --host 0.0.0.0 --port 8000
"""
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from predict import EstimationRiskEngine

app = FastAPI(title="Oracle Fusion Estimation Risk Engine", version="1.0.0")

# The calibre-app dev server (Vite) and its upload-server proxy (Express) —
# CORS is only exercised if something calls this service directly from the
# browser instead of through the Node proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine: Optional[EstimationRiskEngine] = None


@app.on_event("startup")
def load_engine():
    global engine
    engine = EstimationRiskEngine()


class ScoreRequest(BaseModel):
    complexity: Literal["L", "M", "H", "VH"]
    industry: str
    n_modules: int = Field(ge=1)
    n_entities: int = Field(ge=1)
    integ_simple: int = Field(ge=0)
    integ_complex: int = Field(ge=0)
    n_reports: int = Field(ge=0)
    n_cemli: int = Field(ge=0)
    n_dm_objects: int = Field(ge=0)
    duration_months: int = Field(ge=1)
    team_size: int = Field(ge=1)
    integ_coverage_ratio: float = Field(gt=0)
    dm_coverage_ratio: float = Field(gt=0)


class TopDriver(BaseModel):
    feature: str
    contribution: float


class MLCalibration(BaseModel):
    predicted_deviation_pct: float
    range_low_pct: float
    range_high_pct: float
    overrun_probability: float
    risk_band: Literal["GREEN", "AMBER", "RED"]
    historical_overrun_rate: Optional[float] = None
    historical_n_projects: Optional[int] = None
    top_drivers: list[TopDriver]
    model_used: dict


class SimilarProject(BaseModel):
    project_id: str
    industry: str
    complexity: str
    deviation_pct: float
    overrun_flag: int
    health: str


class ScoreResponse(BaseModel):
    ml_calibration: MLCalibration
    similar_projects: list[SimilarProject]


@app.get("/health")
def health():
    if engine is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
    return {
        "status": "ok",
        "uc1_model": engine.training_summary["uc1_deviation_regressor"]["champion_model"] if engine.uc1_champion is not None else "ridge_twin",
        "uc2_model": engine.training_summary["uc2_overrun_classifier"]["champion_model"] if engine.uc2_champion is not None else "logit_twin",
        "comparator_projects": len(engine.comparators),
        "industries": engine.coefficients["industries"],
    }


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest):
    if engine is None:
        raise HTTPException(status_code=503, detail="Models not loaded")

    known_industries = set(engine.coefficients["industries"])
    if request.industry not in known_industries:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown industry '{request.industry}'. Expected one of: {sorted(known_industries)}",
        )

    try:
        return engine.score(request.model_dump())
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Scoring failed: {err}") from err
