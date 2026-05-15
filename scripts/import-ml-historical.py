#!/usr/bin/env python3
"""
Import historical Mercado Libre sales from the ML seller-panel XLSX export.

Reads `Ventas CO` sheet, groups by `# de venta`, upserts:
  - raw_orders (one row per unique order, full payload as JSON)
  - sales (one row per unique order, idempotent on canal,external_order_id)
  - sale_items (N rows per order)

Date parsing: ML exports dates as "9 de mayo de 2026 07:30 hs." (Spanish).
Status mapping: heuristic on Spanish phrase → faka's status enum.

Usage:
  python3 scripts/import-ml-historical.py <path/to/xlsx>

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env (repo root).
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

# ── config ───────────────────────────────────────────────────────────────────

CANAL = "mercadolibre"
BATCH_SIZE = 200

# Spanish month names → number (lowercase, no accents normalized to bare ASCII).
ES_MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
    "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
}

# Heuristic mapping from ML's free-text status (col C "Estado" + D "Descripción del estado")
# to faka's strict enum: pagado / pendiente / cancelado / devuelto / parcial.
def map_status(estado: str, descripcion: str) -> str:
    e = (estado or "").lower()
    d = (descripcion or "").lower()
    blob = f"{e} || {d}"
    if "cancel" in blob:
        return "cancelado"
    if "devuelt" in blob or "devolución" in blob or "devoluc" in blob:
        return "devuelto"
    if "parcial" in blob:
        return "parcial"
    if "reembols" in blob:
        return "devuelto"
    # Procesando, etiqueta lista, en camino, entregado, ... → completed sale ("pagado")
    return "pagado"

def parse_es_date(s: str):
    """'9 de mayo de 2026 07:30 hs.' → (date 'YYYY-MM-DD', time 'HH:MM:SS') or (None, None)."""
    if not s:
        return None, None
    s = s.strip().lower().replace(".", "")
    # ej: '9 de mayo de 2026 07:30 hs'
    m = re.match(r"(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*hs)?", s)
    if not m:
        return None, None
    day, mon_name, year, hh, mm = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    mon = ES_MONTHS.get(mon_name)
    if not mon:
        return None, None
    date_str = f"{int(year):04d}-{mon:02d}-{int(day):02d}"
    time_str = f"{int(hh):02d}:{int(mm):02d}:00" if hh and mm else None
    return date_str, time_str

# ── env loader ───────────────────────────────────────────────────────────────

def load_env(path=".env"):
    env = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# ── xlsx reader ─────────────────────────────────────────────────────────────

COLUMN_HEADERS = {}  # col letter (e.g. 'A') -> header text (set after row 6)

def col_to_int(col_letters: str) -> int:
    n = 0
    for c in col_letters:
        n = n * 26 + (ord(c.upper()) - 64)
    return n

def read_xlsx_rows(path: str):
    """Yields dicts keyed by column letter for each data row (row 7 onwards)."""
    with zipfile.ZipFile(path) as z:
        with z.open("xl/sharedStrings.xml") as f:
            ss_root = ET.parse(f).getroot()
        strings = [
            "".join((t.text or "") for t in si.iter(f"{{{NS}}}t"))
            for si in ss_root.iter(f"{{{NS}}}si")
        ]
        with z.open("xl/worksheets/sheet1.xml") as f:
            for ev, el in ET.iterparse(f, events=("end",)):
                if el.tag != f"{{{NS}}}row":
                    continue
                rn = int(el.attrib["r"])
                if rn < 6:
                    el.clear()
                    continue
                row = {}
                for c in el.iter(f"{{{NS}}}c"):
                    ref = c.attrib["r"]
                    col = "".join(ch for ch in ref if ch.isalpha())
                    t = c.attrib.get("t")
                    v = c.find(f"{{{NS}}}v")
                    val = v.text if v is not None else ""
                    if t == "s" and val and val.isdigit():
                        val = strings[int(val)]
                    elif t == "inlineStr":
                        is_el = c.find(f"{{{NS}}}is")
                        val = (
                            "".join((t.text or "") for t in is_el.iter(f"{{{NS}}}t"))
                            if is_el is not None else ""
                        )
                    row[col] = (val or "").strip()
                if rn == 6:
                    COLUMN_HEADERS.update(row)
                else:
                    yield row
                el.clear()

# ── REST helpers ────────────────────────────────────────────────────────────

class Rest:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def request(self, method: str, path: str, body=None, extra_headers=None, params=""):
        url = f"{self.url}/rest/v1/{path.lstrip('/')}{('?' + params) if params else ''}"
        headers = dict(self.headers)
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def insert(self, table, rows, returning=False, on_conflict=None):
        params = ""
        if on_conflict:
            params = f"on_conflict={on_conflict}"
        extra = {"Prefer": "return=representation" if returning else "return=minimal"}
        if on_conflict:
            extra["Prefer"] = "resolution=merge-duplicates," + extra["Prefer"]
        status, body = self.request("POST", table, body=rows, extra_headers=extra, params=params)
        if status >= 300:
            raise RuntimeError(f"insert {table} failed {status}: {body[:500].decode(errors='replace')}")
        if returning and body:
            return json.loads(body)
        return None

    def select(self, table, params):
        status, body = self.request("GET", table, params=params)
        if status >= 300:
            raise RuntimeError(f"select {table} failed {status}: {body[:500].decode(errors='replace')}")
        return json.loads(body) if body else []

# ── main ────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("usage: python3 import-ml-historical.py <xlsx>", file=sys.stderr)
        sys.exit(2)
    xlsx = sys.argv[1]

    env = load_env(".env")
    rest = Rest(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    print(f"target: {env['SUPABASE_URL']}")

    # ── Pass 1: group rows by # de venta ────────────────────────────────────
    by_order = {}  # external_order_id -> {meta, items[]}
    raw_count = 0
    skipped = 0
    for row in read_xlsx_rows(xlsx):
        order_id = row.get("A", "").strip()
        if not order_id or not order_id.isdigit():
            skipped += 1
            continue
        raw_count += 1
        items_list = by_order.setdefault(order_id, {"first_row": row, "rows": []})["rows"]
        items_list.append(row)

    print(f"raw rows parsed: {raw_count}  (skipped: {skipped})")
    print(f"unique orders:   {len(by_order)}")

    # ── Pass 2: build payloads ──────────────────────────────────────────────
    raw_payloads = []  # (order_id, payload_json)
    sales_rows = []    # one per order
    items_per_order = {}  # order_id -> list of item dicts

    for oid, grp in by_order.items():
        meta = grp["first_row"]
        date_str, time_str = parse_es_date(meta.get("B", ""))
        if not date_str:
            # Fall back: today if we can't parse — keep import going
            date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        try:
            total = float((meta.get("Q") or "0").replace(",", "")) if meta.get("Q") else 0.0
        except ValueError:
            total = 0.0
        try:
            costo_envio = abs(float((meta.get("K") or "0").replace(",", ""))) if meta.get("K") else 0.0
        except ValueError:
            costo_envio = 0.0

        estado = map_status(meta.get("C", ""), meta.get("D", ""))

        sales_rows.append({
            "canal": CANAL,
            "external_order_id": oid,
            "fecha": date_str,
            "hora": time_str,
            "total": total,
            "subtotal": 0.0,  # set after summing items
            "costo_envio": costo_envio,
            "moneda": "COP",
            "estado": estado,
            "customer_external_id": (meta.get("AJ") or "").strip() or None,
            "customer_name": (meta.get("AH") or "").strip() or None,
            "customer_city": (meta.get("AL") or "").strip() or None,
            "payment_method": (meta.get("AB") or "").strip() or None,
            "notes": f"estado_ml={meta.get('C','')}; envio={meta.get('AP','')}".strip(),
        })

        # Build raw payload — full row dict using header names for legibility.
        payload = {
            "source": "xlsx_import",
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "items": [
                {COLUMN_HEADERS.get(col, col): val for col, val in row.items()}
                for row in grp["rows"]
            ],
        }
        raw_payloads.append({
            "canal": CANAL,
            "payload_json": payload,
        })

        items = []
        subtotal = 0.0
        for r in grp["rows"]:
            try:
                qty = int(float((r.get("G") or "0").replace(",", ""))) if r.get("G") else 1
            except ValueError:
                qty = 1
            if qty <= 0:
                qty = 1
            try:
                unit_price = float((r.get("AA") or "0").replace(",", ""))
            except ValueError:
                unit_price = 0.0
            line_total = unit_price * qty
            subtotal += line_total
            items.append({
                "external_sku": (r.get("U") or "").strip() or None,
                "external_product_id": (r.get("V") or "").strip() or None,
                "product_name": (r.get("Y") or "(sin título)").strip(),
                "quantity": qty,
                "unit_price": unit_price,
                "line_total": line_total,
                "line_discount": 0.0,
            })
        items_per_order[oid] = items
        # set sale subtotal (best-effort)
        sales_rows[-1]["subtotal"] = round(subtotal, 2)

    print(f"sales rows built:  {len(sales_rows)}")
    print(f"sale_items built:  {sum(len(v) for v in items_per_order.values())}")

    # ── Pass 3: insert raw_orders (idempotency = none; we just record) ─────
    print("inserting raw_orders ...")
    inserted_raw = 0
    for i in range(0, len(raw_payloads), BATCH_SIZE):
        chunk = raw_payloads[i:i+BATCH_SIZE]
        rest.insert("raw_orders", chunk)
        inserted_raw += len(chunk)
        print(f"  raw_orders {inserted_raw}/{len(raw_payloads)}", flush=True)

    # ── Pass 4: upsert sales (on canal,external_order_id) returning sale_id ─
    print("upserting sales ...")
    oid_to_sale_id = {}
    for i in range(0, len(sales_rows), BATCH_SIZE):
        chunk = sales_rows[i:i+BATCH_SIZE]
        ret = rest.insert("sales", chunk, returning=True, on_conflict="canal,external_order_id")
        for row in ret or []:
            oid_to_sale_id[row["external_order_id"]] = row["sale_id"]
        print(f"  sales {i + len(chunk)}/{len(sales_rows)}", flush=True)

    # Fallback: re-query any unmapped order_ids (in case of merge-duplicates not returning)
    missing = [oid for oid in by_order if oid not in oid_to_sale_id]
    if missing:
        print(f"  re-querying {len(missing)} sale_id by external_order_id ...")
        for i in range(0, len(missing), 100):
            ids = missing[i:i+100]
            # PostgREST in.(...) with comma-separated quoted values
            in_list = ",".join([f'"{x}"' for x in ids])
            rows = rest.select("sales", f"select=sale_id,external_order_id&canal=eq.{CANAL}&external_order_id=in.({in_list})")
            for row in rows:
                oid_to_sale_id[row["external_order_id"]] = row["sale_id"]
        print(f"  mapped {len(oid_to_sale_id)}/{len(by_order)} orders to sale_id")

    # ── Pass 5: insert sale_items ───────────────────────────────────────────
    # First, clear any pre-existing sale_items for the imported sale_ids so a
    # re-run of this script is idempotent (sale_items has no canal-aware
    # uniqueness — we wipe-and-replay per sale_id we just touched).
    sale_ids = list(oid_to_sale_id.values())
    if sale_ids:
        print(f"clearing existing sale_items for {len(sale_ids)} imported sales ...")
        for i in range(0, len(sale_ids), 200):
            ids = sale_ids[i:i+200]
            in_list = ",".join([f'"{x}"' for x in ids])
            status, body = rest.request(
                "DELETE", "sale_items",
                params=f"sale_id=in.({in_list})",
                extra_headers={"Prefer": "return=minimal"},
            )
            if status >= 300:
                raise RuntimeError(f"sale_items pre-clear failed {status}: {body[:300]!r}")

    print("inserting sale_items ...")
    all_items = []
    for oid, items in items_per_order.items():
        sid = oid_to_sale_id.get(oid)
        if not sid:
            continue
        for it in items:
            it["sale_id"] = sid
            all_items.append(it)

    inserted_items = 0
    for i in range(0, len(all_items), BATCH_SIZE):
        chunk = all_items[i:i+BATCH_SIZE]
        rest.insert("sale_items", chunk)
        inserted_items += len(chunk)
        print(f"  sale_items {inserted_items}/{len(all_items)}", flush=True)

    print()
    print("=" * 60)
    print(f"DONE. raw_orders: {inserted_raw}  sales: {len(oid_to_sale_id)}  sale_items: {inserted_items}")

if __name__ == "__main__":
    main()
