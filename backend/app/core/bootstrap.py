from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import generate_password_hash

from app.core.config import Config
from app.db.session import SessionLocal
from app.models import User

logger = logging.getLogger(__name__)


def seed_default_superuser() -> None:
    if not Config.SEED_DEFAULT_SUPERUSER:
        return

    db = SessionLocal()
    try:
        first_user = db.execute(select(User.id).limit(1)).scalar_one_or_none()
        if first_user is not None:
            return

        superuser = User(
            user_name=Config.DEFAULT_SUPERUSER_USER_NAME,
            email=Config.DEFAULT_SUPERUSER_EMAIL,
            password_hash=generate_password_hash(Config.DEFAULT_SUPERUSER_PASSWORD),
        )
        db.add(superuser)
        db.commit()
        logger.info("Seeded default superuser '%s'.", Config.DEFAULT_SUPERUSER_EMAIL)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Failed to seed default superuser.")
        raise
    finally:
        db.close()
