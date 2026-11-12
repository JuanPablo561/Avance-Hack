FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --omit=dev
COPY backend ./backend
COPY frontend ./frontend
USER node
EXPOSE 3000
CMD ["node", "backend/server.cjs"]
