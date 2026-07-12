import os
import jwt
from fastapi import Header, HTTPException, status

# Must match your Spring app's `jwt.secret` property exactly, set as an env
# var here (not hardcoded) — e.g.:
#   export APP_JWT_SECRET="9vH0J2kLmP8rXs5QaWdY7uF1nBcEzRtY3hIjK6LpOmN"
# (the value currently sitting in application.properties — move it to an
# env var / secrets manager in both places, not just this one.)
APP_JWT_SECRET = os.environ["APP_JWT_SECRET"]
ALGORITHM = "HS256"


def verify_jwt(authorization: str = Header(...)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, APP_JWT_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    return payload  # contains sub (user id), role, departmentId, etc.
