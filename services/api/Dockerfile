FROM node:20-alpine

RUN apk add --no-cache tini
RUN npm install -g tsx

WORKDIR /app

COPY apps/api/package.json ./package.json
RUN sed -i '/"@haxvibe\/shared-types"/d' package.json && \
    sed -i '/"bullmq"/d' package.json && \
    sed -i '/"ioredis"/d' package.json && \
    npm install

COPY packages/shared-types/ ./node_modules/@haxvibe/shared-types/
COPY apps/api/src/ ./src/
COPY apps/api/tsconfig.json ./

USER node
ENV NODE_ENV=production
ENV PORT=4000
ENV API_PORT=4000
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tsx", "src/server.ts"]
