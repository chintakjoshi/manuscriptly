from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Config

engine = create_engine(Config.DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
