FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY server ./server
USER node
ENV HOST=0.0.0.0 PORT=3002 DATA_DIR=/data
EXPOSE 3002
CMD ["node", "server/index.mjs"]
