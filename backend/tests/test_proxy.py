import concurrent.futures
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx

from fastapi.testclient import TestClient
import ai
from proxy_server import create_proxy
from rate_limit import RateLimit


PAYLOAD = {
    "days": [{"weekday": "lun", "posture_pct": 85, "session_min": 12, "alerts": {}, "blinks_per_min": None}],
    "slouching_by_part_of_day": {"mañana": None},
}
SUMMARY = {"headline": "Tu semana", "points": ["day_0_posture", "day_0_time"],
           "tips": ["Haz una pausa."], "goal": "Completa tu siguiente sesión."}


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(os.environ, {
            "GEMINI_API_KEY": "test-key-only", "PS_ALLOWED_ORIGINS": "http://localhost:5173",
            "PS_PROVIDER": "gemini", "PS_IP_PER_HOUR": "2", "PS_GLOBAL_PER_DAY": "4",
            "PS_AI_MIN_INTERVAL_SECONDS": "0",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.calls = []

    def client(self, post=None):
        def response(url, headers, body, **kwargs):
            self.calls.append(body)
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(SUMMARY)}]}}]}
        return TestClient(create_proxy(post=post or response, clock=lambda: 10000,
                                       rate_path=Path(self.temp.name) / "quota.sqlite"))

    def test_valid_summary_health_and_cors(self):
        with self.client() as client:
            self.assertTrue(client.get("/health").json()["ok"])
            result = client.post("/summarize", json=PAYLOAD, headers={"Origin": "http://localhost:5173"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["headline"], SUMMARY["headline"])
            self.assertEqual(result.headers["access-control-allow-origin"], "http://localhost:5173")
            self.assertEqual(len(self.calls), 1)

    def test_invalid_payload_never_calls_provider(self):
        with self.client() as client:
            for content, code in [(b"x" * 4097, 413), (b"{", 422), (b'{"photo":"private"}', 422)]:
                self.assertEqual(client.post("/summarize", content=content, headers={"Content-Type": "application/json"}).status_code, code)
            self.assertEqual(client.post("/summarize", content="hello").status_code, 415)
            self.assertEqual(client.post("/summarize", json=PAYLOAD, headers={"Origin": "https://unknown.example"}).status_code, 403)
            self.assertEqual(self.calls, [])

    def test_limits_survive_application_restart_and_ignore_untrusted_header(self):
        with self.client() as client:
            for minutes in (12, 13):
                payload = {**PAYLOAD, "days": [{**PAYLOAD["days"][0], "session_min": minutes}]}
                self.assertEqual(client.post("/summarize", json=payload).status_code, 200)
        with self.client() as restarted:
            payload = {**PAYLOAD, "days": [{**PAYLOAD["days"][0], "session_min": 14}]}
            result = restarted.post("/summarize", json=payload, headers={"X-Forwarded-For": "203.0.113.22"})
            self.assertEqual(result.status_code, 429)
            self.assertIn("retry-after", result.headers)

    def test_cached_summary_and_cooldown_survive_restart(self):
        with patch.dict(os.environ, {"PS_AI_MIN_INTERVAL_SECONDS": "600"}):
            with self.client() as client:
                first = client.post("/summarize", json=PAYLOAD)
                second = client.post("/summarize", json=PAYLOAD)
                self.assertEqual(first.json(), second.json())
                self.assertEqual(len(self.calls), 1)
                changed = {**PAYLOAD, "days": [{**PAYLOAD["days"][0], "session_min": 20}]}
                self.assertEqual(client.post("/summarize", json=changed).status_code, 429)
            with self.client() as restarted:
                self.assertEqual(restarted.post("/summarize", json=PAYLOAD).status_code, 200)
                self.assertEqual(len(self.calls), 1)

    def test_simultaneous_identical_requests_share_generation(self):
        def response(*args, **kwargs):
            self.calls.append(True)
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(SUMMARY)}]}}]}
        app = create_proxy(post=response, rate_path=Path(self.temp.name) / "concurrent.sqlite")
        async def request_all():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                return await asyncio.gather(*(client.post("/summarize", json=PAYLOAD) for _ in range(3)))
        results = asyncio.run(request_all())
        self.assertTrue(all(result.status_code == 200 for result in results))
        self.assertEqual(len(self.calls), 1)

    def test_status_reports_real_wait_without_consuming_quota(self):
        now = [10000]
        def response(*args, **kwargs):
            self.calls.append(True)
            return {"candidates": [{"content": {"parts": [{"text": json.dumps(SUMMARY)}]}}]}
        with patch.dict(os.environ, {"PS_AI_MIN_INTERVAL_SECONDS": "600"}):
            app = create_proxy(post=response, clock=lambda: now[0], rate_path=Path(self.temp.name) / "status.sqlite")
            with TestClient(app) as client:
                self.assertTrue(client.get("/summary/status").json()["available"])
                self.assertEqual(client.post("/summarize", json=PAYLOAD).status_code, 200)
                now[0] += 30
                status = client.get("/summary/status").json()
                self.assertFalse(status["available"])
                self.assertEqual(status["retry_after"], 570)
                changed = {**PAYLOAD, "days": [{**PAYLOAD["days"][0], "session_min": 20}]}
                blocked = client.post("/summarize", json=changed)
                self.assertEqual(blocked.status_code, 429)
                self.assertEqual(blocked.headers["retry-after"], "570")
                self.assertEqual(len(self.calls), 1)
                now[0] += 570
                self.assertTrue(client.get("/summary/status").json()["available"])
                self.assertEqual(client.post("/summarize", json=changed).status_code, 200)
                self.assertEqual(len(self.calls), 2)

    def test_missing_key_and_provider_failure(self):
        with self.client() as client, patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            self.assertEqual(client.post("/summarize", json=PAYLOAD).status_code, 503)
        def failed(*args, **kwargs):
            raise ai.AIError("El proveedor no responde")
        with self.client(failed) as client:
            result = client.post("/summarize", json=PAYLOAD)
            self.assertEqual(result.status_code, 502)
            self.assertNotIn("test-key-only", result.text)

    def test_atomic_global_quota(self):
        limiter = RateLimit(Path(self.temp.name) / "parallel.sqlite", 100, 4)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda n: limiter.allow(str(n), 10000), range(12)))
        self.assertEqual(sum(results), 4)
        self.assertTrue(limiter.allow("new", 10000 + 86401))

    def test_summary_preserves_percent_units_and_rejects_invented_counts(self):
        payload = {**PAYLOAD, "slouching_by_part_of_day": {"tarde": 66, "noche": 4}}
        facts = ai.summary_facts(payload)
        response = {**SUMMARY, "points": ["part_tarde", "part_noche"]}
        result = ai.parse_summary(json.dumps(response), facts)
        self.assertIn("66%", result["points"][0])
        self.assertIn("4%", result["points"][1])
        response["points"] = ["Por la tarde hubo 66 encorvamientos", "part_noche"]
        with self.assertRaises(ai.AIError):
            ai.parse_summary(json.dumps(response), facts)


if __name__ == "__main__":
    unittest.main()
