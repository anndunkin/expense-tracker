#!/usr/bin/env python3
import os
"""
ExpenseTrack Boundary Tests — Mileage totals & Corp card subtotals
Verifies report-level sums stay accurate when valid, rejected, and
foreign-currency entries coexist.
"""

import requests
import json
import sys

# Port is allocated dynamically by the Electron shell; override with
# EXPENSE_TRACK_BASE when testing against a running app instance.
BASE = os.environ.get("EXPENSE_TRACK_BASE", "http://127.0.0.1:5000")
MILEAGE_RATE = 0.725  # 2026 IRS rate

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

def assert_eq(label, got, want, precision=3):
    if isinstance(got, float) and isinstance(want, float):
        if round(got, precision) == round(want, precision):
            ok(label, f"got {got:.{precision}f}")
        else:
            fail(label, f"expected {want:.{precision}f}, got {got:.{precision}f}")
    else:
        if got == want:
            ok(label, f"got {got}")
        else:
            fail(label, f"expected {want!r}, got {got!r}")

def post_report(name, rtype="travel"):
    r = requests.post(f"{BASE}/api/reports", json={
        "name": name, "type": rtype,
        "submitterName": "BoundaryTester", "status": "draft"
    })
    assert r.status_code in (200, 201), f"Failed to create report: {r.text}"
    return r.json()["id"]

def post_item(rid, payload):
    r = requests.post(f"{BASE}/api/reports/{rid}/items", json=payload)
    return r.status_code, r.json() if r.status_code in (200, 201, 400, 404, 422) else {}

def patch_item(iid, payload):
    r = requests.patch(f"{BASE}/api/items/{iid}", json=payload)
    return r.status_code, r.json() if r.status_code in (200, 201, 400, 404, 422) else {}

def get_items(rid):
    r = requests.get(f"{BASE}/api/reports/{rid}/items")
    assert r.status_code == 200
    return r.json()

def total_reimb(items):
    return sum(i.get("amountUsd", 0) for i in items if not i.get("billedToCard", False))

def total_card(items):
    return sum(i.get("amountUsd", 0) for i in items if i.get("billedToCard", False))

def total_all(items):
    return sum(i.get("amountUsd", 0) for i in items)

def total_miles(items):
    return sum(i.get("miles", 0) for i in items if i.get("isMileage", False))

def total_mileage_usd(items):
    return sum(i.get("amountUsd", 0) for i in items if i.get("isMileage", False))

def section(title):
    print(f"\n{'═'*62}")
    print(f"  {title}")
    print(f"{'═'*62}")

# ─────────────────────────────────────────────────────────────────
section("BLOCK 1 — MILEAGE TOTALS: MIX OF VALID + REJECTED")

rid1 = post_report("Mileage Boundary Test", "monthly")
print(f"  Report ID: {rid1}")

# Valid entries
s, _ = post_item(rid1, {"category":"Mileage Reimbursement","description":"Trip A",
    "currency":"USD","amount":72.50,"amountUsd":72.50,"exchangeRate":1,
    "isMileage":True,"miles":100,"billedToCard":False})
assert_status("1a: 100 valid miles accepted (201)", s, 201)

s, _ = post_item(rid1, {"category":"Mileage Reimbursement","description":"Trip B",
    "currency":"USD","amount":36.6125,"amountUsd":36.6125,"exchangeRate":1,
    "isMileage":True,"miles":50.5,"billedToCard":False})
assert_status("1b: 50.5 fractional miles accepted (201)", s, 201)

# Rejected entries — must NOT be persisted
s, _ = post_item(rid1, {"category":"Mileage Reimbursement","description":"Trip NEG",
    "currency":"USD","amount":-72.50,"amountUsd":-72.50,"exchangeRate":1,
    "isMileage":True,"miles":-100,"billedToCard":False})
assert_status("1c: negative miles rejected (400)", s, 400)

s, _ = post_item(rid1, {"category":"Mileage Reimbursement","description":"Trip ZERO",
    "currency":"USD","amount":0,"amountUsd":0,"exchangeRate":1,
    "isMileage":True,"miles":0,"billedToCard":False})
assert_status("1d: zero miles on mileage item rejected (400)", s, 400)

