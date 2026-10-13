# syntax=docker/dockerfile:1

FROM node:26-alpine AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Both are build-time values: PUBLIC_API_BASE is baked into the client bundle
# via $env/static/public, and PRERENDER_ORIGIN becomes the origin of the
# canonical/hreflang/Open Graph URLs and sitemap.xml written during the build.
ARG PUBLIC_API_BASE=http://localhost:8080/v1
ARG PRERENDER_ORIGIN=https://opencw.net
ENV PUBLIC_API_BASE=$PUBLIC_API_BASE
ENV PRERENDER_ORIGIN=$PRERENDER_ORIGIN

# Generate .svelte-kit files in clean build environments, gate on the message,
# SEO and type checks, then build.
RUN npm run prepare && npm run verify && npm run build

# The output is a fully static site (prerendered pages, assets, fallback 404).
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
