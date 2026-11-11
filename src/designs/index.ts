import { L } from "../core/i18n";
import type { DesignId } from "../core/types";
import type { Design, DesignInfo } from "./design";
import { Mesa } from "./mesa";
import { Pachinko } from "./pachinko";
import { Pildora } from "./pildora";
import { Tragamonedas } from "./tragamonedas";

export const DESIGN_LIST: DesignInfo[] = [
  {
    id: "mesa",
    get name() {
      return L("Mesa", "Table");
    },
    get description() {
      return L("Tu banca de 5 h en fichas y el gasto en el pozo.", "Your 5-hour bank in chips and your spend in the pot.");
    },
    create: () => new Mesa(),
  },
  {
    id: "pildora",
    get name() {
      return L("Píldora", "Pill");
    },
    get description() {
      return L("Una fila mínima para dejar encima de un juego.", "A tiny row to leave on top of a game.");
    },
    create: () => new Pildora(),
  },
  {
    id: "tragamonedas",
    get name() {
      return L("Tragamonedas", "Slot machine");
    },
    get description() {
      return L("El gasto cae en monedas, un color por cada valor.", "Your spend drops as coins, one color per value.");
    },
    create: () => new Tragamonedas(),
  },
  {
    id: "pachinko",
    name: "Pachinko",
    get description() {
      return L("Las bolas se quedan en la casilla de su valor.", "Each ball stays in the pocket of its value.");
    },
    create: () => new Pachinko(),
  },
];

export function createDesign(id: DesignId): Design {
  const info = DESIGN_LIST.find((d) => d.id === id) ?? DESIGN_LIST[0];
  return info.create();
}
