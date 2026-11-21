# Supplier Dashboard

A small dashboard that **ranks raw-material suppliers** and **tracks price trends**. It runs on sample data.

- **Ranking**: each supplier gets a score from 0 to 100, built from four factors: price compared with the market, on-time delivery, quality (defect rate), and lead time. Sliders let you change how much each factor counts.
- **Price trends**: the market index for all materials, or each supplier's monthly price for one material.
- **Supplier detail**: click a row to see that supplier's price vs. market and on-time delivery over time.

It's a plain static website (HTML, CSS, and JavaScript), so there's nothing to install or build.

## View it locally

Browsers block loading data files from a page opened straight from disk, so start a tiny web server in this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Use your own data

Replace the two files in `data/` and keep the same column names:

| File | Columns |
|---|---|
| `suppliers.csv` | `supplier_id, name, region, materials` (materials separated by `\|`) |
| `orders.csv` | `order_id, order_date, supplier_id, material, unit, unit_price, quantity, promised_date, delivered_date, units_defective` |

Dates use the format `YYYY-MM-DD`. To recreate the sample data, run `python3 scripts/generate_data.py`.

## How the score works

1. For each supplier, using the selected period and material:
   - **Price**: average % above or below the market average for the same material and month
   - **On-time**: share of orders delivered on or before the promised date
   - **Quality**: defective units ÷ units received
   - **Lead time**: average days from order to delivery
2. Each factor is rescaled from 0 (worst supplier) to 1 (best supplier).
3. Score = weighted average × 100. The default weights are Price 35%, On-time 25%, Quality 25%, and Lead time 15%.

The table also shows each supplier's **total spend** (unit price × quantity, added up over the selected period and material). It's there for context and doesn't count toward the score.

## Files

- `index.html`: page layout
- `style.css`: styling, with light and dark themes
- `app.js`: loads the data, scores suppliers, draws the charts ([Chart.js](https://www.chartjs.org/))
- `data/`: the CSV data
- `scripts/generate_data.py`: the sample-data generator
