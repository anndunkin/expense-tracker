#!/usr/bin/env python3
import os
"""
ExpenseTrack Functionality Tests — covers all features including recent additions.

Tests grouped by feature area:
  1.  Reports CRUD
  2.  Expense Items CRUD
  3.  filePath field (new — shows on HomePage cards)
  4.  Report Import with filePath
  5.  Save As simulation (POST new report + PATCH filePath)
  6.  App Settings — defaults, PATCH, persistence
  7.  Default Save Location setting (new)
  8.  Report Header settings (monthly + travel)
  9.  Category management
  10. Exchange rate cache
  11. Status → Complete auto-sets dateSubmitted
  12. Foreign currency storage
  13. Mileage items
  14. Corporate card flag
  15. Prepaid date field
  16. Export/import round-trip
  17. Method-not-allowed guard
  18. Delete cascades items
"""

import requests
import json
import sys
import time

# Port is allocated dynamically by the Electron shell; override with
# EXPENSE_TRACK_BASE when testing against a running app instance.
BASE = os.environ.get("EXPENSE_TRACK_BASE", "http://127.0.0.1:5000")
PASS = 0
FAIL = 0
FAILURES = []
_created_ids = []   # report ids to clean up


def ok(label, detail=""):
    global PASS
    PASS += 1
    print(f"  ✅  PASS  {label}" + (f"  ({detail})" if detail else ""))


def fail(label, detail=""):
    global FAIL
    FAIL += 1
    FAILURES.append(label)
    print(f"  ❌  FAIL  {label}" + (f"  — {detail}" if detail else ""))


def section(title):
    print(f"\n{'═'*66}")
    print(f"  {title}")
    print(f"{'═'*66}")


def post(path, payload=None):
    return requests.post(f"{BASE}{path}", json=payload, timeout=10)


def get(path):
    return requests.get(f"{BASE}{path}", timeout=10)


def patch(path, payload):
    return requests.patch(f"{BASE}{path}", json=payload, timeout=10)


def delete(path):
    return requests.delete(f"{BASE}{path}", timeout=10)


def new_report(rtype="monthly", name="Test Report", extra=None):
    payload = {"name": name, "type": rtype, "submitterName": "Tester",
               "tripPurpose": "Testing", "dateSubmitted": "", "status": "draft"}
    if extra:
        payload.update(extra)
    r = post("/api/reports", payload)
    rid = r.json().get("id")
    if rid:
        _created_ids.append(rid)
    return r


def new_item(report_id, extra=None):
    payload = {
        "reportId": report_id,
        "date": "2026-01-15",
        "purpose": "Test item",
        "category": "Meals",
        "amount": 25.00,
        "currency": "USD",
        "amountUsd": 25.00,
        "exchangeRate": 1.0,
        "isMileage": False,
        "miles": 0,
        "billedToCard": False,
        "notes": "",
        "sortOrder": 0,
    }
    if extra:
        payload.update(extra)
    return post(f"/api/reports/{report_id}/items", payload)


def cleanup():
    for rid in _created_ids:
        try:
            delete(f"/api/reports/{rid}")
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# 1. Reports CRUD
# ─────────────────────────────────────────────────────────────────────────────
section("1. Reports CRUD")

r = new_report("monthly", "CRUD Test Report")
if r.status_code == 200:
    ok("POST /api/reports → 200")
    rid = r.json()["id"]
else:
    fail("POST /api/reports → 200", f"got {r.status_code}: {r.text[:100]}")
    rid = None

if rid:
    r = get(f"/api/reports/{rid}")
    if r.status_code == 200 and r.json()["report"]["name"] == "CRUD Test Report":
        ok("GET /api/reports/:id returns correct record")
    else:
        fail("GET /api/reports/:id returns correct record", r.text[:80])

    r = patch(f"/api/reports/{rid}", {"name": "CRUD Test Report Updated"})
    if r.status_code == 200 and r.json()["name"] == "CRUD Test Report Updated":
        ok("PATCH /api/reports/:id updates name")
    else:
        fail("PATCH /api/reports/:id updates name", r.text[:80])

    r = get("/api/reports")
    ids = [rep["id"] for rep in r.json()]
    if rid in ids:
        ok("GET /api/reports lists the new report")
    else:
        fail("GET /api/reports lists the new report")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Expense Items CRUD
