"""Safe local configuration and error classification for the Gemini backend."""

import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai


PROJECT_ENV_FILE = Path(__file__).resolve().parent / ".env"


def load_project_environment() -> None:
    """Load this project's .env without overriding hosting environment variables."""
    load_dotenv(PROJECT_ENV_FILE, override=False)


def configured_api_key() -> str:
    """Return the backend-only credential; callers must never log or serialize it."""
    return (os.getenv("GEMINI_API_KEY") or "").strip()


def classify_gemini_error(error: Exception, model: str) -> tuple[str, str]:
    """Return safe, actionable provider diagnostics without echoing request secrets."""
    if isinstance(error, genai.errors.APIError):
        code = getattr(error, "code", None) or getattr(error, "status", None)
        message = str(getattr(error, "message", "") or "").lower()
        if code in (401, 403):
            if "access_token_type_unsupported" in message or "access token type unsupported" in message:
                return "authentication_type", (
                    "Gemini rejected this credential type (ACCESS_TOKEN_TYPE_UNSUPPORTED). "
                    "Use a credential supported by the Gemini Developer API and current SDK, "
                    "or check the provider's authentication status."
                )
            return "authentication", (
                "Gemini rejected the configured API key. Set a valid current Gemini API key "
                "in the backend GEMINI_API_KEY environment variable or project .env file."
            )
        if code == 429:
            return "quota", "Gemini rate limit or quota was reached. Check the key's project quota and billing."
        if code in (400, 404) and (
            "model" in message and any(term in message for term in ("not found", "unsupported", "not supported"))
        ):
            return "model", f"Gemini model '{model}' is unavailable or unsupported. Check GEMINI_MODEL."
        if code in (400, 404):
            return "request", f"Gemini rejected the request (HTTP {code}). Check the model and request configuration."
        if isinstance(code, int) and 500 <= code <= 599:
            return "provider_server", f"Gemini is temporarily unavailable (HTTP {code}). Try again shortly."
        return "provider", f"Gemini rejected the request (HTTP {code or 'unknown'}). Check provider configuration."

    error_type = type(error).__name__.lower()
    if "timeout" in error_type:
        return "timeout", "Gemini did not respond before the timeout. Try again shortly."
    if any(term in error_type for term in ("connect", "network", "transport")):
        return "network", "Could not reach Gemini. Check network and proxy connectivity from the backend host."
    return "internal", "Gemini could not respond right now. Please try again."
