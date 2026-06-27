import type { Classification, ConfirmEdits, RelatedItem, SaveMode, SavePlan } from "@omni-catcher/shared";

const VALID_MODES: SaveMode[] = ["new", "merge", "collection"];

export function normalizeSavePlan(
  value: unknown,
  relatedItems: RelatedItem[],
  mergePreview: Classification["mergePreview"],
): SavePlan | null {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const mode = String(raw.mode || "").trim().toLowerCase() as SaveMode;
    if (!VALID_MODES.includes(mode)) return savePlanFromMergePreview(mergePreview, relatedItems);
    const bodyPreview = String(raw.bodyPreview || "").trim();
    if (!bodyPreview && mode !== "new") return savePlanFromMergePreview(mergePreview, relatedItems);
    const rawTargetItemId = String(raw.targetItemId || "").trim();
    const noteTarget = resolveNoteTarget(relatedItems, rawTargetItemId);
    const targetTitle = String(raw.targetTitle || noteTarget?.title || "").trim();
    const insertHeading = String(raw.insertHeading || "").trim() || undefined;
    const reason = String(raw.reason || "").trim() || defaultReason(mode, noteTarget);
    if (mode === "merge" && !noteTarget?.id) return savePlanFromMergePreview(mergePreview, relatedItems);
    if (mode === "collection" && !noteTarget?.id && !targetTitle && !bodyPreview) {
      return savePlanFromMergePreview(mergePreview, relatedItems);
    }
    return {
      mode,
      targetItemId: mode === "merge" || mode === "collection" ? noteTarget?.id : undefined,
      targetTitle: targetTitle || undefined,
      insertHeading,
      reason,
      bodyPreview: bodyPreview || mergePreview?.insertedContent || "",
    };
  }
  return savePlanFromMergePreview(mergePreview, relatedItems);
}

export function savePlanFromMergePreview(
  mergePreview: Classification["mergePreview"],
  relatedItems: RelatedItem[] = [],
): SavePlan | null {
  if (!mergePreview) return null;
  const inserted = mergePreview.insertedContent.trim();
  if (!inserted && !mergePreview.targetItemId && !mergePreview.targetTitle) return null;
  if (mergePreview.targetItemId) {
    const target = resolveNoteTarget(relatedItems, mergePreview.targetItemId);
    if (!target) return null;
    return {
      mode: target.isCollection ? "collection" : "merge",
      targetItemId: target.id,
      targetTitle: mergePreview.targetTitle || target.title,
      reason: target.isCollection
        ? `Extend collection (${target.reason})`
        : `Merge into related item (${target.reason})`,
      bodyPreview: inserted || mergePreview.targetTitle,
    };
  }
  if (mergePreview.targetTitle && inserted) {
    return {
      mode: "collection",
      targetTitle: mergePreview.targetTitle,
      reason: "Create a collection-style note",
      bodyPreview: inserted,
    };
  }
  return null;
}

export function syncMergePreviewFromSavePlan(savePlan: SavePlan | null | undefined): Classification["mergePreview"] {
  if (!savePlan) return null;
  if (savePlan.mode === "new") return null;
  return {
    targetItemId:
      savePlan.mode === "merge" || (savePlan.mode === "collection" && savePlan.targetItemId) ?
        savePlan.targetItemId
      : undefined,
    targetTitle: savePlan.targetTitle || "",
    existingContent: "",
    insertedContent: savePlan.bodyPreview,
  };
}

export function withDeterministicSavePlan(classification: Classification): Classification {
  if (classification.savePlan?.targetItemId || classification.primaryIntent !== "note") {
    return classification;
  }
  const exact = (classification.relatedItems || []).find(
    (item) =>
      item.type === "note" &&
      (item.reason === "same-url" ||
        item.reason === "same-doi" ||
        item.reason === "same-arxiv" ||
        item.reason === "same-title"),
  );
  if (!exact) return classification;
  const savePlan: SavePlan = {
    mode: exact.isCollection ? "collection" : "merge",
    targetItemId: exact.id,
    targetTitle: exact.title,
    insertHeading: exact.isCollection ? exact.insertHeadings?.[0] : undefined,
    reason: `Deterministic match: ${exact.reason}`,
    bodyPreview: classification.summary || classification.title,
  };
  return {
    ...classification,
    savePlan,
    mergePreview: syncMergePreviewFromSavePlan(savePlan),
  };
}

