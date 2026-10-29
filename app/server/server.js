#!/usr/bin/env node
/* 学习空间 - 统一网关服务（多用户数据隔离）
 * 监听 Unix Socket（网关模式）或 TCP 端口（本地测试模式）
 * 数据按用户隔离：X-Trim-Userid 头 → data-<uid>.json；无该头时用 "local"
 * 用法: SOCKET_PATH=... node server.js   或  node server.js <port>
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const SOCKET = process.env.SOCKET_PATH || "";
const PORT = parseInt(process.env.PORT || "8768", 10);
const WWW = path.resolve(path.join(__dirname, "..", "www"));
const DATA_DIR = process.env.DATA_DIR || "/var/apps/xuexikongjian/var";
const LEGACY_FILE = path.join(DATA_DIR, "data.json");   // v1.2.x 共享数据（迁移源）
const MAX_SIZE = 3145728;

function getUser(req) {
  // 网关转发用户头；本地无该头时用 local
  return (req.headers["x-trim-userid"] || "local").replace(/[^A-Za-z0-9_.-]/g, "_");
}
function isAdmin(req) {
  const uidHeader = req.headers["x-trim-userid"];
  if (!uidHeader) return true;                       // 本地/无网关头：视为管理员（便于开发调试）
  return req.headers["x-trim-isadmin"] === "true";   // 网关模式：以可信头为准
}
function listUsers() {
  // 扫描 data-*.json，汇总每个用户的状态
  const out = [];
  try {
    fs.readdirSync(DATA_DIR).forEach(fn => {
      const m = /^data-(.+)\.json$/.exec(fn);
      if (!m) return;
      const uid = m[1];
      const d = readJsonOrNull(path.join(DATA_DIR, fn));
      if (!d) return;
      let pending = 0;
      const today = new Date().toISOString().slice(0, 10);
      const day = d.days && d.days[today];
      if (day && day.grades) {
        Object.keys(day.grades).forEach(g => {
          const gs = day.grades[g] || {};
          Object.keys(gs).forEach(k => { if (gs[k] === 1) pending++; });
        });
      }
      out.push({
        uid: uid,
        name: (d.config && d.config.name) || uid,
        points: (d.totals && d.totals.points) || 0,
        earned: (d.totals && d.totals.earned) || 0,
        pending: pending,
        grade: (d.config && d.config.grade) || "4"
      });
    });
  } catch (e) {}
  return out;
}
function userFile(uid) { return path.join(DATA_DIR, "data-" + uid + ".json"); }

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
function readJsonOrNull(f) {
  try {
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {}
  return null;
}

function apiLoad(req, res) {
  const uid = getUser(req);
  console.log(new Date().toISOString() + " [load] uid=" + uid);
  const f = userFile(uid);
  let data = readJsonOrNull(f);
  if (data === null) {
    // 首次：迁移旧版共享数据作为该用户的初始数据
    const legacy = readJsonOrNull(LEGACY_FILE);
    if (legacy !== null) {
      data = legacy;
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(legacy)); try { fs.chmodSync(f, 0o666); } catch (e) {} } catch (e) {}
    }
  }
  sendJson(res, data === null ? { ok: true, data: null } : { ok: true, data: data });
}
function apiSave(req, res) {
  const uid = getUser(req);
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
    try { JSON.parse(s); } catch (e) { sendJson(res, { ok: false, msg: "invalid json" }); return; }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = userFile(uid) + ".tmp";
      fs.writeFileSync(tmp, s);
      fs.renameSync(tmp, userFile(uid));
      try { fs.chmodSync(userFile(uid), 0o666); } catch (e) {}
      console.log(new Date().toISOString() + " [save] uid=" + uid + " bytes=" + s.length + " ok");
      sendJson(res, { ok: true });
    } catch (e) {
      console.log(new Date().toISOString() + " [save] uid=" + uid + " FAIL " + e.message);
      sendJson(res, { ok: false, msg: "write failed" });
    }
  });
}

/* ---------- DeepSeek AI 出题（服务端代理，密钥不出服务端） ---------- */
function aiPrompt(subject, gradeName, keywords, count) {
  const schema = {
    poems: '{"t":"诗题","a":"朝代 · 作者","lines":["第一句，","第二句。"],"tag":"自编"}',
    readings: '{"title":"短文标题","src":"自编","text":"正文（可含换行）","qs":[{"q":"题目","opts":["A","B","C","D"],"ans":0,"why":"解析"}]}',
    quotes: '{"t":"名言内容。","s":"作者或出处"}',
    words: '{"en":"english","cn":"中文"}',
    dialogues: '{"who":"对话主题","lines":[{"who":"A","en":"Hello!","cn":"你好！"}]}',
    math: '{"type":"q1","text":"题目文本","ans":42,"why":"解析"}'
  }[subject] || '{}';
  const subjName = { poems: "古诗", readings: "阅读理解", quotes: "名言", words: "英语单词", dialogues: "英语对话", math: "数学题" }[subject] || subject;
  return {
    system: "你是一位中国小学" + gradeName + "的" + subjName + "老师，负责出题。只输出 JSON 数组，不要任何解释、不要 markdown 代码块。",
    user: "请生成 " + count + " 道/个适合小学" + gradeName + "的" + subjName + "。关键词/主题：" + (keywords || "不限") + "。\n" +
          "每一项必须是如下结构的 JSON 对象（字段名与类型严格一致）：\n" + schema + "\n" +
          (subject === "math" ? "注意：ans 必须是数字（整数或一位小数），题型 type 用 q1（基础计算）或 q2（思维应用题）。\n" : "") +
          (subject === "readings" ? "注意：每篇 3-4 道选择题，每题 4 个选项，ans 为正确选项下标（0=A，1=B，2=C，3=D）。\n" : "") +
          "直接输出 JSON 数组，例如 [ " + schema + " ]"
  };
}
function handleAI(req, res) {
  let body = "";
  req.on("data", c => { body += c; if (body.length > 65536) req.destroy(); });
  req.on("end", () => {
    let p;
    try { p = JSON.parse(body || "{}"); } catch (e) { sendJson(res, { ok: false, msg: "参数错误" }); return; }
    const uid = getUser(req);
    const st = readJsonOrNull(userFile(uid));
    const cfg = (st && st.config) || {};
    const key = cfg.deepseekKey || "";
    if (!key) { sendJson(res, { ok: false, msg: "请先在家长管理 → 设置 中填写 DeepSeek API Key" }); return; }
    const base = (cfg.deepseekBase || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = cfg.deepseekModel || "deepseek-chat";
    const count = Math.min(10, Math.max(1, parseInt(p.count, 10) || 5));
    const pr = aiPrompt(p.subject, p.gradeName || "", p.keywords || "", count);
    const payload = JSON.stringify({
      model: model,
      messages: [{ role: "system", content: pr.system }, { role: "user", content: pr.user }],
      temperature: 0.8,
      stream: false
    });
    const https = require("https");
    const url = new URL(base + "/chat/completions");
    const r2 = https.request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key, "Content-Length": Buffer.byteLength(payload) },
      timeout: 120000
    }, resp => {
      let data = "";
      resp.on("data", c => { data += c; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (j.error) { sendJson(res, { ok: false, msg: "DeepSeek 返回错误：" + (j.error.message || "") }); return; }
          const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "";
          const jsonText = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
          const m = jsonText.match(/\[[\s\S]*\]/);
          if (!m) { sendJson(res, { ok: false, msg: "AI 返回内容无法解析为题目数组" }); return; }
          sendJson(res, { ok: true, items: JSON.parse(m[0]) });
        } catch (e) { sendJson(res, { ok: false, msg: "AI 响应解析失败" }); }
      });
    });
    r2.on("error", e => sendJson(res, { ok: false, msg: "请求 DeepSeek 失败：" + e.message }));
    r2.on("timeout", () => { r2.destroy(); sendJson(res, { ok: false, msg: "请求 DeepSeek 超时" }); });
    r2.write(payload);
    r2.end();
  });
}

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
  // 网关前缀无尾斜杠时 301 跳转（保证浏览器落在 /app/xuexikongjian/ 目录上）
  if (pathname === "/app/xuexikongjian") {
    res.writeHead(301, { Location: "/app/xuexikongjian/" });
    res.end();
    return;
  }
  // 网关前缀剥离：/app/xuexikongjian/xxx → /xxx
  if (pathname.startsWith("/app/")) {
    const idx = pathname.indexOf("/", 5);
    pathname = idx >= 0 ? pathname.slice(idx) : "/";
  }
  if (pathname === "/api/load" && req.method === "GET") return apiLoad(req, res);
  if (pathname === "/api/save" && req.method === "POST") return apiSave(req, res);
  if (pathname === "/api/whoami" && req.method === "GET") {
    return sendJson(res, { ok: true, uid: getUser(req), isAdmin: isAdmin(req), username: req.headers["x-trim-username"] || "" });
  }
  if (pathname === "/api/ai" && req.method === "POST") return handleAI(req, res);
  if (pathname === "/api/admin/users" && req.method === "GET") {
    if (!isAdmin(req)) return sendJson(res, { ok: false, msg: "需要管理员权限" });
    return sendJson(res, { ok: true, users: listUsers() });
  }
  if (pathname === "/api/admin/load" && req.method === "GET") {
    if (!isAdmin(req)) return sendJson(res, { ok: false, msg: "需要管理员权限" });
    const uid = (new URL(req.url, "http://x").searchParams.get("uid") || "").replace(/[^A-Za-z0-9_.-]/g, "_");
    if (!uid) return sendJson(res, { ok: false, msg: "缺少 uid" });
    const d = readJsonOrNull(path.join(DATA_DIR, "data-" + uid + ".json"));
    return sendJson(res, { ok: true, uid: uid, data: d });
  }
  if (pathname === "/api/admin/save" && req.method === "POST") {
    if (!isAdmin(req)) return sendJson(res, { ok: false, msg: "需要管理员权限" });
    let b = "";
    req.on("data", c => { b += c; if (b.length > 3145728) req.destroy(); });
    req.on("end", () => {
      try {
        const p = JSON.parse(b || "{}");
        const uid = String(p.uid || "").replace(/[^A-Za-z0-9_.-]/g, "_");
        if (!uid || !p.data) { sendJson(res, { ok: false, msg: "参数错误" }); return; }
        const s2 = JSON.stringify(p.data);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const f = path.join(DATA_DIR, "data-" + uid + ".json");
        fs.writeFileSync(f + ".tmp", s2);
        fs.renameSync(f + ".tmp", f);
        try { fs.chmodSync(f, 0o666); } catch (e) {}
        console.log(new Date().toISOString() + " [admin-save] by=" + getUser(req) + " uid=" + uid + " bytes=" + s2.length);
        sendJson(res, { ok: true });
      } catch (e) { sendJson(res, { ok: false, msg: "保存失败" }); }
    });
    return;
  }
  if (pathname.startsWith("/api/")) { send(res, 404, "application/json; charset=utf-8", '{"ok":false,"msg":"not found"}'); return; }
  serveStatic(req, res, pathname);
});

server.on("error", err => {
  console.error("服务启动失败: " + err.message);
  process.exit(1);
});

if (SOCKET) {
  try { fs.rmSync(SOCKET, { force: true }); } catch (e) {}
  server.listen(SOCKET, () => {
    console.log("学习空间网关服务已启动 (unix socket " + SOCKET + ")");
  });
} else {
  server.listen(PORT, "0.0.0.0", () => {
    console.log("学习空间服务已启动，端口 " + PORT);
  });
}
