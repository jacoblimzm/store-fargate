// View controller: swaps between login, dashboard and account detail.
const views = {
  login: document.getElementById("loginView"),
  dashboard: document.getElementById("dashboardView"),
  account: document.getElementById("accountView"),
};

const logoutBtn = document.getElementById("logoutBtn");

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
  logoutBtn.classList.toggle("hidden", name === "login");
}

const currency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

// --- Login ---
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    const { accessToken } = await api.login(email, password);
    api.setToken(accessToken);
    await loadDashboard();
  } catch (err) {
    loginError.textContent = err.message || "Login failed";
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => {
  api.clearToken();
  showView("login");
});

document.getElementById("backBtn").addEventListener("click", loadDashboard);

// --- Dashboard ---
async function loadDashboard() {
  const [user, accounts] = await Promise.all([api.me(), api.accounts()]);
  document.getElementById("welcomeName").textContent = `Welcome, ${user.firstName}`;
  document.getElementById("welcomeEmail").textContent = user.email;

  const list = document.getElementById("accountList");
  list.innerHTML = "";
  accounts.forEach((acct) => {
    const card = document.createElement("button");
    card.className = "card account-card";
    card.innerHTML = `
      <span class="account-type">${acct.accountType}</span>
      <span class="account-number">•••• ${acct.accountNumber.slice(-4)}</span>
      <span class="balance-amount">${currency(acct.balance)}</span>
    `;
    card.addEventListener("click", () => loadAccount(acct.id));
    list.appendChild(card);
  });

  showView("dashboard");
}

// --- Account detail ---
async function loadAccount(accountId) {
  const { account, transactions } = await api.transactions(accountId);
  document.getElementById("detailType").textContent = account.accountType.toUpperCase();
  document.getElementById("detailNumber").textContent = `•••• ${account.accountNumber.slice(-4)}`;
  document.getElementById("detailBalance").textContent = currency(account.balance);

  const body = document.getElementById("txBody");
  body.innerHTML = "";
  transactions.forEach((tx) => {
    const row = document.createElement("tr");
    const signed = tx.kind === "credit" ? tx.amount : -tx.amount;
    row.innerHTML = `
      <td>${formatDate(tx.createdAt)}</td>
      <td>${tx.description}</td>
      <td class="right ${tx.kind}">${signed >= 0 ? "+" : ""}${currency(signed)}</td>
      <td class="right">${currency(tx.balanceAfter)}</td>
    `;
    body.appendChild(row);
  });

  showView("account");
}

// --- Bootstrap ---
(async function init() {
  if (api.getToken()) {
    try {
      await loadDashboard();
      return;
    } catch (_) {
      api.clearToken();
    }
  }
  showView("login");
})();
