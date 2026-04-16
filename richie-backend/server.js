import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PHOTON_URL = "https://photon.komoot.io";

// Bias center: Charlottetown
const BIAS_LAT = Number(process.env.BIAS_LAT || "46.2382");
const BIAS_LON = Number(process.env.BIAS_LON || "-63.1311");

// Hard filters (default: PEI only)
const ONLY_CANADA = (process.env.ONLY_CANADA || "1") === "1";
const ONLY_PEI = (process.env.ONLY_PEI || "1") === "1";

// Ranking preference (NOT a filter)
const PREFER_CHARLOTTETOWN = (process.env.PREFER_CHARLOTTETOWN || "1") === "1";

function normalizeQuery(s) {
  return (s || "").trim().replace(/\s+/g, " ");
}
function normalizePostal(s) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function extractCanadianPostal(text) {
  const m = (text || "")
    .toUpperCase()
    .match(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d\b/);
  if (!m) return null;
  return normalizePostal(m[0]);
}

function makeLabel(p) {
  // Keep it short + address-like
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(" ").trim();
  const city = p.city || p.locality;
  const postcode = p.postcode;
  const parts = [streetLine || null, city || null, postcode || null].filter(Boolean);
  return parts.join(", ");
}

function isCanada(p) {
  const cc = (p.countrycode || "").toUpperCase();
  if (cc) return cc === "CA";
  const c = (p.country || "").toLowerCase();
  return c.includes("canada");
}

function isPEI(p) {
  const state = (p.state || "").toLowerCase();

  if (state.includes("prince edward island")) return true;
  if (state === "pei" || state === "pe") return true;

  // Correct PEI postal prefixes:
  const pc = normalizePostal(p.postcode || "");
  if (pc.startsWith("C0A") || pc.startsWith("C0B") || pc.startsWith("C0C") || pc.startsWith("C1A") || pc.startsWith("C1B")) {
    return true;
  }

  // If Photon didn’t provide state/postcode well, don’t auto-fail here.
  return false;
}

function looksDeliverable(label, postcode) {
  // if it has a postal, good
  if (postcode) return true;

  const s = (label || "").toLowerCase();

  const hasNumber = /\d/.test(s);
  const hasStreetWord =
    /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|cres|crescent|way|pl|place|ter|terrace|hwy|highway)\b/.test(s);

  // reject pure area names
  const pureArea =
    (s.includes("charlottetown") || s.includes("prince edward") || s === "pei") && !hasNumber && !hasStreetWord;

  if (pureArea) return false;

  return hasNumber || hasStreetWord;
}

function scoreSuggestion(s) {
  let score = 0;

  if (s.postcode) score += 50;

  if (PREFER_CHARLOTTETOWN) {
    const city = (s.city || "").toLowerCase();
    const label = (s.label || "").toLowerCase();
    if (city.includes("charlottetown")) score += 30;
    else if (label.includes("charlottetown")) score += 15;
  }

  const l = (s.label || "").toLowerCase();
  if (/\d/.test(l)) score += 10;
  if (/\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|cres|crescent|way|pl|place|ter|terrace|hwy|highway)\b/.test(l)) {
    score += 8;
  }

  score += Math.max(0, 20 - Math.min(20, (s.label?.length || 0) / 10));

  return score;
}

app.get("/api/address/autocomplete", async (req, res) => {
  const q = normalizeQuery(req.query.q);
  if (q.length < 3) return res.json({ suggestions: [] });

  const url =
    `${PHOTON_URL}/api/?q=${encodeURIComponent(q)}` +
    `&limit=30` +
    `&lat=${encodeURIComponent(String(BIAS_LAT))}` +
    `&lon=${encodeURIComponent(String(BIAS_LON))}`;

  try {
    const r = await fetch(url, { headers: { "User-Agent": "RichieDelivery/1.0" } });
    if (!r.ok) return res.status(502).json({ error: "photon failed" });

    const data = await r.json();

    let suggestions = (data.features || [])
      .map((f) => {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates || [];
        const lng = coords[0];
        const lat = coords[1];

        const label = makeLabel(p);
        if (!label || typeof lat !== "number" || typeof lng !== "number") return null;

        const postcode = p.postcode ? normalizePostal(p.postcode) : extractCanadianPostal(label);

        return {
          id: `${p.osm_type}:${p.osm_id}`,
          label,
          lat,
          lng,
          postcode: postcode || null,
          countrycode: p.countrycode || null,
          country: p.country || null,
          state: p.state || null,
          city: p.city || p.locality || null,
        };
      })
      .filter(Boolean);

    if (ONLY_CANADA) suggestions = suggestions.filter((s) => isCanada(s));

    // IMPORTANT: only apply PEI filter if it can actually decide.
    // If isPEI() returns false because missing data, don’t kill it.
    if (ONLY_PEI) {
      suggestions = suggestions.filter((s) => {
        // if we can positively identify PEI -> true
        if (isPEI(s)) return true;

        // if query looks like a specific street address, allow it through (Photon sometimes misses state)
        const l = (s.label || "").toLowerCase();
        const likelyStreet = /\d/.test(l) && /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cres|crescent|way|pl|place)\b/.test(l);
        return likelyStreet;
      });
    }

    suggestions = suggestions.filter((s) => looksDeliverable(s.label, s.postcode));

    suggestions.sort((a, b) => scoreSuggestion(b) - scoreSuggestion(a));

    return res.json({ suggestions: suggestions.slice(0, 8) });
  } catch {
    return res.status(500).json({ error: "autocomplete failed" });
  }
});

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
  console.log(
    `Bias: ${BIAS_LAT}, ${BIAS_LON} | ONLY_CANADA=${ONLY_CANADA} ONLY_PEI=${ONLY_PEI} PREFER_CHARLOTTETOWN=${PREFER_CHARLOTTETOWN}`
  );
});
