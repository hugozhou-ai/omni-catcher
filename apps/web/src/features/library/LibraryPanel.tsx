import type { ReactNode } from "react";
import type { LibrarySelection } from "./libraryNavigation.js";
import { CollectionPanel } from "./CollectionPanel.js";
import { TodoPanel } from "../todo/TodoPanel.js";

export function LibraryPanel(props: {
  selection: LibrarySelection;
  onSelectItem: (itemId: string | null) => void;
  onGoCapture?: () => void;
}): ReactNode {
  const { selection, onSelectItem, onGoCapture } = props;

  if (selection.category === "todo") {
    return (
      <TodoPanel
        selectedItemId={selection.itemId}
        onSelectItem={onSelectItem}
        onGoCapture={onGoCapture}
      />
    );
  }

  return (
    <CollectionPanel
      type={selection.category}
      selectedItemId={selection.itemId}
      onSelectItem={onSelectItem}
      onGoCapture={onGoCapture}
    />
  );
}
