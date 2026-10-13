"use client";

import { useEffect } from "react";
import { AUTHOR, COPYRIGHT, PRODUCT, SIGNATURE_ID } from "@/lib/signature";

/** Prints the authorship signature in the browser console, once per page load. */
export default function SignatureBeacon() {
  useEffect(() => {
    const w = window as unknown as { __slSigned?: boolean };
    if (w.__slSigned) return;
    w.__slSigned = true;
    console.info(`%c${PRODUCT}%c built by ${AUTHOR}\n${COPYRIGHT}\nSignature ${SIGNATURE_ID}`, "font-weight:700;color:#24439A", "color:inherit");
    document.documentElement.dataset.signature = SIGNATURE_ID;
  }, []);
  return null;
}
