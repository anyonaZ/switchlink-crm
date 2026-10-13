import {
  BarChart3,
  Building2,
  CalendarCheck,
  FileSpreadsheet,
  KanbanSquare,
  LayoutDashboard,
  MapPin,
  Network,
  Handshake,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export type Role = "AGENT" | "BDO" | "TEAM_LEADER" | "ADMIN";
export type Item = { href: string; label: string; icon: LucideIcon; roles?: Role[] };

export const NAV: Item[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarCheck },
  { href: "/statements", label: "Statements", icon: FileSpreadsheet, roles: ["ADMIN"] },
  { href: "/locations", label: "Locations", icon: MapPin, roles: ["TEAM_LEADER", "ADMIN"] },
  { href: "/shares", label: "Shared corporates", icon: Handshake, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/users", label: "People", icon: UserCog, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/teams", label: "Teams", icon: Network, roles: ["ADMIN"] },
];

