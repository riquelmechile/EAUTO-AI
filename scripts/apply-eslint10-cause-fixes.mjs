import { readFile, writeFile } from "node:fs/promises";

const replacements = [
  {
    path: "packages/content/src/httpContentProvider.ts",
    before: "throw new Error(`Content provider timed out after ${this.config.timeoutMs} ms.`);",
    after:
      "throw new Error(`Content provider timed out after ${this.config.timeoutMs} ms.`, { cause: error });",
  },
  {
    path: "packages/content/src/httpContentProvider.ts",
    before:
      "throw new Error(`Generated asset download timed out after ${this.config.timeoutMs} ms.`);",
    after:
      "throw new Error(`Generated asset download timed out after ${this.config.timeoutMs} ms.`, { cause: error });",
  },
  {
    path: "packages/infrastructure/src/deepSeekGateway.ts",
    before: 'throw new Error("DeepSeek request timed out.");',
    after: 'throw new Error("DeepSeek request timed out.", { cause: error });',
  },
  {
    path: "packages/infrastructure/src/httpActionExecutor.ts",
    before:
      "throw new Error(\n          `Action provider ${operation} timed out after ${this.config.timeoutMs} ms.`,\n        );",
    after:
      "throw new Error(\n          `Action provider ${operation} timed out after ${this.config.timeoutMs} ms.`,\n          { cause: error },\n        );",
  },
  {
    path: "packages/infrastructure/src/httpCatalogAcquisitionProviders.ts",
    before: "throw new Error(`${config.providerName} timed out after ${config.timeoutMs} ms.`);",
    after:
      "throw new Error(`${config.providerName} timed out after ${config.timeoutMs} ms.`, { cause: error });",
  },
  {
    path: "packages/infrastructure/src/httpProductFingerprintProvider.ts",
    before:
      "throw new Error(`${this.config.providerName} timed out after ${this.config.timeoutMs} ms.`);",
    after:
      "throw new Error(`${this.config.providerName} timed out after ${this.config.timeoutMs} ms.`, { cause: error });",
  },
  {
    path: "packages/infrastructure/src/mercadoLibreQuestionAnswerExecutor.ts",
    before:
      "throw new Error(\n          `MercadoLibre question request timed out after ${this.config.timeoutMs} ms.`,\n        );",
    after:
      "throw new Error(\n          `MercadoLibre question request timed out after ${this.config.timeoutMs} ms.`,\n          { cause: error },\n        );",
  },
  {
    path: "packages/infrastructure/src/mercadoLibreTaxonomyHttpReader.ts",
    before:
      "throw new Error(\n          `MercadoLibre taxonomy read timed out after ${this.config.timeoutMs} ms for ${path}.`,\n        );",
    after:
      "throw new Error(\n          `MercadoLibre taxonomy read timed out after ${this.config.timeoutMs} ms for ${path}.`,\n          { cause: error },\n        );",
  },
  {
    path: "scripts/init-object-storage.mjs",
    before:
      'throw new AggregateError([error, createError], "Object storage bucket is unavailable.");',
    after:
      'throw new AggregateError([error, createError], "Object storage bucket is unavailable.", { cause: error });',
  },
  {
    path: "eslint.config.mjs",
    before: '        Buffer: "readonly",\n        URL: "readonly",',
    after: '        Buffer: "readonly",\n        Response: "readonly",\n        URL: "readonly",',
  },
];

for (const replacement of replacements) {
  const source = await readFile(replacement.path, "utf8");
  const occurrences = source.split(replacement.before).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one replacement in ${replacement.path}; found ${occurrences}.`,
    );
  }
  await writeFile(replacement.path, source.replace(replacement.before, replacement.after));
  console.log(`✓ ${replacement.path}`);
}
