import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { initials } from "../../format";
import { useSendFlow } from "./SendLayout";
import type { Contact } from "../../types";

export default function SendRecipient() {
  const navigate = useNavigate();
  const { setRecipient } = useSendFlow();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.contacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  const pick = (c: Contact) => {
    setRecipient(c);
    navigate("/send/amount");
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.handle || "").toLowerCase().includes(q))
    : contacts;

  return (
    <div className="send-body">
      <h2 className="send-step-title">Who are you sending to?</h2>

      <input
        type="text"
        className="contact-search"
        placeholder="Search contacts"
        autoCapitalize="none"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="section-label">Contacts</div>
      <div className="contact-list glass">
        {contacts.length === 0 ? (
          <p className="muted contact-empty">
            No contacts yet. Add someone in Contacts first, then come back to send.
          </p>
        ) : filtered.length === 0 ? (
          <p className="muted contact-empty">No contacts match “{query.trim()}”.</p>
        ) : (
          filtered.map((c) => (
            <button key={c.id} className="contact-item" onClick={() => pick(c)}>
              <span className="avatar">{initials(c.name.split(" ")[0], c.name.split(" ")[1])}</span>
              <span className="contact-meta">
                <span className="contact-name">{c.name}</span>
                <span className="contact-handle">@{c.handle}</span>
              </span>
              <span className="contact-go" aria-hidden="true">›</span>
            </button>
          ))
        )}
      </div>

      <button className="btn btn-secondary" onClick={() => navigate("/contacts")}>
        + Add a contact
      </button>
    </div>
  );
}
