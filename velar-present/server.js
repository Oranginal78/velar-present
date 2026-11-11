// VELAR Present — glisser une prez (export web .html ou .zip), obtenir un lien partageable.
// Admin : /admin (mot de passe = variable ADMIN_PASSWORD)   Public : /<slug>
const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const DECKS = path.join(DATA, "decks");
const TMP = path.join(DATA, "tmp");
const PASS = process.env.ADMIN_PASSWORD || "";
// Lien admin secret : /admin-<ADMIN_TOKEN> (sans mot de passe). Sans ADMIN_TOKEN, on garde /admin + mot de passe.
const TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 1024);
const RESERVED = new Set(["admin", "api", "d", "assets", "favicon.ico", "robots.txt"]);

fs.mkdirSync(DECKS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// ---------- helpers ----------
const slugify = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const deckDir = (slug) => path.join(DECKS, slug);
const metaPath = (slug) => path.join(deckDir(slug), "_velar.json");

function readMeta(slug) {
  try { return JSON.parse(fs.readFileSync(metaPath(slug), "utf8")); } catch { return null; }
}

function listDecks() {
  return fs.readdirSync(DECKS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readMeta(d.name))
    .filter(Boolean)
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function uniqueSlug(base) {
  let s = base, i = 2;
  while (fs.existsSync(deckDir(s)) || RESERVED.has(s)) s = `${base}-${i++}`;
  return s;
}

function findEntry(dir) {
  // index.html le moins profond, sinon le premier .html trouvé
  const htmls = [];
  (function walk(d, depth) {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.html?$/i.test(e.name)) htmls.push({ rel: path.relative(dir, p), depth, index: /^index\.html?$/i.test(e.name) });
    }
  })(dir, 0);
  htmls.sort((a, b) => (b.index - a.index) || (a.depth - b.depth));
  return htmls[0] ? htmls[0].rel.split(path.sep).join("/") : null;
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// ---------- auth (admin uniquement) ----------
const sameSecret = (x, y) => {
  const a = Buffer.from(String(x || "")), b = Buffer.from(String(y || ""));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
};

function auth(req, res, next) {
  if (TOKEN && sameSecret(req.get("x-velar-admin"), TOKEN)) return next();
  if (TOKEN && !PASS) return res.status(401).json({ error: "Accès réservé à VELAR." });
  if (!PASS) return res.status(500).send("ADMIN_PASSWORD n'est pas défini sur le serveur.");
  const [type, value] = (req.headers.authorization || "").split(" ");
  if (type === "Basic" && value) {
    const decoded = Buffer.from(value, "base64").toString();
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    const a = Buffer.from(pass), b = Buffer.from(PASS);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="VELAR Present", charset="UTF-8"').status(401).send("Accès réservé à VELAR.");
}

// ---------- admin ----------
const upload = multer({ dest: TMP, limits: { fileSize: MAX_MB * 1024 * 1024 } });

const sendAdmin = (res) => {
  res.set({ "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" });
  res.sendFile(path.join(__dirname, "public", "admin.html"));
};
if (TOKEN) {
  app.get("/admin-:token", (req, res, next) => (sameSecret(req.params.token, TOKEN) ? sendAdmin(res) : next()));
} else {
  app.get("/admin", auth, (req, res) => sendAdmin(res));
}
app.get("/api/decks", auth, (req, res) => res.json(listDecks()));

app.post("/api/decks", auth, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Aucun fichier reçu." });
  const original = file.originalname || "prez";
  const ext = path.extname(original).toLowerCase();
  const title = (req.body.title || "").trim() || path.basename(original, ext);
  let base = slugify(req.body.slug) || slugify(title) || "prez";
  if (RESERVED.has(base)) base = `${base}-prez`;
  const replace = req.body.replace === "1" && fs.existsSync(deckDir(base)) && !RESERVED.has(base);
  const slug = replace ? base : uniqueSlug(base);
  const dir = deckDir(slug);
  try {
    if (replace) rmrf(dir);
    fs.mkdirSync(dir, { recursive: true });
    let entry;
    if (ext === ".html" || ext === ".htm") {
      fs.renameSync(file.path, path.join(dir, "index.html"));
      entry = "index.html";
    } else if (ext === ".zip") {
      const zip = new AdmZip(file.path);
      for (const z of zip.getEntries()) {
        const target = path.resolve(dir, z.entryName);
        if (!target.startsWith(path.resolve(dir) + path.sep)) continue; // anti zip-slip
        if (z.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, z.getData());
      }
      fs.rmSync(file.path, { force: true });
      entry = findEntry(dir);
      if (!entry) { rmrf(dir); return res.status(400).json({ error: "Aucun fichier .html dans le zip." }); }
    } else {
      fs.rmSync(file.path, { force: true }); rmrf(dir);
      return res.status(400).json({ error: "Format accepté : .html ou .zip (export web de la prez)." });
    }
    const meta = { slug, title, entry, created: new Date().toISOString(), size: file.size };
    fs.writeFileSync(metaPath(slug), JSON.stringify(meta, null, 2));
    res.json({ ...meta, url: `${req.protocol}://${req.get("host")}/${slug}` });
  } catch (e) {
    fs.rmSync(file.path, { force: true }); rmrf(dir);
    res.status(500).json({ error: "Import impossible : " + e.message });
  }
});

app.delete("/api/decks/:slug", auth, (req, res) => {
  const slug = slugify(req.params.slug);
  if (!slug || !readMeta(slug)) return res.status(404).json({ error: "Introuvable." });
  rmrf(deckDir(slug));
  res.json({ ok: true });
});

// ---------- public ----------
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), { maxAge: "7d" }));
app.use("/d", (req, res, next) => (/\/_velar\.json$/.test(req.path) ? res.status(404).end() : next()),
  express.static(DECKS, { index: false, dotfiles: "deny", maxAge: "1h" }));

