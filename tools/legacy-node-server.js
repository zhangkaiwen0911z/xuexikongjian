#!/usr/bin/env node
/* 学习空间 - 端口服务
 * 静态页面 + 数据 API（load/save）
 * 用法: node server.js <port>   （PORT 环境变量优先）
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || process.argv[2] || "8768", 10);
if (!(PORT >= 1 && PORT <= 65535)) { console.error("非法端口: " + PORT); process.exit(1); }
const WWW = path.resolve(path.join(__dirname, "..", "www"));
const DATA_DIR = process.env.DATA_DIR || "/var/apps/xuexikongjian/var";
const DATA_FILE = path.join(DATA_DIR, "data.json");
const MAX_SIZE = 3145728;

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg"
};

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function sendJson(res, obj) { send(res, 200, "application/json; charset=utf-8", JSON.stringify(obj)); }

/* 数据 API */
function apiLoad(res) {
  try {
    if (fs.existsSync(DATA_FILE) && fs.statSync(DATA_FILE).size > 0) {
      const data = fs.readFileSync(DATA_FILE, "utf8");
      sendJson(res, { ok: true, data: JSON.parse(data) });
    } else {
      sendJson(res, { ok: true, data: null });
    }
  } catch (e) { sendJson(res, { ok: true, data: null }); }
}
function apiSave(req, res) {
  let body = "";
  let size = 0;
  let aborted = false;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > MAX_SIZE) { aborted = true; req.destroy(); return; }
    body += chunk;
  });
  req.on("end", () => {
    if (aborted) { sendJson(res, { ok: false, msg: "too large" }); return; }
    const s = body.trim();
    if (!s || s[0] !== "{" || s[s.length - 1] !== "}") { sendJson(res, { ok: false, msg: "invalid json" }); return; }
    try {
      JSON.parse(s);
    } catch (e) { sendJson(res, { ok: false, msg: "invalid json" }); return; }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, s);
      fs.renameSync(tmp, DATA_FILE);
      try { fs.chmodSync(DATA_FILE, 0o666); } catch (e) {}
      sendJson(res, { ok: true });
    } catch (e) {
      sendJson(res, { ok: false, msg: "write failed" });
    }
  });
}

/* 静态文件 */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.includes("..") || rel.includes("\\") || rel.includes("//")) { send(res, 400, "text/plain; charset=utf-8", "Bad Request"); return; }
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW)) { send(res, 400, "text/plain; charset=utf-8", "Bad Request"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { send(res, 404, "text/plain; charset=utf-8", "404 Not Found"); return; }
    const mime = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; }
  catch (e) { send(res, 400, "text/plain; charset=utf-8", "Bad Request"); return; }
  if (pathname === "/api/load" && req.method === "GET") return apiLoad(res);
  if (pathname === "/api/save" && req.method === "POST") return apiSave(req, res);
  if (pathname.startsWith("/api/")) { send(res, 404, "application/json; charset=utf-8", '{"ok":false,"msg":"not found"}'); return; }
  serveStatic(req, res, pathname);
});

server.on("error", err => {
  console.error("服务启动失败: " + err.message);
  process.exit(1);
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("学习空间服务已启动，端口 " + PORT);
});
