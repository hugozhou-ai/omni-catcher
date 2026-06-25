import type { ReactNode } from "react";
import type { LibrarySelection } from "./libraryNavigation.js";
import { CollectionPanel } from "./CollectionPanel.js";
import { TodoPanel } from "../todo/TodoPanel.js";

export function LibraryPanel(props: {
  selection: LibrarySelection;
  onSelectItem: (itemId: string | null) => void;
}): ReactNode {
  const { selection, onSelectItem } = props;

  if (selection.category === "todo") {
    return <TodoPanel selectedItemId={selection.itemId} onSelectItem={onSelectItem} />;
  }

  return (
    <CollectionPanel
      type={selection.category}
      selectedItemId={selection.itemId}
      onSelectItem={onSelectItem}
    />
  );
}