# ─────────────────────────────────────────────────────────────────────────────
section("2. Expense Items CRUD")

r = new_report("monthly", "Items CRUD Report")
rid2 = r.json().get("id") if r.status_code == 200 else None

if rid2:
    r = new_item(rid2)
    if r.status_code == 201:
        ok("POST /api/reports/:id/items → 201")
        iid = r.json()["id"]
    else:
        fail("POST /api/reports/:id/items → 201", r.text[:80])
        iid = None

    if iid:
        r = get(f"/api/reports/{rid2}/items")
        items = r.json()
        if r.status_code == 200 and any(i["id"] == iid for i in items):
            ok("GET /api/reports/:id/items lists item")
        else:
            fail("GET /api/reports/:id/items lists item")

        r = patch(f"/api/items/{iid}", {"purpose": "Updated purpose"})
        if r.status_code == 200 and r.json()["purpose"] == "Updated purpose":
            ok("PATCH /api/items/:id updates item")
        else:
            fail("PATCH /api/items/:id updates item", r.text[:80])

        r = delete(f"/api/items/{iid}")
        if r.status_code == 200:
            ok("DELETE /api/items/:id → 200")
        else:
            fail("DELETE /api/items/:id → 200", str(r.status_code))

# ─────────────────────────────────────────────────────────────────────────────
# 3. filePath field — new schema column
# ─────────────────────────────────────────────────────────────────────────────
section("3. filePath field on reports")

r = new_report("monthly", "FilePath Test")
if r.status_code == 200:
    rid3 = r.json()["id"]
    data = r.json()

    # Field must be present (not missing from response)
    if "filePath" in data:
        ok("POST report response includes filePath key")
    else:
        fail("POST report response includes filePath key", f"keys: {list(data.keys())}")

    # Default should be empty string
    if data.get("filePath") == "" or data.get("filePath") is None:
        ok("filePath defaults to empty string")
    else:
        fail("filePath defaults to empty string", f"got: {data.get('filePath')!r}")

    # PATCH filePath to a real path
    test_path = r"C:\Users\anndu\Documents\Reports\Q1-2026.expense"
    r2 = patch(f"/api/reports/{rid3}", {"filePath": test_path})
    if r2.status_code == 200 and r2.json().get("filePath") == test_path:
        ok("PATCH filePath stores Windows-style path")
    else:
        fail("PATCH filePath stores Windows-style path", r2.text[:100])

    # Retrieve and verify persistence
    r3 = get(f"/api/reports/{rid3}")
    if r3.status_code == 200 and r3.json()["report"].get("filePath") == test_path:
        ok("GET /api/reports/:id returns persisted filePath")
    else:
        fail("GET /api/reports/:id returns persisted filePath",
             f"got: {r3.json()['report'].get('filePath')!r}")

    # Confirm it appears in list endpoint too
    r4 = get("/api/reports")
    match = next((rep for rep in r4.json() if rep["id"] == rid3), None)
    if match and match.get("filePath") == test_path:
        ok("GET /api/reports list includes filePath for each report")
    else:
        fail("GET /api/reports list includes filePath for each report",
             f"got: {match.get('filePath') if match else 'not found'!r}")

    # PATCH filePath to empty (clear it)
    r5 = patch(f"/api/reports/{rid3}", {"filePath": ""})
    if r5.status_code == 200 and r5.json().get("filePath") == "":
        ok("PATCH filePath can be cleared to empty string")
    else:
        fail("PATCH filePath can be cleared to empty string", r5.text[:80])
else:
    fail("FilePath test setup — could not create report", r.text[:80])

# ─────────────────────────────────────────────────────────────────────────────
# 4. Report import with filePath
# ─────────────────────────────────────────────────────────────────────────────
section("4. Report import with filePath")

