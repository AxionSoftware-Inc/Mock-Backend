import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/mockbase")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
