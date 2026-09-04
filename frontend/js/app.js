// View controller: swaps between login, dashboard and account detail.
const views = {
  login: document.getElementById("loginView"),
  dashboard: document.getElementById("dashboardView"),
  account: document.getElementById("accountView"),
  profile: document.getElementById("profileView"),
};

const logoutBtn = document.getElementById("logoutBtn");

// --- Authenticated user area (profile button + dropdown menu) ---
const userArea = document.getElementById("userArea");
const userMenuBtn = document.getElementById("userMenuBtn");
const userMenu = document.getElementById("userMenu");
const profileMenuItem = document.getElementById("profileMenuItem");

function isUserMenuOpen() {
  return !userMenu.classList.contains("hidden");
}

let hoverCloseTimer = null;

function openUserMenu({ focusFirst = false } = {}) {
  clearTimeout(hoverCloseTimer);
  userMenu.classList.remove("hidden");
  userMenuBtn.setAttribute("aria-expanded", "true");
  // Only pull focus into the menu for explicit (click/keyboard) opens — hover
  // opens should not steal focus from wherever the user is.
  if (focusFirst) {
    const first = userMenu.querySelector('[role="menuitem"]');
    if (first) first.focus();
  }
}

function closeUserMenu({ focusButton = false } = {}) {
  clearTimeout(hoverCloseTimer);
  userMenu.classList.add("hidden");
  userMenuBtn.setAttribute("aria-expanded", "false");
  if (focusButton) userMenuBtn.focus();
}

function toggleUserMenu() {
  if (isUserMenuOpen()) closeUserMenu({ focusButton: true });
  else openUserMenu({ focusFirst: true });
}

// Click still toggles (keyboard + touch friendly), focusing the first item.
userMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleUserMenu();
});

// Hover to reveal: open on pointer enter, close shortly after leaving so a
// small gap between the button and the menu doesn't cause flicker. The menu
// lives inside #userArea, so hovering either keeps it open.
userArea.addEventListener("mouseenter", () => {
  if (!userArea.classList.contains("hidden")) openUserMenu();
});
userArea.addEventListener("mouseleave", () => {
  hoverCloseTimer = setTimeout(() => closeUserMenu(), 180);
});

// Close on outside click.
document.addEventListener("click", (e) => {
  if (isUserMenuOpen() && !userArea.contains(e.target)) closeUserMenu();
});

// Close on Escape; return focus to the trigger button.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isUserMenuOpen()) closeUserMenu({ focusButton: true });
});

// "Account details" opens the dedicated profile page.
profileMenuItem.addEventListener("click", () => {
  closeUserMenu({ focusButton: true });
  loadProfile();
});

function initials(firstName, lastName) {
  const a = (firstName || "").trim()[0] || "";
  const b = (lastName || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}

// Populate the profile button + menu header with the signed-in user.
function setProfile(user) {
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  const ini = initials(user.firstName, user.lastName);
  document.getElementById("userAvatar").textContent = ini;
  document.getElementById("menuAvatar").textContent = ini;
  document.getElementById("userBtnName").textContent = fullName;
  document.getElementById("userBtnEmail").textContent = user.email || "";
  document.getElementById("menuName").textContent = fullName;
  document.getElementById("menuEmail").textContent = user.email || "";
}

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
  userArea.classList.toggle("hidden", name === "login");
  // Chat needs an authenticated session (it reads the customer's RDS data via
  // tools), so hide the assistant launcher/panel on the login view.
  document.body.classList.toggle("pre-auth", name === "login");
  if (name === "login") closeUserMenu();
}

const currency = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

// --- Login ---
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const simulateBtn = document.getElementById("simulateBtn");
const simHint = document.getElementById("simHint");

// Pre-seeded demo users (all share the same password). Kept in sync with
// backend/app/seed.py so "Simulate user" always logs in successfully.
const DEMO_PASSWORD = "Password123!";
const DEMO_USERS = [
  "ada@pay2play.test",
  "grace@pay2play.test",
  "alan@pay2play.test",
  "katherine@pay2play.test",
  "margaret@pay2play.test",
  "linus@pay2play.test",
];

async function performLogin(email, password) {
  loginError.classList.add("hidden");
  if (simHint) simHint.classList.add("hidden");
  try {
    const { accessToken } = await api.login(email, password);
    api.setToken(accessToken);
    await loadDashboard();
  } catch (err) {
    loginError.textContent = err.message || "Login failed";
    loginError.classList.remove("hidden");
  }
}

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  performLogin(emailInput.value.trim(), passwordInput.value);
});

simulateBtn.addEventListener("click", () => {
  const email = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
  // Auto-fill a random demo user's credentials but DON'T sign in automatically.
  // Letting the user see the picked account and click "Sign in" themselves
  // keeps the flow transparent instead of teleporting them into a dashboard.
  loginError.classList.add("hidden");
  emailInput.value = email;
  passwordInput.value = DEMO_PASSWORD;
  if (simHint) {
    simHint.textContent = `Filled in ${email}. Click “Sign in” to continue.`;
    simHint.classList.remove("hidden");
  }
  // Nudge focus to the primary action so keyboard/Enter completes the login.
  loginForm.querySelector('button[type="submit"]').focus();
});

logoutBtn.addEventListener("click", () => {
  closeUserMenu();
  api.clearToken();
  if (window.DD_RUM) window.DD_RUM.onReady(function () { window.DD_RUM.clearUser(); });
  showView("login");
});

document.getElementById("backBtn").addEventListener("click", loadDashboard);
document.getElementById("profileBackBtn").addEventListener("click", loadDashboard);

// --- Dashboard ---
async function loadDashboard() {
  const [user, accounts] = await Promise.all([api.me(), api.accounts()]);
  document.getElementById("welcomeName").textContent = `Welcome, ${user.firstName}`;
  document.getElementById("welcomeEmail").textContent = user.email;

  // Populate the always-present profile button / dropdown menu.
  setProfile(user);

  // Tie the RUM session to the authenticated user. Defer via onReady: with the
  // async SDK loader, setUser/clearUser don't exist until the SDK has loaded
  // (the stub only exposes onReady), so calling them directly can throw.
  if (window.DD_RUM) {
    window.DD_RUM.onReady(function () {
      window.DD_RUM.setUser({
        id: String(user.id),
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
      });
    });
  }

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

// --- Profile ---
async function loadProfile() {
  const [user, accounts] = await Promise.all([api.me(), api.accounts()]);
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();

  document.getElementById("profileAvatar").textContent = initials(user.firstName, user.lastName);
  document.getElementById("profileName").textContent = fullName || "Profile";
  document.getElementById("profileEmail").textContent = user.email || "";
  document.getElementById("profileFullName").textContent = fullName || "—";
  document.getElementById("profileEmailValue").textContent = user.email || "—";
  document.getElementById("profileMemberSince").textContent = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "—";

  const total = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  document.getElementById("profileAccounts").textContent = String(accounts.length);
  document.getElementById("profileTotalBalance").textContent = currency(total);

  // Keep the header profile button in sync in case we came here directly.
  setProfile(user);
  showView("profile");
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
