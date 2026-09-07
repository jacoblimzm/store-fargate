export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string | null;
}

export interface Account {
  id: number;
  accountNumber: string;
  accountType: string;
  balance: number;
}

export interface Transaction {
  id: number;
  kind: "credit" | "debit";
  amount: number;
  description: string;
  balanceAfter: number;
  createdAt: string | null;
}

export interface TransactionsResponse {
  account: Account;
  transactions: Transaction[];
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

export interface Contact {
  id: number;
  handle: string | null;
  name: string;
}

export interface MyQr {
  handle: string | null;
  payload: string;
}

export interface TransferResult {
  ok: boolean;
  amount: number;
  toHandle: string | null;
  fromHandle: string | null;
  senderBalance: number;
  transferCount: number;
}
