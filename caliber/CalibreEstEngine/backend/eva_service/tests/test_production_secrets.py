"""Regression tests for eva_service's production fail-closed check on
internal_api_key (Phase 2.1, security gap #2 from the Phase 2 report).

Mirrors the property already tested for upload-server's JWT_SECRET/
INTERNAL_API_KEY in Node: a production deployment must refuse to start
with a missing or still-default internal secret, while development stays
completely unaffected. validate_production_secrets() is a standalone
function specifically so these scenarios can be tested directly against a
constructed Settings instance rather than needing to spawn a real process
per case (which is how this was verified live for the Node services).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from src.config import DEV_INTERNAL_API_KEY, Settings, validate_production_secrets  # noqa: E402


def _settings(**overrides):
    """A Settings instance isolated from any real .env file on disk, so
    these tests can't accidentally pass/fail based on this machine's local
    configuration."""
    return Settings(_env_file=None, **overrides)


def test_production_missing_key_fails():
    """No INTERNAL_API_KEY configured at all falls back to the same
    DEV_INTERNAL_API_KEY default — "missing" and "still the placeholder"
    are the same observable state, by construction."""
    s = _settings(node_env="production")
    assert s.internal_api_key == DEV_INTERNAL_API_KEY
    with pytest.raises(RuntimeError, match="INTERNAL_API_KEY"):
        validate_production_secrets(s)


def test_production_default_key_fails():
    s = _settings(node_env="production", internal_api_key=DEV_INTERNAL_API_KEY)
    with pytest.raises(RuntimeError, match="INTERNAL_API_KEY"):
        validate_production_secrets(s)


def test_production_real_key_succeeds():
    s = _settings(node_env="production", internal_api_key="a-real-production-secret-value")
    validate_production_secrets(s)  # must not raise


def test_development_default_key_succeeds():
    """Development is unaffected — the exact default that fails in
    production must be a no-op here, matching current behavior."""
    s = _settings(node_env="development", internal_api_key=DEV_INTERNAL_API_KEY)
    validate_production_secrets(s)  # must not raise


def test_unset_node_env_defaults_to_development_and_succeeds():
    """No NODE_ENV set at all (the normal local-dev case) must behave
    exactly like explicit 'development' — this is what keeps every existing
    test in this suite, and a plain `uvicorn src.main:app`, working
    unchanged."""
    s = _settings(internal_api_key=DEV_INTERNAL_API_KEY)
    assert s.node_env == "development"
    validate_production_secrets(s)  # must not raise


def test_module_level_settings_do_not_raise_in_this_test_environment():
    """The real, module-level `settings` object (imported normally, already
    validated once at import time by config.py itself) must exist and be
    usable — proves the check did not prevent the module from loading in
    this (development) test environment."""
    from src.config import settings

    assert settings.node_env == "development"
