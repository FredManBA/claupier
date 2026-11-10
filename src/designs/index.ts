import type { DesignId } from "../core/types";
import type { Design, DesignInfo } from "./design";
import { Mesa } from "./mesa";

export const DESIGN_LIST: DesignInfo[] = [
  {
    id: "mesa",
    name: "Mesa",
    description: "El crupier se lleva tus fichas al pozo.",
    ready: true,
    create: () => new Mesa(),
  },
  {
    id: "pildora",
    name: "Píldora",
    description: "Una fila mínima para jugar.",
    ready: false,
    create: () => new Mesa(),
  },
  {
    id: "tragamonedas",
    name: "Tragamonedas",
    description: "Tres rodillos y la palanca.",
    ready: false,
    create: () => new Mesa(),
  },
  {
    id: "pachinko",
    name: "Pachinko",
    description: "Las bolas son tus tokens.",
    ready: false,
    create: () => new Mesa(),
  },
];

export function createDesign(id: DesignId): Design {
  const info = DESIGN_LIST.find((d) => d.id === id && d.ready) ?? DESIGN_LIST[0];
  return info.create();
}
