# Use a recent Node.js LTS base image
FROM node:22-slim

# Set the working directory
WORKDIR /usr/src/app

# Install build tools required for native modules (e.g. bcrypt)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 4000

# Define environment variables (adjust if needed)
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]
