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
    description: "El crupier se lleva tus fichas al pozo.",
    ready: true,
    create: () => new Mesa(),
  },
  {
    id: "pildora",
    name: "Píldora",
    description: "Una fila mínima para jugar.",
    ready: true,
    create: () => new Pildora(),
  },
  {
    id: "tragamonedas",
    name: "Tragamonedas",
    description: "Tres rodillos y la palanca.",
    ready: true,
    create: () => new Tragamonedas(),
  },
  {
    id: "pachinko",
    name: "Pachinko",
    description: "Cada bola que cae suma una ficha.",
    ready: true,
    create: () => new Pachinko(),
  },
];

export function createDesign(id: DesignId): Design {
  const info = DESIGN_LIST.find((d) => d.id === id && d.ready) ?? DESIGN_LIST[0];
  return info.create();
}
