import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Single datasource for now (no replica set up yet) — points at the same
# 'assetflow' Postgres your Java app uses. Set DB_URL as an environment
# variable (do not hardcode credentials here):
#   export DB_URL="postgresql+psycopg2://postgres:<password>@localhost:5432/assetflow"
# If you add a real read replica later, just point DB_URL at it; nothing
# else here needs to change.
DB_URL = os.environ["DB_URL"]

engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
