// Port de fuentes.py + pokemon.py. Las imágenes se piden DESDE EL NAVEGADOR a APIs públicas (con CORS) y se muestran
// con <img src=url>; no se descargan ni se guardan archivos. Los metadatos vistos se recuerdan para usarlos sin internet.
import type { Content } from "../types";
import { ls } from "./store";

export type Src = Content & { cry?: string | null };

export const PACKS: Record<string, [string, string]> = {
  "Pokémon": ["⚡", "#f7d02c"], Gatitos: ["🐱", "#fbbf24"], Perritos: ["🐶", "#e2bf65"], Zorros: ["🦊", "#ee8130"],
  Arte: ["🎨", "#a98ff3"], Espacio: ["🚀", "#6390f0"], "Dragon Ball": ["🐉", "#fb923c"],
  Estiramientos: ["🤸", "#6ee7b7"], Frases: ["💬", "#93f0cb"], Respira: ["🌬️", "#7dd3fc"],
};
export const PACK_NAMES = Object.keys(PACKS);
export const ART_PACKS = ["Pokémon", "Pokémon", "Gatitos", "Perritos", "Zorros", "Arte", "Espacio", "Dragon Ball"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function getJson<T = any>(url: string, ms = 5000): Promise<T> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}
const clean = (x: unknown) => String(x).replace(/\W/g, "").slice(0, 40) || "x";
const mk = (pack: string, id: unknown, art_url: string, title: string, text: string, credit: string, extra: Partial<Src> = {}): Src =>
  ({ pack, id: clean(id), name: title, title, text, art_url, color: PACKS[pack][1], credit, breathe: false, ...extra });

// ------------------------------------------------------------------ proveedores (ninguno pide clave)
const PROVIDERS: Record<string, () => Promise<Src>> = {
  async Gatitos() {
    const [it] = await getJson("https://api.thecatapi.com/v1/images/search");
    return mk("Gatitos", it.id, it.url, "¡Un gatito te avisa!", "", "TheCatAPI");
  },
  async Perritos() {
    const url: string = (await getJson("https://dog.ceo/api/breeds/image/random")).message;
    const breed = url.split("/")[4].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return mk("Perritos", url.split("/").pop()!.split(".")[0], url, "¡Un perrito te avisa!", breed, "Dog CEO");
  },
  async Zorros() {
    const url: string = (await getJson("https://randomfox.ca/floof/")).image;
    return mk("Zorros", url.split("/").pop()!.split(".")[0], url, "¡Un zorrito te avisa!", "", "randomfox.ca");
  },
  async Arte() {
    const q = new URLSearchParams({ q: pick(["landscape", "flowers", "garden", "sea", "mountain", "birds", "sky", "trees", "river"]),
      limit: "20", page: String(1 + Math.floor(Math.random() * 5)), fields: "id,title,artist_title,image_id,is_public_domain" });
    const data = (await getJson("https://api.artic.edu/api/v1/artworks/search?" + q, 6000)).data as any[];   // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = pick(data.filter((x) => x.image_id && x.is_public_domain));
    return mk("Arte", d.id, `https://www.artic.edu/iiif/2/${d.image_id}/full/400,/0/default.jpg`,
      d.title || "Obra de arte", d.artist_title || "", "Art Institute of Chicago");
  },
  async Espacio() {
    const [it] = await getJson("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=1", 8000);
    if (it.media_type !== "image") throw new Error("hoy no es imagen");
    return mk("Espacio", it.date, it.url, it.title, "Foto astronómica", "NASA APOD");
  },
  async "Dragon Ball"() {
    const j = await getJson(`https://dragonball-api.com/api/characters?page=${1 + Math.floor(Math.random() * 5)}&limit=10`, 6000);
    const it = pick(j.items as any[]);   // eslint-disable-line @typescript-eslint/no-explicit-any
    return mk("Dragon Ball", it.id, it.image, it.name, [it.race, it.affiliation].filter(Boolean).join(" · "), "Dragon Ball API");
  },
};

// ------------------------------------------------------------------ memoria para usar sin internet
const cachePut = (pack: string, s: Src) => {
  const arr = ls.get<Src[]>("ps.cache." + pack, []).filter((x) => x.id !== s.id);
  arr.push(s);
  ls.set("ps.cache." + pack, arr.slice(-30));
};
const fromCache = (pack: string): Src | null => { const a = ls.get<Src[]>("ps.cache." + pack, []); return a.length ? pick(a) : null; };

