"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, GraduationCap, MapPin, Store, User, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import ActionForm, { Field, Submit } from "@/components/ui/ActionForm";
import { createAccount } from "@/lib/actions/accounts";

type Kind = "MERCHANT" | "INDIVIDUAL" | "SCHOOL" | "CORPORATE";
const KINDS: { value: Kind; label: string; hint: string; icon: typeof Store }[] = [
  { value: "MERCHANT", label: "Merchant", hint: "Business, needs KYC", icon: Store },
  { value: "INDIVIDUAL", label: "Individual", hint: "Needs ID only", icon: User },
  { value: "SCHOOL", label: "School", hint: "SNPL, Salary Advance", icon: GraduationCap },
  { value: "CORPORATE", label: "Corporate", hint: "Salary Advance", icon: Building2 },
];
const DRAFT_KEY = "sl-new-account-draft";
// The ID number is never written to the phone's storage.
const DRAFT_SKIP = new Set(["id_number", "latitude", "longitude", "accuracy", "captured_at", "kind"]);

type Loc =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "ok"; lat: number; lng: number; accuracy: number | null; at: string; address: string | null; addressLoading: boolean }
  | { state: "error"; message: string };

function geoError(err: GeolocationPositionError | Error) {
  if ("code" in err) {
    if (err.code === err.PERMISSION_DENIED) return "Location is blocked. Allow location for this site in your browser settings, then try again.";
    if (err.code === err.TIMEOUT) return "Getting a GPS fix took too long. Step outside or near a window and try again.";
    return "Your phone couldn't find its location. Check that location (GPS) is switched on.";
  }
  return err.message;
}