import_path = r"C:\Users\anndu\OneDrive\Documents\DGA\Expense Reports\2026\London June 2026.expense"
import_payload = {
    "report": {
        "name": "London June 2026",
        "type": "travel",
        "submitterName": "Ann Dunkin",
        "tripPurpose": "Commercialising Quantum",
        "dateSubmitted": "",
        "status": "draft",
    },
    "items": [
        {
            "date": "2026-06-01", "purpose": "Flights", "category": "Airfare",
            "amount": 1200.0, "currency": "USD", "amountUsd": 1200.0,
            "exchangeRate": 1.0, "isMileage": False, "miles": 0,
            "billedToCard": False, "notes": "", "sortOrder": 0,
        }
    ],
    "filePath": import_path,
}
r = post("/api/reports/import", import_payload)
if r.status_code == 200:
    ok("POST /api/reports/import → 200")
    imp = r.json()
    _created_ids.append(imp["report"]["id"])

    if imp["report"].get("filePath") == import_path:
        ok("Import stores filePath from request body")
    else:
        fail("Import stores filePath from request body",
             f"got: {imp['report'].get('filePath')!r}")

    if len(imp.get("items", [])) == 1:
        ok("Import creates expense items")
    else:
        fail("Import creates expense items", f"got {len(imp.get('items',[]))} items")
else:
    fail("POST /api/reports/import → 200", f"{r.status_code}: {r.text[:100]}")

# Import without filePath — should default to ""
r2 = post("/api/reports/import", {
    "report": {"name": "No-path import", "type": "monthly",
               "submitterName": "", "tripPurpose": "", "dateSubmitted": "", "status": "draft"},
    "items": []
})
if r2.status_code == 200:
    _created_ids.append(r2.json()["report"]["id"])
    if r2.json()["report"].get("filePath", "MISSING") in ("", None):
        ok("Import without filePath defaults to empty")
    else:
        fail("Import without filePath defaults to empty",
             f"got: {r2.json()['report'].get('filePath')!r}")

# filePath carried from report.filePath field in legacy payload
r3 = post("/api/reports/import", {
    "report": {"name": "Legacy path import", "type": "monthly",
               "submitterName": "", "tripPurpose": "", "dateSubmitted": "", "status": "draft",
               "filePath": r"C:\legacy\path.expense"},
    "items": []
})
if r3.status_code == 200:
    _created_ids.append(r3.json()["report"]["id"])
    if r3.json()["report"].get("filePath") == r"C:\legacy\path.expense":
        ok("Import falls back to report.filePath when top-level filePath missing")
    else:
        fail("Import falls back to report.filePath",
             f"got: {r3.json()['report'].get('filePath')!r}")

# ─────────────────────────────────────────────────────────────────────────────
# 5. Save As simulation (POST new + PATCH filePath)
# ─────────────────────────────────────────────────────────────────────────────
section("5. Save As flow simulation")

# Create base report with items
r = new_report("travel", "Original Report")
if r.status_code == 200:
    orig_id = r.json()["id"]
    new_item(orig_id, {"amount": 500, "amountUsd": 500, "category": "Airfare"})
    new_item(orig_id, {"amount": 200, "amountUsd": 200, "category": "Meals"})

    # Simulate Save As: POST brand-new report (no id)
    r2 = post("/api/reports", {
        "name": "Original Report Copy",
        "type": "travel",
        "submitterName": "Tester",
        "tripPurpose": "Testing",
        "dateSubmitted": "",
        "status": "draft",
    })
    if r2.status_code == 200:
        new_id = r2.json()["id"]
        _created_ids.append(new_id)
        ok("Save As: POST new report → 200")

        # Copy items
        items_r = get(f"/api/reports/{orig_id}/items")
        for item in items_r.json():
            post(f"/api/reports/{new_id}/items", {
                k: v for k, v in item.items()
                if k not in ("id", "reportId")
            } | {"reportId": new_id})

        # PATCH filePath after disk write
        save_path = r"C:\Users\anndu\Documents\Original Report Copy.expense"
        r3 = patch(f"/api/reports/{new_id}", {"filePath": save_path})
        if r3.status_code == 200 and r3.json().get("filePath") == save_path:
            ok("Save As: PATCH filePath on new report succeeds")
        else:
            fail("Save As: PATCH filePath on new report succeeds", r3.text[:80])

        # Verify items were copied
        items_new = get(f"/api/reports/{new_id}/items").json()
        if len(items_new) == 2:
            ok("Save As: items copied to new report")
        else:
            fail("Save As: items copied to new report",
                 f"expected 2, got {len(items_new)}")

        # Original report unchanged
        orig = get(f"/api/reports/{orig_id}").json()
        if orig["report"]["name"] == "Original Report":
            ok("Save As: original report name unchanged")
        else:
            fail("Save As: original report name unchanged")
    else:
        fail("Save As: POST new report → 200", r2.text[:80])

