from .account_routes import account_bp
from .admin_routes import admin_bp
from .auth_routes import auth_bp
from .chat_routes import chat_bp
from .contact_routes import contact_bp
from .health_routes import health_bp
from .lab_routes import lab_bp
from .signup_routes import signup_bp
from .status_routes import status_bp
from .transfer_routes import transfer_bp
from .user_routes import user_bp
from .vuln_routes import vuln_bp

__all__ = [
    "account_bp",
    "admin_bp",
    "auth_bp",
    "chat_bp",
    "contact_bp",
    "health_bp",
    "lab_bp",
    "signup_bp",
    "status_bp",
    "transfer_bp",
    "user_bp",
    "vuln_bp",
]
