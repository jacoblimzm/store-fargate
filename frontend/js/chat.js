// Sleek floating chat assistant. Talks to POST /api/chat (OpenAI-backed via the
// Responses API), which ddtrace-run auto-instruments and LLM Observability
// captures. Kept dependency-free to match the rest of the SPA.
(function () {
  const fab = document.getElementById("chatFab");
  const panel = document.getElementById("chatPanel");
  const closeBtn = document.getElementById("chatClose");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatText");
  const log = document.getElementById("chatLog");

  function toggle(open) {
    panel.classList.toggle("hidden", !open);
    fab.classList.toggle("hidden", open);
    if (open) input.focus();
  }

  fab.addEventListener("click", () => toggle(true));
  closeBtn.addEventListener("click", () => toggle(false));

  function addMessage(text, className) {
    const el = document.createElement("div");
    el.className = `chat-msg ${className}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  addMessage("Hi! I'm your Pay2Play assistant. How can I help?", "bot");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addMessage(text, "user");

    const pending = addMessage("Thinking…", "bot pending");
    try {
      const { reply } = await api.chat(text);
      pending.classList.remove("pending");
      pending.textContent = reply || "(no response)";
    } catch (err) {
      pending.classList.remove("pending");
      pending.classList.add("error");
      pending.textContent = err.message || "Something went wrong.";
    }
    log.scrollTop = log.scrollHeight;
  });
})();