s, _ = post_item(rid1, {"category":"Mileage Reimbursement","description":"Trip NEGAMT",
    "currency":"USD","amount":72.50,"amountUsd":-72.50,"exchangeRate":1,
    "isMileage":True,"miles":100,"billedToCard":False})
assert_status("1e: negative amountUsd on mileage item rejected (400)", s, 400)

# Test that non-numeric string for miles is rejected
import urllib.request as _ur, urllib.error as _ue
try:
    req = _ur.Request(
        f"{BASE}/api/reports/{rid1}/items",
        data=b'{"category":"Mileage Reimbursement","description":"String miles","currency":"USD","amount":10,"amountUsd":10,"exchangeRate":1,"isMileage":true,"miles":"notanumber","billedToCard":false}',
        headers={"Content-Type": "application/json"}, method="POST")
    with _ur.urlopen(req) as resp:
        s1f = resp.status
except _ue.HTTPError as e:
    s1f = e.code
assert_status("1f: string miles rejected (400)", s1f, 400)

items1 = get_items(rid1)
assert_eq("1g: exactly 2 items stored (rejected not persisted)", len(items1), 2)

miles1 = total_miles(items1)
assert_eq("1h: total miles = 150.500", miles1, 150.5)

musd1 = total_mileage_usd(items1)
# 100*0.725=72.5, 50.5*0.725=36.6125 → sum=109.1125
assert_eq("1i: mileage USD total = 150.5 × 0.725 = 109.113", musd1, 150.5 * MILEAGE_RATE, precision=4)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 2 — MILEAGE BOUNDARY VALUES")

rid2 = post_report("Mileage Boundary Values", "travel")
print(f"  Report ID: {rid2}")

BIG = 99999
BIG_USD = round(BIG * MILEAGE_RATE, 10)
s, _ = post_item(rid2, {"category":"Mileage Reimbursement","description":"Long haul",
    "currency":"USD","amount":BIG_USD,"amountUsd":BIG_USD,"exchangeRate":1,
    "isMileage":True,"miles":BIG,"billedToCard":False})
assert_status("2a: very large miles (99999) accepted (201)", s, 201)

s, _ = post_item(rid2, {"category":"Mileage Reimbursement","description":"Short hop",
    "currency":"USD","amount":0.0725,"amountUsd":0.0725,"exchangeRate":1,
    "isMileage":True,"miles":0.1,"billedToCard":False})
assert_status("2b: minimum valid miles (0.1) accepted (201)", s, 201)

s, _ = post_item(rid2, {"category":"Mileage Reimbursement","description":"Zero hop",
    "currency":"USD","amount":0,"amountUsd":0,"exchangeRate":1,
    "isMileage":True,"miles":0.0,"billedToCard":False})
assert_status("2c: miles=0.0 exactly rejected (400)", s, 400)

items2 = get_items(rid2)
assert_eq("2d: exactly 2 items stored", len(items2), 2)

assert_eq("2e: miles total = 99999.100", total_miles(items2), 99999.1)
# Float precision: compare to 2 decimal places for very large values
assert_eq("2f: mileage USD total = 99999.1 × 0.725", total_mileage_usd(items2), 99999.1 * MILEAGE_RATE, precision=1)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 3 — CORP CARD SUBTOTAL: MIXED ENTRIES")

rid3 = post_report("Corp Card Boundary Test", "travel")
print(f"  Report ID: {rid3}")

