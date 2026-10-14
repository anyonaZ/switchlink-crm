export const ROLE_LABELS = { AGENT: "Agent", BDO: "BDO", TEAM_LEADER: "Team Leader", ADMIN: "Admin" } as const;

export const KIND_LABELS = {
  SCHOOL: "School",
  CORPORATE: "Corporate",
  MERCHANT: "Merchant",
  INDIVIDUAL: "Individual",
} as const;

export const STATUS_LABELS = {
  ONGOING_ENGAGEMENT: "Ongoing engagement",
  DOCUMENT_COLLECTION: "Document collection",
  PENDING_VERIFICATION: "Pending verification",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
} as const;

export const STATUS_STYLES = {
  ONGOING_ENGAGEMENT: "bg-sky-100 text-sky-800",
  DOCUMENT_COLLECTION: "bg-amber-100 text-amber-900",
  PENDING_VERIFICATION: "bg-violet-100 text-violet-800",
  ACTIVE: "bg-green-100 text-green-800",
  INACTIVE: "bg-slate-100 text-slate-600",
} as const;

export const PRODUCT_LABELS = {
  SNPL: "School Now Pay Later",
  SALARY_ADVANCE: "Salary Advance",
  QUICK_FINANCE: "Quick Finance",
} as const;
export const PRODUCT_SHORT = { SNPL: "SNPL", SALARY_ADVANCE: "Salary Adv.", QUICK_FINANCE: "QF" } as const;

/** Which products each kind of account can take. */
export const PRODUCTS_FOR_KIND = {
  SCHOOL: ["SNPL", "SALARY_ADVANCE"],
  CORPORATE: ["SALARY_ADVANCE", "SNPL"],
  MERCHANT: ["QUICK_FINANCE"],
  INDIVIDUAL: ["QUICK_FINANCE"],
} as const;

export const STAGES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "MEETING",
  "INTERESTED",
  "PROPOSAL",
  "NEGOTIATION",
  "MOU",
  "ONBOARDING",
  "ACTIVE",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "Prospect",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  MEETING: "Meeting",
  INTERESTED: "Interested",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  MOU: "MOU",
  ONBOARDING: "Onboarding",
  ACTIVE: "Won",
};

export const STAGE_STYLES: Record<Stage, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-sky-100 text-sky-800",
  QUALIFIED: "bg-cyan-100 text-cyan-800",
  MEETING: "bg-indigo-100 text-indigo-800",
  INTERESTED: "bg-violet-100 text-violet-800",
  PROPOSAL: "bg-amber-100 text-amber-900",
  NEGOTIATION: "bg-orange-100 text-orange-900",
  MOU: "bg-purple-100 text-purple-800",
  ONBOARDING: "bg-teal-100 text-teal-800",
  ACTIVE: "bg-green-100 text-green-800",
};

export const ACTIVITY_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "SITE_VISIT", "NOTE"] as const;
export const ACTIVITY_LABELS = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  MEETING: "Meeting",
  SITE_VISIT: "Site visit",
  NOTE: "Note",
} as const;
