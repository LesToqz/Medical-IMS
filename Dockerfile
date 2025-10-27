FROM node:22-alpine
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./server.js
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
