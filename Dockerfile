FROM node:20-alpine

WORKDIR /app
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 7778

USER node
CMD ["node", "server.js"]
