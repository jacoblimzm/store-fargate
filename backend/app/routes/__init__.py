from .account_routes import account_bp
from .auth_routes import auth_bp
from .health_routes import health_bp
from .user_routes import user_bp

__all__ = ["account_bp", "auth_bp", "health_bp", "user_bp"]
