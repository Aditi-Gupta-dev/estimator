"""Markdown chunking, per RAG_Architecture_Guide.docx's chunking rules:

- Word/PDF/PPT-derived markdown: split by heading, 400-700 tokens, 10-15%
  overlap, title + breadcrumb prepended per chunk.
- Excel/CSV-derived markdown: split by "## Sheet:" boundary, then into
  400-600 token row-blocks with the sheet name + header row repeated in
  each chunk.
"""
from dataclasses import dataclass

import tiktoken
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

from .converters import SHEET_AWARE_EXTS

_encoding = tiktoken.get_encoding("cl100k_base")

DOCX_MIN_TOKENS, DOCX_MAX_TOKENS = 400, 700
DOCX_OVERLAP_RATIO = 0.12
XLSX_MIN_TOKENS, XLSX_MAX_TOKENS = 400, 600

_HEADER_SPLITTER = MarkdownHeaderTextSplitter(
    headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")],
    strip_headers=False,
)


@dataclass
class ChunkDraft:
    section_path: str
    text: str
    token_count: int


def _token_count(text: str) -> int:
    return len(_encoding.encode(text))


def chunk_markdown(md_text: str, file_ext: str, title: str) -> list[ChunkDraft]:
    if file_ext.lower() in SHEET_AWARE_EXTS:
        return _chunk_sheet_markdown(md_text, title)
    return _chunk_heading_markdown(md_text, title)


def _breadcrumb(title: str, metadata: dict) -> str:
    parts = [title] + [v for v in metadata.values() if v]
    return " > ".join(parts)


def _chunk_heading_markdown(md_text: str, title: str) -> list[ChunkDraft]:
    sections = _HEADER_SPLITTER.split_text(md_text) or [
        type("S", (), {"page_content": md_text, "metadata": {}})()
    ]

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=DOCX_MAX_TOKENS * 4,  # ~4 chars/token heuristic
        chunk_overlap=int(DOCX_MAX_TOKENS * 4 * DOCX_OVERLAP_RATIO),
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    drafts: list[ChunkDraft] = []
    for section in sections:
        breadcrumb = _breadcrumb(title, section.metadata)
        section_text = f"{breadcrumb}\n\n{section.page_content}".strip()

        if _token_count(section_text) <= DOCX_MAX_TOKENS:
            drafts.append(ChunkDraft(breadcrumb, section_text, _token_count(section_text)))
            continue

        for piece in splitter.split_text(section.page_content):
            piece_text = f"{breadcrumb}\n\n{piece}".strip()
            drafts.append(ChunkDraft(breadcrumb, piece_text, _token_count(piece_text)))

    return [d for d in drafts if d.text.strip()]


def _chunk_sheet_markdown(md_text: str, title: str) -> list[ChunkDraft]:
    drafts: list[ChunkDraft] = []
    sheets = md_text.split("\n## Sheet: ")
    for i, raw in enumerate(sheets):
        if not raw.strip():
            continue
        block = raw if i == 0 and raw.startswith("## Sheet: ") else f"## Sheet: {raw}"
        header_line, _, rest = block.partition("\n")
        sheet_name = header_line.replace("## Sheet: ", "").strip()

        lines = rest.strip("\n").split("\n")
        if len(lines) < 2:
            continue
        table_header, table_sep, table_rows = lines[0], lines[1], lines[2:]

        row_block: list[str] = []
        for row in table_rows + [None]:
            candidate = row_block + ([row] if row is not None else [])
            candidate_text = _sheet_chunk_text(title, sheet_name, table_header, table_sep, candidate)
            if row is not None and _token_count(candidate_text) > XLSX_MAX_TOKENS and row_block:
                drafts.append(
                    ChunkDraft(
                        f"{title} > {sheet_name}",
                        _sheet_chunk_text(title, sheet_name, table_header, table_sep, row_block),
                        _token_count(_sheet_chunk_text(title, sheet_name, table_header, table_sep, row_block)),
                    )
                )
                row_block = [row]
            else:
                if row is not None:
                    row_block.append(row)

        if row_block:
            text = _sheet_chunk_text(title, sheet_name, table_header, table_sep, row_block)
            drafts.append(ChunkDraft(f"{title} > {sheet_name}", text, _token_count(text)))

    return drafts


def _sheet_chunk_text(title: str, sheet_name: str, header: str, sep: str, rows: list[str]) -> str:
    breadcrumb = f"{title} > Sheet: {sheet_name}"
    table = "\n".join([header, sep, *rows])
    return f"{breadcrumb}\n\n{table}"
