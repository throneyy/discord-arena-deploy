FROM node:20-slim

WORKDIR /app

# Prisma needs OpenSSL
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