# ─────────────────────────────────────────────────────────────────────────────
# 6. App Settings — defaults, PATCH, persistence
# ─────────────────────────────────────────────────────────────────────────────
section("6. App Settings")

r = get("/api/settings")
if r.status_code == 200:
    ok("GET /api/settings → 200")
    settings = r.json()
    if isinstance(settings, dict):
        ok("GET /api/settings returns a JSON object")
    else:
        fail("GET /api/settings returns a JSON object", type(settings).__name__)

    # All three known keys must be present
    for key in ("monthlyReportHeader", "travelReportHeader", "defaultSaveLocation"):
        if key in settings:
            ok(f"GET /api/settings includes '{key}'")
        else:
            fail(f"GET /api/settings includes '{key}'", f"keys: {list(settings.keys())}")
else:
    fail("GET /api/settings → 200", str(r.status_code))
    settings = {}

# ─────────────────────────────────────────────────────────────────────────────
# 7. Default Save Location setting
# ─────────────────────────────────────────────────────────────────────────────
section("7. Default Save Location setting")

test_dir = r"C:\Users\anndu\OneDrive\Documents\DGA\Expense Reports\2026 expenses"

# Save a default location
r = patch("/api/settings", {"defaultSaveLocation": test_dir})
if r.status_code == 200:
    ok("PATCH defaultSaveLocation → 200")
    if r.json().get("defaultSaveLocation") == test_dir:
        ok("PATCH defaultSaveLocation returns updated value")
    else:
        fail("PATCH defaultSaveLocation returns updated value",
             f"got: {r.json().get('defaultSaveLocation')!r}")
else:
    fail("PATCH defaultSaveLocation → 200", r.text[:80])

# Verify persistence across a fresh GET
r2 = get("/api/settings")
if r2.json().get("defaultSaveLocation") == test_dir:
    ok("defaultSaveLocation persists across GET")
else:
    fail("defaultSaveLocation persists across GET",
         f"got: {r2.json().get('defaultSaveLocation')!r}")

# Clear it back to empty
r3 = patch("/api/settings", {"defaultSaveLocation": ""})
if r3.status_code == 200 and r3.json().get("defaultSaveLocation") == "":
    ok("defaultSaveLocation can be cleared to empty")
else:
    fail("defaultSaveLocation can be cleared to empty", r3.text[:60])

# ─────────────────────────────────────────────────────────────────────────────
# 8. Report Header settings
# ─────────────────────────────────────────────────────────────────────────────
section("8. Report Header settings")

# Set custom headers
r = patch("/api/settings", {
    "monthlyReportHeader": "Dunkin Global Advisors — Monthly Expenses",
    "travelReportHeader":  "Dunkin Global Advisors — Travel Expenses",
})
if r.status_code == 200:
    ok("PATCH monthly + travel headers → 200")
    data = r.json()
    if data.get("monthlyReportHeader") == "Dunkin Global Advisors — Monthly Expenses":
        ok("monthlyReportHeader stored correctly")
    else:
        fail("monthlyReportHeader stored correctly", repr(data.get("monthlyReportHeader")))
    if data.get("travelReportHeader") == "Dunkin Global Advisors — Travel Expenses":
        ok("travelReportHeader stored correctly")
    else:
        fail("travelReportHeader stored correctly", repr(data.get("travelReportHeader")))
else:
    fail("PATCH monthly + travel headers → 200", r.text[:80])

# Reset to defaults (empty → server returns defaults)
r2 = patch("/api/settings", {
    "monthlyReportHeader": "Monthly Expense Report",
    "travelReportHeader":  "Travel Expense Report",
})
if r2.status_code == 200:
    ok("Headers reset to defaults → 200")

