// Thin API client. Stores the JWT in localStorage and attaches it as a Bearer
// header. All calls go through nginx which proxies /api to the backend.
const TOKEN_KEY = "pay2play_token";

const api = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  },

  async request(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.clearToken();
      const err = new Error("unauthorized");
      err.status = 401;
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  login(email, password) {
    return this.request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
  },
  me() {
    return this.request("/users/me");
  },
  accounts() {
    return this.request("/accounts");
  },
  transactions(accountId) {
    return this.request(`/accounts/${accountId}/transactions`);
  },
};
