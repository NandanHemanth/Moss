"""Generic CRUD routes matching the frontend's Refine data provider contract.

GET /api/{resource}?filters=<json CrudFilter[]>&sorters=<json CrudSort[]>&page=1&pageSize=10
returns {"data": [...], "total": n}. Pass pageSize=0 to disable pagination.
"""

import json
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from .. import actions, db

router = APIRouter(prefix="/api")


def _matches(row: dict[str, Any], f: dict[str, Any]) -> bool:
    if "field" not in f:
        results = [_matches(row, sub) for sub in f.get("value", [])]
        return any(results) if f.get("operator") == "or" else all(results)
    value, target, op = row.get(f["field"]), f.get("value"), f.get("operator")
    match op:
        case "eq":
            return value == target
        case "ne":
            return value != target
        case "in":
            return value in (target or [])
        case "contains":
            return str(target or "").lower() in str(value or "").lower()
        case "gte":
            return value is not None and value >= target
        case "lte":
            return value is not None and value <= target
        case _:
            return True


def _resource(name: str) -> str:
    if name not in db.RESOURCES:
        raise HTTPException(404, f"Unknown resource: {name}")
    return name


def _id(resource: str, raw: str) -> int | str:
    return raw if resource == "agents" else int(raw)


@router.get("/{resource}")
def get_list(
    resource: str,
    filters: str = Query("[]"),
    sorters: str = Query("[]"),
    page: int = 1,
    pageSize: int = 10,
) -> dict[str, Any]:
    rows = [r for r in db.all_rows(_resource(resource)) if all(_matches(r, f) for f in json.loads(filters))]
    for s in reversed(json.loads(sorters)):
        present = [r for r in rows if r.get(s["field"]) is not None]
        missing = [r for r in rows if r.get(s["field"]) is None]
        present.sort(key=lambda r: r[s["field"]], reverse=s.get("order") == "desc")
        rows = present + missing
    total = len(rows)
    if pageSize > 0:
        rows = rows[(page - 1) * pageSize : page * pageSize]
    return {"data": rows, "total": total}


@router.get("/{resource}/{id_}")
def get_one(resource: str, id_: str) -> dict[str, Any]:
    row = db.get(_resource(resource), _id(resource, id_))
    if not row:
        raise HTTPException(404, f"{resource} {id_} not found")
    return row


@router.post("/{resource}")
def create(resource: str, values: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return db.create(_resource(resource), values)


@router.patch("/{resource}/{id_}")
def update(resource: str, id_: str, values: dict[str, Any] = Body(...)) -> dict[str, Any]:
    resource = _resource(resource)
    before = db.get(resource, _id(resource, id_))
    if not before:
        raise HTTPException(404, f"{resource} {id_} not found")
    row = db.update(resource, _id(resource, id_), values)
    assert row is not None
    actions.on_update(resource, before, row)
    return row


@router.delete("/{resource}/{id_}")
def delete(resource: str, id_: str) -> dict[str, Any]:
    row = db.delete(_resource(resource), _id(resource, id_))
    if not row:
        raise HTTPException(404, f"{resource} {id_} not found")
    return row
