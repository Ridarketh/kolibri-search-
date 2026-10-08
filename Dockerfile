# Kolibri network server. Build from the repository root:
#   docker build -t kolibri-server .
#   docker run -p 8787:8787 -v kolibri-data:/app/server/data kolibri-server
FROM node:22-alpine
WORKDIR /app
COPY extension/shared ./extension/shared
COPY server ./server
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
EXPOSE 8787
VOLUME ["/app/server/data"]
USER node
CMD ["node", "server/src/index.js"]