app.get("/robots.txt", (req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));

app.get("/", (req, res) => res.send(page("VELAR", `
  <main style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px">
    <img src="/assets/velar-logo-white.png" alt="VELAR" style="width:220px">
    <p style="letter-spacing:.18em;font-size:12px;opacity:.6">CGI · ART DIRECTION · MOTION DESIGN</p>
  </main>`)));

app.get("/:slug", (req, res, next) => {
  const slug = slugify(req.params.slug);
  const meta = slug && readMeta(slug);
  if (!meta) return next();
  const host = `${req.protocol}://${req.get("host")}`;
  const src = `/d/${slug}/${meta.entry.split("/").map(encodeURIComponent).join("/")}`;
  res.send(page(`VELAR — ${meta.title}`, `
  <header>
    <a href="/" aria-label="VELAR"><img src="/assets/velar-logo-white.png" alt="VELAR"></a>
    <span class="t">${esc(meta.title)}</span>
    <button id="fs" type="button" aria-label="Plein écran">Plein écran ↗</button>
  </header>
  <iframe id="deck" src="${src}" title="${esc(meta.title)}" allow="fullscreen; autoplay" allowfullscreen></iframe>
  <script>
    var f=document.getElementById('deck'),b=document.getElementById('fs');
    b.onclick=function(){var el=document.documentElement;(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el);};
    if(!(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen))b.style.display='none';
  </script>`, {
    "og:title": `VELAR — ${meta.title}`,
    "og:description": "Présentation VELAR Studio",
    "og:image": `${host}/assets/og.png`,
    "og:url": `${host}/${slug}`,
  }));
});

app.use((req, res) => res.status(404).send(page("VELAR — introuvable", `
  <main style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px">
    <img src="/assets/velar-logo-white.png" alt="VELAR" style="width:160px">
    <p style="opacity:.7">Cette présentation n'existe pas ou a été retirée.</p>
  </main>`)));

function page(title, body, og = {}) {
  const metas = Object.entries(og).map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`).join("\n  ");
  return `<!doctype html>
<html lang="fr"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  ${metas}
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/favicon.png">
  <style>
    html,body{margin:0;height:100%;background:#070808;color:#f4f4f1;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
    body{display:flex;flex-direction:column}
    header{height:48px;flex:none;display:flex;align-items:center;gap:16px;padding:0 16px;border-bottom:1px solid #1d1f21}
    header img{height:22px;display:block}
    header .t{flex:1;font-size:13px;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.8}
    header button{background:none;border:1px solid #3a3d40;color:#f4f4f1;font:inherit;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:7px 12px;cursor:pointer}
    header button:hover{border-color:#f4f4f1}
    iframe{flex:1;width:100%;border:0;background:#070808}
    @media (max-width:600px){header{height:42px;padding:0 12px}header .t{font-size:11px}header button{display:none}}
  </style>
</head><body>${body}</body></html>`;
}

app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Fichier trop lourd (max ${MAX_MB} Mo).` });
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

app.listen(PORT, () => console.log(`VELAR Present sur :${PORT} — données dans ${DATA}`));
