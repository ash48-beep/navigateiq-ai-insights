# ─────────────────────────────────────────────
# Stage 1: Build the React app
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# ── Build-time variables (CRA bakes all REACT_APP_* into the JS bundle) ──
ARG REACT_APP_API_URL=http://localhost:3002/api/v1
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Admin Cognito pool — baked in at build time (used only on /admin route)
# Client Cognito config is fetched at runtime from /client-config/:slug
ARG REACT_APP_ADMIN_COGNITO_USER_POOL_ID
ENV REACT_APP_ADMIN_COGNITO_USER_POOL_ID=$REACT_APP_ADMIN_COGNITO_USER_POOL_ID

ARG REACT_APP_ADMIN_COGNITO_CLIENT_ID
ENV REACT_APP_ADMIN_COGNITO_CLIENT_ID=$REACT_APP_ADMIN_COGNITO_CLIENT_ID

ARG REACT_APP_ADMIN_COGNITO_REGION=ap-south-1
ENV REACT_APP_ADMIN_COGNITO_REGION=$REACT_APP_ADMIN_COGNITO_REGION

# Install dependencies
# Using npm install instead of npm ci to handle lock file version differences
# across npm versions (development vs Docker image)
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

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
