import pytest
from pydantic import ValidationError

from app.recruitment_schemas import PublishTaskCreateRequest
from app.services.recruitment_publish_adapters import build_publish_adapter


@pytest.mark.parametrize("mode", ["live", "production", "", "MOCK"])
def test_unsupported_mode_is_rejected_before_publish(mode):
    with pytest.raises(ValidationError):
        PublishTaskCreateRequest(position_id=1, target_platform="boss", mode=mode)
    with pytest.raises(ValueError, match="Only mock"):
        build_publish_adapter("boss", mode)


@pytest.mark.parametrize("platform", ["boss", "zhilian", "custom"])
def test_default_mode_retains_preview_adapter(platform):
    payload = PublishTaskCreateRequest(position_id=1, target_platform=platform)
    adapter = build_publish_adapter(platform, payload.mode)
    result = adapter.publish_job({"position_id": 1, "title": "Synthetic preview"})
    assert result["status"] == "success"
    assert payload.mode == "mock"
