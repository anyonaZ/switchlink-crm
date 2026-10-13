"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

type Point = { id: string; name: string; kind: string; lat: number; lng: number; address: string; owner: string };
const COLORS: Record<string, string> = { MERCHANT: "#059669", INDIVIDUAL: "#7c3aed", SCHOOL: "#24439A", CORPORATE: "#D91014" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** OpenStreetMap tiles via Leaflet: both free and open source, no API key. */
export default function MapView({ points }: { points: Point[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const bounds = L.latLngBounds([]);
      for (const p of points) {
        L.circleMarker([p.lat, p.lng], { radius: 8, color: "#fff", weight: 2, fillColor: COLORS[p.kind] ?? "#475569", fillOpacity: 0.95 })
          .bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.address)}<br><span style="color:#64748b">${esc(p.owner)}</span><br><a href="/accounts/${p.id}">Open account</a>`)
          .addTo(map);
        bounds.extend([p.lat, p.lng]);
      }
      if (points.length === 1) map.setView([points[0].lat, points[0].lng], 15);
      else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);
  return (
    <div className="card overflow-hidden">
      <div ref={el} className="h-[55vh] min-h-[280px] w-full md:h-[480px]" />
      <div className="flex flex-wrap gap-3 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
        {Object.entries(COLORS).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {k.charAt(0) + k.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
