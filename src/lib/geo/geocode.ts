import "server-only";

/**
 * Reverse geocoding: GPS coordinates to a street address.
 *
 * GEOCODER=nominatim (default): OpenStreetMap's free public Nominatim
 *   service. Its usage policy allows light use like ours (a few hundred
 *   registrations a day) if we send an identifying User-Agent, make at most
 *   one request per second, and cache results. All three are done here.
 * GEOCODER=google: Google Geocoding API (paid; needs GOOGLE_MAPS_API_KEY).
 * GEOCODER=off: store coordinates only.
 *
 * Calls are always made from the server, so no API key reaches a phone.
 */
export interface Address {
  road: string | null;
  landmark: string | null;
  area: string | null;
  town: string | null;
  county: string | null;
  country: string | null;
  formatted: string | null;
  provider: string;
  raw: unknown;
}

export type GeocoderName = "nominatim" | "google" | "off";
export const geocoderName = (): GeocoderName => {
  const v = (process.env.GEOCODER || "nominatim").toLowerCase();
  return v === "google" || v === "off" ? v : "nominatim";
};

// --- cache + 1 request/second throttle (single server process) -------------
const cache = new Map<string, Address>();
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Kenyan OSM data puts counties in `state` or `county`, sometimes with the word "County". */
const countyName = (v: string | null) => (v ? (/county/i.test(v) ? v : `${v} County`) : null);

async function nominatim(lat: number, lng: number): Promise<Address> {
  const contact = process.env.GEOCODER_CONTACT_EMAIL || "admin@example.com";
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
  const res = await throttled(() =>
    fetch(url, {
      headers: { "User-Agent": `SwitchlinkCRM/4.0 (${contact})`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    })
  );
  if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
  const j = (await res.json()) as { address?: Record<string, string>; display_name?: string; error?: string };
  if (j.error || !j.address) throw new Error(j.error || "No address found here");
  const a = j.address;
  return {
    road: clean(a.road) ?? clean(a.pedestrian) ?? clean(a.footway) ?? clean(a.path),
    landmark: clean(a.building) ?? clean(a.amenity) ?? clean(a.shop) ?? clean(a.office) ?? clean(a.house_name),
    area: clean(a.suburb) ?? clean(a.neighbourhood) ?? clean(a.quarter) ?? clean(a.residential) ?? clean(a.village),
    town: clean(a.city) ?? clean(a.town) ?? clean(a.municipality) ?? clean(a.village),
    county: countyName(clean(a.county) ?? clean(a.state)),
    country: clean(a.country),
    formatted: clean(j.display_name),
    provider: "nominatim",
    raw: j,
  };
}

async function google(lat: number, lng: number): Promise<Address> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`, {
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json()) as {
    status: string;
    results: { formatted_address: string; address_components: { long_name: string; types: string[] }[] }[];
  };
  if (j.status !== "OK" || !j.results.length) throw new Error(`Google answered ${j.status}`);
  const comps = j.results[0].address_components;
  const pick = (...types: string[]) => comps.find((c) => types.some((ty) => c.types.includes(ty)))?.long_name ?? null;
  return {
    road: pick("route"),
    landmark: pick("premise", "point_of_interest", "establishment"),
    area: pick("sublocality_level_1", "sublocality", "neighborhood"),
    town: pick("locality", "administrative_area_level_2"),
    county: countyName(pick("administrative_area_level_1")),
    country: pick("country"),
    formatted: j.results[0].formatted_address,
    provider: "google",
    raw: { formatted_address: j.results[0].formatted_address, address_components: comps },
  };
}

// Circuit breaker: when the office internet or the service is down, stop
// trying for a while instead of making every request wait on a timeout.
const PAUSE_AFTER_FAILURE_MS = 2 * 60 * 1000;
let pausedUntil = 0;

/** Throws if the lookup fails; callers keep the coordinates and retry later. */
export async function reverseGeocode(lat: number, lng: number): Promise<Address | null> {
  const which = geocoderName();
  if (which === "off") return null;
  const k = `${which}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  if (Date.now() < pausedUntil) throw new Error("Address lookup paused after a recent failure");
  let addr: Address;
  try {
    addr = which === "google" ? await google(lat, lng) : await nominatim(lat, lng);
  } catch (e) {
    // A "no address here" answer is not an outage; anything else pauses lookups.
    if (!(e instanceof Error && /No address|Unable to geocode/i.test(e.message))) pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
    throw e;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, addr);
  return addr;
}

/** "Moi Avenue, CBD, Nairobi County": the short line shown to agents. */
export function shortAddress(a: { road?: string | null; landmark?: string | null; area?: string | null; town?: string | null; county?: string | null }) {
  const parts = [a.landmark, a.road, a.area, a.town !== a.area ? a.town : null, a.county].filter(Boolean) as string[];
  return [...new Set(parts)].join(", ") || null;
}
