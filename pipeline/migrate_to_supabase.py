#!/usr/bin/env python3
"""Copy the checked-in SQLite dataset and local report/evidence files into Supabase.

First apply the SQL schema with `supabase db push --linked`, then set DATABASE_URL,
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and run this script with --apply.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from sqlalchemy import MetaData, Table, create_engine, func, inspect, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import models_ops  # noqa: E402,F401 (registers operational models)
from backend.config import settings  # noqa: E402
from backend.db import IS_SQLITE, engine as target_engine, validate_postgres_schema  # noqa: E402
from backend.models import Base  # noqa: E402
from backend.storage import ensure_private_bucket, put_object  # noqa: E402

BATCH_SIZE = 250
SUPABASE_FREE_DB_LIMIT = 500 * 1024 * 1024


@dataclass(frozen=True)
class SourceObject:
    key: str
    path: Path
    content_type: str


def _source_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    resolved_root = root.resolve()
    if resolved_root not in candidate.parents:
        raise ValueError(f"Stored file path escapes the source directory: {relative!r}")
    if not candidate.is_file():
        raise FileNotFoundError(f"Stored file is missing: {candidate}")
    return candidate


def source_objects(connection, tables: dict[str, Table], data_dir: Path) -> list[SourceObject]:
    objects: dict[str, SourceObject] = {}
    reports = tables.get("reports")
    if reports is not None:
        for row in connection.execute(select(reports.c.report_id, reports.c.status, reports.c.pdf_path)):
            report_id, status, pdf_path = row
            if status == "ready" and pdf_path:
                path = _source_path(data_dir, pdf_path)
                objects[pdf_path] = SourceObject(pdf_path, path, "application/pdf")
    evidence = tables.get("evidence")
    if evidence is not None:
        for row in connection.execute(select(evidence.c.measure_id, evidence.c.file_name, evidence.c.thumb_name)):
            measure_id, file_name, thumb_name = row
            for name in (file_name, thumb_name):
                key = f"evidence/{measure_id}/{name}"
                path = _source_path(data_dir, key)
                objects[key] = SourceObject(key, path, "image/jpeg")
    return list(objects.values())


def _tables(source_engine):
    available = set(inspect(source_engine).get_table_names())
    expected = set(Base.metadata.tables)
    missing = expected - available
    if missing:
        raise RuntimeError(f"SQLite source is missing required WAYMARK tables: {', '.join(sorted(missing))}")
    metadata = MetaData()
    source_tables: dict[str, Table] = {}
    target_tables = []
    for target in Base.metadata.sorted_tables:
        if target.name not in available:
            continue
        source = Table(target.name, metadata, autoload_with=source_engine)
        absent_required = [c.name for c in target.columns if c.name not in source.c and not c.nullable and c.default is None and c.server_default is None]
        if absent_required:
            raise RuntimeError(f"SQLite table {target.name} is missing required columns: {', '.join(absent_required)}")
        source_tables[target.name] = source
        target_tables.append(target)
    return source_tables, target_tables


def _batches(connection, table: Table, wanted_columns: list[str]) -> Iterator[list[dict]]:
    source_columns = [table.c[name] for name in wanted_columns if name in table.c]
    result = connection.execute(select(*source_columns))
    while batch := result.fetchmany(BATCH_SIZE):
        yield [dict(zip((c.name for c in source_columns), row)) for row in batch]


def _count(connection, table: Table) -> int:
    return int(connection.execute(select(func.count()).select_from(table)).scalar_one())


def _copy_rows(source_connection, target_connection, source_tables: dict[str, Table], target_tables: list[Table]) -> dict[str, int]:
    copied: dict[str, int] = {}
    dialect = target_connection.dialect.name
    insert_factory = pg_insert if dialect == "postgresql" else sqlite_insert
    for target in target_tables:
        source = source_tables[target.name]
        primary_keys = [column.name for column in target.primary_key.columns]
        if not primary_keys:
            raise RuntimeError(f"Cannot safely repeat import: table {target.name} has no primary key.")
        columns = [column.name for column in target.columns if column.name in source.c]
        statement = insert_factory(target).on_conflict_do_nothing(index_elements=primary_keys)
        count = 0
        for batch in _batches(source_connection, source, columns):
            if not batch:
                continue
            result = target_connection.execute(statement, batch)
            count += result.rowcount if result.rowcount is not None and result.rowcount >= 0 else len(batch)
        copied[target.name] = count
    return copied


def _reset_sequences(connection, target_tables: list[Table]) -> None:
    if connection.dialect.name != "postgresql":
        return
    preparer = connection.dialect.identifier_preparer
    for table in target_tables:
        for column in table.primary_key.columns:
            if column.name != "id" or not column.autoincrement:
                continue
            q_table, q_column = preparer.quote(table.name), preparer.quote(column.name)
            qualified = f"public.{table.name}"
            connection.execute(text(
                f"SELECT setval(pg_get_serial_sequence(:table_name, :column_name), "
                f"COALESCE(MAX({q_column}), 1), COUNT(*) > 0) FROM public.{q_table}"
            ), {"table_name": qualified, "column_name": column.name})


def _database_size(connection) -> int | None:
    if connection.dialect.name != "postgresql":
        return None
    return int(connection.execute(text("SELECT pg_database_size(current_database())")).scalar_one())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, default=Path("waymark.db"), help="Source SQLite file (default: waymark.db).")
    parser.add_argument("--data-dir", type=Path, default=settings.data_dir, help="Source reports/evidence root (default: WAYMARK_DATA_DIR).")
    parser.add_argument("--apply", action="store_true", help="Upload files and copy rows; without this flag, only show the import plan.")
    args = parser.parse_args()

    sqlite_path = args.sqlite.resolve()
    data_dir = args.data_dir.resolve()
    if not sqlite_path.is_file():
        parser.error(f"SQLite source not found: {sqlite_path}")
    if not data_dir.is_dir():
        parser.error(f"Data directory not found: {data_dir}")
    source = create_engine(f"sqlite:///{sqlite_path}")
    try:
        with source.connect() as source_connection:
            source_tables, target_tables = _tables(source)
            counts = {table.name: _count(source_connection, source_tables[table.name]) for table in target_tables}
            objects = source_objects(source_connection, source_tables, data_dir)
        total_bytes = sum(obj.path.stat().st_size for obj in objects)
        print(f"Source database: {sqlite_path} ({sqlite_path.stat().st_size / 1024 / 1024:.1f} MiB)")
        print(f"Files to migrate: {len(objects)} ({total_bytes / 1024 / 1024:.2f} MiB)")
        for table, count in counts.items():
            print(f"  {table:<20} {count:>10,} rows")
        if total_bytes > 1024 * 1024 * 1024:
            raise RuntimeError("Source files exceed Supabase Free's 1 GiB Storage quota; do not cut over.")
        if not args.apply:
            print("Dry run only. Apply the Supabase migration, configure secrets, then rerun with --apply.")
            return 0
        if IS_SQLITE:
            raise RuntimeError("DATABASE_URL is not configured; refusing to import into local SQLite.")
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before applying the import.")

        validate_postgres_schema()
        with target_engine.connect() as connection:
            before = _database_size(connection) or 0
        if before + 2 * sqlite_path.stat().st_size > SUPABASE_FREE_DB_LIMIT:
            raise RuntimeError("Preflight estimate exceeds Supabase Free's 500 MiB database quota; do not cut over.")

        ensure_private_bucket()
        for item in objects:
            put_object(item.key, item.path.read_bytes(), item.content_type)
        with target_engine.begin() as target_connection, source.connect() as source_connection:
            copied = _copy_rows(source_connection, target_connection, source_tables, target_tables)
            _reset_sequences(target_connection, target_tables)
        with target_engine.connect() as connection:
            after = _database_size(connection)
            target_counts = {table.name: _count(connection, table) for table in target_tables}
        lost_rows = [name for name, source_count in counts.items() if target_counts[name] < source_count]
        if lost_rows:
            raise RuntimeError(f"Row-count verification failed for: {', '.join(lost_rows)}")
        print("Imported rows (existing primary keys were left unchanged):")
        for table, count in copied.items():
            print(f"  {table:<20} {count:>10,} inserted; {target_counts[table]:>10,} in target (source: {counts[table]:,})")
        if after is not None:
            print(f"Supabase Postgres size: {after / 1024 / 1024:.1f} MiB / 500 MiB free quota")
            if after > SUPABASE_FREE_DB_LIMIT:
                raise RuntimeError("Imported database exceeds the Supabase Free quota. Do not switch Render to this project.")
        print(f"Imported object bytes: {total_bytes / 1024 / 1024:.2f} MiB (check total Storage usage in Supabase before cutover).")
        return 0
    finally:
        source.dispose()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Import stopped: {exc}", file=sys.stderr)
        raise SystemExit(1)
