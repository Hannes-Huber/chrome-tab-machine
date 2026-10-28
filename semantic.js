import { env, pipeline } from "@huggingface/transformers";
import ortWasmModuleUrl from "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmBinaryUrl from "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

const MODEL_ID = "multilingual-e5-small";
let extractorPromise;

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = chrome.runtime.getURL("models/");
env.backends.onnx.wasm.wasmPaths = {
  mjs: ortWasmModuleUrl,
  wasm: ortWasmBinaryUrl
};

async function getExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      local_files_only: true,
      progress_callback: (event) => onProgress?.(event)
    }).catch((error) => {
      extractorPromise = undefined;
      throw error;
    });
  }
  return extractorPromise;
}

export async function embedTexts(texts, onProgress) {
  const extractor = await getExtractor(onProgress);
  const vectors = [];
  const batchSize = 8;
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize).map((text) => `passage: ${text}`);
    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
      padding: true,
      truncation: true
    });
    vectors.push(...output.tolist());
    onProgress?.({ status: "embedding", completed: vectors.length, total: texts.length });
  }
  return vectors;
}
