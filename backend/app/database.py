from pathlib import Path

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

from .config import DATABASE_URL

pool = ConnectionPool(
    DATABASE_URL, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row}
)


def open_pool() -> None:
    pool.open()
    pool.wait()


def close_pool() -> None:
    pool.close()


def initialize_schema() -> None:
    schema_path = Path(__file__).resolve().parents[2] / "database" / "schema.sql"
    with pool.connection() as connection:
        connection.execute(schema_path.read_text())
