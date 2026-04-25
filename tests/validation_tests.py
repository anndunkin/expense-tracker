#!/usr/bin/env python3
"""
ExpenseTrack Input Validation Tests — 23 tests.

Verifies that the Zod validation rules in shared/schema.ts reject bad inputs
on both POST (create) and PATCH (update) paths, and that valid inputs are accepted.

Usage:
    Start the dev server first:  npm run dev
    Then run:                    python3 tests/validation_tests.py
"""

import requests
import sys
import urllib.request as _ur
import urllib.error as _ue
import json

BASE = "http://localhost:5000"
PASS = 0
FAIL = 0
FAILURES = []


def ok(label, detail=""):
    global PASS
    PASS += 1
    print(f"  ✅  PASS  {label}" + (f"  ({detail})" if detail else ""))


def fail(label, detail=""):
    global FAIL
    FAIL += 1
    FAILURES.append(label)
    print(f"  ❌  FAIL  {label}" + (f"  — {detail}" if detail else ""))


def assert_status(label, got, want):
    if got == want:
        ok(label, f"HTTP {got}")
    else:
        fail(label, f"expected HTTP {want}, got HTTP {got}")


def section(title):
    print(f"\n{'═'*62}")
    print(f"  {title}")
    print(f"{'═'*62}")


def post_item(rid, payload):
    r = requests.post(f"{BASE}/api/reports/{rid}/items", json=payload)
    return r.status_code

def patch_item(iid, payload):
    r = requests.patch(f"{BASE}/api/items/{iid}", json=payload)
    return r.status_code

