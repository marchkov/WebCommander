FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    WC_PORT=3001 \
    WC_ROOT_PATH=/data/webcommander \
    WC_ALLOWED_PATHS=/data/webcommander \
    WC_BLOCKED_PATHS=/etc,/root,/var/log \
    WC_AUTH_ENABLED=true \
    WC_AUTH_USERS=[{"username":"admin","password":"***REMOVED***"}] \
    WC_SESSION_SECRET=***REMOVED*** \
    WC_SESSION_MAX_AGE=86400000 \
    WC_MAX_FILE_SIZE=104857600 \
    WC_ALLOWED_EXTENSIONS=*

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/config.json ./config.json

RUN mkdir -p /data/webcommander

EXPOSE 3001

CMD ["node", "server/index.js"]
