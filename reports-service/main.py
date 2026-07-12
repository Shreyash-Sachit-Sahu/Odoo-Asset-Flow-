import io
from datetime import datetime

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import verify_jwt
from db import get_db

app = FastAPI(title="Reports & Analytics Service", root_path="/reports")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _scope_filter(claims: dict) -> tuple[str, dict]:
    """ADMIN/ASSET_MANAGER see org-wide; everyone else is department-scoped."""
    role = claims.get("role", "EMPLOYEE")
    dept = claims.get("departmentId")
    if role in ("ADMIN", "ASSET_MANAGER") or dept is None:
        return "", {}
    return " AND department_id = :dept_id", {"dept_id": dept}


def _read_sql(db: Session, sql: str, params: dict) -> pd.DataFrame:
    return pd.read_sql(text(sql), db.bind, params=params)


# ---------------------------------------------------------------------------
# GET /reports/utilization -> most-used vs idle, trend
# ---------------------------------------------------------------------------

@app.get("/utilization")
def utilization(db: Session = Depends(get_db), claims: dict = Depends(verify_jwt)):
    dept_sql, params = _scope_filter(claims)
    df = _read_sql(
        db,
        f"""
        SELECT a.id AS asset_id, a.tag, a.category, count(al.id) AS allocation_count,
               coalesce(sum(EXTRACT(EPOCH FROM (coalesce(al.actual_return_at, now()) - al.allocated_at)) / 86400), 0) AS days_in_use
        FROM assets a
        LEFT JOIN allocations al ON al.asset_id = a.id
        WHERE 1=1 {dept_sql}
        GROUP BY a.id, a.tag, a.category
        ORDER BY allocation_count DESC
        """,
        params,
    )
    most_used = df.head(10).to_dict(orient="records")
    idle = df[df["allocation_count"] == 0].to_dict(orient="records")
    return {"most_used": most_used, "idle": idle, "total_assets": int(len(df))}


# ---------------------------------------------------------------------------
# GET /reports/maintenance-frequency -> by asset / category
# ---------------------------------------------------------------------------

@app.get("/maintenance-frequency")
def maintenance_frequency(db: Session = Depends(get_db), claims: dict = Depends(verify_jwt)):
    dept_sql, params = _scope_filter(claims)
    by_asset = _read_sql(
        db,
        f"""
        SELECT a.id AS asset_id, a.tag, count(m.id) AS request_count
        FROM assets a
        LEFT JOIN maintenance_requests m ON m.asset_id = a.id
        WHERE 1=1 {dept_sql}
        GROUP BY a.id, a.tag
        ORDER BY request_count DESC
        """,
        params,
    )
    by_category = _read_sql(
        db,
        f"""
        SELECT a.category, count(m.id) AS request_count
        FROM assets a
        LEFT JOIN maintenance_requests m ON m.asset_id = a.id
        WHERE 1=1 {dept_sql}
        GROUP BY a.category
        ORDER BY request_count DESC
        """,
        params,
    )
    return {
        "by_asset": by_asset.to_dict(orient="records"),
        "by_category": by_category.to_dict(orient="records"),
    }


# ---------------------------------------------------------------------------
# Assets due for maintenance or nearing retirement
# ---------------------------------------------------------------------------

@app.get("/due-for-maintenance")
def due_for_maintenance(db: Session = Depends(get_db), claims: dict = Depends(verify_jwt)):
    dept_sql, params = _scope_filter(claims)
    df = _read_sql(
        db,
        f"""
        SELECT id AS asset_id, tag, category, next_maintenance_due, retirement_due
        FROM assets
        WHERE (next_maintenance_due <= now() + interval '30 days'
               OR retirement_due <= now() + interval '90 days')
          {dept_sql}
        ORDER BY next_maintenance_due ASC NULLS LAST
        """,
        params,
    )
    return df.to_dict(orient="records")


# ---------------------------------------------------------------------------
# GET /reports/allocation-summary -> by department
# ---------------------------------------------------------------------------

