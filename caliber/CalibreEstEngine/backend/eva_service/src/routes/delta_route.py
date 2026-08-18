"""POST /internal/delta-analysis — internal-key-gated (main.py adds
require_internal_key to this router, same as documents/ingest/plan/chat).
Called by upload-server's estimator/deltaService.js after it has already
computed the deterministic delta and redacted any rate-card figures out of
it (Part 3) — this route never sees, and therefore can never leak, a
blendedRate value.
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from ..agents.delta_analysis import DeltaAIAnalysis, analyze_delta
from ..config import settings
from ..providers.llm_factory import get_llm

log = logging.getLogger("eva_service.delta_route")
router = APIRouter()


class DeltaAnalysisRequest(BaseModel):
    deterministicDelta: dict
    estimateName: str | None = None
    industry: str | None = None
    overallComplexity: str | None = None
    businessUnit: str | None = None
    changeReason: str | None = None
    projectName: str | None = None
    projectKey: str | None = None


@router.post("/internal/delta-analysis")
def delta_analysis(req: DeltaAnalysisRequest) -> DeltaAIAnalysis:
    try:
        llm = get_llm(settings)
    except RuntimeError as err:
        log.warning("No LLM provider configured for delta analysis: %s", err)
        raise HTTPException(status_code=503, detail="No LLM provider configured.") from err

    context = {
        "estimateName": req.estimateName,
        "industry": req.industry,
        "overallComplexity": req.overallComplexity,
        "businessUnit": req.businessUnit,
        "changeReason": req.changeReason,
        "projectName": req.projectName,
        "projectKey": req.projectKey,
    }

    try:
        result = analyze_delta(llm, req.deterministicDelta, context)
    except ValidationError as err:
        # Malformed structured output — never store arbitrary LLM text as
        # trusted structured data (Part 8). The caller marks the delta FAILED.
        log.warning("Delta analysis returned malformed structured output: %s", err)
        raise HTTPException(status_code=422, detail="Malformed AI analysis output.") from err
    except Exception as err:  # noqa: BLE001 — never crash the service on an LLM failure
        log.warning("Delta analysis LLM call failed: %s", err)
        raise HTTPException(status_code=502, detail="AI analysis failed.") from err

    return result