# Verify GET returns them
r3 = get("/api/settings")
if r3.json().get("monthlyReportHeader") == "Monthly Expense Report":
    ok("GET /api/settings returns reset monthly header")
else:
    fail("GET /api/settings returns reset monthly header",
         repr(r3.json().get("monthlyReportHeader")))

# ─────────────────────────────────────────────────────────────────────────────
# 9. Category management
# ─────────────────────────────────────────────────────────────────────────────
section("9. Category management")

r = get("/api/categories/monthly")
if r.status_code == 200 and len(r.json()) > 0:
    ok("GET /api/categories/monthly returns categories")
    monthly_cats = r.json()
else:
    fail("GET /api/categories/monthly returns categories", r.text[:60])
    monthly_cats = []

r = get("/api/categories/travel")
if r.status_code == 200 and len(r.json()) > 0:
    ok("GET /api/categories/travel returns categories")
else:
    fail("GET /api/categories/travel returns categories")

# Create a custom category
r = post("/api/categories", {
    "reportType": "monthly", "name": "Test Category XYZ",
    "sortOrder": 99, "isDefault": False
})
if r.status_code == 200:
    ok("POST /api/categories → 200")
    cat_id = r.json()["id"]

    # Rename
    r2 = patch(f"/api/categories/{cat_id}", {"name": "Test Category XYZ Renamed"})
    if r2.status_code == 200 and r2.json()["name"] == "Test Category XYZ Renamed":
        ok("PATCH /api/categories/:id renames category")
    else:
        fail("PATCH /api/categories/:id renames category", r2.text[:60])

    # Appears in list
    cats = get("/api/categories/monthly").json()
    if any(c["id"] == cat_id for c in cats):
        ok("New category appears in GET /api/categories/monthly")
    else:
        fail("New category appears in GET /api/categories/monthly")

    # Delete
    r3 = delete(f"/api/categories/{cat_id}")
    if r3.status_code == 200:
        ok("DELETE /api/categories/:id → 200")
    else:
        fail("DELETE /api/categories/:id → 200", str(r3.status_code))
else:
    fail("POST /api/categories → 200", r.text[:80])

# ─────────────────────────────────────────────────────────────────────────────
# 10. Exchange rate cache
# ─────────────────────────────────────────────────────────────────────────────
section("10. Exchange rate cache")

r = get("/api/exchange-rate/EUR")
if r.status_code == 200:
    ok("GET /api/exchange-rate/EUR → 200")
    data = r.json()
    if "rateToUsd" in data and isinstance(data["rateToUsd"], (int, float)) and data["rateToUsd"] > 0:
        ok(f"EUR rate is a positive number ({data['rateToUsd']})")
    else:
        fail("EUR rate is a positive number", str(data))
elif r.status_code == 503:
    ok("GET /api/exchange-rate/EUR → 503 (offline/rate-limited, acceptable)")
else:
    fail("GET /api/exchange-rate/EUR → 200 or 503", str(r.status_code))

# USD rate is always 1
r2 = get("/api/exchange-rate/USD")
if r2.status_code == 200 and r2.json().get("rateToUsd") in (1, 1.0):
    ok("USD rate is always 1.0")
else:
    fail("USD rate is always 1.0", str(r2.json()))

# ─────────────────────────────────────────────────────────────────────────────
# 11. Status → Complete auto-fills dateSubmitted
# ─────────────────────────────────────────────────────────────────────────────
section("11. Status → Complete behaviour")

r = new_report("monthly", "Status Test Report")
if r.status_code == 200:
    rid_s = r.json()["id"]
    # Initial dateSubmitted should be blank
    data = r.json()
    if data.get("dateSubmitted") == "":
        ok("New report has blank dateSubmitted")
    else:
        fail("New report has blank dateSubmitted", repr(data.get("dateSubmitted")))

    # The auto-fill is done client-side before PATCH; test that the server
    # stores whatever we send (including a date string)
    today = "2026-04-25"
    r2 = patch(f"/api/reports/{rid_s}", {"status": "complete", "dateSubmitted": today})
    if r2.status_code == 200:
        if r2.json().get("status") == "complete":
            ok("PATCH status to 'complete' accepted")
        else:
            fail("PATCH status to 'complete' accepted", r2.text[:60])
        if r2.json().get("dateSubmitted") == today:
            ok("dateSubmitted stored when status set to complete")
        else:
            fail("dateSubmitted stored when status set to complete",
                 repr(r2.json().get("dateSubmitted")))
    else:
        fail("PATCH status complete → 200", r2.text[:60])

