#!/usr/bin/env node

const GEOJSON_URL = "https://raw.githubusercontent.com/cihadturhan/tr-geojson/master/geo/tr-cities-utf8.json";

const PROVINCE_TO_REGION = {
  "Edirne": "marmara", "Kırklareli": "marmara", "Tekirdağ": "marmara", "İstanbul": "marmara",
  "Kocaeli": "marmara", "Sakarya": "marmara", "Düzce": "marmara", "Bolu": "marmara",
  "Yalova": "marmara", "Bursa": "marmara", "Bilecik": "marmara", "Çanakkale": "marmara",
  "Balıkesir": "marmara",
  "İzmir": "ege", "Manisa": "ege", "Aydın": "ege", "Denizli": "ege", "Muğla": "ege",
  "Afyonkarahisar": "ege", "Afyon": "ege", "Kütahya": "ege", "Uşak": "ege",
  "Antalya": "akdeniz", "Burdur": "akdeniz", "Isparta": "akdeniz", "Mersin": "akdeniz",
  "Adana": "akdeniz", "Osmaniye": "akdeniz", "Hatay": "akdeniz", "Kahramanmaraş": "akdeniz",
  "Ankara": "ic_anadolu", "Konya": "ic_anadolu", "Eskişehir": "ic_anadolu",
  "Kırşehir": "ic_anadolu", "Kırıkkale": "ic_anadolu", "Çankırı": "ic_anadolu",
  "Kastamonu": "ic_anadolu", "Aksaray": "ic_anadolu", "Nevşehir": "ic_anadolu",
  "Niğde": "ic_anadolu", "Kayseri": "ic_anadolu", "Sivas": "ic_anadolu",
  "Yozgat": "ic_anadolu", "Karaman": "ic_anadolu",
  "Zonguldak": "karadeniz", "Bartın": "karadeniz", "Karabük": "karadeniz",
  "Sinop": "karadeniz", "Samsun": "karadeniz", "Amasya": "karadeniz", "Tokat": "karadeniz",
  "Çorum": "karadeniz", "Ordu": "karadeniz", "Giresun": "karadeniz", "Trabzon": "karadeniz",
  "Rize": "karadeniz", "Artvin": "karadeniz", "Gümüşhane": "karadeniz", "Bayburt": "karadeniz",
  "Erzincan": "dogu_anadolu", "Erzurum": "dogu_anadolu", "Kars": "dogu_anadolu",
  "Iğdır": "dogu_anadolu", "Ağrı": "dogu_anadolu", "Ardahan": "dogu_anadolu",
  "Muş": "dogu_anadolu", "Bingöl": "dogu_anadolu", "Tunceli": "dogu_anadolu",
  "Elazığ": "dogu_anadolu", "Malatya": "dogu_anadolu", "Bitlis": "dogu_anadolu",
  "Van": "dogu_anadolu", "Hakkari": "dogu_anadolu",
  "Gaziantep": "guneydogu", "Adıyaman": "guneydogu", "Şanlıurfa": "guneydogu",
  "Diyarbakır": "guneydogu", "Mardin": "guneydogu", "Batman": "guneydogu",
  "Şırnak": "guneydogu", "Siirt": "guneydogu", "Kilis": "guneydogu",
};

