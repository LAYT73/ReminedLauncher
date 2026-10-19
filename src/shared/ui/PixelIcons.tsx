/** 7×7 pixel "X" used by the cancel / discard buttons. */
const CROSS: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [6, 0],
  [5, 1],
  [4, 2],
  [2, 4],
  [1, 5],
  [0, 6],
];

export function PixelCrossIcon({ color = "#fff" }: { color?: string }) {
  return (
    <svg className="btn-pixel-icon" viewBox="0 0 7 7" aria-hidden>
      {CROSS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={color} />
      ))}
    </svg>
  );
}

/** 11×9 pixel check mark used by the username "save" button. */
const CHECK: Array<[number, number]> = [
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
  [4, 6],
  [5, 5],
  [6, 4],
  [7, 3],
  [8, 2],
  [9, 1],
  [10, 0],
];

export function PixelCheckIcon() {
  return (
    <svg className="btn-pixel-icon" viewBox="0 0 11 9" aria-hidden>
      {CHECK.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#fff" />
      ))}
    </svg>
  );
}