def post_raw(rid, body_bytes):
    """Send a raw JSON body (allows non-serializable values like strings for numbers)."""
    try:
        req = _ur.Request(
            f"{BASE}/api/reports/{rid}/items",
            data=body_bytes,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with _ur.urlopen(req) as resp:
            return resp.status
    except _ue.HTTPError as e:
        return e.code

def create_report(name="Validation Test", rtype="travel"):
    r = requests.post(f"{BASE}/api/reports", json={
        "name": name, "type": rtype,
        "submitterName": "ValidationTester", "status": "draft"
    })
    assert r.status_code in (200, 201), f"Failed to create report: {r.text}"
    return r.json()["id"]

def valid_item(**overrides):
    """Base valid item payload."""
    item = {
        "category": "Meals", "description": "Test",
        "currency": "USD", "amount": 25.00, "amountUsd": 25.00,
        "exchangeRate": 1, "isMileage": False, "miles": 0, "billedToCard": False
    }
    item.update(overrides)
    return item

def valid_mileage_item(**overrides):
    """Base valid mileage item payload."""
    item = {
        "category": "Mileage Reimbursement", "description": "Drive",
        "currency": "USD", "amount": 72.50, "amountUsd": 72.50,
        "exchangeRate": 1, "isMileage": True, "miles": 100, "billedToCard": False
    }
    item.update(overrides)
    return item


# ─────────────────────────────────────────────────────────────────────────────
section("1 — MILEAGE MILES FIELD VALIDATION")

rid1 = create_report("Miles Validation")

# 1a. Valid miles — integer
s = post_item(rid1, valid_mileage_item(miles=50))
assert_status("1a: valid integer miles (50) accepted (201)", s, 201)
# Save item id for PATCH tests
items = requests.get(f"{BASE}/api/reports/{rid1}/items").json()
valid_item_id = items[0]["id"]

# 1b. Valid miles — float
s = post_item(rid1, valid_mileage_item(miles=12.75, amount=9.24, amountUsd=9.24))
assert_status("1b: valid fractional miles (12.75) accepted (201)", s, 201)

# 1c. Rejected: negative miles
s = post_item(rid1, valid_mileage_item(miles=-10, amount=-7.25, amountUsd=-7.25))
assert_status("1c: negative miles rejected (400)", s, 400)

# 1d. Rejected: zero miles on mileage item
s = post_item(rid1, valid_mileage_item(miles=0, amount=0, amountUsd=0))
assert_status("1d: zero miles on mileage item rejected (400)", s, 400)

# 1e. Rejected: string value for miles (sent as raw JSON)
s = post_raw(rid1, b'{"category":"Mileage Reimbursement","description":"Bad","currency":"USD","amount":10,"amountUsd":10,"exchangeRate":1,"isMileage":true,"miles":"fifty","billedToCard":false}')
assert_status("1e: string miles rejected (400)", s, 400)

# 1f. Zero miles is fine for non-mileage items
s = post_item(rid1, valid_item(miles=0))
assert_status("1f: zero miles on non-mileage item accepted (201)", s, 201)


# ─────────────────────────────────────────────────────────────────────────────
section("2 — FOREIGN CURRENCY AMOUNT VALIDATION")

rid2 = create_report("FX Validation")

# 2a. Valid FX item — EUR
s = post_item(rid2, valid_item(currency="EUR", amount=100, amountUsd=109, exchangeRate=1.09))
assert_status("2a: valid EUR item accepted (201)", s, 201)

# 2b. Rejected: negative amount
s = post_item(rid2, valid_item(currency="EUR", amount=-50, amountUsd=-54.5, exchangeRate=1.09))
assert_status("2b: negative amount rejected (400)", s, 400)

# 2c. Rejected: negative amountUsd
s = post_item(rid2, valid_item(currency="EUR", amount=50, amountUsd=-54.5, exchangeRate=1.09))
assert_status("2c: negative amountUsd rejected (400)", s, 400)

# 2d. Rejected: zero exchange rate
s = post_item(rid2, valid_item(currency="EUR", amount=50, amountUsd=0, exchangeRate=0))
assert_status("2d: zero exchange rate rejected (400)", s, 400)

# 2e. Rejected: negative exchange rate
s = post_item(rid2, valid_item(currency="EUR", amount=50, amountUsd=-54.5, exchangeRate=-1.09))
assert_status("2e: negative exchange rate rejected (400)", s, 400)

# 2f. Rejected: unsupported currency code
s = post_item(rid2, valid_item(currency="XYZ", amount=50, amountUsd=50, exchangeRate=1))
assert_status("2f: unsupported currency code rejected (400)", s, 400)

# 2g. Rejected: empty string currency
s = post_item(rid2, valid_item(currency="", amount=50, amountUsd=50, exchangeRate=1))
assert_status("2g: empty currency string rejected (400)", s, 400)

# 2h. All 20 supported currencies accepted
SUPPORTED = ["USD","EUR","GBP","CAD","MXN","JPY","AUD","CHF","CNY","INR",
             "BRL","KRW","SGD","HKD","NZD","SEK","NOK","DKK","ZAR","AED"]
failures = []
for code in SUPPORTED:
    rate = 1 if code == "USD" else 1.1
    s2 = post_item(rid2, valid_item(currency=code, amount=10, amountUsd=11, exchangeRate=rate))
    if s2 not in (200, 201):
        failures.append(code)
if failures:
    fail(f"2h: some supported currencies rejected: {failures}")
else:
    ok("2h: all 20 supported currencies accepted")


# ─────────────────────────────────────────────────────────────────────────────
section("3 — PATCH PATH VALIDATION")

rid3 = create_report("PATCH Validation")
s = post_item(rid3, valid_mileage_item(miles=100))
assert_status("3a: seed mileage item created (201)", s, 201)
items3 = requests.get(f"{BASE}/api/reports/{rid3}/items").json()
iid3 = items3[0]["id"]

# 3b. Rejected PATCH: negative miles
s = patch_item(iid3, {"miles": -50})
assert_status("3b: PATCH negative miles rejected (400)", s, 400)

# 3c. Rejected PATCH: negative amountUsd
s = patch_item(iid3, {"amountUsd": -100})
assert_status("3c: PATCH negative amountUsd rejected (400)", s, 400)

# 3d. Rejected PATCH: zero exchange rate
s = patch_item(iid3, {"exchangeRate": 0})
assert_status("3d: PATCH zero exchangeRate rejected (400)", s, 400)

# 3e. Rejected PATCH: negative exchange rate
s = patch_item(iid3, {"exchangeRate": -1.5})
assert_status("3e: PATCH negative exchangeRate rejected (400)", s, 400)

# 3f. Valid PATCH: update miles
s = patch_item(iid3, {"miles": 200, "amount": 145, "amountUsd": 145})
assert_status("3f: valid PATCH miles update accepted (200)", s, 200)

# 3g. Valid PATCH: flip billedToCard
s = patch_item(iid3, {"billedToCard": True})
assert_status("3g: valid PATCH billedToCard flip accepted (200)", s, 200)

# 3h. Verify the item was actually updated
item_updated = requests.get(f"{BASE}/api/reports/{rid3}/items").json()[0]
if item_updated.get("billedToCard") == True:
    ok("3h: billedToCard correctly reflected after PATCH")
else:
    fail("3h: billedToCard not updated after valid PATCH")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{'═'*62}")
print(f"\n  RESULTS: {PASS} passed, {FAIL} failed")
if FAIL == 0:
    print("  ✅  ALL VALIDATION TESTS PASSED")
else:
    print(f"  ❌  {FAIL} TEST(S) FAILED:")
    for f in FAILURES:
        print(f"      • {f}")
print(f"\n{'═'*62}")
sys.exit(0 if FAIL == 0 else 1)
