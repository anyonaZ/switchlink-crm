"use client";

import { useEffect } from "react";
import { clearAllDrafts } from "@/lib/drafts";

/** Rendered on the sign-in page: whoever signs in next starts with no one else's unsaved form data. */
export default function ClearDrafts() {
  useEffect(() => clearAllDrafts(), []);
  return null;
}
