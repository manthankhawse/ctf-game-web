# Use a lightweight Node.js image
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install system tools needed for some Node modules
RUN apk add --no-cache python3 make g++

# Copy package files first to utilize Docker caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the server code
COPY . .

# Default command (can be overridden in docker-compose)
CMD [ "node", "server.js" ]