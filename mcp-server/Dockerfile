FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app/mcp-server

# Pull patched Alpine packages before installing dependencies, as the other RyanAI images do.
RUN apk upgrade --no-cache \
    && apk add --no-cache 'libexpat>=2.10.0-r0'

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY mcp-server/index.js mcp-server/http.js mcp-server/provider-router.js mcp-server/stdio.js mcp-server/health-url.js mcp-server/tool-registry.js mcp-server/delegation.js ./
RUN node --check index.js \
    && node --check http.js \
    && node --check delegation.js
COPY src/mcp/canonical-tool-registry.json /app/src/mcp/canonical-tool-registry.json
COPY stacks/ryanai.stack.json /app/stacks/ryanai.stack.json

USER node
EXPOSE 8765
CMD ["node", "http.js"]
