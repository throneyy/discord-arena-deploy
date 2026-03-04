FROM node:20-slim

WORKDIR /app

# Install dependencies (no lock file - fresh install)
COPY package.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY . .

# Railway provides PORT via env
EXPOSE 3000

CMD ["node", "src/index.js"]
