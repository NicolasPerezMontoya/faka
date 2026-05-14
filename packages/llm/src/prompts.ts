import type { AnchorProduct, CandidateProduct } from "./types.js";

// Versioned arbiter prompt. Bump V<n> append-only; never edit existing
// versions — testability + reproducibility per AI-05 spirit.
export const ARBITER_PROMPT_V1 = {
  version: "v1" as const,
  system: `Eres un experto en catálogos de productos de retail en Colombia.
Tu tarea: decidir si dos descripciones de producto se refieren al MISMO producto físico
(ignorando diferencias de formato, mayúsculas, acentos, marcas redundantes y atributos
de listado como "envío gratis" o "garantía").

Responde SIEMPRE en JSON estricto con tres campos:
- "isMatch": boolean
- "confidence": float 0-1
- "rationale": string (1-2 frases, en español, conciso)

NO incluyas texto fuera del JSON.`,
  user: (a: AnchorProduct, b: CandidateProduct): string => {
    return `Producto A (canal: ${a.channel ?? "desconocido"}):
  Nombre: ${a.name}
  Marca: ${a.brand ?? "(sin marca)"}
  Categoría: ${a.category ?? "(sin categoría)"}
  Precio: ${a.price ?? "(sin precio)"} COP

Producto B (canal: ${b.channel ?? "desconocido"}):
  Nombre: ${b.name}
  Marca: ${b.brand ?? "(sin marca)"}
  Categoría: ${b.category ?? "(sin categoría)"}
  Precio: ${b.price ?? "(sin precio)"} COP

¿Son el mismo producto físico?`;
  },
};