export function resolveEffectiveSavePlan(
  classification: Classification,
  edits: ConfirmEdits,
  intent: string,
): SavePlan | null {
  if (intent !== "note") return null;
  const base = classification.savePlan || savePlanFromMergePreview(classification.mergePreview, classification.relatedItems);
  const mode = (edits.saveMode || base?.mode || "new") as SaveMode;
  if (mode === "new") {
    const bodyPreview = edits.bodyPreview?.trim() || base?.bodyPreview || "";
    if (!bodyPreview) return { mode: "new", reason: "Create new item", bodyPreview: "" };
    return { mode: "new", reason: base?.reason || "Create new item", bodyPreview };
  }
  const targetItemId = edits.targetItemId?.trim() || base?.targetItemId;
  const targetTitle = base?.targetTitle;
  const insertHeading = edits.insertHeading?.trim() || base?.insertHeading;
  const bodyPreview = edits.bodyPreview?.trim() || base?.bodyPreview || classification.summary || "";
  if (mode === "merge") {
    const target = resolveNoteTarget(classification.relatedItems || [], targetItemId || "");
    if (!target?.id) return base?.mode === "merge" ? base : { mode: "new", reason: "Create new item", bodyPreview };
    return {
      mode: "merge",
      targetItemId: target.id,
      targetTitle: target.title || targetTitle,
      insertHeading,
      reason: base?.reason || "Merge into existing document",
      bodyPreview,
    };
  }
  if (mode === "collection") {
    const target = resolveNoteTarget(classification.relatedItems || [], targetItemId || "");
    return {
      mode: "collection",
      targetItemId: target?.id,
      targetTitle: edits.title?.trim() || target?.title || targetTitle || classification.title,
      insertHeading,
      reason: base?.reason || (target ? "Extend collection note" : "Create collection note"),
      bodyPreview,
    };
  }
  return base;
}

/** Insert markdown body under a heading; append a new section when the heading is missing. */
export function insertAtHeading(body: string, insertHeading: string | undefined, incomingBody: string): string {
  const incoming = incomingBody.trim();
  if (!incoming) return body.trimEnd();
  const trimmedBody = body.trimEnd();
  const heading = insertHeading?.trim();
  if (!heading) return `${trimmedBody}\n\n${incoming}\n`;
  const lines = trimmedBody.split("\n");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, "i");
  let sectionStart = -1;
  let sectionLevel = 2;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]!.match(headingRe);
    if (!match) continue;
    sectionStart = i;
    sectionLevel = match[1]!.length;
    break;
  }
  if (sectionStart === -1) {
    return `${trimmedBody}\n\n## ${heading}\n\n${incoming}\n`;
  }
  let insertAt = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const match = lines[i]!.match(/^(#{1,6})\s+/);
    if (match && match[1]!.length <= sectionLevel) {
      insertAt = i;
      break;
    }
  }
  const before = lines.slice(0, insertAt).join("\n").trimEnd();
  const after = lines.slice(insertAt).join("\n").trimStart();
  const merged = after ? `${before}\n\n${incoming}\n\n${after}` : `${before}\n\n${incoming}`;
  return `${merged.trimEnd()}\n`;
}

function resolveNoteTarget(relatedItems: RelatedItem[], rawTargetItemId: string): RelatedItem | undefined {
  if (!rawTargetItemId) return undefined;
  const target = relatedItems.find((item) => item.id === rawTargetItemId);
  return target?.type === "note" ? target : undefined;
}

function defaultReason(mode: SaveMode, target: RelatedItem | undefined): string {
  if (mode === "merge") return target ? `Merge into ${target.title}` : "Merge into existing document";
  if (mode === "collection") {
    return target ? `Extend collection ${target.title}` : "Create a collection-style note";
  }
  return "Create a new item";
}
