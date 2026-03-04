#!/bin/sh
set -e

echo "=== START SCRIPT ==="
echo "Running prisma db push..."
npx prisma db push
echo "Prisma done."

echo "Starting node app..."
exec node src/index.js