@app.get("/allocation-summary")
def allocation_summary(db: Session = Depends(get_db), claims: dict = Depends(verify_jwt)):
    dept_sql, params = _scope_filter(claims)
    df = _read_sql(
        db,
        f"""
        SELECT d.name AS department, count(al.id) AS active_allocations
        FROM departments d
        LEFT JOIN allocations al ON al.department_id = d.id AND al.status = 'ACTIVE'
        WHERE 1=1 {dept_sql.replace('department_id', 'd.id')}
        GROUP BY d.name
        ORDER BY active_allocations DESC
        """,
        params,
    )
    return df.to_dict(orient="records")


# ---------------------------------------------------------------------------
# GET /reports/booking-heatmap -> weekday x hour matrix
# ---------------------------------------------------------------------------

@app.get("/booking-heatmap")
def booking_heatmap(db: Session = Depends(get_db), claims: dict = Depends(verify_jwt)):
    dept_sql, params = _scope_filter(claims)
    df = _read_sql(
        db,
        f"""
        SELECT extract(dow FROM start_at) AS weekday, extract(hour FROM start_at) AS hour
        FROM bookings
        WHERE status IN ('UPCOMING', 'ONGOING', 'COMPLETED') {dept_sql}
        """,
        params,
    )
    if df.empty:
        return {"weekdays": [], "hours": [], "matrix": []}

    df["count"] = 1
    pivot = df.pivot_table(index="weekday", columns="hour", values="count", aggfunc="sum", fill_value=0)
    return {
        "weekdays": pivot.index.astype(int).tolist(),
        "hours": pivot.columns.astype(int).tolist(),
        "matrix": pivot.values.tolist(),
    }


# ---------------------------------------------------------------------------
# GET /reports/export/{report}?fmt=csv|xlsx -> file download
# ---------------------------------------------------------------------------

_REPORT_QUERIES = {
    "utilization": lambda db, dept_sql, params: _read_sql(
        db,
        f"""
        SELECT a.id AS asset_id, a.tag, a.category, count(al.id) AS allocation_count
        FROM assets a LEFT JOIN allocations al ON al.asset_id = a.id
        WHERE 1=1 {dept_sql} GROUP BY a.id, a.tag, a.category ORDER BY allocation_count DESC
        """,
        params,
    ),
    "maintenance-frequency": lambda db, dept_sql, params: _read_sql(
        db,
        f"""
        SELECT a.id AS asset_id, a.tag, count(m.id) AS request_count
        FROM assets a LEFT JOIN maintenance_requests m ON m.asset_id = a.id
        WHERE 1=1 {dept_sql} GROUP BY a.id, a.tag ORDER BY request_count DESC
        """,
        params,
    ),
    "allocation-summary": lambda db, dept_sql, params: _read_sql(
        db,
        f"""
        SELECT d.name AS department, count(al.id) AS active_allocations
        FROM departments d
        LEFT JOIN allocations al ON al.department_id = d.id AND al.status = 'ACTIVE'
        WHERE 1=1 {dept_sql.replace('department_id', 'd.id')} GROUP BY d.name ORDER BY active_allocations DESC
        """,
        params,
    ),
}


@app.get("/export/{report}")
def export_report(
    report: str,
    fmt: str = Query("csv", pattern="^(csv|xlsx)$"),
    db: Session = Depends(get_db),
    claims: dict = Depends(verify_jwt),
):
    if report not in _REPORT_QUERIES:
        raise HTTPException(status_code=404, detail=f"Unknown report '{report}'")

    dept_sql, params = _scope_filter(claims)
    df = _REPORT_QUERIES[report](db, dept_sql, params)

    filename = f"{report}-{datetime.utcnow().date()}.{fmt}"
    buffer = io.BytesIO()

    if fmt == "csv":
        df.to_csv(buffer, index=False)
        media_type = "text/csv"
    else:
        df.to_excel(buffer, index=False, engine="openpyxl")
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/health")
def health():
    return {"status": "ok"}
