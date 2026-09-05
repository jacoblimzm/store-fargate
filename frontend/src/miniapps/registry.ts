// Config-driven super-app services. The Home hub renders its tile grid from
// this registry so services bolt on/off. Phase-1 tiles route to a ComingSoon
// placeholder; feature phases replace the route + flip `enabled`.
export interface MiniApp {
  key: string;
  label: string;
  route: string;
  enabled: boolean;
}

export const miniApps: MiniApp[] = [
  { key: "send", label: "Send", route: "/soon/send", enabled: true },
  { key: "pay", label: "Pay Bills", route: "/soon/pay", enabled: true },
  { key: "bank", label: "Bank", route: "/soon/bank", enabled: true },
  { key: "cards", label: "Cards", route: "/soon/cards", enabled: true },
  { key: "loans", label: "Loans", route: "/soon/loans", enabled: true },
  { key: "shop", label: "Shop", route: "/soon/shop", enabled: false },
  { key: "rides", label: "Rides", route: "/soon/rides", enabled: false },
  { key: "more", label: "More", route: "/soon/more", enabled: true },
];