# ─────────────────────────────────────────────────────────────────────────────
# 12. Foreign currency items
# ─────────────────────────────────────────────────────────────────────────────
section("12. Foreign currency items")

r = new_report("travel", "FX Test Report")
if r.status_code == 200:
    rid_fx = r.json()["id"]
    # GBP item: £100 @ 1.27 = $127 USD
    r2 = new_item(rid_fx, {
        "amount": 100.0, "currency": "GBP",
        "amountUsd": 127.0, "exchangeRate": 1.27,
        "purpose": "London Taxi", "category": "Public Transportation",
    })
    if r2.status_code == 201:
        ok("Foreign currency item (GBP) created → 201")
        item = r2.json()
        if item["currency"] == "GBP" and item["amount"] == 100.0:
            ok("GBP item stores original currency and amount")
        else:
            fail("GBP item stores original currency and amount", str(item))
        if item["amountUsd"] == 127.0 and item["exchangeRate"] == 1.27:
            ok("GBP item stores USD equivalent and exchange rate")
        else:
            fail("GBP item stores USD equivalent and exchange rate", str(item))
    else:
        fail("Foreign currency item (GBP) created → 201", r2.text[:80])

# ─────────────────────────────────────────────────────────────────────────────
# 13. Mileage items
# ─────────────────────────────────────────────────────────────────────────────
section("13. Mileage items")

MILEAGE_RATE = 0.725

r = new_report("monthly", "Mileage Test")
if r.status_code == 200:
    rid_m = r.json()["id"]
    miles = 42.5
    expected_usd = round(miles * MILEAGE_RATE, 4)
    r2 = new_item(rid_m, {
        "isMileage": True, "miles": miles,
        "amount": expected_usd, "amountUsd": expected_usd,
        "category": "Mileage Reimbursement",
        "purpose": "Drive to airport",
    })
    if r2.status_code == 201:
        ok("Mileage item created → 201")
        item = r2.json()
        if item["isMileage"] and item["miles"] == miles:
            ok(f"Mileage item stores isMileage=True and miles={miles}")
        else:
            fail(f"Mileage item stores isMileage=True and miles", str(item))
    else:
        fail("Mileage item created → 201", r2.text[:80])

    # Zero miles for mileage item should be rejected
    r3 = new_item(rid_m, {"isMileage": True, "miles": 0,
                           "category": "Mileage Reimbursement"})
    if r3.status_code in (400, 422):
        ok("Zero miles for mileage item rejected (400/422)")
    else:
        fail("Zero miles for mileage item rejected (400/422)",
             f"got {r3.status_code}")

# ─────────────────────────────────────────────────────────────────────────────
# 14. Corporate card flag
# ─────────────────────────────────────────────────────────────────────────────
section("14. Corporate card flag")

r = new_report("travel", "Corp Card Test")
if r.status_code == 200:
    rid_cc = r.json()["id"]
    r2 = new_item(rid_cc, {
        "billedToCard": True,
        "amount": 350.0, "amountUsd": 350.0,
        "category": "Airfare", "purpose": "Flight to London",
    })
    if r2.status_code == 201 and r2.json()["billedToCard"] is True:
        ok("billedToCard=True item stored correctly")
    else:
        fail("billedToCard=True item stored correctly",
             f"{r2.status_code}: {r2.text[:60]}")

    r3 = new_item(rid_cc, {
        "billedToCard": False,
        "amount": 45.0, "amountUsd": 45.0,
        "category": "Meals", "purpose": "Dinner",
    })
    if r3.status_code == 201 and r3.json()["billedToCard"] is False:
        ok("billedToCard=False (reimbursable) item stored correctly")
    else:
        fail("billedToCard=False item stored correctly", r3.text[:60])

    # Verify both items exist
    items = get(f"/api/reports/{rid_cc}/items").json()
    corp = [i for i in items if i["billedToCard"]]
    reimb = [i for i in items if not i["billedToCard"]]
    if len(corp) == 1 and len(reimb) == 1:
        ok("Corp card and reimbursable items coexist correctly")
    else:
        fail("Corp card and reimbursable items coexist",
             f"corp={len(corp)}, reimb={len(reimb)}")

