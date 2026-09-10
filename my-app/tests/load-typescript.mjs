import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export default function loadTypeScript(file, mocks = {}, globals = {}, sourceOverride) {
  const source = sourceOverride ?? fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    module: compiledModule, exports: compiledModule.exports,
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected test dependency: ${name}`);
    },
    Response, Request, Headers, URL, URLSearchParams, AbortController, AbortSignal, Buffer,
    ReadableStream, TextDecoder, TextEncoder, setTimeout, clearTimeout, console,
    ...globals,
  }, { filename: String(file) });
  return compiledModule.exports;
}
