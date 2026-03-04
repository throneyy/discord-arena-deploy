#!/bin/sh
echo "=== WRAPPER START ==="
echo "Running Prisma db push..."
npx prisma db push --skip-generate 2>&1
PRISMA_EXIT=$?
echo "Prisma exit code: $PRISMA_EXIT"
if [ $PRISMA_EXIT -ne 0 ]; then
  echo "Prisma failed, exiting"
  exit 1
fi

echo "=== Starting Node.js ==="
echo "Node version: $(node --version)"
echo "Working directory: $(pwd)"
echo "Files: $(ls src/)"

# Run node and capture both stdout and stderr
node src/index.js 2>&1
NODE_EXIT=$?
echo "Node exit code: $NODE_EXIT"
