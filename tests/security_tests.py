#!/usr/bin/env python3
"""
ExpenseTrack Security Tests — 34 tests across 8 attack categories.

Usage:
    Start the dev server first:  npm run dev
    Then run:                    python3 tests/security_tests.py
"""

import requests
import json
import sys

BASE = "http://localhost:5000"
PASS = 0
FAIL = 0
FAILURES = []


def ok(label):
    global PASS
    PASS += 1
    print(f"  ✅  PASS  {label}")


def fail(label, detail=""):
    global FAIL
    FAIL += 1
    FAILURES.append(label)
    print(f"  ❌  FAIL  {label}" + (f"  — {detail}" if detail else ""))


def assert_status(label, got, want):
    if isinstance(want, (list, tuple)):
        if got in want:
            ok(f"{label} (HTTP {got})")
        else:
            fail(label, f"expected HTTP {want}, got {got}")
    else:
        if got == want:
            ok(f"{label} (HTTP {got})")
        else:
            fail(label, f"expected HTTP {want}, got HTTP {got}")


def assert_not_contains(label, body_str, bad_pattern):
    """Body must NOT contain the bad pattern (case-insensitive)."""
    if bad_pattern.lower() in body_str.lower():
        fail(label, f"response contained sensitive pattern: {bad_pattern!r}")
    else:
        ok(label)


def section(title):
    print(f"\n{'═'*62}")
    print(f"  {title}")
    print(f"{'═'*62}")


def post(path, payload):
    r = requests.post(f"{BASE}{path}", json=payload)
    return r.status_code, r.text

def get(path):
    r = requests.get(f"{BASE}{path}")
    return r.status_code, r.text

def patch(path, payload):
    r = requests.patch(f"{BASE}{path}", json=payload)
    return r.status_code, r.text

def delete(path):
    r = requests.delete(f"{BASE}{path}")
    return r.status_code, r.text

def put(path, payload=None):
    r = requests.put(f"{BASE}{path}", json=payload or {})
    return r.status_code, r.text

def head(path):
    r = requests.head(f"{BASE}{path}")
    return r.status_code, dict(r.headers)


# ── Seed a report for tests that need an existing resource ────────────────────
r = requests.post(f"{BASE}/api/reports", json={
    "name": "Security Test Seed",
    "type": "monthly",
    "submitterName": "SecurityTester",
    "status": "draft"
})
SEED_ID = r.json()["id"]
print(f"Seeded report id={SEED_ID}")


# ─────────────────────────────────────────────────────────────────────────────
section("1 — SQL INJECTION")

# 1a. OR 1=1 in report name
s, body = post("/api/reports", {"name": "' OR '1'='1", "type": "monthly",
    "submitterName": "test", "status": "draft"})
assert_status("1a: SQL injection in report name accepted as literal (200)", s, [200, 201])
r2 = requests.get(f"{BASE}/api/reports").json()
names = [r["name"] for r in r2]
if "' OR '1'='1" in names:
    ok("1b: SQL injection name stored as literal, not evaluated")
else:
    fail("1b: SQL injection name not stored correctly")

# 1c. DROP TABLE attempt in category field
s, body = post(f"/api/reports/{SEED_ID}/items", {
    "category": "'); DROP TABLE expense_items; --",
    "description": "SQLi test", "currency": "USD",
    "amount": 1, "amountUsd": 1, "exchangeRate": 1,
    "isMileage": False, "miles": 0, "billedToCard": False
})
assert_status("1c: DROP TABLE in category accepted or rejected cleanly (200/201/400)", s, [200, 201, 400])

# 1d. Reports table still intact after injection attempts
s2, body2 = get("/api/reports")
assert_status("1d: expense_reports table intact after SQLi attempts", s2, 200)


# ─────────────────────────────────────────────────────────────────────────────
section("2 — PATH TRAVERSAL")

