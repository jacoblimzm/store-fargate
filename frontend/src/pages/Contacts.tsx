import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { initials } from "../format";
import { ServiceIcon } from "../components/ui/ServiceIcon";
import QrScannerModal from "../components/QrScanner";
import type { Contact } from "../types";

export default function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const load = () => api.contacts().then(setContacts).catch(() => setContacts([]));
  useEffect(() => {
    load();
  }, []);

  const addByValue = async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setError("");
    try {
      const contact = await api.scanContact(v);
      setInput("");
      setNotice(`Added ${contact.name} (@${contact.handle}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact");
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice("");
    await addByValue(input);
  };

  const onScanned = async (text: string) => {
    setScanning(false);
    setNotice("");
    await addByValue(text);
  };

  const remove = async (c: Contact) => {
    setConfirmId(null);
    if (!c.handle) return;
    setError("");
    setNotice("");
    try {
      await api.deleteContact(c.handle);
      setNotice(`Removed @${c.handle}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove contact");
    }
  };

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>

      <button className="my-qr-link glass" onClick={() => navigate("/receive")}>
        <span className="tile-icon" aria-hidden="true"><ServiceIcon name="qr" size={20} /></span>
        <span className="my-qr-meta">
          <span className="my-qr-title">Show my QR code</span>
          <span className="my-qr-sub muted">Let others scan to add & pay you</span>
        </span>
        <span className="my-qr-caret" aria-hidden="true">&rsaquo;</span>
      </button>

      <button type="button" className="btn btn-primary scan-cta" onClick={() => { setNotice(""); setError(""); setScanning(true); }}>
        <ServiceIcon name="qr" size={18} /> Scan QR Code
      </button>

      <form className="scan-add" onSubmit={add}>
        <input
          type="text"
          placeholder="or add by @handle"
          autoCapitalize="none"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary scan-btn">Add</button>
      </form>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="section-label">Contacts</div>
      <div className="contact-list glass">
        {contacts.length === 0 ? (
          <p className="muted contact-empty">No contacts yet.</p>
        ) : (
          contacts.map((c) => (
            <div key={c.id} className="contact-item static">
              <span className="avatar">{initials(c.name.split(" ")[0], c.name.split(" ")[1])}</span>
              <span className="contact-meta">
                <span className="contact-name">{c.name}</span>
                <span className="contact-handle">@{c.handle}</span>
              </span>
              {confirmId === c.id ? (
                <span className="contact-confirm">
                  <span className="contact-confirm-q muted">Remove?</span>
                  <button type="button" className="contact-confirm-yes" onClick={() => remove(c)}>
                    Remove
                  </button>
                  <button type="button" className="contact-confirm-no" onClick={() => setConfirmId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="contact-remove"
                  aria-label={`Remove ${c.name}`}
                  title="Remove contact"
                  onClick={() => { setError(""); setNotice(""); setConfirmId(c.id); }}
                >
                  &times;
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {scanning ? <QrScannerModal onResult={onScanned} onClose={() => setScanning(false)} /> : null}
    </section>
  );
}
