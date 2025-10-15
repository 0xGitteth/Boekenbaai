# syntax=docker/dockerfile:1

# Build stage: install dependencies and build the Vite frontend
FROM node:20 AS build
WORKDIR /app

# Install dependencies based on the lockfile for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and run the frontend build
COPY . .
RUN npm run build

# Runtime stage: only keep production dependencies and built assets
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server code, static assets and seed data
COPY --from=build /app/dist ./dist
COPY server.js ./server.js
COPY public ./public
COPY data ./data

EXPOSE 3000
CMD ["npm", "start"]
