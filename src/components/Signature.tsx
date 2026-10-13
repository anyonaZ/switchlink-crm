import { AUTHOR, COPYRIGHT_YEAR, watermark } from "@/lib/signature";

/** The visible "built by" line. Carries the invisible watermark too. */
export default function Signature({ className = "text-xs text-slate-400" }: { className?: string }) {
  return (
    <p className={className} data-signature="anyonaz-newtech">
      {watermark(`Switchlink CRM · © ${COPYRIGHT_YEAR} ${AUTHOR}`)}
    </p>
  );
}
