"""
Generates the demo bank statement PDF (artifacts/demo-bank-statement.pdf)
from the CSV exported by the Klear seed. The PDF is what gets dropped into
the dashboard for the live Sarvam Document AI extraction moment.

Run: /tmp/opencode/mlvenv/bin/python ml/gen_bank_pdf.py
"""
import csv
from datetime import datetime, timezone
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "artifacts" / "demo-bank-statement.csv"
OUT_PATH = ROOT / "artifacts" / "demo-bank-statement.pdf"

ACC_HOLDER = "SUNRISE ORGANICS PVT LTD"
ACC_NO = "50100247891234"
BANK = "HDFC BANK - CURRENT A/C"


def fmt_date(iso: str) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt.strftime("%d %b %Y")


def fmt_time(iso: str) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt.strftime("%H:%M")


def main() -> None:
    rows = []
    with open(CSV_PATH, newline="") as f:
        for r in csv.DictReader(f):
            rows.append(r)

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(True, margin=14)
    pdf.add_page()

    # header
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, BANK, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, f"Account: {ACC_NO}    Account holder: {ACC_HOLDER}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"Statement period: last 30 days    Generated: {datetime.now(timezone.utc).strftime('%d %b %Y')}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # table header
    pdf.set_fill_color(240, 242, 238)
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.cell(30, 7, "Date", border=1, fill=True)
    pdf.cell(14, 7, "Time", border=1, fill=True)
    pdf.cell(18, 7, "Chq/Ref", border=1, fill=True)
    pdf.cell(72, 7, "Narration", border=1, fill=True)
    pdf.cell(26, 7, "Withdrawal", border=1, fill=True, align="R")
    pdf.cell(26, 7, "Deposit", border=1, fill=True, align="R")
    pdf.ln()

    pdf.set_font("Helvetica", "", 8.5)
    for r in rows:
        paise = int(r["amount_paise"])
        rupees = paise / 100
        amt = f"{rupees:,.2f}"
        date = fmt_date(r["date"])
        time = fmt_time(r["date"])
        narration = r["narration"][:46]
        utr = r["utr"][:12]
        is_debit = r["direction"].upper() == "DEBIT"

        pdf.cell(30, 6.4, date, border=1)
        pdf.cell(14, 6.4, time, border=1)
        pdf.cell(18, 6.4, utr, border=1)
        pdf.cell(72, 6.4, narration, border=1)
        if is_debit:
            pdf.cell(26, 6.4, amt, border=1, align="R")
            pdf.cell(26, 6.4, "", border=1)
        else:
            pdf.cell(26, 6.4, "", border=1)
            pdf.cell(26, 6.4, amt, border=1, align="R")
        pdf.ln()

    OUT_PATH.parent.mkdir(exist_ok=True)
    pdf.output(str(OUT_PATH))
    print(f"✓ {OUT_PATH} ({len(rows)} transactions)")


if __name__ == "__main__":
    main()
