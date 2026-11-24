# syntax=docker/dockerfile:1.7

# The workshop image. Everything heavy is already inside: Node 24, ffmpeg,
# whisper-cli, both Whisper models and the reranker model. The clips are not;
# the fetch script downloads them when the container is created.

ARG BASE_IMAGE=mcr.microsoft.com/devcontainers/javascript-node:4-24-bookworm

FROM ${BASE_IMAGE} AS base
# Without this, onnxruntime-node downloads CUDA libraries during `npm ci` on Linux.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    WHISPER_MODELS_DIR=/opt/whisper/models \
    TRANSFORMERS_CACHE_DIR=/opt/transformers-cache


# whisper-cli, built portable: native tuning off, so the build machine's CPU never
# leaks into the binary. x64 turns on AVX2, FMA and F16C explicitly.
FROM base AS whisper-cli
ARG WHISPER_CPP_TAG=v1.9.4
ARG WHISPER_CPP_COMMIT=927cfce34f31707e17f2bff35c349632fb9e2c3a
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_CPP_TAG}" https://github.com/ggml-org/whisper.cpp /src/whisper.cpp \
    && test "$(git -C /src/whisper.cpp rev-parse HEAD)" = "${WHISPER_CPP_COMMIT}"
WORKDIR /src/whisper.cpp
RUN set -eux; \
    x64_flags=""; \
    if [ "${TARGETARCH}" = "amd64" ]; then \
      x64_flags="-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"; \
    fi; \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF ${x64_flags} -DWHISPER_BUILD_TESTS=OFF; \
    cmake --build build --config Release --target whisper-cli -j "$(nproc)"


# The quantized Whisper models, pinned by revision and checked by hash.
FROM base AS whisper-models
ARG WHISPER_MODELS_REVISION=5359861c739e955e79d9a303bcbc70fb988958b1
WORKDIR ${WHISPER_MODELS_DIR}
RUN set -eux; \
    url="https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODELS_REVISION}"; \
    curl -fsSL -o ggml-base.en-q5_1.bin "${url}/ggml-base.en-q5_1.bin"; \
    curl -fsSL -o ggml-small.en-q5_1.bin "${url}/ggml-small.en-q5_1.bin"; \
    printf '%s  %s\n' \
      4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f ggml-base.en-q5_1.bin \
      bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30 ggml-small.en-q5_1.bin \
      | sha256sum -c -


# The reranker model, downloaded by the lockfile's own Transformers.js so the cache
# holds exactly the files the shipped client loads. The second load runs with
# remote models off, which proves the cache is complete.
FROM base AS reranker
WORKDIR /warm
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/local-models.ts src/
COPY <<'EOF' warm-reranker.ts
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
} from "@huggingface/transformers";
import { reranker, transformersCacheDir } from "./src/local-models.ts";

env.cacheDir = transformersCacheDir;
const load = async () => [
  await AutoTokenizer.from_pretrained(reranker.id),
  await AutoModelForSequenceClassification.from_pretrained(reranker.id, {
    dtype: reranker.dtype,
  }),
] as const;

await load();
env.allowRemoteModels = false;
const [tokenizer, model] = await load();
const inputs = tokenizer(["Who runs the toy shop?"], {
  text_pair: ["The toymaker runs the toy shop."],
});
const { logits } = await model(inputs);
console.log(`reranker loads offline, score ${logits.data[0]}`);
EOF
RUN node warm-reranker.ts


FROM base
# Links the package to the public repo, so the package inherits its access. GitHub
# reads this only when the package is first published. Access is not visibility:
# a new package starts private whatever the repo is, so make it public by hand.
LABEL org.opencontainers.image.source="https://github.com/nstaab1/roll-for-retrieval"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=whisper-cli /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-models --chown=node:node ${WHISPER_MODELS_DIR} ${WHISPER_MODELS_DIR}
COPY --from=reranker --chown=node:node ${TRANSFORMERS_CACHE_DIR} ${TRANSFORMERS_CACHE_DIR}
# Fail the build on a missing shared library, and on an SSH server: attendees
# use the browser terminal.
RUN ! ldd /usr/local/bin/whisper-cli | grep 'not found' \
    && ! command -v sshd
