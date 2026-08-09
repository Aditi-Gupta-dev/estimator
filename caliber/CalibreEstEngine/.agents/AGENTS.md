
# ENTERPRISE GOVERNANCE & AI QUALITY PILLARS

Every solution, design, code change, prompt, and RAG architectural component created for Calibre must strictly align with and evaluate against these 7 core pillars:

1. **Prompt Effectiveness & Efficiency**: Minimal token footprint, clear systemic framing, zero ambiguity, structured outputs.
2. **Knowledge Retrieval Quality**: High precision hybrid (vector + metadata) pre-filtering, context-preserving chunking, breadcrumb context headers.
3. **Response Reliability & Trustworthiness**: Grounded generation, explicit source attribution/citations, strict anti-hallucination guardrails, confidence scoring.
4. **Cost & Resource Utilization**: Optimized embedding models (	ext-embedding-3-small), token window capping (400-600 tokens), DB index efficiency, lazy execution.
5. **Security & Compliance Considerations**: Role-based access control (RBAC) enforced at database query level, sensitivity/classification filtering (e.g. Rate Cards restricted to Admin/SME), zero data leakage across tenants/roles.
6. **Business Value Measurement**: Traceability of estimation velocity, accuracy improvements (± variance against actuals), user adoption telemetry.
7. **Operational Governance & Oversight**: Audit logging for queries/ingestions, version control of prompt templates and document schemas, human-in-the-loop review for high-risk estimates.

