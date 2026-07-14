import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selectValues = await loadTypeScriptModule("apps/web/src/components/selectValue.ts");
const agentTargetOptions = await loadTypeScriptModule("apps/web/src/components/agentTargetOptions.ts");

test("Select encodes every string and number as a distinct non-empty Radix value", () => {
  const values = [
    "",
    "__app_select_empty__",
    "1",
    1,
    0,
    -0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '{"agent":["目标",":{},[]"]}',
    "团队/研究员 🚀\u0000换行\n",
  ];
  const encoded = values.map(selectValues.toRadixSelectValue);

  assert.equal(encoded.every((value) => value.length > 0), true);
  assert.equal(new Set(encoded).size, values.length);
});

test("Select resolves encoded values back to the original option value", () => {
  const options = [
    { value: "", label: "Default" },
    { value: "__app_select_empty__", label: "Sentinel-shaped Agent Target" },
    { value: "1", label: "String one" },
    { value: 1, label: "Number one" },
    { value: '{"id":"代理:一"}', label: "JSON and Unicode" },
  ];

  for (const option of options) {
    const encoded = selectValues.toRadixSelectValue(option.value);
    const matched = selectValues.findSelectOptionByRadixValue(options, encoded);
    assert.equal(matched, option);
    assert.equal(matched.value, option.value);
  }
});

test("Agent Target options keep empty and sentinel-shaped target ids distinct", () => {
  const options = agentTargetOptions.buildAgentTargetOptions(
    [{
      agentTargetId: "__app_select_empty__",
      providerId: "shared-runtime",
      displayName: "Sentinel Agent",
      status: "available",
      runtimeSupported: true,
    }],
    "",
    { defaultOption: "Default", unavailable: "Unavailable" },
  );

  assert.deepEqual(options.map((option) => option.value), ["", "__app_select_empty__"]);
  assert.notEqual(
    selectValues.toRadixSelectValue(options[0].value),
    selectValues.toRadixSelectValue(options[1].value),
  );
});

async function loadTypeScriptModule(relativePath) {
  const result = await build({
    entryPoints: [resolve(root, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
