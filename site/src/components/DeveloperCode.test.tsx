import {act} from "react";
import {createRoot} from "react-dom/client";

import {CodeLines} from "./DeveloperCode";

it.each([
  ["curl", "curl --get 'https://example.test' # request", ["keyword", "string", "comment"]],
  ["javascript", 'const page = await fetch("/api"); // request', ["keyword", "function", "string", "comment"]],
  ["python", 'with urlopen(url) as response: print("ready")', ["keyword", "function", "string"]],
  ["r", 'if (ready) print("ready")', ["keyword", "function", "string"]],
  ["json", '{"items": [true, 12, "lima"]}', ["property", "literal", "string"]],
] as const)("highlights %s without changing its source text", async (language, value, tokenKinds) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(
    <CodeLines label={`${language} example`} language={language} value={value} />,
  ));

  expect(container.querySelector(".code-lines__text")).toHaveTextContent(value);
  tokenKinds.forEach((kind) => {
    expect(container.querySelector(`.code-token--${kind}`)).not.toBeNull();
  });

  await act(async () => root.unmount());
  container.remove();
});