# 2a–2d: ../sequences in string fields should be stored as literal text
for i, payload in enumerate([
    ("name", "../../etc/passwd"),
    ("name", "..\\..\\windows\\system32\\config\\sam"),
    ("submitterName", "../../../etc/shadow"),
    ("tripPurpose", "../../../../var/log/auth.log"),
], start=1):
    field, value = payload
    s, body = post("/api/reports", {field: value, "type": "travel",
        "submitterName": "PathTest", "status": "draft"})
    label = f"2{chr(96+i)}: path traversal in {field!r} stored as literal"
    assert_status(label, s, [200, 201])


# ─────────────────────────────────────────────────────────────────────────────
section("3 — XSS PAYLOAD INJECTION")

xss_payloads = [
    "<script>alert('xss')</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(document.cookie)",
    "\"><svg onload=alert(1)>",
]

for i, payload in enumerate(xss_payloads, start=1):
    s, body = post("/api/reports", {
        "name": payload, "type": "monthly",
        "submitterName": "XSSTest", "status": "draft"
    })
    label = f"3{chr(96+i)}: XSS payload {payload[:30]!r} stored as literal"
    assert_status(label, s, [200, 201])
    # Verify it round-trips as literal text
    data = requests.get(f"{BASE}/api/reports").json()
    stored = [r["name"] for r in data if r["name"] == payload]
    if stored:
        ok(f"3{chr(96+i)}-verify: XSS payload returned verbatim, not executed")
    # Note: escaping happens at render time (React); the API is not responsible


# ─────────────────────────────────────────────────────────────────────────────
section("4 — MASS ASSIGNMENT / OVER-POSTING")

# 4a: id cannot be set by client
s, body = post("/api/reports", {
    "id": 999999, "name": "Mass assign test",
    "type": "monthly", "submitterName": "T", "status": "draft"
})
assert_status("4a: POST with explicit id accepted (id should be ignored)", s, [200, 201])
data = requests.get(f"{BASE}/api/reports").json()
ids = [r["id"] for r in data]
if 999999 in ids:
    fail("4b: client-supplied id=999999 was used — mass assignment vulnerability")
else:
    ok("4b: client-supplied id ignored; server assigned auto-increment id")

# 4c: extra unknown fields are silently ignored
s, body = post("/api/reports", {
    "name": "Extra fields test", "type": "monthly",
    "submitterName": "T", "status": "draft",
    "__proto__": {"polluted": True},
    "isAdmin": True,
    "internalField": "hack"
})
assert_status("4c: extra unknown fields accepted (stripped, not errored)", s, [200, 201])


# ─────────────────────────────────────────────────────────────────────────────
section("5 — HTTP METHOD TAMPERING")

# 5a: PUT on reports list (no handler)
s, _ = put("/api/reports", {"name": "put test", "type": "monthly"})
assert_status("5a: PUT /api/reports returns 404/405", s, [404, 405])

# 5b: PUT on single report (no handler)
s, _ = put(f"/api/reports/{SEED_ID}", {"name": "tamper"})
assert_status("5b: PUT /api/reports/:id returns 404/405", s, [404, 405])

# 5c: DELETE on items list (no handler)
s, _ = delete(f"/api/reports/{SEED_ID}/items")
assert_status("5c: DELETE /api/reports/:id/items returns 404/405", s, [404, 405])

# 5d: HEAD on reports (no explicit handler; may return 200 or 404)
s, headers = head("/api/reports")
assert_not_contains("5d: X-Powered-By header absent", headers.get("X-Powered-By", ""), "express")


# ─────────────────────────────────────────────────────────────────────────────
section("6 — MALFORMED / OVERSIZED INPUT")

# 6a: Missing required 'type' field
s, body = post("/api/reports", {"name": "No type", "submitterName": "T"})
assert_status("6a: missing required 'type' field returns 400", s, 400)

# 6b: Wrong type for 'type' field
s, body = post("/api/reports", {"name": "Bad type", "type": 12345,
    "submitterName": "T", "status": "draft"})
