FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node data/catalog.json data/sources.json ./data/
RUN mkdir -p /var/lib/backstage && chown node:node /var/lib/backstage
USER node
ENV HOST=0.0.0.0 PORT=3000 COOKIE_SECURE=true DB_PATH=/var/lib/backstage/backstage.sqlite
VOLUME /var/lib/backstage
EXPOSE 3000
CMD ["node", "server.js"]
