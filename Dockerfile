# syntax=docker/dockerfile:1

FROM node:20-slim AS app
WORKDIR /app

# Installeer alle dependencies om de frontend te kunnen builden
COPY package.json package-lock.json ./
RUN npm ci

# Kopieer de volledige broncode en bouw de Vite-app
COPY . .
RUN npm run build

# Verwijder dev-dependencies zodat de runtime schoon blijft
RUN npm prune --omit=dev

# Zorg dat Node in production-modus draait
ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]