s, _ = post_item(rid3, {"category":"Meals","description":"Lunch",
    "currency":"USD","amount":45.00,"amountUsd":45.00,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("3a: reimbursable meal $45 accepted (201)", s, 201)

s, _ = post_item(rid3, {"category":"Airfare","description":"Flight",
    "currency":"USD","amount":350.00,"amountUsd":350.00,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("3b: corp card airfare $350 accepted (201)", s, 201)

s, _ = post_item(rid3, {"category":"Supplies","description":"Paper",
    "currency":"USD","amount":22.50,"amountUsd":22.50,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("3c: reimbursable supplies $22.50 accepted (201)", s, 201)

s, _ = post_item(rid3, {"category":"Rental Car","description":"Hotel",
    "currency":"USD","amount":199.99,"amountUsd":199.99,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("3d: corp card hotel $199.99 accepted (201)", s, 201)

# Rejected — must NOT corrupt either bucket
s, _ = post_item(rid3, {"category":"Airfare","description":"Neg corp",
    "currency":"USD","amount":-100.00,"amountUsd":-100.00,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("3e: negative corp card item rejected (400)", s, 400)

s, _ = post_item(rid3, {"category":"Meals","description":"Neg reimb",
    "currency":"USD","amount":-20.00,"amountUsd":-20.00,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("3f: negative reimbursable item rejected (400)", s, 400)

items3 = get_items(rid3)
assert_eq("3g: exactly 4 items stored (2 rejected not persisted)", len(items3), 4)
assert_eq("3h: reimbursable total = $45 + $22.50 = $67.50", total_reimb(items3), 67.50)
assert_eq("3i: corp card total = $350 + $199.99 = $549.99", total_card(items3), 549.99)
assert_eq("3j: grand total = $67.50 + $549.99 = $617.49", total_all(items3), 617.49)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 4 — CORP CARD EDGE CASES")

# All-corp-card report
rid4a = post_report("All Corp Card", "travel")
print(f"  All-corp-card Report ID: {rid4a}")

s, _ = post_item(rid4a, {"category":"Airfare","description":"Card 1",
    "currency":"USD","amount":500,"amountUsd":500,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("4a: all-corp-card item 1 accepted (201)", s, 201)

s, _ = post_item(rid4a, {"category":"Rental Car","description":"Card 2",
    "currency":"USD","amount":200,"amountUsd":200,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("4b: all-corp-card item 2 accepted (201)", s, 201)

items4a = get_items(rid4a)
assert_eq("4c: all-corp-card → reimbursable total = $0.00", total_reimb(items4a), 0.0)
assert_eq("4d: all-corp-card → card total = $700.00", total_card(items4a), 700.0)

# All-reimbursable report
rid4b = post_report("All Reimbursable", "monthly")
print(f"  All-reimbursable Report ID: {rid4b}")

s, _ = post_item(rid4b, {"category":"Meals","description":"Reimb 1",
    "currency":"USD","amount":30,"amountUsd":30,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("4e: all-reimbursable item accepted (201)", s, 201)

items4b = get_items(rid4b)
assert_eq("4f: all-reimbursable → card total = $0.00", total_card(items4b), 0.0)
assert_eq("4g: all-reimbursable → reimb total = $30.00", total_reimb(items4b), 30.0)

# PATCH to flip billedToCard — bucket switch must be accurate
item_id_4b = items4b[0]["id"]
s, _ = patch_item(item_id_4b, {"billedToCard": True})
assert_status("4h: PATCH flip reimbursable→corp card accepted (200)", s, 200)

items4b2 = get_items(rid4b)
assert_eq("4i: after PATCH flip → reimb total = $0.00", total_reimb(items4b2), 0.0)
assert_eq("4j: after PATCH flip → card total = $30.00", total_card(items4b2), 30.0)

# PATCH back to reimbursable — bucket must switch back
s, _ = patch_item(item_id_4b, {"billedToCard": False})
assert_status("4k: PATCH flip back to reimbursable (200)", s, 200)

items4b3 = get_items(rid4b)
assert_eq("4l: after flip-back → reimb total = $30.00", total_reimb(items4b3), 30.0)
assert_eq("4m: after flip-back → card total = $0.00", total_card(items4b3), 0.0)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 5 — FOREIGN CURRENCY + CORP CARD")

rid5 = post_report("FX Corp Card Test", "travel")
print(f"  Report ID: {rid5}")

# EUR reimbursable: 100 EUR × 1.09 = $109 USD
s, _ = post_item(rid5, {"category":"Meals","description":"Paris dinner",
    "currency":"EUR","amount":100,"amountUsd":109.00,"exchangeRate":1.09,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("5a: EUR reimbursable 100@1.09=$109 accepted (201)", s, 201)

# GBP corp card: 200 GBP × 1.27 = $254 USD
s, _ = post_item(rid5, {"category":"Airfare","description":"London flight",
    "currency":"GBP","amount":200,"amountUsd":254.00,"exchangeRate":1.27,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("5b: GBP corp card 200@1.27=$254 accepted (201)", s, 201)

# JPY corp card: 10000 JPY × 0.0067 = $67 USD
s, _ = post_item(rid5, {"category":"Supplies","description":"Tokyo supplies",
    "currency":"JPY","amount":10000,"amountUsd":67.00,"exchangeRate":0.0067,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("5c: JPY corp card 10000@0.0067=$67 accepted (201)", s, 201)

# Rejected: exchange rate = 0
s, _ = post_item(rid5, {"category":"Meals","description":"Bad rate",
    "currency":"EUR","amount":50,"amountUsd":0,"exchangeRate":0,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("5d: zero exchange rate rejected (400)", s, 400)

# Rejected: negative exchange rate
s, _ = post_item(rid5, {"category":"Meals","description":"Neg rate",
    "currency":"EUR","amount":50,"amountUsd":-54.50,"exchangeRate":-1.09,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("5e: negative exchange rate rejected (400)", s, 400)

items5 = get_items(rid5)
assert_eq("5f: exactly 3 items stored (2 FX-rate rejections not persisted)", len(items5), 3)

# Only USD amountUsd values flow into totals — original currency amounts are display-only
assert_eq("5g: FX reimb total = $109.00 (EUR→USD only)", total_reimb(items5), 109.0)
assert_eq("5h: FX card total = $254 + $67 = $321.00", total_card(items5), 321.0)
assert_eq("5i: FX grand total = $109 + $321 = $430.00", total_all(items5), 430.0)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 6 — MIXED SCENARIO: ALL TYPES COEXISTING")

rid6 = post_report("Full Mixed Scenario", "travel")
print(f"  Report ID: {rid6}")

# Valid items
# Mileage reimbursable: 75 miles × 0.725 = $54.375
s, _ = post_item(rid6, {"category":"Mileage Reimbursement","description":"Drive to airport",
    "currency":"USD","amount":54.375,"amountUsd":54.375,"exchangeRate":1,
    "isMileage":True,"miles":75,"billedToCard":False})
assert_status("6a: mileage 75mi reimbursable accepted (201)", s, 201)

# USD meal corp card: $80
s, _ = post_item(rid6, {"category":"Meals","description":"Client dinner",
    "currency":"USD","amount":80,"amountUsd":80,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("6b: USD meal corp card $80 accepted (201)", s, 201)

# EUR supplies reimbursable: 50 EUR × 1.09 = $54.50
s, _ = post_item(rid6, {"category":"Supplies","description":"EU supplies",
    "currency":"EUR","amount":50,"amountUsd":54.50,"exchangeRate":1.09,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("6c: EUR reimbursable $54.50 USD accepted (201)", s, 201)

# CAD hotel corp card: 300 CAD × 0.73 = $219
s, _ = post_item(rid6, {"category":"Rental Car","description":"Hotel CAD",
    "currency":"CAD","amount":300,"amountUsd":219,"exchangeRate":0.73,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("6d: CAD corp card $219 USD accepted (201)", s, 201)

# Rejected inputs — must not contaminate any total
s, _ = post_item(rid6, {"category":"Mileage Reimbursement","description":"Neg miles",
    "currency":"USD","amount":72.50,"amountUsd":72.50,"exchangeRate":1,
    "isMileage":True,"miles":-100,"billedToCard":False})
assert_status("6e: negative miles rejected (400)", s, 400)

s, _ = post_item(rid6, {"category":"Meals","description":"Neg corp card",
    "currency":"USD","amount":-50,"amountUsd":-50,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":True})
assert_status("6f: negative corp card amount rejected (400)", s, 400)

s, _ = post_item(rid6, {"category":"Airfare","description":"Zero FX rate",
    "currency":"EUR","amount":200,"amountUsd":0,"exchangeRate":0,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("6g: zero FX exchange rate rejected (400)", s, 400)

s, _ = post_item(rid6, {"category":"Mileage Reimbursement","description":"Zero miles",
    "currency":"USD","amount":0,"amountUsd":0,"exchangeRate":1,
    "isMileage":True,"miles":0,"billedToCard":False})
assert_status("6h: mileage with zero miles rejected (400)", s, 400)

items6 = get_items(rid6)
assert_eq("6i: exactly 4 items stored (4 rejected not persisted)", len(items6), 4)

# Expected reimbursable: mileage $54.375 + EUR $54.50 = $108.875
assert_eq("6j: reimb total = $54.375 + $54.50 = $108.875", total_reimb(items6), 108.875)

# Expected corp card: USD $80 + CAD $219 = $299
assert_eq("6k: corp card total = $80 + $219 = $299.00", total_card(items6), 299.0)

# Grand total: $108.875 + $299 = $407.875
assert_eq("6l: grand total = $108.875 + $299 = $407.875", total_all(items6), 407.875)

# Miles total — only the one valid 75-mile entry
assert_eq("6m: total miles = 75.0 (rejected -100 never persisted)", total_miles(items6), 75.0)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 7 — PATCH VALIDATION: UPDATES DON'T CORRUPT TOTALS")

# Get the mileage item from rid6
mileage_item = next(i for i in items6 if i.get("isMileage"))
iid = mileage_item["id"]
print(f"  Mileage item ID: {iid}")

# Reject bad PATCH values
s, _ = patch_item(iid, {"miles": -50})
assert_status("7a: PATCH negative miles rejected (400)", s, 400)

s, _ = patch_item(iid, {"amountUsd": -100})
assert_status("7b: PATCH negative amountUsd rejected (400)", s, 400)

s, _ = patch_item(iid, {"exchangeRate": 0})
assert_status("7c: PATCH zero exchangeRate rejected (400)", s, 400)

# Verify item is unchanged after rejected PATCHes
items6_after_bad_patches = get_items(rid6)
assert_eq("7d: total after rejected PATCHes unchanged = $407.875",
          total_all(items6_after_bad_patches), 407.875)
assert_eq("7e: reimb after rejected PATCHes unchanged = $108.875",
          total_reimb(items6_after_bad_patches), 108.875)
assert_eq("7f: card after rejected PATCHes unchanged = $299.00",
          total_card(items6_after_bad_patches), 299.0)

# Valid PATCH: update mileage from 75→100 miles ($54.375→$72.50)
s, _ = patch_item(iid, {"miles": 100, "amount": 72.50, "amountUsd": 72.50})
assert_status("7g: valid PATCH miles 75→100 accepted (200)", s, 200)

items6b = get_items(rid6)
assert_eq("7h: after PATCH, miles total = 100.0", total_miles(items6b), 100.0)

# Reimb: $72.50 + $54.50 = $127.00
assert_eq("7i: reimb total after PATCH = $72.50 + $54.50 = $127.00",
          total_reimb(items6b), 127.0)

# Corp card must be UNCHANGED (different item)
assert_eq("7j: corp card total unchanged after reimb PATCH = $299.00",
          total_card(items6b), 299.0)

# Grand total: $127.00 + $299 = $426.00
assert_eq("7k: grand total after PATCH = $127.00 + $299 = $426.00",
          total_all(items6b), 426.0)

# ─────────────────────────────────────────────────────────────────
section("BLOCK 8 — MILEAGE TOTAL ISOLATION (non-mileage items don't add to miles)")

rid8 = post_report("Miles Isolation Test", "monthly")
print(f"  Report ID: {rid8}")

# Add a regular USD item (not mileage) with miles=0
s, _ = post_item(rid8, {"category":"Meals","description":"Regular meal",
    "currency":"USD","amount":35,"amountUsd":35,"exchangeRate":1,
    "isMileage":False,"miles":0,"billedToCard":False})
assert_status("8a: non-mileage item accepted (201)", s, 201)

# Add a mileage item: 40 miles
s, _ = post_item(rid8, {"category":"Mileage Reimbursement","description":"40 miles",
    "currency":"USD","amount":29,"amountUsd":29,"exchangeRate":1,
    "isMileage":True,"miles":40,"billedToCard":False})
assert_status("8b: 40-mile mileage item accepted (201)", s, 201)

items8 = get_items(rid8)
assert_eq("8c: miles total counts only mileage items = 40.0", total_miles(items8), 40.0)

# Reimb total counts both: meal $35 + mileage $29 = $64
assert_eq("8d: reimb total = meal $35 + mileage $29 = $64.00", total_reimb(items8), 64.0)

# ─────────────────────────────────────────────────────────────────
print(f"\n{'═'*62}")
print(f"\n  RESULTS: {PASS} passed, {FAIL} failed")
if FAIL == 0:
    print("  ✅  ALL BOUNDARY TESTS PASSED")
else:
    print(f"  ❌  {FAIL} TEST(S) FAILED:")
    for f in FAILURES:
        print(f"      • {f}")
print(f"\n{'═'*62}")
sys.exit(0 if FAIL == 0 else 1)