// ------------------------------------------------------------------ Pokémon (PokéAPI)
const SLEEP_POOL = [143, 96, 97, 39, 113];
const TYPE_COLORS: Record<string, string> = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};
async function pokemonContent(net: boolean, sleep: boolean): Promise<Src | null> {
  const pid = sleep ? pick(SLEEP_POOL) : 1 + Math.floor(Math.random() * 905);
  if (net) {
    try {
      const j = await getJson(`https://pokeapi.co/api/v2/pokemon/${pid}`);
      const art = j.sprites?.other?.["official-artwork"]?.front_default || j.sprites?.front_default;
      if (!art) throw new Error("sin imagen");
      const nm = String(j.name).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const type = j.types?.[0]?.type?.name ?? "normal";
      const s = mk("Pokémon", pid, art, `¡${nm} te avisa!`, "", "PokéAPI",
        { name: nm, color: TYPE_COLORS[type] ?? "#6ee7b7", cry: j.cries?.latest || j.cries?.legacy || null });
      cachePut("Pokémon", s);
      return s;
    } catch { /* cae a la memoria */ }
  }
  return fromCache("Pokémon");
}

// ------------------------------------------------------------------ paquetes locales (sin internet)
const STRETCHES: [string, string, string][] = [
  ["🙆", "Estira el cuello", "Inclina la oreja hacia el hombro, 15 segundos por lado."],
  ["🤸", "Abre el pecho", "Entrelaza las manos atrás y abre los hombros, 20 segundos."],
  ["👀", "Regla 20-20-20", "Mira algo a 6 metros durante 20 segundos."],
  ["🔄", "Rota los hombros", "10 círculos hacia atrás, bien lento."],
  ["🖐️", "Cuida tus muñecas", "Abre y cierra las manos 10 veces y gira las muñecas."],
  ["🚶", "Ponte de pie", "Camina un minuto y toma agua."],
  ["🧘", "Espalda larga", "Imagina un hilo que te jala suavemente desde la coronilla."],
  ["💧", "Hidrátate", "Unos sorbos de agua y de vuelta al estudio."],
];
const QUOTES: [string, string, string][] = [
  ["🌱", "Pequeños ajustes", "Un ajuste de dos segundos hoy es una espalda feliz mañana."],
  ["🏆", "Constancia", "No tienes que ser perfecto; solo volver a sentarte bien cada vez."],
  ["🧠", "Cuerpo y mente", "Te concentras mejor cuando tu cuerpo no está peleando contigo."],
  ["⏳", "Descansar rinde", "Un descanso corto ahora te regala atención después."],
  ["🔥", "Vas bien", "Cada vez que corriges, entrenas un hábito que dura años."],
  ["🎯", "Un paso", "Endereza la espalda. Eso es todo. Ya hiciste lo difícil."],
];
const local = (pack: string, items: [string, string, string][]): Src => {
  const [emoji, title, text] = pick(items);
  return { pack, id: clean(title), name: title, title, text, art_url: null, emoji, color: PACKS[pack][1], credit: null, breathe: false };
};

/** Devuelve SIEMPRE un contenido (nunca null): si todo falla, un estiramiento local. */
export async function getContent(pack: string, net = true, sleep = false): Promise<Src> {
  if (pack === "Sorpresa") pack = pick(PACK_NAMES);
  let c: Src | null = null;
  try {
    if (pack === "Pokémon") c = await pokemonContent(net, sleep);
    else if (pack === "Estiramientos") c = local(pack, STRETCHES);
    else if (pack === "Frases") c = local(pack, QUOTES);
    else if (pack === "Respira")
      c = { pack, id: "respira", name: "Respira", title: "Respira conmigo", text: "Inhala 4 s, exhala 4 s. Repite 3 veces.",
        art_url: null, emoji: "🌬️", color: PACKS.Respira[1], credit: null, breathe: true };
    else if (PROVIDERS[pack]) {
      if (net) { try { c = await PROVIDERS[pack](); cachePut(pack, c); } catch { c = null; } }
      c = c ?? fromCache(pack);
    }
  } catch { c = null; }
  return c ?? local("Estiramientos", STRETCHES);
}

export async function notifyPhone(topic: string, msg: string) {
  try { await fetch("https://ntfy.sh/" + encodeURIComponent(topic), { method: "POST", body: msg, headers: { Title: "Pantalla Sana" } }); }
  catch { /* sin internet */ }
}
