FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./

RUN npm install

EXPOSE 3000

CMD ["npm", "run", "dev"]