export default function NewAccountForm({ agents, initialKind }: { agents: { id: string; name: string }[]; initialKind?: string }) {
  const [kind, setKind] = useState<Kind | null>(KINDS.some((k) => k.value === initialKind) ? (initialKind as Kind) : null);
  const [loc, setLoc] = useState<Loc>({ state: "idle" });
  const formWrap = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Restore a draft typed earlier (e.g. before the signal dropped).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Record<string, string>;
        setDraft(d);
        if (!kind && d._kind) setKind(d._kind as Kind);
      }
    } catch {
      /* storage unavailable: nothing to restore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraft = () => {
    const form = formWrap.current?.querySelector("form");
    if (!form) return;
    const data: Record<string, string> = { _kind: kind ?? "" };
    new FormData(form).forEach((v, k) => {
      if (!DRAFT_SKIP.has(k) && typeof v === "string" && v) data[k] = v;
    });
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  };
  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const capture = () => {
    if (!("geolocation" in navigator)) {
      setLoc({ state: "error", message: "This browser can't share its location. Use Chrome on your phone." });
      return;
    }
    setLoc({ state: "busy" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const at = new Date(pos.timestamp).toISOString();
        setLoc({ state: "ok", lat: latitude, lng: longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null, at, address: null, addressLoading: true });
        const { line } = await fetch(`/api/geo/preview?lat=${latitude}&lng=${longitude}`, { signal: AbortSignal.timeout(10000) })
          .then((r) => r.json() as Promise<{ line: string | null }>)
          .catch(() => ({ line: null }));
        setLoc((l) => (l.state === "ok" ? { ...l, address: line, addressLoading: false } : l));
      },
      (err) => setLoc({ state: "error", message: geoError(err) }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const d = (k: string) => draft[k] ?? "";
  const isPerson = kind === "INDIVIDUAL";
  const isMerchantLike = kind === "MERCHANT" || kind === "INDIVIDUAL";

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="label">What kind of account?</legend>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              aria-pressed={kind === k.value}
              className={`flex min-h-[72px] items-center gap-3 rounded-xl border p-3 text-left ${
                kind === k.value ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white active:bg-slate-50"
              }`}
            >
              <k.icon size={22} className={kind === k.value ? "text-brand-700" : "text-slate-500"} />
              <span>
                <span className="block font-medium text-ink">{k.label}</span>
                <span className="block text-xs text-slate-500">{k.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {kind && (
        <div ref={formWrap} onChange={saveDraft}>
          <ActionForm
            action={async (prev, f) => {
              const res = await createAccount(prev, f);
              if (res.ok) clearDraft();
              return res;
            }}
            redirectTo="/accounts/{id}"
            className="space-y-4"
          >
            <input type="hidden" name="kind" value={kind} />
            <div className="card space-y-4 p-4">
              <Field label={isPerson ? "Full name" : kind === "MERCHANT" ? "Business name" : "Organisation name"} name="name">
                <input id="name" name="name" required defaultValue={d("name")} className="input" autoComplete="off" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" name="phone">
                  <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={d("phone")} placeholder="07…" className="input" />
                </Field>
                <Field label="Email" name="email">
                  <input id="email" name="email" type="email" inputMode="email" defaultValue={d("email")} className="input" />
                </Field>
              </div>
              {kind === "MERCHANT" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Type of business" name="business_type">
                      <input id="business_type" name="business_type" defaultValue={d("business_type")} placeholder="e.g. Butchery, Hardware" className="input" />
                    </Field>
                    <Field label="Owner's name" name="owner_name">
                      <input id="owner_name" name="owner_name" defaultValue={d("owner_name")} className="input" />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="KRA PIN (optional)" name="kra_pin">
                      <input id="kra_pin" name="kra_pin" defaultValue={d("kra_pin")} className="input uppercase" autoCapitalize="characters" />
                    </Field>
                    <Field label="Registration no. (optional)" name="registration_no">
                      <input id="registration_no" name="registration_no" defaultValue={d("registration_no")} className="input" />
                    </Field>
                  </div>
                </>
              )}
              {isPerson && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="National ID number" name="id_number" hint="Stored encrypted. Others see only the last 4 digits.">
                    <input id="id_number" name="id_number" required inputMode="numeric" autoComplete="off" className="input" />
                  </Field>
                  <Field label="Date of birth (optional)" name="date_of_birth">
                    <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={d("date_of_birth")} className="input" />
                  </Field>
                </div>
              )}
              {(kind === "SCHOOL" || kind === "CORPORATE") && (
                <Field label="Industry (optional)" name="industry">
                  <input id="industry" name="industry" defaultValue={d("industry")} placeholder={kind === "SCHOOL" ? "e.g. Primary school" : "e.g. Manufacturing"} className="input" />
                </Field>
              )}
              {isMerchantLike && (
                <Field label="Pesi account number (if signed up)" name="pesi_account_no" hint="4 digits. Needed before Document collection.">
                  <input id="pesi_account_no" name="pesi_account_no" inputMode="numeric" maxLength={4} pattern="\d{4}" defaultValue={d("pesi_account_no")} className="input" />
                </Field>
              )}
              <Field label="Where is it? (optional)" name="location_text" hint="Building, market or landmark, as the client describes it.">
                <input id="location_text" name="location_text" defaultValue={d("location_text")} className="input" />
              </Field>
              {agents.length > 0 && (
                <Field label="Assign to" name="owner_id">
                  <select id="owner_id" name="owner_id" defaultValue={d("owner_id")} className="input">
                    <option value="">Me</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="card space-y-3 p-4">
              <div className="flex items-start gap-3">
                <MapPin size={20} className="mt-0.5 shrink-0 text-brand-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">Location</p>
                  <p className="text-sm text-slate-500">Required. Capture it while you're at the client.</p>
                </div>
              </div>
              {loc.state === "ok" && (
                <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
                  <p className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={16} /> Location captured
                    {loc.accuracy !== null && <span className="font-normal text-green-800">(±{Math.round(loc.accuracy)} m)</span>}
                  </p>
                  <p className="mt-1">
                    {loc.addressLoading ? "Finding the street name…" : loc.address ?? "Street name not available yet. It will be looked up after saving."}
                  </p>
                  {loc.accuracy !== null && loc.accuracy > 100 && (
                    <p className="mt-1 flex items-center gap-1 text-amber-800">
                      <AlertTriangle size={14} /> Not very precise. Try again outside for a better fix.
                    </p>
                  )}
                  <input type="hidden" name="latitude" value={loc.lat} />
                  <input type="hidden" name="longitude" value={loc.lng} />
                  <input type="hidden" name="accuracy" value={loc.accuracy ?? ""} />
                  <input type="hidden" name="captured_at" value={loc.at} />
                </div>
              )}
              {loc.state === "error" && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loc.message}</p>}
              <button type="button" onClick={capture} disabled={loc.state === "busy"} className={loc.state === "ok" ? "btn-secondary w-full" : "btn-primary w-full"}>
                {loc.state === "busy" ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Getting GPS fix…
                  </>
                ) : loc.state === "ok" ? (
                  "Capture again"
                ) : (
                  <>
                    <MapPin size={18} /> Capture location
                  </>
                )}
              </button>
            </div>

            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
              <Submit pendingText="Saving…">{loc.state === "ok" ? "Save account" : "Save account (capture location first)"}</Submit>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
