# ─────────────────────────────────────────────
# Stage 1: Build the React app
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Accept the backend URL as a build argument so CRA can bake it in
ARG REACT_APP_API_URL=http://localhost:3002/api/v1
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Install dependencies first (layer-cache friendly)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Serve via nginx
# ─────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

# Remove default nginx site
RUN rm /etc/nginx/conf.d/default.conf

# Copy our SPA-friendly nginx config
COPY nginx.conf /etc/nginx/conf.d/app.conf

# Copy the built React app
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