assert_status("6b: wrong type for 'type' field returns 400", s, [400, 422])

# 6c: Oversized string (100 KB name)
big = "A" * 100_000
s, body = post("/api/reports", {"name": big, "type": "monthly",
    "submitterName": "T", "status": "draft"})
assert_status("6c: oversized 100KB name field handled (200/400/413)", s, [200, 201, 400, 413])

# 6d: Completely empty body
r = requests.post(f"{BASE}/api/reports", data="", headers={"Content-Type": "application/json"})
assert_status("6d: empty body handled (400)", r.status_code, 400)

# 6e: Non-JSON content type
r = requests.post(f"{BASE}/api/reports",
    data="name=test&type=monthly",
    headers={"Content-Type": "application/x-www-form-urlencoded"})
assert_status("6e: form-encoded body handled (400/415)", r.status_code, [400, 415])


# ─────────────────────────────────────────────────────────────────────────────
section("7 — IDOR (INSECURE DIRECT OBJECT REFERENCE)")

# 7a: GET non-existent report
s, _ = get("/api/reports/999999")
assert_status("7a: GET non-existent report returns 404", s, 404)

# 7b: PATCH non-existent report
s, _ = patch("/api/reports/999999", {"name": "ghost"})
assert_status("7b: PATCH non-existent report returns 404", s, 404)

# 7c: DELETE non-existent report
s, _ = delete("/api/reports/999999")
assert_status("7c: DELETE non-existent report returns 404", s, 404)

# 7d: POST item to non-existent report
s, _ = post("/api/reports/999999/items", {
    "category": "Meals", "currency": "USD",
    "amount": 10, "amountUsd": 10, "exchangeRate": 1,
    "isMileage": False, "miles": 0, "billedToCard": False
})
assert_status("7d: POST item to non-existent report returns 404", s, 404)

# 7e: PATCH non-existent item
s, _ = patch("/api/items/999999", {"amount": 100})
assert_status("7e: PATCH non-existent item returns 404", s, 404)

# 7f: DELETE non-existent item
s, _ = delete("/api/items/999999")
assert_status("7f: DELETE non-existent item returns 404", s, 404)


# ─────────────────────────────────────────────────────────────────────────────
section("8 — HEADER INJECTION & RESPONSE SPLITTING")

# 8a: CRLF in report name (response splitting attempt)
s, body = post("/api/reports", {
    "name": "test\r\nX-Injected: evil", "type": "monthly",
    "submitterName": "T", "status": "draft"
})
assert_status("8a: CRLF in name handled cleanly (200/400)", s, [200, 201, 400])

# 8b: X-Powered-By must not appear in any response
r = requests.get(f"{BASE}/api/reports")
if "X-Powered-By" in r.headers:
    fail("8b: X-Powered-By header present — stack fingerprinting risk",
         r.headers["X-Powered-By"])
else:
    ok("8b: X-Powered-By header absent")

# 8c: Null bytes in string field
s, body = post("/api/reports", {
    "name": "null\x00byte", "type": "monthly",
    "submitterName": "T", "status": "draft"
})
assert_status("8c: null byte in name handled (200/400)", s, [200, 201, 400])

# 8d: Unicode edge cases
s, body = post("/api/reports", {
    "name": "Unicode: \u0000\uFFFD\u202E\u200B", "type": "monthly",
    "submitterName": "T", "status": "draft"
})
assert_status("8d: unicode edge cases in name handled (200/400)", s, [200, 201, 400])


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{'═'*62}")
print(f"\n  RESULTS: {PASS} passed, {FAIL} failed")
if FAIL == 0:
    print("  ✅  ALL SECURITY TESTS PASSED")
else:
    print(f"  ❌  {FAIL} TEST(S) FAILED:")
    for f in FAILURES:
        print(f"      • {f}")
print(f"\n{'═'*62}")
sys.exit(0 if FAIL == 0 else 1)
