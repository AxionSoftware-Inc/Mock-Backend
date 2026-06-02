from app.database import close_pool, initialize_schema, open_pool

open_pool()
try:
    initialize_schema()
    print("mockbase schema is ready")
finally:
    close_pool()
