import { useRecipesStore } from "../model/store";
import { ItemIcon } from "./ItemIcon";

/**
 * One crafting slot. `ids` are alternatives (cycled by the shared `tick`); empty = blank slot.
 * Click → recipes of the shown item, right-click → uses.
 */
export function Slot({
  ids,
  tag,
  count = 1,
  tick,
  big = false,
}: {
  ids: string[];
  tag?: string;
  count?: number;
  tick: number;
  big?: boolean;
}) {
  const id = ids.length ? ids[tick % ids.length] : null;
  const store = useRecipesStore.getState();
  const name = useRecipesStore((s) => (id ? s.lookup?.itemsById.get(id)?.name : undefined));
  return (
    <div
      className={`rcp-slot${big ? " is-big" : ""}${id ? "" : " is-empty"}${ids.length > 1 ? " is-multi" : ""}`}
      role={id ? "button" : undefined}
      aria-label={name}
      onMouseEnter={id ? () => store.setTip({ id, tag }) : undefined}
      onMouseLeave={id ? () => store.setTip(null) : undefined}
      onClick={id ? () => store.open(id, "recipes") : undefined}
      onContextMenu={
        id
          ? (e) => {
              e.preventDefault();
              store.open(id, "uses");
            }
          : undefined
      }
    >
      {id ? <ItemIcon id={id} size={32} hot /> : null}
      {id && count > 1 ? <span className="rcp-slot-count">{count}</span> : null}
    </div>
  );
}