# ─────────────────────────────────────────────────────────────────────────────
# 15. Prepaid date field
# ─────────────────────────────────────────────────────────────────────────────
section("15. Prepaid date field")

r = new_report("travel", "Prepaid Test")
if r.status_code == 200:
    rid_pp = r.json()["id"]
    r2 = new_item(rid_pp, {
        "date": "prepaid",   # special sentinel for prepaid items
        "purpose": "Pre-booked hotel",
        "category": "Airfare",
        "amount": 800.0, "amountUsd": 800.0,
    })
    if r2.status_code == 201 and r2.json()["date"] == "prepaid":
        ok("Prepaid item stores date='prepaid'")
    else:
        fail("Prepaid item stores date='prepaid'",
             f"{r2.status_code}: {r2.text[:80]}")

# ─────────────────────────────────────────────────────────────────────────────
# 16. Export / Import round-trip
# ─────────────────────────────────────────────────────────────────────────────
section("16. Export / Import round-trip")

r = new_report("monthly", "Round-trip Test")
if r.status_code == 200:
    rid_rt = r.json()["id"]
    new_item(rid_rt, {"amount": 100, "amountUsd": 100, "category": "Equipment"})
    new_item(rid_rt, {"amount": 50,  "amountUsd": 50,  "category": "Meals"})

    # Fetch full report (simulate export)
    rep = get(f"/api/reports/{rid_rt}").json()
    items = get(f"/api/reports/{rid_rt}/items").json()

    # Import it back as a new report
    import_fp = r"C:\roundtrip\export.expense"
    r2 = post("/api/reports/import", {
        "report": rep["report"],
        "items": items,
        "filePath": import_fp,
    })
    if r2.status_code == 200:
        ok("Import round-trip → 200")
        imp = r2.json()
        _created_ids.append(imp["report"]["id"])

        if imp["report"]["name"] == "Round-trip Test":
            ok("Round-trip: report name preserved")
        else:
            fail("Round-trip: report name preserved",
                 repr(imp["report"]["name"]))

        if imp["report"].get("filePath") == import_fp:
            ok("Round-trip: filePath preserved through import")
        else:
            fail("Round-trip: filePath preserved through import",
                 repr(imp["report"].get("filePath")))

        if len(imp["items"]) == 2:
            ok("Round-trip: all 2 items preserved")
        else:
            fail("Round-trip: all 2 items preserved",
                 f"got {len(imp['items'])}")
    else:
        fail("Import round-trip → 200", r2.text[:80])

# ─────────────────────────────────────────────────────────────────────────────
# 17. Method-not-allowed guard
# ─────────────────────────────────────────────────────────────────────────────
section("17. Method-not-allowed guard")

for method, path in [
    ("PUT",    "/api/reports"),
    ("PUT",    "/api/settings"),
    ("DELETE", "/api/settings"),
    ("POST",   "/api/settings"),
    ("PUT",    "/api/categories/monthly"),
]:
    r = requests.request(method, f"{BASE}{path}", json={}, timeout=10)
    if r.status_code == 405:
        ok(f"{method} {path} → 405 Method Not Allowed")
    else:
        fail(f"{method} {path} → 405", f"got {r.status_code}")

# ─────────────────────────────────────────────────────────────────────────────
# 18. Delete cascades items
# ─────────────────────────────────────────────────────────────────────────────
section("18. Delete cascades items")

