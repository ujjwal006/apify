# Use Apify's Playwright base image (includes all browser deps)
FROM apify/actor-node-playwright-chrome:18

# Copy package files and install dependencies
COPY package*.json ./
RUN npm --quiet set progress=false \
  && npm install --only=prod --no-optional \
  && echo "Dependencies installed"

# Copy source files
COPY . ./

# Run as non-root user
USER myuser

CMD ["node", "main.js"]
