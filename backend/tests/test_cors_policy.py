from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


class CorsPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = get_settings()
        self.client = TestClient(create_app())

    def _preflight(self, origin: str):
        return self.client.options(
            "/api/v1/workspace/current",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
            },
        )

    def test_configured_frontend_origin_is_allowed(self) -> None:
        response = self._preflight(self.settings.frontend_origin)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), self.settings.frontend_origin)

    def test_unconfigured_localhost_origin_is_rejected(self) -> None:
        response = self._preflight("http://localhost:61999")

        self.assertNotEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()