const NAME_TO_ID = {
  "Edirne": "edirne", "Kırklareli": "kirklareli", "Tekirdağ": "tekirdag",
  "İstanbul": "istanbul", "Kocaeli": "kocaeli", "Sakarya": "sakarya",
  "Düzce": "duzce", "Bolu": "bolu", "Yalova": "yalova", "Bursa": "bursa",
  "Bilecik": "bilecik", "Eskişehir": "eskisehir", "Çanakkale": "canakkale",
  "Balıkesir": "balikesir", "Kütahya": "kutahya",
  "Afyonkarahisar": "afyon", "Afyon": "afyon",
  "Manisa": "manisa", "İzmir": "izmir", "Aydın": "aydin", "Denizli": "denizli",
  "Muğla": "mugla", "Burdur": "burdur", "Isparta": "isparta", "Uşak": "usak",
  "Antalya": "antalya", "Konya": "konya", "Ankara": "ankara", "Çankırı": "cankiri",
  "Kastamonu": "kastamonu", "Sinop": "sinop", "Samsun": "samsun", "Amasya": "amasya",
  "Tokat": "tokat", "Çorum": "corum", "Ordu": "ordu", "Giresun": "giresun",
  "Trabzon": "trabzon", "Rize": "rize", "Artvin": "artvin", "Gümüşhane": "gumushane",
  "Bayburt": "bayburt", "Erzincan": "erzincan", "Tunceli": "tunceli",
  "Erzurum": "erzurum", "Kars": "kars", "Iğdır": "igdir", "Ardahan": "ardahan",
  "Ağrı": "agri", "Muş": "mus", "Bingöl": "bingol", "Bitlis": "bitlis",
  "Van": "van", "Hakkari": "hakkari", "Şırnak": "sirnak", "Siirt": "siirt",
  "Batman": "batman", "Mardin": "mardin", "Diyarbakır": "diyarbakir",
  "Elazığ": "elazig", "Malatya": "malatya", "Adıyaman": "adiyaman",
  "Şanlıurfa": "sanliurfa", "Gaziantep": "gaziantep", "Kilis": "kilis",
  "Hatay": "hatay", "Osmaniye": "osmaniye", "Kahramanmaraş": "kahramanmaras",
  "Adana": "adana", "Mersin": "mersin", "Niğde": "nigde", "Aksaray": "aksaray",
  "Nevşehir": "nevsehir", "Kayseri": "kayseri", "Sivas": "sivas",
  "Yozgat": "yozgat", "Kırşehir": "kirsehir", "Karaman": "karaman",
  "Kırıkkale": "kirikkale", "Zonguldak": "zonguldak", "Bartın": "bartin",
  "Karabük": "karabuk",
};

const TARGET_WIDTH = 650;
const TARGET_HEIGHT = 185;
const PADDING = 5;
const MIN_RING_AREA = 0.5;

function projectMercator(lon, lat) {
  const x = lon * (Math.PI / 180);
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  return [x, y];
}

function ringArea(coords) {
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area) / 2;
}

