// Ayudas para sprites pixel: un mapa de texto se convierte en un canvas.

export function spriteFrom(map: string[], colors: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = map[0].length;
  c.height = map.length;
  const g = c.getContext("2d")!;
  map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = colors[ch];
      if (!color) return;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}
