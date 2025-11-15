# Use official Node.js 20 runtime
FROM node:20-slim
# Create app directory
WORKDIR /app
# Install app dependencies
COPY package*.json ./
RUN npm install --omit=dev
# Bundle app source
COPY . .
# Expose Cloud Run port
ENV PORT=8080
EXPOSE 8080
# Start app
CMD ["node", "index.js"]
