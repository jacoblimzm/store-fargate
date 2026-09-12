// Thin typed API client. Stores the JWT in localStorage and attaches it as a
// Bearer header. All calls go through nginx (prod) / the Vite proxy (dev),
// which forward /api to the Flask backend.
import type {
  Account,
  Contact,
  LabResult,
  LoginResponse,
  MyQr,
  TransactionsResponse,
  TransferResult,
  User,
} from "../types";

const TOKEN_KEY = "dcash_token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, { method = "GET", body }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    throw new ApiError("unauthorized", 401);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as string) || `request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const api = {
  getToken,
  setToken,
  clearToken,
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", { method: "POST", body: { email, password } });
  },
  signup(username: string, displayName?: string): Promise<LoginResponse> {
    return request<LoginResponse>("/signup", { method: "POST", body: { username, displayName } });
  },
  contacts(): Promise<Contact[]> {
    return request<Contact[]>("/contacts");
  },
  addContact(handle: string): Promise<Contact> {
    return request<Contact>("/contacts", { method: "POST", body: { handle } });
  },
  scanContact(payload: string): Promise<Contact> {
    return request<Contact>("/contacts/scan", { method: "POST", body: { payload } });
  },
  deleteContact(handle: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/contacts/${encodeURIComponent(handle)}`, { method: "DELETE" });
  },
  myQr(): Promise<MyQr> {
    return request<MyQr>("/me/qr");
  },
  transfer(toHandle: string, amount: string, note?: string): Promise<TransferResult> {
    return request<TransferResult>("/transfers", { method: "POST", body: { toHandle, amount, note } });
  },
  me(): Promise<User> {
    return request<User>("/users/me");
  },
  accounts(): Promise<Account[]> {
    return request<Account[]>("/accounts");
  },
  transactions(accountId: number): Promise<TransactionsResponse> {
    return request<TransactionsResponse>(`/accounts/${accountId}/transactions`);
  },
  chat(message: string): Promise<{ reply: string }> {
    return request<{ reply: string }>("/chat", { method: "POST", body: { message } });
  },
  lab(scenario: string): Promise<LabResult> {
    return request<LabResult>(`/lab/${scenario}`, { method: "POST" });
  },
};
