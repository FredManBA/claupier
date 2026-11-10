import type { DesignId } from "../core/types";
import type { Design, DesignInfo } from "./design";
import { Mesa } from "./mesa";
import { Pachinko } from "./pachinko";
import { Pildora } from "./pildora";
import { Tragamonedas } from "./tragamonedas";

export const DESIGN_LIST: DesignInfo[] = [
  {
    id: "mesa",
    name: "Mesa",
    description: "Tu banca de 5 h en fichas y el gasto en el pozo.",
    create: () => new Mesa(),
  },
  {
    id: "pildora",
    name: "Píldora",
    description: "Una fila mínima para dejar encima de un juego.",
    create: () => new Pildora(),
  },
  {
    id: "tragamonedas",
    name: "Tragamonedas",
    description: "Cada dólar es una moneda; cada $100, una bolsa.",
    create: () => new Tragamonedas(),
  },
  {
    id: "pachinko",
    name: "Pachinko",
    description: "Las bolas se quedan en la casilla de su valor.",
    create: () => new Pachinko(),
  },
];

export function createDesign(id: DesignId): Design {
  const info = DESIGN_LIST.find((d) => d.id === id) ?? DESIGN_LIST[0];
  return info.create();
}
