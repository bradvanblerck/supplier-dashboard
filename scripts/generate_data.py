"""Generate sample supplier + order data for the dashboard.

Run from the project root:
    python3 scripts/generate_data.py

Uses a fixed random seed, so the output is identical every time.
Replace data/suppliers.csv and data/orders.csv with your own data
(same column names) to use the dashboard for real.
"""
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
OUT = Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(exist_ok=True)

# Base market price per unit and unit name for each material.
MATERIALS = {
    "Steel":         {"base": 820,  "unit": "tonne", "drift": 0.004,  "vol": 0.025},
    "Copper":        {"base": 8600, "unit": "tonne", "drift": 0.008,  "vol": 0.035},
    "Aluminum":      {"base": 2350, "unit": "tonne", "drift": 0.002,  "vol": 0.030},
    "Plastic resin": {"base": 1450, "unit": "tonne", "drift": -0.003, "vol": 0.020},
    "Lumber":        {"base": 540,  "unit": "MBF",   "drift": -0.002, "vol": 0.045},
}

# Each supplier: price premium vs market, on-time probability, defect rate,
# average lead time (days), and which materials they supply.
SUPPLIERS = [
    ("S01", "Northfield Metals",   "North America", -0.02, 0.95, 0.008, 12, ["Steel", "Aluminum", "Copper"]),
    ("S02", "Harbor Steelworks",   "Asia",          -0.07, 0.78, 0.030, 28, ["Steel", "Aluminum"]),
    ("S03", "Redline Copper Co.",  "South America",  0.01, 0.90, 0.012, 21, ["Copper"]),
    ("S04", "Vantage Polymers",    "Europe",         0.04, 0.97, 0.004, 15, ["Plastic resin"]),
    ("S05", "Pacific Resin Supply","Asia",          -0.05, 0.83, 0.022, 30, ["Plastic resin", "Aluminum"]),
    ("S06", "Timberline Forest",   "North America",  0.00, 0.92, 0.015, 9,  ["Lumber"]),
    ("S07", "Cascade Wood Group",  "North America", -0.03, 0.70, 0.035, 14, ["Lumber"]),
    ("S08", "Meridian Alloys",     "Europe",         0.06, 0.98, 0.003, 18, ["Copper", "Steel", "Aluminum"]),
]

START = date(2024, 12, 1)
MONTHS = 24

# Monthly market index for each material: drift + seasonality + noise.
market = {}
for name, m in MATERIALS.items():
    level = m["base"]
    series = []
    for i in range(MONTHS):
        season = 0.03 * math.sin(2 * math.pi * i / 12)
        level *= 1 + m["drift"] + random.gauss(0, m["vol"])
        series.append(level * (1 + season))
    market[name] = series


def month_start(i):
    y = START.year + (START.month - 1 + i) // 12
    mo = (START.month - 1 + i) % 12 + 1
    return date(y, mo, 1)


with open(OUT / "suppliers.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["supplier_id", "name", "region", "materials"])
    for sid, name, region, *_rest, mats in SUPPLIERS:
        w.writerow([sid, name, region, "|".join(mats)])

rows = []
order_no = 1000
for i in range(MONTHS):
    for sid, name, region, prem, on_time, defect, lead, mats in SUPPLIERS:
        for mat in mats:
            for _ in range(random.randint(1, 3)):  # 1-3 orders per month
                d = month_start(i) + timedelta(days=random.randint(0, 27))
                price = market[mat][i] * (1 + prem + random.gauss(0, 0.012))
                qty = random.randint(10, 120)
                lead_days = max(3, round(random.gauss(lead, lead * 0.15)))
                promised = d + timedelta(days=lead_days)
                late = 0 if random.random() < on_time else random.randint(1, 10)
                actual = promised + timedelta(days=late)
                bad = sum(1 for _ in range(qty) if random.random() < defect)
                order_no += 1
                rows.append([
                    f"PO-{order_no}", d.isoformat(), sid, mat,
                    MATERIALS[mat]["unit"], round(price, 2), qty,
                    promised.isoformat(), actual.isoformat(), bad,
                ])

rows.sort(key=lambda r: r[1])
with open(OUT / "orders.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["order_id", "order_date", "supplier_id", "material", "unit",
                "unit_price", "quantity", "promised_date", "delivered_date",
                "units_defective"])
    w.writerows(rows)

print(f"Wrote {len(SUPPLIERS)} suppliers and {len(rows)} orders to {OUT}")
