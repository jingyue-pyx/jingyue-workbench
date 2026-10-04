FROM node:22-bookworm-slim

# Pin the agent independently of the workbench. No repository or credentials
# enter this image; the build context is this directory only.
ARG OPENCODE_VERSION=1.18.34
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global opencode-ai@${OPENCODE_VERSION} \
    && npm cache clean --force
USER node
WORKDIR /workspace
ENV OPENCODE_DISABLE_AUTOUPDATE=true \
    OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
    OPENCODE_DISABLE_PROJECT_CONFIG=true \
    OPENCODE_DISABLE_CLAUDE_CODE=true
EXPOSE 4096
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
