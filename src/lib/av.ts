import "server-only";
import net from "node:net";

/**
 * Optional virus scan with ClamAV (free, open source). Set CLAMAV_HOST (and
 * CLAMAV_PORT, default 3310) to a running clamd, e.g. the `clamav` service in
 * docker-compose.yml (`docker compose --profile antivirus up -d`). When it's
 * set, every KYC file is scanned before it's stored, and an upload is refused
 * if the scanner can't be reached, so files never go in unscanned.
 */
export type ScanResult = { status: "clean" } | { status: "infected"; signature: string } | { status: "skipped" } | { status: "error"; message: string };

export async function scanBytes(bytes: Buffer, timeoutMs = 30_000): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return { status: "skipped" };
  const port = Number(process.env.CLAMAV_PORT || 3310);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let reply = "";
    const done = (r: ScanResult) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs, () => done({ status: "error", message: "The virus scanner didn't answer in time." }));
    sock.on("error", () => done({ status: "error", message: "The virus scanner isn't reachable." }));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const chunk = bytes.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (/: OK$/.test(r)) done({ status: "clean" });
      else if (/FOUND$/.test(r)) done({ status: "infected", signature: r.replace(/^stream: /, "").replace(/ FOUND$/, "") });
      else done({ status: "error", message: `Unexpected scanner reply: ${r.slice(0, 100)}` });
    });
  });
}