function simplifyRing(coords, tolerance) {
  if (coords.length <= 4) return coords;
  const result = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const prev = result[result.length - 1];
    const dx = coords[i][0] - prev[0];
    const dy = coords[i][1] - prev[1];
    if (Math.sqrt(dx * dx + dy * dy) > tolerance) {
      result.push(coords[i]);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function ringToPath(coords, xScale, yScale, xOff, yOff, padX, padY) {
  return coords.map((c, i) => {
    const [mx, my] = projectMercator(c[0], c[1]);
    const x = (mx - xOff) * xScale + padX;
    const y = (yOff - my) * yScale + padY;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

function polygonCentroid(coords) {
  let maxArea = 0;
  let bestRing = coords[0];
  for (const ring of coords) {
    const a = ringArea(ring.map(c => projectMercator(c[0], c[1])));
    if (a > maxArea) { maxArea = a; bestRing = ring; }
  }
  let cx = 0, cy = 0;
  for (const c of bestRing) {
    const [mx, my] = projectMercator(c[0], c[1]);
    cx += mx; cy += my;
  }
  return [cx / bestRing.length, cy / bestRing.length];
}

async function main() {
  const resp = await fetch(GEOJSON_URL);
  if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
  const geojson = await resp.json();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of geojson.features) {
    const coords = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of coords) {
      for (const ring of poly) {
        for (const c of ring) {
          const [mx, my] = projectMercator(c[0], c[1]);
          if (mx < minX) minX = mx;
          if (mx > maxX) maxX = mx;
          if (my < minY) minY = my;
          if (my > maxY) maxY = my;
        }
      }
    }
  }

  const geoWidth = maxX - minX;
  const geoHeight = maxY - minY;
  const availW = TARGET_WIDTH - PADDING * 2;
  const availH = TARGET_HEIGHT - PADDING * 2;
  const scale = Math.min(availW / geoWidth, availH / geoHeight);

  const contentW = geoWidth * scale;
  const contentH = geoHeight * scale;
  const padX = (TARGET_WIDTH - contentW) / 2;
  const padY = (TARGET_HEIGHT - contentH) / 2;

  const provinces = [];
  const centroids = {};

  for (const f of geojson.features) {
    const name = f.properties.name || f.properties.NAME_1 || f.properties.il_adi;
    if (!name) continue;
    const id = NAME_TO_ID[name];
    if (!id) { console.error(`No ID mapping for: ${name}`); continue; }
    const region = PROVINCE_TO_REGION[name] || "unknown";
    const coords = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;

    let pathD = "";
    for (const poly of coords) {
      for (const ring of poly) {
        const projected = ring.map(c => projectMercator(c[0], c[1]));
        const area = ringArea(projected);
        const svgArea = area * scale * scale;
        if (svgArea < MIN_RING_AREA) continue;
        const simplified = simplifyRing(ring, 0.008);
        pathD += ringToPath(simplified, scale, scale, minX, maxY, padX, padY);
      }
    }

    if (!pathD) continue;

    const allCoords = coords.flatMap(p => p);
    const [centX, centY] = polygonCentroid(allCoords);
    const svgX = (centX - minX) * scale + padX;
    const svgY = (maxY - centY) * scale + padY;

    centroids[id] = { x: Math.round(svgX * 10) / 10, y: Math.round(svgY * 10) / 10 };
    provinces.push({ id, region, d: pathD });
  }

  provinces.sort((a, b) => a.id.localeCompare(b.id));

  const output = [];
  output.push("const PROVINCE_PATHS: { id: string; d: string; region: string }[] = [");
  for (const p of provinces) {
    output.push(`  { id: "${p.id}", region: "${p.region}", d: "${p.d}" },`);
  }
  output.push("];");

  output.push("");
  output.push("const REGION_FILLS: Record<string, string> = {");
  const regionFills = {
    marmara: "#e2e8f0", ege: "#dbeafe", akdeniz: "#fef3c7",
    ic_anadolu: "#f1f5f9", karadeniz: "#dcfce7",
    dogu_anadolu: "#ede9fe", guneydogu: "#fce7f3",
  };
  for (const [k, v] of Object.entries(regionFills)) {
    output.push(`  ${k}: "${v}",`);
  }
  output.push("};");

  const CITY_IDS = [
    "istanbul", "ankara", "izmir", "bursa", "antalya", "adana", "konya",
    "gaziantep", "mersin", "kayseri", "diyarbakir", "samsun", "trabzon",
    "eskisehir", "denizli", "malatya", "erzurum", "van", "manisa", "tekirdag"
  ];

  output.push("");
  output.push("const CITY_POSITIONS: Record<string, { x: number; y: number }> = {");
  for (const cid of CITY_IDS) {
    const pos = centroids[cid];
    if (pos) output.push(`  ${cid}: { x: ${pos.x}, y: ${pos.y} },`);
  }
  output.push("};");

  console.log(output.join("\n"));
  console.error(`Total provinces: ${provinces.length}`);
  console.error(`Total output chars: ${output.join("\n").length}`);

  const unmapped = geojson.features
    .map(f => f.properties.name || f.properties.NAME_1 || f.properties.il_adi)
    .filter(n => n && !NAME_TO_ID[n]);
  if (unmapped.length > 0) console.error(`Unmapped: ${unmapped.join(", ")}`);
}

main().catch(console.error);