r = new_report("monthly", "Cascade Delete Test")
if r.status_code == 200:
    rid_del = r.json()["id"]
    _created_ids.remove(rid_del)  # we'll delete it ourselves

    new_item(rid_del, {"amount": 10, "amountUsd": 10})
    new_item(rid_del, {"amount": 20, "amountUsd": 20})
    new_item(rid_del, {"amount": 30, "amountUsd": 30})

    items_before = get(f"/api/reports/{rid_del}/items").json()
    if len(items_before) == 3:
        ok("Setup: 3 items created under report")
    else:
        fail("Setup: 3 items created under report", f"got {len(items_before)}")

    r2 = delete(f"/api/reports/{rid_del}")
    if r2.status_code == 200:
        ok("DELETE /api/reports/:id → 200")
    else:
        fail("DELETE /api/reports/:id → 200", str(r2.status_code))

    # Report should be gone
    r3 = get(f"/api/reports/{rid_del}")
    if r3.status_code == 404:
        ok("Deleted report returns 404")
    else:
        fail("Deleted report returns 404", f"got {r3.status_code}")

    # Items should also be gone
    r4 = get(f"/api/reports/{rid_del}/items")
    items_after = r4.json() if r4.status_code == 200 else []
    if len(items_after) == 0:
        ok("Items cascade-deleted with report")
    else:
        fail("Items cascade-deleted with report",
             f"{len(items_after)} items remain")

# ─────────────────────────────────────────────────────────────────────────────
# 19. Settings partial PATCH — unrelated keys unchanged
# ─────────────────────────────────────────────────────────────────────────────
section("19. Settings partial PATCH")

# Set all three
patch("/api/settings", {
    "monthlyReportHeader": "Monthly Header A",
    "travelReportHeader":  "Travel Header A",
    "defaultSaveLocation": r"C:\test\folder",
})

# Patch only one
patch("/api/settings", {"monthlyReportHeader": "Monthly Header B"})

s = get("/api/settings").json()
if s.get("monthlyReportHeader") == "Monthly Header B":
    ok("Partial PATCH updates target key")
else:
    fail("Partial PATCH updates target key", repr(s.get("monthlyReportHeader")))

if s.get("travelReportHeader") == "Travel Header A":
    ok("Partial PATCH leaves other keys unchanged")
else:
    fail("Partial PATCH leaves other keys unchanged",
         repr(s.get("travelReportHeader")))

if s.get("defaultSaveLocation") == r"C:\test\folder":
    ok("Partial PATCH leaves defaultSaveLocation unchanged")
else:
    fail("Partial PATCH leaves defaultSaveLocation unchanged",
         repr(s.get("defaultSaveLocation")))

# Reset
patch("/api/settings", {
    "monthlyReportHeader": "Monthly Expense Report",
    "travelReportHeader": "Travel Expense Report",
    "defaultSaveLocation": "",
})

# ─────────────────────────────────────────────────────────────────────────────
# 20. Not-found handling
# ─────────────────────────────────────────────────────────────────────────────
section("20. Not-found handling")

r = get("/api/reports/999999")
if r.status_code == 404:
    ok("GET non-existent report → 404")
else:
    fail("GET non-existent report → 404", str(r.status_code))

r = patch("/api/reports/999999", {"name": "Ghost"})
if r.status_code == 404:
    ok("PATCH non-existent report → 404")
else:
    fail("PATCH non-existent report → 404", str(r.status_code))

r = delete("/api/reports/999999")
if r.status_code in (200, 404):
    ok(f"DELETE non-existent report → {r.status_code} (acceptable)")
else:
    fail("DELETE non-existent report → 200 or 404", str(r.status_code))

r = patch("/api/items/999999", {"purpose": "Ghost"})
if r.status_code == 404:
    ok("PATCH non-existent item → 404")
else:
    fail("PATCH non-existent item → 404", str(r.status_code))

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup & Summary
# ─────────────────────────────────────────────────────────────────────────────
cleanup()

print(f"\n{'═'*66}")
print(f"  FUNCTIONALITY TESTS COMPLETE")
print(f"{'═'*66}")
print(f"  ✅  Passed : {PASS}")
print(f"  ❌  Failed : {FAIL}")
if FAILURES:
    print(f"\n  Failed tests:")
    for f in FAILURES:
        print(f"    • {f}")
print(f"{'═'*66}\n")

sys.exit(0 if FAIL == 0 else 1)
