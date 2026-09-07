import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { initials } from "../format";
import { Brand } from "./ui/Brand";
import { Avatar } from "./ui/Avatar";
import { ServiceIcon } from "./ui/ServiceIcon";
import { ThemeToggle } from "../theme/theme";

export default function Header() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const ini = initials(user?.firstName, user?.lastName);

  return (
    <header className="topbar">
      <div className="brand">
        <Brand /> DCash
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="theme-toggle"
          aria-label="My QR code"
          onClick={() => navigate("/receive")}
        >
          <ServiceIcon name="qr" size={20} />
        </button>
        <ThemeToggle />
        <button
          type="button"
          className="avatar-btn"
          aria-label="Open profile"
          onClick={() => navigate("/profile")}
        >
          <Avatar text={ini} />
        </button>
      </div>
    </header>
  );
}
