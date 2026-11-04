import { useEffect, useState } from "react";
import { useRecipesStore } from "../model/store";

/** Lazily rendered item icon in a fixed box (no layout shift while it loads). */
export function ItemIcon({ id, size = 32, hot = false }: { id: string; size?: number; hot?: boolean }) {
  const icons = useRecipesStore((s) => s.icons);
  const [url, setUrl] = useState<string | undefined>(() => icons?.peek(id));

  useEffect(() => {
    if (!icons) return;
    const hit = icons.peek(id);
    if (hit) {
      setUrl(hit);
      return;
    }
    setUrl(undefined);
    return icons.request(id, setUrl, hot);
  }, [icons, id, hot]);

  return (
    <span className="rcp-icon" style={{ width: size, height: size }} aria-hidden>
      {url ? <img src={url} width={size} height={size} alt="" draggable={false} /> : null}
    </span>
  );
}
