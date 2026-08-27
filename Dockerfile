# Creaciones Melvin — ventas (Node 24, cero dependencias)
#
# Imagen base PINEADA por digest OCI (verificado en gym-node-02):
#   node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
# El pin garantiza builds reproducibles: el contenido de la imagen no cambia
# aunque el tag "24-alpine" avance. Para actualizar: `docker pull node:24-alpine`,
# obtener el digest con `docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine`
# y sustituirlo aquí (verificar el nuevo digest antes de desplegar).
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

# No ejecutar como root
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copiar código (no hay node_modules: todo usa built-ins de Node)
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY productos.json ./

RUN mkdir -p /app/data && chown -R app:app /app

USER app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/sales.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/main.js"]
