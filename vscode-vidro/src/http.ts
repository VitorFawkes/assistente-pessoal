// Cliente HTTP minimalista usando o módulo nativo do Node (sem depender de fetch global,
// que pode não existir na versão de Node do extension host).
import * as http from "http";
import * as fs from "fs";

const HOST = "127.0.0.1";

export function getJson<T = any>(port: number, path: string): Promise<T> {
  return request(port, "GET", path).then((b) => JSON.parse(b || "{}"));
}

export function postJson<T = any>(port: number, path: string, body: unknown): Promise<T> {
  const data = Buffer.from(JSON.stringify(body ?? {}), "utf8");
  return request(port, "POST", path, data, {
    "Content-Type": "application/json",
    "Content-Length": String(data.length),
  }).then((b) => (b ? JSON.parse(b) : ({} as T)));
}

function request(
  port: number,
  method: string,
  path: string,
  body?: Buffer,
  headers: Record<string, string> = {},
  timeoutMs = 120000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, path, method, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${method} ${path}: ${text.slice(0, 200)}`));
        } else {
          resolve(text);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

// POST multipart/form-data com um arquivo (para /voice e /stt).
export function postFile<T = any>(
  port: number,
  path: string,
  field: string,
  filePath: string,
  filename = "audio.wav",
  contentType = "audio/wav"
): Promise<T> {
  const fileBuf = fs.readFileSync(filePath);
  const boundary = "----vidro" + Math.random().toString(16).slice(2);
  const pre = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    "utf8"
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const data = Buffer.concat([pre, fileBuf, post]);
  return request(port, "POST", path, data, {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(data.length),
  }).then((b) => (b ? JSON.parse(b) : ({} as T)));
}

// Checa se o motor está no ar (GET /projects responde).
export async function isUp(port: number): Promise<boolean> {
  try {
    await getJson(port, "/projects");
    return true;
  } catch {
    return false;
  }
}
