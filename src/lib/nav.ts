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
  Upload,
  Trophy,
  Target,
  UserCog,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export type Role = "AGENT" | "BDO" | "TEAM_LEADER" | "ADMIN";
export type Item = { href: string; label: string; icon: LucideIcon; roles?: Role[] };

export const NAV: Item[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarCheck },
  { href: "/targets", label: "Weekly targets", icon: Target },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/import", label: "Bulk upload", icon: Upload, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/statements", label: "Statements", icon: FileSpreadsheet, roles: ["ADMIN"] },
  { href: "/locations", label: "Locations", icon: MapPin, roles: ["TEAM_LEADER", "ADMIN"] },
  { href: "/shares", label: "Shared corporates", icon: Handshake, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/users", label: "People", icon: UserCog, roles: ["BDO", "TEAM_LEADER", "ADMIN"] },
  { href: "/teams", label: "Teams", icon: Network, roles: ["ADMIN"] },
  { href: "/audit", label: "Audit log", icon: ScrollText, roles: ["ADMIN"] },
];

