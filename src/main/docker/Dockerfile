FROM node:20-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
# Install Claude Code CLI globally (the SDK spawns it as a subprocess)
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY worker.mjs .
WORKDIR /workspace
ENTRYPOINT ["node", "/app/worker.mjs"]
